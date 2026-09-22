import { TaskStatus, taskStatus } from '../models/Task'

type StatusHistoryEntry = { to: TaskStatus, changedAt: Date, note?: string }

/** La más reciente vez que llegó a Listo: si se reabre y se vuelve a
 *  cerrar, esta es la que manda, sin duplicar nada. `null` cuando nunca
 *  quedó registro real del cierre (histórico importado sin esa fecha). */
export function lastDoneAt(history: StatusHistoryEntry[]): Date | null {
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].to === taskStatus.DONE) return history[i].changedAt
    }
    return null
}

export const HISTORICAL_IMPORT_NOTE = 'Importado del histórico de Notion'

/** Lo importado del histórico de Notion no trae una fecha real de cierre:
 *  a la base le queda la fecha en que se corrió la migración, no la fecha
 *  en que de verdad se hizo el trabajo. Agruparlo por esa fecha inventada
 *  haría que cientos de tareas de hace meses parecieran cerradas hoy. Se
 *  reconoce por la nota de su último cambio de estado: si nadie volvió a
 *  tocarla desde la importación, no cuenta como cierre real; si alguien la
 *  retomó después, esa nota más reciente manda y sí cuenta. */
export function isFromHistoricalImport(history: StatusHistoryEntry[]): boolean {
    return !!history[history.length - 1]?.note?.includes(HISTORICAL_IMPORT_NOTE)
}
