/** Migración 003 — Multi-equipo
 *
 *  Hasta ahora UpTask era de un solo equipo: nada distinguía "de quién" era
 *  una tarea, un proyecto, una nota o una marca. Esta migración introduce el
 *  workspace como frontera de aislamiento:
 *
 *  1. Crea (o encuentra) dos workspaces: "Equipo de Marketing" y
 *     "Equipo de Desarrollo".
 *  2. Todo lo que ya existe —usuarias, tareas, proyectos, notas, notas de
 *     tarea, bloques de calendario, marcas— se etiqueta con el workspace de
 *     Marketing. Nada cambia para nadie hoy.
 *  3. La cuenta que ya tenía acceso especial a Informes (por id exacto)
 *     queda marcada `isSuperAdmin: true`, generalizando ese mismo permiso
 *     en vez de duplicar el id en dos sitios del código.
 *  4. "Equipo de Desarrollo" queda creado y vacío: listo para recibir
 *     personas más adelante.
 *
 *  Uso: npx ts-node src/migrations/003-workspaces.ts [--dry-run]
 */
import mongoose from 'mongoose'
import dotenv from 'dotenv'

dotenv.config()

const MIGRATION_NAME = '003-workspaces'
const DRY_RUN = process.argv.includes('--dry-run')

const MARKETING_NAME = 'Equipo de Marketing'
const DEVELOPMENT_NAME = 'Equipo de Desarrollo'

// Mismo id que ya usaban `REPORTS_OWNER_ID` en el backend y en el frontend:
// se reutiliza como ancla de identidad en vez de buscar por email.
const SUPER_ADMIN_ID = '6aa94c7d5c6817e6ae2e46d3'

const WORKSPACE_SCOPED_COLLECTIONS = ['users', 'tasks', 'projects', 'notes', 'memos', 'timeblocks', 'brands']

const run = async () => {
    await mongoose.connect(process.env.DATABASE_URL!)
    const db = mongoose.connection.db

    console.log(`\n=== Migración ${MIGRATION_NAME}${DRY_RUN ? ' (SIMULACIÓN)' : ''} ===\n`)

    const already = await db.collection('migrations').findOne({ name: MIGRATION_NAME })
    if (already && !DRY_RUN) {
        console.log('Ya aplicada. Se revisa igual por si quedó algún documento sin workspace.')
    }

    let marketing = await db.collection('workspaces').findOne({ name: MARKETING_NAME })
    if (!marketing) {
        console.log(`Crear workspace "${MARKETING_NAME}"`)
        if (!DRY_RUN) {
            const result = await db.collection('workspaces').insertOne({
                name: MARKETING_NAME, createdAt: new Date(), updatedAt: new Date()
            })
            marketing = { _id: result.insertedId, name: MARKETING_NAME }
        }
    } else {
        console.log(`Workspace "${MARKETING_NAME}" ya existe (${marketing._id})`)
    }

    let development = await db.collection('workspaces').findOne({ name: DEVELOPMENT_NAME })
    if (!development) {
        console.log(`Crear workspace "${DEVELOPMENT_NAME}"`)
        if (!DRY_RUN) {
            const result = await db.collection('workspaces').insertOne({
                name: DEVELOPMENT_NAME, createdAt: new Date(), updatedAt: new Date()
            })
            development = { _id: result.insertedId, name: DEVELOPMENT_NAME }
        }
    } else {
        console.log(`Workspace "${DEVELOPMENT_NAME}" ya existe (${development._id})`)
    }

    // En dry-run, sin escritura real, se usa un id de mentira solo para poder
    // seguir mostrando los conteos de abajo sin romper.
    const marketingId = marketing?._id ?? new mongoose.Types.ObjectId()

    console.log('')
    for (const name of WORKSPACE_SCOPED_COLLECTIONS) {
        const pending = await db.collection(name).countDocuments({ workspace: { $exists: false } })
        console.log(`${name.padEnd(12)} sin workspace: ${pending}`)
        if (!DRY_RUN && pending > 0) {
            await db.collection(name).updateMany(
                { workspace: { $exists: false } },
                { $set: { workspace: marketingId } }
            )
        }
    }

    console.log('')
    const superAdmin = await db.collection('users').findOne({ _id: new mongoose.Types.ObjectId(SUPER_ADMIN_ID) })
    if (!superAdmin) {
        console.log(`Cuenta ${SUPER_ADMIN_ID} no encontrada: no se marca isSuperAdmin.`)
    } else if (superAdmin.isSuperAdmin) {
        console.log(`${superAdmin.email} ya es isSuperAdmin.`)
    } else {
        console.log(`Marcar isSuperAdmin: true en ${superAdmin.email}`)
        if (!DRY_RUN) {
            await db.collection('users').updateOne(
                { _id: superAdmin._id },
                { $set: { isSuperAdmin: true } }
            )
        }
    }

    if (!DRY_RUN) {
        await db.collection('migrations').updateOne(
            { name: MIGRATION_NAME },
            { $setOnInsert: { name: MIGRATION_NAME, appliedAt: new Date() } },
            { upsert: true }
        )
    }
    if (DRY_RUN) console.log('\nSIMULACIÓN: no se escribió nada.')

    await mongoose.disconnect()
    process.exit(0)
}

run().catch(error => {
    console.error('La migración falló:', error)
    process.exit(1)
})
