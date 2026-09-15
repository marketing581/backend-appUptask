import type { Request, Response } from 'express'
import { Types } from 'mongoose'
import Task, { taskStatus } from '../models/Task'
import TimeBlock from '../models/TimeBlock'
import User from '../models/User'
import {
    canEditCalendarOf,
    canViewCalendarOf,
    canViewTask,
    isManagerRole,
    visibleTaskFilter
} from '../middleware/authorization'
import {
    addDays,
    startOfDayUtc,
    startOfWeekUtc,
    isAlignedToSlot,
    dayKeyUtc,
    SLOT_MINUTES,
    DEFAULT_TIMEZONE
} from '../utils/datetime'
import { isDoneForPeriod, isRecurring, occurrencesPerWeek } from '../utils/recurrence'

const BLOCK_POPULATE = {
    path: 'task',
    select: '_id name status priority project brand dueDate estimatedMinutes onHold review isPrivate assignee createdBy collaborators',
    populate: [
        { path: 'project', select: '_id projectName' },
        { path: 'brand', select: '_id name color' }
    ]
}

const MAX_BLOCK_MINUTES = 12 * 60

const minutesBetween = (start: Date, end: Date) => (end.getTime() - start.getTime()) / 60000

/** Resuelve de qué calendario se está hablando y valida el acceso. */
async function resolveCalendarOwner(req: Request, res: Response, mode: 'view' | 'edit' = 'view') {
    const requestedId = (req.query.userId ?? req.body.user ?? req.user.id).toString()

    const allowed = mode === 'edit'
        ? canEditCalendarOf(req.user, requestedId)
        : canViewCalendarOf(req.user, requestedId)

    if (!allowed) {
        res.status(403).json({ error: 'Solo la encargada puede cambiar el calendario de otra persona' })
        return null
    }

    const owner = requestedId === req.user.id.toString()
        ? req.user
        : await User.findById(requestedId).select('_id name email timezone schedulePrefs role')

    if (!owner) {
        res.status(404).json({ error: 'Usuaria no encontrada' })
        return null
    }
    return owner
}

/** Minutos ya programados por tarea dentro de una ventana, para distinguir el
 *  esfuerzo estimado del tiempo efectivamente puesto en el calendario.
 *
 *  La ventana es la semana que se está mirando, no el histórico: el trabajo
 *  operativo se repite, y "Historias" vuelve a hacer falta cada día aunque ya
 *  se programara la semana pasada. */
async function scheduledMinutesByTask(taskIds: Types.ObjectId[], from?: Date, to?: Date) {
    if (taskIds.length === 0) return new Map<string, number>()

    const match: Record<string, unknown> = { task: { $in: taskIds } }
    if (from && to) match.start = { $gte: from, $lt: to }

    const rows = await TimeBlock.aggregate([
        { $match: match },
        {
            $group: {
                _id: '$task',
                minutes: { $sum: { $divide: [{ $subtract: ['$end', '$start'] }, 60000] } }
            }
        }
    ])

    return new Map<string, number>(rows.map(row => [row._id.toString(), row.minutes]))
}

/** Días distintos de la semana en que ya hay hueco reservado para cada tarea. */
async function scheduledDaysByTask(
    taskIds: Types.ObjectId[], from: Date, to: Date, timezone: string
) {
    if (taskIds.length === 0) return new Map<string, Set<string>>()

    const blocks = await TimeBlock.find({
        task: { $in: taskIds },
        start: { $gte: from, $lt: to }
    }).select('task start')

    const map = new Map<string, Set<string>>()
    for (const block of blocks) {
        const key = block.task.toString()
        if (!map.has(key)) map.set(key, new Set())
        map.get(key)!.add(dayKeyUtc(block.start, timezone))
    }
    return map
}

async function findConflicts(userId: Types.ObjectId, start: Date, end: Date, excludeId?: string) {
    const filter: Record<string, unknown> = {
        user: userId,
        start: { $lt: end },
        end: { $gt: start }
    }
    if (excludeId) filter._id = { $ne: new Types.ObjectId(excludeId) }

    return TimeBlock.find(filter).populate(BLOCK_POPULATE)
}

