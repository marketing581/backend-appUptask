import { DEFAULT_TIMEZONE, addDays, utcToZonedParts, zonedTimeToUtc, zonedWeekday } from './datetime'

/** Cuánto tiempo pasó dentro del horario de oficina, no en el reloj
 *  corrido: para el informe de "En proceso a Listo" una tarea que empieza
 *  el viernes a las 5 p. m. y termina el lunes a las 10 a. m. debe contar
 *  3 horas, no todo el fin de semana de por medio. */

const BUSINESS_START_HOUR = 8
const BUSINESS_END_HOUR = 18

/** Minutos de lunes a viernes, 8 a. m.–6 p. m. en la zona dada, que caen
 *  dentro de `[start, end)`. Recorre día por día y suma el solape entre la
 *  ventana laboral de ese día y el intervalo real — sin descontar
 *  almuerzos ni feriados todavía (fuera de alcance de esta primera
 *  versión). */
export function businessMinutesBetween(start: Date, end: Date, timezone: string = DEFAULT_TIMEZONE): number {
    if (end <= start) return 0

    let totalMs = 0
    const startParts = utcToZonedParts(start, timezone)
    let cursor = zonedTimeToUtc(startParts.year, startParts.month, startParts.day, 0, 0, timezone)

    while (cursor < end) {
        if (zonedWeekday(cursor, timezone) <= 5) {
            const p = utcToZonedParts(cursor, timezone)
            const windowStart = zonedTimeToUtc(p.year, p.month, p.day, BUSINESS_START_HOUR, 0, timezone)
            const windowEnd = zonedTimeToUtc(p.year, p.month, p.day, BUSINESS_END_HOUR, 0, timezone)
            const overlapStart = start > windowStart ? start : windowStart
            const overlapEnd = end < windowEnd ? end : windowEnd
            if (overlapEnd > overlapStart) totalMs += overlapEnd.getTime() - overlapStart.getTime()
        }
        cursor = addDays(cursor, 1)
    }

    return Math.round(totalMs / 60000)
}
