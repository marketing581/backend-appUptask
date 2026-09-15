/** Migración 001 — Modelo de trabajo
 *
 *  Mapea los cinco estados antiguos al modelo Pendiente / En proceso / Listo
 *  con indicadores superpuestos, conservando el estado anterior en el historial:
 *
 *    inProgress   -> inProgress
 *    completed    -> done
 *    underReview  -> inProgress + review.needed
 *    onHold       -> pending    + onHold.active
 *    pending      -> pending
 *
 *  También convierte `completedBy` en `statusHistory`, asigna el rol de
 *  encargada a quien ya gestiona proyectos y rellena los campos nuevos.
 *
 *  Es idempotente: se registra en la colección `migrations` y al reejecutarse
 *  solo completa lo que falte.
 *
 *  Uso:
 *    npx ts-node src/migrations/001-work-model.ts --dry-run
 *    npx ts-node src/migrations/001-work-model.ts
 */
import mongoose from 'mongoose'
import dotenv from 'dotenv'

dotenv.config()

const MIGRATION_NAME = '001-work-model'
const DRY_RUN = process.argv.includes('--dry-run')

const STATUS_MAP: Record<string, { status: string, review?: boolean, onHold?: boolean }> = {
    pending: { status: 'pending' },
    inProgress: { status: 'inProgress' },
    completed: { status: 'done' },
    underReview: { status: 'inProgress', review: true },
    onHold: { status: 'pending', onHold: true }
}

const LEGACY_STATUSES = ['completed', 'underReview', 'onHold']

const log = (...args: unknown[]) => console.log(...args)