/** Los bloques de tareas reservadas siguen ocupando hueco en el calendario
 *  —si no, las demás creerían que esa franja está libre— pero sin revelar de
 *  qué trata el trabajo. */
async function maskPrivateBlocks(blocks: any[], viewer: any) {
    const result = []
    for (const block of blocks) {
        const task = block.task
        if (task && task.isPrivate && !(await canViewTask(viewer, task))) {
            const plain = block.toObject()
            plain.task = {
                _id: task._id,
                name: 'Reservado',
                status: task.status,
                isPrivate: true,
                project: null,
                brand: null
            }
            plain.note = ''
            result.push(plain)
        } else {
            result.push(block)
        }
    }
    return result
}

function validateRange(startRaw: unknown, endRaw: unknown) {
    const start = new Date(String(startRaw))
    const end = new Date(String(endRaw))

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return { error: 'Fechas no válidas' as const }
    }
    if (end <= start) {
        return { error: 'El fin del bloque debe ser posterior al inicio' as const }
    }
    if (!isAlignedToSlot(start) || !isAlignedToSlot(end)) {
        return { error: `Los bloques se alinean a intervalos de ${SLOT_MINUTES} minutos` as const }
    }
    if (minutesBetween(start, end) > MAX_BLOCK_MINUTES) {
        return { error: 'El bloque no puede superar 12 horas' as const }
    }
    return { start, end }
}

export class ScheduleController {

