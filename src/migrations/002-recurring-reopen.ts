/** Migración 002 — Recurrentes atrapadas en "Listo"
 *
 *  Antes, completar una tarea recurrente la dejaba en Listo para siempre, aunque
 *  al día siguiente volviera a hacer falta. Ahora se anota la ocurrencia y la
 *  tarea regresa a Pendiente.
 *
 *  Esta migración rescata las que quedaron cerradas con el modelo anterior:
 *  las devuelve a Pendiente y registra cuándo se completaron, tomando la fecha
 *  de su historial para no inventar datos.
 *
 *  Uso: npx ts-node src/migrations/002-recurring-reopen.ts [--dry-run]
 */
import mongoose from 'mongoose'
import dotenv from 'dotenv'

dotenv.config()

const MIGRATION_NAME = '002-recurring-reopen'
const DRY_RUN = process.argv.includes('--dry-run')

const RECURRING = ['daily', 'everyOtherDay', 'weekly', 'biweekly', 'monthly']

const run = async () => {
    await mongoose.connect(process.env.DATABASE_URL!)
    const db = mongoose.connection.db

    console.log(`\n=== Migración ${MIGRATION_NAME}${DRY_RUN ? ' (SIMULACIÓN)' : ''} ===\n`)

    const stuck = await db.collection('tasks').find({
        status: 'done',
        frequency: { $in: RECURRING }
    }).toArray()

    for (const task of stuck) {
        // La fecha real de cierre está en el historial; si no, se usa updatedAt.
        const lastDone = [...(task.statusHistory ?? [])]
            .reverse()
            .find((entry: Record<string, unknown>) => entry.to === 'done')

        const completedAt = (lastDone?.changedAt as Date) ?? task.updatedAt ?? new Date()

        console.log(`"${task.name}" (${task.frequency}) -> Pendiente, completada el ${new Date(completedAt).toISOString()}`)

        if (!DRY_RUN) {
            await db.collection('tasks').updateOne(
                { _id: task._id },
                {
                    $set: { status: 'pending', lastCompletedAt: completedAt },
                    $push: {
                        statusHistory: {
                            from: 'done',
                            to: 'pending',
                            changedBy: null,
                            changedAt: new Date(),
                            note: `Migración ${MIGRATION_NAME}: recurrente reabierta para su próxima ocurrencia`
                        }
                    } as never
                }
            )
        }
    }

    console.log(`\nRecurrentes reabiertas: ${stuck.length}`)

    if (!DRY_RUN && stuck.length > 0) {
        const already = await db.collection('migrations').findOne({ name: MIGRATION_NAME })
        if (!already) {
            await db.collection('migrations').insertOne({ name: MIGRATION_NAME, appliedAt: new Date() })
        }
    }
    if (DRY_RUN) console.log('SIMULACIÓN: no se escribió nada.')

    await mongoose.disconnect()
    process.exit(0)
}

run().catch(error => {
    console.error('La migración falló:', error)
    process.exit(1)
})
