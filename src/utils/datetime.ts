/** Conversión entre instantes UTC y hora de pared en una zona IANA.
 *  Los bloques se guardan en UTC y se interpretan en la zona de cada usuaria
 *  (por defecto America/Lima), configurable por perfil. */

export const DEFAULT_TIMEZONE = 'America/Lima'

export function isValidTimezone(timezone: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone })
        return true
    } catch {
        return false
    }
}

interface ZonedParts {
    year: number
    month: number
    day: number
    hour: number
    minute: number
    second: number
}

export function utcToZonedParts(date: Date, timezone: string): ZonedParts {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    })

    const parts: Record<string, string> = {}
    for (const part of formatter.formatToParts(date)) {
        if (part.type !== 'literal') parts[part.type] = part.value
    }

    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        // Intl usa "24" para medianoche con hour12:false en algunos entornos.
        hour: Number(parts.hour) % 24,
        minute: Number(parts.minute),
        second: Number(parts.second)
    }
}

/** Desplazamiento de la zona respecto a UTC, en milisegundos, para ese instante. */
function zoneOffsetMs(date: Date, timezone: string): number {
    const parts = utcToZonedParts(date, timezone)
    const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    return asIfUtc - date.getTime()
}

/** Hora de pared en una zona -> instante UTC.
 *  Doble pasada para resolver correctamente los cambios de horario de verano. */
export function zonedTimeToUtc(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    timezone: string
): Date {
    const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
    const firstGuess = naive - zoneOffsetMs(new Date(naive), timezone)
    const refinedOffset = zoneOffsetMs(new Date(firstGuess), timezone)
    return new Date(naive - refinedOffset)
}

/** Día de la semana en la zona dada: 1 = lunes ... 7 = domingo. */
export function zonedWeekday(date: Date, timezone: string): number {
    const parts = utcToZonedParts(date, timezone)
    const utcNoon = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12))
    const jsDay = utcNoon.getUTCDay()
    return jsDay === 0 ? 7 : jsDay
}

/** Lunes 00:00 (hora local de la zona) de la semana que contiene `date`. */
export function startOfWeekUtc(date: Date, timezone: string): Date {
    const parts = utcToZonedParts(date, timezone)
    const weekday = zonedWeekday(date, timezone)
    const mondayUtc = zonedTimeToUtc(parts.year, parts.month, parts.day, 0, 0, timezone)
    return new Date(mondayUtc.getTime() - (weekday - 1) * 24 * 60 * 60 * 1000)
}

/** Inicio del día local (00:00) que contiene `date`. */
export function startOfDayUtc(date: Date, timezone: string): Date {
    const parts = utcToZonedParts(date, timezone)
    return zonedTimeToUtc(parts.year, parts.month, parts.day, 0, 0, timezone)
}

/** Clave estable de día local, para agrupar por jornada. */
export function dayKeyUtc(date: Date, timezone: string): string {
    const p = utcToZonedParts(date, timezone)
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

export function addMinutes(date: Date, minutes: number): Date {
    return new Date(date.getTime() + minutes * 60 * 1000)
}

export const SLOT_MINUTES = 15

export function isAlignedToSlot(date: Date): boolean {
    return date.getTime() % (SLOT_MINUTES * 60 * 1000) === 0
}