    /** Semana completa de una persona: bloques con su tarea asociada. */
    static getWeek = async (req: Request, res: Response) => {
        try {
            const owner = await resolveCalendarOwner(req, res)
            if (!owner) return

            const timezone = owner.timezone || DEFAULT_TIMEZONE
            const anchor = req.query.date ? new Date(String(req.query.date)) : new Date()
            if (isNaN(anchor.getTime())) {
                return res.status(400).json({ error: 'Fecha no válida' })
            }

            const weekStart = startOfWeekUtc(anchor, timezone)
            const weekEnd = addDays(weekStart, 7)

            const blocks = await TimeBlock.find({
                user: owner._id,
                start: { $gte: weekStart, $lt: weekEnd }
            }).populate(BLOCK_POPULATE).sort({ start: 1 })

            res.json({
                user: { _id: owner._id, name: owner.name, email: owner.email },
                timezone,
                schedulePrefs: owner.schedulePrefs,
                weekStart,
                weekEnd,
                blocks: await maskPrivateBlocks(blocks, req.user)
            })
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    /** Mi día: bloques de hoy, entregables comprometidos para hoy, vencidos y
     *  cuántas horas hay programadas. Terminar un bloque no cierra una tarea,
     *  por eso los entregables se cuentan aparte de los bloques. */
    static getDay = async (req: Request, res: Response) => {
        try {
            const owner = await resolveCalendarOwner(req, res)
            if (!owner) return

            const timezone = owner.timezone || DEFAULT_TIMEZONE
            const anchor = req.query.date ? new Date(String(req.query.date)) : new Date()
            if (isNaN(anchor.getTime())) {
                return res.status(400).json({ error: 'Fecha no válida' })
            }

            const dayStart = startOfDayUtc(anchor, timezone)
            const dayEnd = addDays(dayStart, 1)

            const [blocks, dueToday, overdue] = await Promise.all([
                TimeBlock.find({
                    user: owner._id,
                    start: { $gte: dayStart, $lt: dayEnd }
                }).populate(BLOCK_POPULATE).sort({ start: 1 }),

                Task.find({
                    assignee: owner._id,
                    status: { $ne: taskStatus.DONE },
                    dueDate: { $gte: dayStart, $lt: dayEnd },
                    ...visibleTaskFilter(req.user)
                }).populate([
                    { path: 'project', select: '_id projectName' },
                    { path: 'brand', select: '_id name color' }
                ]),

                Task.find({
                    assignee: owner._id,
                    status: { $ne: taskStatus.DONE },
                    dueDate: { $ne: null, $lt: dayStart },
                    ...visibleTaskFilter(req.user)
                }).populate([
                    { path: 'project', select: '_id projectName' },
                    { path: 'brand', select: '_id name color' }
                ]).sort({ dueDate: 1 })
            ])

            const scheduledMinutes = blocks.reduce(
                (total, block) => total + minutesBetween(block.start, block.end), 0
            )

            const prefs = owner.schedulePrefs ?? { dayStartHour: 8, dayEndHour: 18, showWeekends: false }
            const windowMinutes = (prefs.dayEndHour - prefs.dayStartHour) * 60

            res.json({
                user: { _id: owner._id, name: owner.name, email: owner.email },
                timezone,
                dayStart,
                dayEnd,
                blocks: await maskPrivateBlocks(blocks, req.user),
                dueToday,
                overdue,
                scheduledMinutes,
                // Franja visible, no capacidad real: almuerzo, reuniones y margen
                // para imprevistos se configuran aparte.
                windowMinutes,
                unscheduledWindowMinutes: Math.max(0, windowMinutes - scheduledMinutes)
            })
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    /** "Por programar": el trabajo abierto de esa persona, con cuánto le queda
     *  por reservar en la semana que se está mirando.
     *
     *  No se esconde nada por estar ya programado: lo operativo se repite y hay
     *  que poder volver a darle hora. Solo se marca lo que ya está cubierto. */
    static getUnscheduled = async (req: Request, res: Response) => {
        try {
            const owner = await resolveCalendarOwner(req, res)
            if (!owner) return

            const timezone = owner.timezone || DEFAULT_TIMEZONE
            const anchor = req.query.date ? new Date(String(req.query.date)) : new Date()
            if (isNaN(anchor.getTime())) {
                return res.status(400).json({ error: 'Fecha no válida' })
            }

            const weekStart = startOfWeekUtc(anchor, timezone)
            const weekEnd = addDays(weekStart, 7)

            const tasks = await Task.find({
                assignee: owner._id,
                status: { $ne: taskStatus.DONE },
                ...visibleTaskFilter(req.user)
            }).populate([
                { path: 'project', select: '_id projectName' },
                { path: 'brand', select: '_id name color' }
            ]).sort({ dueDate: 1, priority: -1 })

            const [scheduled, daysByTask] = await Promise.all([
                scheduledMinutesByTask(tasks.map(task => task._id), weekStart, weekEnd),
                scheduledDaysByTask(tasks.map(task => task._id), weekStart, weekEnd, timezone)
            ])

            const prefs = owner.schedulePrefs ?? { dayStartHour: 8, dayEndHour: 18, showWeekends: false }
            const workingDays = prefs.showWeekends ? 7 : 5

            res.json(tasks.map(task => {
                const key = task._id.toString()
                const scheduledMinutes = scheduled.get(key) ?? 0
                const scheduledDays = daysByTask.get(key)?.size ?? 0
                const estimated = task.estimatedMinutes
                const recurring = isRecurring(task)
                const expectedPerWeek = recurring
                    ? occurrencesPerWeek(task.frequency, workingDays)
                    : 1

                return {
                    task,
                    scheduledMinutes,
                    scheduledDays,
                    expectedPerWeek,
                    estimatedMinutes: estimated,
                    remainingMinutes: estimated === null ? null : Math.max(0, estimated - scheduledMinutes),
                    doneForPeriod: isDoneForPeriod(task, timezone),
                    // Lo recurrente se cubre por días, no por minutos: una tarea
                    // diaria necesita hueco cada día, no una vez a la semana.
                    fullyScheduled: recurring
                        ? scheduledDays >= expectedPerWeek
                        : estimated !== null && scheduledMinutes >= estimated
                }
            }))
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    static createBlock = async (req: Request, res: Response) => {
        try {
            const owner = await resolveCalendarOwner(req, res, 'edit')
            if (!owner) return

            const range = validateRange(req.body.start, req.body.end)
            if ('error' in range) return res.status(400).json({ error: range.error })

            const task = await Task.findById(req.body.task)
            if (!task) return res.status(404).json({ error: 'Tarea no encontrada' })
            if (!await canViewTask(req.user, task)) {
                return res.status(403).json({ error: 'No tienes acceso a esta tarea' })
            }

            const block = new TimeBlock({
                task: task._id,
                user: owner._id,
                start: range.start,
                end: range.end,
                note: req.body.note ?? '',
                createdBy: req.user._id
            })

            // Los cruces se avisan, no se reprograman en silencio.
            const conflicts = await findConflicts(owner._id, range.start, range.end)

            await block.save()
            await block.populate(BLOCK_POPULATE)

            res.status(201).json({ block, conflicts })
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    /** Mover o redimensionar un bloque. No cambia el estado de la tarea. */
    static updateBlock = async (req: Request, res: Response) => {
        try {
            const block = await TimeBlock.findById(req.params.blockId)
            if (!block) return res.status(404).json({ error: 'Bloque no encontrado' })
            if (!canEditCalendarOf(req.user, block.user)) {
                return res.status(403).json({ error: 'Solo la encargada puede mover bloques de otra persona' })
            }

            const range = validateRange(
                req.body.start ?? block.start.toISOString(),
                req.body.end ?? block.end.toISOString()
            )
            if ('error' in range) return res.status(400).json({ error: range.error })

            block.start = range.start
            block.end = range.end
            if ('note' in req.body) block.note = String(req.body.note ?? '')

            const conflicts = await findConflicts(block.user, range.start, range.end, block.id)

            await block.save()
            await block.populate(BLOCK_POPULATE)

            res.json({ block, conflicts })
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    static deleteBlock = async (req: Request, res: Response) => {
        try {
            const block = await TimeBlock.findById(req.params.blockId)
            if (!block) return res.status(404).json({ error: 'Bloque no encontrado' })
            if (!canEditCalendarOf(req.user, block.user)) {
                return res.status(403).json({ error: 'Solo la encargada puede quitar bloques de otra persona' })
            }

            await block.deleteOne()
            res.json({ message: 'Bloque eliminado' })
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    /** Panel del equipo: una columna por persona con su trabajo abierto y
     *  cuánto tiene programado hoy.
     *
     *  Las tareas reservadas no aparecen en las columnas ajenas ni se anuncia
     *  cuántas hay: decir "3 ocultas" delataría justo lo que se quiere
     *  reservar. Sus horas sí cuentan en el total del día, para no dar por
     *  libre un hueco que no lo está. */
    static getTeamBoard = async (req: Request, res: Response) => {
        try {
            const anchor = req.query.date ? new Date(String(req.query.date)) : new Date()
            if (isNaN(anchor.getTime())) {
                return res.status(400).json({ error: 'Fecha no válida' })
            }

            const members = await User.find({ confirmed: true })
                .select('_id name email role timezone')
                .sort({ role: 1, name: 1 })

            const panels = await Promise.all(members.map(async member => {
                const timezone = member.timezone || DEFAULT_TIMEZONE
                const dayStart = startOfDayUtc(anchor, timezone)
                const dayEnd = addDays(dayStart, 1)

                const [tasks, blocks] = await Promise.all([
                    Task.find({
                        assignee: member._id,
                        status: { $ne: taskStatus.DONE },
                        ...visibleTaskFilter(req.user)
                    })
                        .populate([
                            { path: 'project', select: '_id projectName' },
                            { path: 'assignee', select: '_id name email' }
                        ])
                        .sort({ dueDate: 1, createdAt: -1 })
                        .limit(50),

                    TimeBlock.find({
                        user: member._id,
                        start: { $gte: dayStart, $lt: dayEnd }
                    })
                ])

                const scheduledToday = blocks.reduce(
                    (total, block) => total + minutesBetween(block.start, block.end), 0
                )

                const memberTimezone = member.timezone || DEFAULT_TIMEZONE

                return {
                    user: {
                        _id: member._id,
                        name: member.name,
                        email: member.email,
                        role: member.role
                    },
                    tasks: tasks.map(task => ({
                        ...task.toObject(),
                        doneForPeriod: isDoneForPeriod(task, memberTimezone)
                    })),
                    scheduledToday
                }
            }))

            res.json({ date: anchor, panels })
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    /** Integrantes a las que se puede asignar trabajo o consultar calendario. */
    static getTeamMembers = async (req: Request, res: Response) => {
        try {
            const users = await User.find({ confirmed: true })
                .select('_id name email role')
                .sort({ role: 1, name: 1 })

            res.json(users)
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }
}