const run = async () => {
    await mongoose.connect(process.env.DATABASE_URL!)
    const db = mongoose.connection.db

    log(`\n=== Migración ${MIGRATION_NAME}${DRY_RUN ? ' (SIMULACIÓN)' : ''} ===`)
    log(`Base de datos: ${db.databaseName}\n`)

    const alreadyApplied = await db.collection('migrations').findOne({ name: MIGRATION_NAME })
    if (alreadyApplied) {
        log(`Ya se aplicó el ${alreadyApplied.appliedAt}. Se completarán solo los campos faltantes.\n`)
    }

    // ---------- Usuarias ----------
    const projectManagerIds = await db.collection('projects').distinct('manager')
    const managerIdSet = new Set(projectManagerIds.filter(Boolean).map(id => id.toString()))

    const users = await db.collection('users').find({}).toArray()
    let usersTouched = 0

    for (const user of users) {
        const updates: Record<string, unknown> = {}

        if (user.role === undefined) {
            // Quien ya gestiona algún proyecto pasa a encargada; el resto, integrante.
            updates.role = managerIdSet.has(user._id.toString()) ? 'manager' : 'member'
        }
        if (user.timezone === undefined) updates.timezone = 'America/Lima'
        if (user.schedulePrefs === undefined) {
            updates.schedulePrefs = { dayStartHour: 8, dayEndHour: 18, showWeekends: false }
        }

        if (Object.keys(updates).length > 0) {
            usersTouched++
            log(`usuaria  ${user.email} -> ${JSON.stringify(updates)}`)
            if (!DRY_RUN) {
                await db.collection('users').updateOne({ _id: user._id }, { $set: updates })
            }
        }
    }
    log(`Usuarias actualizadas: ${usersTouched}/${users.length}\n`)

    // ---------- Proyectos ----------
    const projectsPending = await db.collection('projects').countDocuments({ brand: { $exists: false } })
    if (!DRY_RUN && projectsPending > 0) {
        await db.collection('projects').updateMany(
            { brand: { $exists: false } },
            { $set: { brand: null } }
        )
    }
    log(`Proyectos con marca inicializada en null: ${projectsPending}`)
    log('(No se reclasifica ningún proyecto automáticamente.)\n')

    // ---------- Tareas ----------
    const tasks = await db.collection('tasks').find({}).toArray()
    let tasksMigrated = 0
    let tasksBackfilled = 0

    for (const task of tasks) {
        const oldStatus: string = task.status ?? 'pending'
        const needsStatusMigration = LEGACY_STATUSES.includes(oldStatus)
        const mapping = STATUS_MAP[oldStatus] ?? { status: 'pending' }

        const set: Record<string, unknown> = {}
        const unset: Record<string, unknown> = {}

        // --- Estado y sus indicadores ---
        if (needsStatusMigration) {
            set.status = mapping.status
            set['review.needed'] = !!mapping.review
            set['review.approver'] = null
            set['review.requestedAt'] = mapping.review ? (task.updatedAt ?? new Date()) : null
            set['onHold.active'] = !!mapping.onHold
            set['onHold.reason'] = mapping.onHold ? 'Migrado del estado "En espera" anterior' : ''
            set['onHold.waitingOn'] = ''
            set['onHold.followUpDate'] = null
        } else {
            if (task.review === undefined) {
                set.review = { needed: false, approver: null, requestedAt: null }
            }
            if (task.onHold === undefined) {
                set.onHold = { active: false, reason: '', waitingOn: '', followUpDate: null }
            }
        }

        // --- Historial: completedBy -> statusHistory, preservando el estado previo ---
        if (task.statusHistory === undefined) {
            const history = (task.completedBy ?? []).map((entry: Record<string, unknown>) => ({
                from: null,
                to: STATUS_MAP[entry.status as string]?.status ?? 'pending',
                changedBy: entry.user ?? null,
                changedAt: task.updatedAt ?? task.createdAt ?? new Date(),
                note: `Migrado del estado anterior "${entry.status}"`
            }))

            if (needsStatusMigration) {
                history.push({
                    from: null,
                    to: mapping.status,
                    changedBy: null,
                    changedAt: new Date(),
                    note: `Migración ${MIGRATION_NAME}: estado anterior "${oldStatus}"`
                })
            }

            set.statusHistory = history
            unset.completedBy = ''
        }

        // --- Campos nuevos (solo si faltan) ---
        if (task.description === undefined) set.description = ''
        if (task.project === undefined) set.project = null
        if (task.brand === undefined) set.brand = null
        if (task.assignee === undefined) set.assignee = null
        if (task.collaborators === undefined) set.collaborators = []
        if (task.createdBy === undefined) set.createdBy = null
        if (task.definitionOfDone === undefined) set.definitionOfDone = ''
        if (task.priority === undefined) set.priority = 'medium'
        if (task.estimatedMinutes === undefined) set.estimatedMinutes = null
        if (task.dueDate === undefined) set.dueDate = null
        if (task.checklist === undefined) set.checklist = []
        if (task.dependencies === undefined) set.dependencies = []
        if (task.parentTask === undefined) set.parentTask = null

        if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) continue

        if (needsStatusMigration) {
            tasksMigrated++
            log(`tarea    "${task.name}": ${oldStatus} -> ${mapping.status}` +
                `${mapping.review ? ' + necesita revisión' : ''}${mapping.onHold ? ' + en espera' : ''}`)
        } else {
            tasksBackfilled++
        }

        if (!DRY_RUN) {
            const update: Record<string, unknown> = { $set: set }
            if (Object.keys(unset).length > 0) update.$unset = unset
            await db.collection('tasks').updateOne({ _id: task._id }, update)
        }
    }

    log(`\nTareas con estado migrado: ${tasksMigrated}`)
    log(`Tareas con campos nuevos completados: ${tasksBackfilled}`)
    log(`Tareas totales: ${tasks.length}\n`)

    if (!DRY_RUN && !alreadyApplied) {
        await db.collection('migrations').insertOne({
            name: MIGRATION_NAME,
            appliedAt: new Date()
        })
        log('Migración registrada en la colección `migrations`.')
    }

    if (DRY_RUN) log('SIMULACIÓN: no se escribió ningún cambio.')

    log('Listo.\n')
    await mongoose.disconnect()
    process.exit(0)
}

run().catch(error => {
    console.error('La migración falló:', error)
    process.exit(1)
})
