import { taskStatus, TaskStatus } from '../models/Task'

/** Lo compartido entre el script de línea de comandos
 *  (`migrations/import-past-tasks.ts`) y el módulo de autoservicio
 *  (`ImportController`): leer el CSV que exporta Notion y traducir sus
 *  columnas a lo que entiende esta app. */

export const NOTION_IMPORT_NOTE = 'Importado del histórico de Notion'

/** Lector de CSV según RFC 4180: comillas dobles, comas y saltos de línea
 *  dentro de un campo. Los títulos de los pendientes llevan comas, así que
 *  partir por `,` a secas rompería filas. */
export function parseCsv(text: string): string[][] {
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

export function toRecords(text: string): Record<string, string>[] {
    const [header, ...body] = parseCsv(text)
    if (!header) return []
    return body.map(cells =>
        Object.fromEntries(header.map((key, index) => [key.trim(), (cells[index] ?? '').trim()]))
    )
}

/** Los estados de Notion no coinciden uno a uno con los nuestros: «Stand by»
 *  es una tarea pendiente que además está en espera, no un estado aparte. */
export function mapNotionStatus(estado: string): { status: TaskStatus, onHold: boolean } {
    const value = estado.toLowerCase()
    if (value === 'listo') return { status: taskStatus.DONE, onHold: false }
    if (value === 'en proceso') return { status: taskStatus.IN_PROGRESS, onHold: false }
    if (value === 'stand by') return { status: taskStatus.PENDING, onHold: true }
    return { status: taskStatus.PENDING, onHold: false }
}

export type NotionImportRow = {
    name: string
    status: TaskStatus
    onHold: boolean
    description: string
}

/** Del CSV completo a la lista de filas que de verdad se van a importar:
 *  filtradas por columna "Día" (si se pide una), con nombre, y sin
 *  duplicados —el mismo título puede repetirse en el tablero de origen;
 *  aquí una tarea es una sola, así que se queda la primera aparición. */
export function planNotionImport(text: string, day?: string): NotionImportRow[] {
    const records = toRecords(text)
    const wanted = records.filter(row =>
        (!day || (row['Día'] ?? '') === day) && (row['Tarea'] ?? '').length > 0
    )

    const seen = new Set<string>()
    const unique = wanted.filter(row => {
        const key = row['Tarea'].toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })

    return unique.map(row => {
        const { status, onHold } = mapNotionStatus(row['Estado'] ?? '')
        return { name: row['Tarea'], status, onHold, description: row['Comentarios'] ?? '' }
    })
}
