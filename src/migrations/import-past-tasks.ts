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
 *  Uso:
 *    npx ts-node src/migrations/import-past-tasks.ts <ruta.csv> \
 *        --email=sofi@greendreams.pe [--dia="Pendientes pasados"] [--dry-run]
 */
import fs from 'fs'
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import User from '../models/User'
import Task, { taskFrequency, taskStatus } from '../models/Task'

dotenv.config()

const IMPORT_NOTE = 'Importado del histórico de Notion'

/** Lector de CSV según RFC 4180: comillas dobles, comas y saltos de línea
 *  dentro de un campo. Los títulos de los pendientes llevan comas, así que
 *  partir por `,` a secas rompería filas. */
function parseCsv(text: string): string[][] {
    const rows: string[][] = []
    let row: string[] = []
    let field = ''
    let quoted = false

    // El BOM de las exportaciones de Notion se colaría en el primer encabezado.
    const input = text.replace(/^﻿/, '').replace(/\r\n/g, '\n')

    for (let i = 0; i < input.length; i++) {
        const char = input[i]

        if (quoted) {
            if (char === '"') {
                if (input[i + 1] === '"') { field += '"'; i++ }
                else quoted = false
            } else field += char
            continue
        }

        if (char === '"') quoted = true
        else if (char === ',') { row.push(field); field = '' }
        else if (char === '\n') { row.push(field); rows.push(row); row = []; field = '' }
        else field += char
    }

    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
    return rows.filter(cells => cells.some(cell => cell.trim().length > 0))
}

function toRecords(text: string): Record<string, string>[] {
    const [header, ...body] = parseCsv(text)
    if (!header) return []
    return body.map(cells =>
        Object.fromEntries(header.map((key, index) => [key.trim(), (cells[index] ?? '').trim()]))
    )
}

/** Los estados de Notion no coinciden uno a uno con los nuestros: «Stand by»
 *  es una tarea pendiente que además está en espera, no un estado aparte. */
function mapStatus(estado: string) {
    const value = estado.toLowerCase()
    if (value === 'listo') return { status: taskStatus.DONE, onHold: false }
    if (value === 'en proceso') return { status: taskStatus.IN_PROGRESS, onHold: false }
    if (value === 'stand by') return { status: taskStatus.PENDING, onHold: true }
    return { status: taskStatus.PENDING, onHold: false }
}

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

    const records = toRecords(fs.readFileSync(csvPath, 'utf8'))
    const wanted = records.filter(row => (row['Día'] ?? '') === dia && (row['Tarea'] ?? '').length > 0)

    // El mismo título puede repetirse en el tablero de origen; aquí una tarea
    // es una sola, así que se queda la primera aparición.
    const seen = new Set<string>()
    const unique = wanted.filter(row => {
        const key = row['Tarea'].toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })

    console.log(`${records.length} filas leídas · ${wanted.length} en "${dia}" · ${unique.length} únicas`)
    if (dryRun) console.log('— simulación: no se escribe nada —\n')

    let created = 0
    let updated = 0

    for (const row of unique) {
        const name = row['Tarea']
        const { status, onHold } = mapStatus(row['Estado'] ?? '')
        const comment = row['Comentarios'] ?? ''

        const existing = await Task.findOne({ name, assignee: owner._id })

        if (existing) {
            updated++
            if (dryRun) continue
            existing.status = status
            existing.frequency = taskFrequency.NONE
            if (comment && !existing.description) existing.description = comment
            await existing.save()
            continue
        }

        created++
        if (dryRun) continue

        await Task.create({
            name,
            description: comment,
            workspace: owner.workspace,
            assignee: owner._id,
            createdBy: owner._id,
            project: null,
            frequency: taskFrequency.NONE,
            status,
            onHold: { active: onHold, reason: '', waitingOn: '', followUpDate: null },
            statusHistory: [{
                from: null,
                to: status,
                changedBy: owner._id,
                changedAt: new Date(),
                note: IMPORT_NOTE
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
