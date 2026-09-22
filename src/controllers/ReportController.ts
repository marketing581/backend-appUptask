import type { Request, Response } from 'express'
import Task, { taskStatus } from '../models/Task'
import { businessMinutesBetween } from '../utils/businessHours'
import { DEFAULT_TIMEZONE, addDays, startOfWeekUtc, utcToZonedParts, zonedTimeToUtc } from '../utils/datetime'
import { isFromHistoricalImport, lastDoneAt } from '../utils/taskHistory'
import { visibleTaskFilter } from '../middleware/authorization'

/** Cuánto tarda el equipo de "En proceso" a "Listo", contando solo horario
 *  de oficina. `Task.statusHistory` ya trae la fecha real de cada cambio de
 *  estado desde antes de este informe, así que todo se calcula al vuelo: sin
 *  campos nuevos, sin migración, y las tareas viejas "se recalculan solas"
 *  con los mismos datos que ya tenían. */

type Period = 'weekly' | 'biweekly' | 'monthly'

function isPeriod(value: unknown): value is Period {
    return value === 'weekly' || value === 'biweekly' || value === 'monthly'
}

/** Rango `[start, end)` del periodo que contiene `anchor`, en la zona dada.
 *  "Quincenal" es la quincena de calendario (1–15 y 16–fin de mes), no un
 *  bloque móvil de 14 días —confirmado con Elery. */
function periodRange(period: Period, anchor: Date, timezone: string): { start: Date, end: Date } {
    const p = utcToZonedParts(anchor, timezone)

    if (period === 'weekly') {
        const start = startOfWeekUtc(anchor, timezone)
        return { start, end: addDays(start, 7) }
    }

    if (period === 'biweekly') {
        const firstHalf = p.day <= 15
        const start = zonedTimeToUtc(p.year, p.month, firstHalf ? 1 : 16, 0, 0, timezone)
        const end = firstHalf
            ? zonedTimeToUtc(p.year, p.month, 16, 0, 0, timezone)
            : zonedTimeToUtc(p.year, p.month + 1, 1, 0, 0, timezone)
        return { start, end }
    }

    const start = zonedTimeToUtc(p.year, p.month, 1, 0, 0, timezone)
    const end = zonedTimeToUtc(p.year, p.month + 1, 1, 0, 0, timezone)
    return { start, end }
}

type StatusHistoryEntry = { to: string, changedAt: Date }

/** La primera vez que entró a "En proceso": si vuelve más tarde (un rechazo
 *  de validación, por ejemplo), esa entrada posterior no mueve el inicio. */
function firstInProgressAt(history: StatusHistoryEntry[]): Date | null {
    const entry = history.find(h => h.to === taskStatus.IN_PROGRESS)
    return entry ? entry.changedAt : null
}

export class ReportController {
    static getTaskDurationReport = async (req: Request, res: Response) => {
        try {
            const period = req.query.period
            if (!isPeriod(period)) {
                return res.status(400).json({ error: 'Periodo no válido' })
            }

            const anchor = req.query.anchor ? new Date(String(req.query.anchor)) : new Date()
            if (Number.isNaN(anchor.getTime())) {
                return res.status(400).json({ error: 'Fecha no válida' })
            }

            const personId = typeof req.query.personId === 'string' ? req.query.personId : 'all'
            const timezone = DEFAULT_TIMEZONE
            const { start, end } = periodRange(period, anchor, timezone)

            const filter: Record<string, unknown> = {
                status: taskStatus.DONE,
                ...visibleTaskFilter(req.user, req.activeWorkspace)
            }
            if (personId !== 'all') filter.assignee = personId

            const tasks = await Task.find(filter)
                .select('name assignee statusHistory')
                .populate('assignee', '_id name')

            const rows = []
            for (const task of tasks) {
                if (isFromHistoricalImport(task.statusHistory)) continue
                const finishedAt = lastDoneAt(task.statusHistory)
                if (!finishedAt || finishedAt < start || finishedAt >= end) continue

                const startedAt = firstInProgressAt(task.statusHistory)
                const businessMinutes = startedAt ? businessMinutesBetween(startedAt, finishedAt, timezone) : null
                const assignee = task.assignee && typeof task.assignee !== 'string'
                    ? task.assignee as unknown as { _id: unknown, name: string }
                    : null

                rows.push({
                    taskId: task._id,
                    taskName: task.name,
                    assigneeName: assignee?.name ?? '—',
                    startedAt,
                    finishedAt,
                    businessMinutes
                })
            }

            // Del más reciente al más antiguo: lo que se acaba de cerrar
            // primero, como el resto de listas de esta app.
            rows.sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime())

            const validMinutes = rows
                .map(row => row.businessMinutes)
                .filter((m): m is number => m !== null)
            // Promedio de los minutos válidos, sin redondear cada fila antes
            // de promediar —lo pidió así explícitamente—; el redondeo, si
            // hace falta, es cosa de cómo se muestra, no de cómo se calcula.
            const averageMinutes = validMinutes.length > 0
                ? validMinutes.reduce((sum, m) => sum + m, 0) / validMinutes.length
                : null

            res.json({
                periodStart: start,
                periodEnd: end,
                finishedCount: rows.length,
                averageMinutes,
                rows
            })
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }
}
