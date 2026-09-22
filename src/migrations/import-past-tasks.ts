/** Importa pendientes puntuales exportados de Notion.
 *
 *  Está pensado para el histórico: filas ya cerradas que interesan como
 *  memoria de lo hecho ("Pendientes pasados"), no como trabajo por hacer.
 *  Entran como pendientes puntuales —sin proyecto y sin frecuencia—, que es
 *  exactamente lo que son: ni mantenimiento que se repite ni tarea de un
 *  proyecto con seguimiento.
 *
 *  El CSV se pasa por ruta y no se guarda en el repositorio: son datos de
 *  trabajo del equipo, no código. Misma decisión que con las notas.
 *
 *  Es idempotente: identifica por nombre + responsable, así que reejecutarlo
 *  actualiza en vez de duplicar.
 *
 *  Para uso puntual sin tocar la terminal, hay una versión de autoservicio
 *  en la propia app: ver `ImportController`/`ImportNotionView`.
 *
 *  Uso:
 *    npx ts-node src/migrations/import-past-tasks.ts <ruta.csv> \
 *        --email=sofi@greendreams.pe [--dia="Pendientes pasados"] [--dry-run]
 */
import fs from 'fs'
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import User from '../models/User'
import Task, { taskFrequency } from '../models/Task'
import { NOTION_IMPORT_NOTE, planNotionImport } from '../utils/notionImport'

dotenv.config()

function arg(name: string, fallback = '') {
    const found = process.argv.find(item => item.startsWith(`--${name}=`))
    return found ? found.slice(name.length + 3) : fallback
}

async function main() {
    const csvPath = process.argv[2]
    const email = arg('email')
    const dia = arg('dia', 'Pendientes pasados')
    const dryRun = process.argv.includes('--dry-run')

    if (!csvPath || !email) {
        console.error('Uso: import-past-tasks.ts <ruta.csv> --email=<responsable> [--dia=...] [--dry-run]')
        process.exit(1)
    }
    if (!fs.existsSync(csvPath)) {
        console.error(`No existe el archivo: ${csvPath}`)
        process.exit(1)
    }

    await mongoose.connect(process.env.DATABASE_URL!)

    const owner = await User.findOne({ email })
    if (!owner) {
        console.error(`No existe la usuaria ${email}`)
        await mongoose.disconnect()
        process.exit(1)
    }

    const text = fs.readFileSync(csvPath, 'utf8')
    const totalRows = text.split('\n').length
    const rows = planNotionImport(text, dia)

    console.log(`${totalRows} filas leídas · ${rows.length} únicas en "${dia}"`)
    if (dryRun) console.log('— simulación: no se escribe nada —\n')

    let created = 0
    let updated = 0

    for (const row of rows) {
        const existing = await Task.findOne({ name: row.name, assignee: owner._id })

        if (existing) {
            updated++
            if (dryRun) continue
            existing.status = row.status
            existing.frequency = taskFrequency.NONE
            if (row.description && !existing.description) existing.description = row.description
            await existing.save()
            continue
        }

        created++
        if (dryRun) continue

        await Task.create({
            name: row.name,
            description: row.description,
            workspace: owner.workspace,
            assignee: owner._id,
            createdBy: owner._id,
            project: null,
            frequency: taskFrequency.NONE,
            status: row.status,
            onHold: { active: row.onHold, reason: '', waitingOn: '', followUpDate: null },
            statusHistory: [{
                from: null,
                to: row.status,
                changedBy: owner._id,
                changedAt: new Date(),
                note: NOTION_IMPORT_NOTE
            }]
        })
    }

    console.log(`${created} creadas · ${updated} ya existían`)
    await mongoose.disconnect()
}

main().catch(async error => {
    console.error(error)
    await mongoose.disconnect()
    process.exit(1)
})
