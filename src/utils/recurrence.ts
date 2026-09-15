import { ITask, TaskFrequency, taskFrequency } from '../models/Task'
import { startOfDayUtc, startOfWeekUtc, utcToZonedParts, addDays } from './datetime'

/** Trabajo recurrente: el que se repite con una cadencia. */
export const isRecurring = (task: Pick<ITask, 'frequency'>) =>
    !!task.frequency &&
    task.frequency !== taskFrequency.NONE &&
    task.frequency !== taskFrequency.ON_DEMAND

/** ¿Ya se hizo en el periodo que toca?
 *
 *  Para lo diario, "hecho" significa hecho hoy; mañana vuelve a estar
 *  pendiente. Para lo semanal, hecho esta semana. Así el trabajo operativo no
 *  desaparece al completarlo una vez. */
export function isDoneForPeriod(task: ITask, timezone: string, now = new Date()): boolean {
    if (!isRecurring(task)) return false
    if (!task.lastCompletedAt) return false

    const done = new Date(task.lastCompletedAt)

    switch (task.frequency) {
        case taskFrequency.DAILY:
            return done >= startOfDayUtc(now, timezone)
        case taskFrequency.EVERY_OTHER_DAY:
            return done >= addDays(startOfDayUtc(now, timezone), -1)
        case taskFrequency.WEEKLY:
            return done >= startOfWeekUtc(now, timezone)
        case taskFrequency.BIWEEKLY:
            return done >= addDays(startOfWeekUtc(now, timezone), -7)
        case taskFrequency.MONTHLY: {
            const nowParts = utcToZonedParts(now, timezone)
            const doneParts = utcToZonedParts(done, timezone)
            return doneParts.year === nowParts.year && doneParts.month === nowParts.month
        }
        default:
            return false
    }
}

/** Cuántas veces hace falta reservar hueco en una semana de `workingDays` días.
 *  Sirve para saber si el calendario cubre ya la cadencia o falta ponerla. */
export function occurrencesPerWeek(frequency: TaskFrequency, workingDays: number): number {
    switch (frequency) {
        case taskFrequency.DAILY:
            return workingDays
        case taskFrequency.EVERY_OTHER_DAY:
            return Math.ceil(workingDays / 2)
        case taskFrequency.WEEKLY:
            return 1
        // Quincenal y mensual no tocan todas las semanas; se pide una vez y
        // quien planifica decide si esta semana toca.
        case taskFrequency.BIWEEKLY:
        case taskFrequency.MONTHLY:
            return 1
        default:
            return 1
    }
}
