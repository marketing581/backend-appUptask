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

const BLOCK_POPULATE = [
    {
        path: 'task',
        select: '_id name status priority project brand dueDate estimatedMinutes onHold review isPrivate assignee createdBy collaborators',
        populate: [
            { path: 'project', select: '_id projectName' },
            { path: 'brand', select: '_id name color' }
        ]
    },
    // El calendario ajeno muestra bloques compartidos: hay que poder decir de
    // quién es cada uno y a quién más se etiquetó.
    { path: 'user', select: '_id name email' },
    { path: 'guests', select: '_id name email' }
]

/** Un bloque está en el calendario de alguien si es suyo o si se la
 *  etiquetó —siempre dentro del mismo workspace, nunca del de otro equipo. */
const inCalendarOf = (userId: Types.ObjectId, workspaceId: Types.ObjectId) => ({
    workspace: workspaceId,
    $or: [{ user: userId }, { guests: userId }]
})

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
        : await User.findOne({ _id: requestedId, workspace: req.activeWorkspace })
            .select('_id name email timezone schedulePrefs role')

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
async function scheduledMinutesByTask(
    taskIds: Types.ObjectId[], workspaceId: Types.ObjectId, from?: Date, to?: Date
) {
    if (taskIds.length === 0) return new Map<string, number>()

    const match: Record<string, unknown> = { task: { $in: taskIds }, workspace: workspaceId }
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
    taskIds: Types.ObjectId[], workspaceId: Types.ObjectId, from: Date, to: Date, timezone: string
) {
    if (taskIds.length === 0) return new Map<string, Set<string>>()

    const blocks = await TimeBlock.find({
        task: { $in: taskIds },
        workspace: workspaceId,
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

async function findConflicts(
    userId: Types.ObjectId, workspaceId: Types.ObjectId, start: Date, end: Date, excludeId?: string
) {
    const filter: Record<string, unknown> = {
        ...inCalendarOf(userId, workspaceId),
        start: { $lt: end },
        end: { $gt: start }
    }
    if (excludeId) filter._id = { $ne: new Types.ObjectId(excludeId) }

    return TimeBlock.find(filter).populate(BLOCK_POPULATE)
}

/** Cruces en la agenda de cada persona etiquetada.
 *
 *  Etiquetar a alguien le ocupa una hora, así que hay que decir si ya tenía
 *  algo ahí. No se impide —a veces se quiere solapar a propósito—, pero se
 *  avisa antes de guardar, no después. */
async function findGuestConflicts(
    guests: Types.ObjectId[], workspaceId: Types.ObjectId, start: Date, end: Date, excludeId?: string
) {
    const rows = await Promise.all(guests.map(async guestId => {
        const blocks = await findConflicts(guestId, workspaceId, start, end, excludeId)
        const user = await User.findOne({ _id: guestId, workspace: workspaceId }).select('_id name')
        return { user: { _id: guestId, name: user?.name ?? '' }, count: blocks.length }
    }))
    return rows.filter(row => row.count > 0)
}

/** Valida y normaliza a quién se etiqueta.
 *
 *  Un pendiente reservado no se puede compartir: sería contradictorio invitar
 *  a alguien a algo marcado como «Solo tú lo ves». Y nadie puede figurar como
 *  invitada en su propio calendario. */
async function resolveGuests(
    raw: unknown, ownerId: Types.ObjectId, task: { isPrivate?: boolean }, workspaceId: Types.ObjectId
): Promise<{ error: string } | { guests: Types.ObjectId[] }> {
    if (!Array.isArray(raw)) return { guests: [] }

    const ids = [...new Set(raw.map(String))]
        .filter(id => Types.ObjectId.isValid(id))
        .filter(id => id !== ownerId.toString())

    if (ids.length === 0) return { guests: [] }

    if (task.isPrivate) {
        return { error: 'Un pendiente reservado no se puede compartir. Quítale «Solo tú lo ves» primero.' }
    }

    const users = await User.find({ _id: { $in: ids }, confirmed: true, workspace: workspaceId }).select('_id')
    if (users.length !== ids.length) {
        return { error: 'Alguna de las personas etiquetadas no existe o no tiene la cuenta activa' }
    }

    return { guests: users.map(user => user._id) }
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
                ...inCalendarOf(owner._id, req.activeWorkspace),
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
                    ...inCalendarOf(owner._id, req.activeWorkspace),
                    start: { $gte: dayStart, $lt: dayEnd }
                }).populate(BLOCK_POPULATE).sort({ start: 1 }),

                Task.find({
                    assignee: owner._id,
                    status: { $ne: taskStatus.DONE },
                    dueDate: { $gte: dayStart, $lt: dayEnd },
                    ...visibleTaskFilter(req.user, req.activeWorkspace)
                }).populate([
                    { path: 'project', select: '_id projectName' },
                    { path: 'brand', select: '_id name color' }
                ]),

                Task.find({
                    assignee: owner._id,
                    status: { $ne: taskStatus.DONE },
                    dueDate: { $ne: null, $lt: dayStart },
                    ...visibleTaskFilter(req.user, req.activeWorkspace)
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

    /** Bloques entre dos fechas, para las vistas de mes y de trimestre.
     *
     *  La semana tiene su propia consulta porque además devuelve las
     *  preferencias de franja; aquí solo hacen falta los bloques, que es lo
     *  único que esas vistas pintan. El rango se limita a un año para que una
     *  petición mal formada no intente traerse el histórico entero. */
    static getRange = async (req: Request, res: Response) => {
        try {
            const owner = await resolveCalendarOwner(req, res)
            if (!owner) return

            const from = new Date(String(req.query.from))
            const to = new Date(String(req.query.to))

            if (isNaN(from.getTime()) || isNaN(to.getTime())) {
                return res.status(400).json({ error: 'Fechas no válidas' })
            }
            if (to <= from) {
                return res.status(400).json({ error: 'El fin del rango debe ser posterior al inicio' })
            }
            if (to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
                return res.status(400).json({ error: 'El rango no puede superar un año' })
            }

            const blocks = await TimeBlock.find({
                ...inCalendarOf(owner._id, req.activeWorkspace),
                start: { $gte: from, $lt: to }
            }).populate(BLOCK_POPULATE).sort({ start: 1 })

            res.json({
                user: { _id: owner._id, name: owner.name, email: owner.email },
                timezone: owner.timezone || DEFAULT_TIMEZONE,
                from,
                to,
                blocks: await maskPrivateBlocks(blocks, req.user)
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
                ...visibleTaskFilter(req.user, req.activeWorkspace)
            }).populate([
                { path: 'project', select: '_id projectName' },
                { path: 'brand', select: '_id name color' }
            ]).sort({ dueDate: 1, priority: -1 })

            const [scheduled, daysByTask] = await Promise.all([
                scheduledMinutesByTask(tasks.map(task => task._id), req.activeWorkspace, weekStart, weekEnd),
                scheduledDaysByTask(tasks.map(task => task._id), req.activeWorkspace, weekStart, weekEnd, timezone)
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

            const task = await Task.findOne({ _id: req.body.task, workspace: req.activeWorkspace })
            if (!task) return res.status(404).json({ error: 'Tarea no encontrada' })
            if (!await canViewTask(req.user, task)) {
                return res.status(403).json({ error: 'No tienes acceso a esta tarea' })
            }

            const invited = await resolveGuests(req.body.guests, owner._id, task, req.activeWorkspace)
            if ('error' in invited) return res.status(400).json({ error: invited.error })

            const block = new TimeBlock({
                workspace: req.activeWorkspace,
                task: task._id,
                user: owner._id,
                start: range.start,
                end: range.end,
                note: req.body.note ?? '',
                createdBy: req.user._id,
                guests: invited.guests
            })

            // Los cruces se avisan, no se reprograman en silencio.
            const [conflicts, guestConflicts] = await Promise.all([
                findConflicts(owner._id, req.activeWorkspace, range.start, range.end),
                findGuestConflicts(invited.guests, req.activeWorkspace, range.start, range.end)
            ])

            await block.save()
            await block.populate(BLOCK_POPULATE)

            res.status(201).json({ block, conflicts, guestConflicts })
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    /** Mover o redimensionar un bloque. No cambia el estado de la tarea. */
    static updateBlock = async (req: Request, res: Response) => {
        try {
            const block = await TimeBlock.findOne({ _id: req.params.blockId, workspace: req.activeWorkspace })
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

            if ('guests' in req.body) {
                const task = await Task.findOne({ _id: block.task, workspace: req.activeWorkspace }).select('isPrivate')
                const invited = await resolveGuests(req.body.guests, block.user, task ?? {}, req.activeWorkspace)
                if ('error' in invited) return res.status(400).json({ error: invited.error })
                block.guests = invited.guests
            }

            const [conflicts, guestConflicts] = await Promise.all([
                findConflicts(block.user, req.activeWorkspace, range.start, range.end, block.id),
                findGuestConflicts(block.guests, req.activeWorkspace, range.start, range.end, block.id)
            ])

            await block.save()
            await block.populate(BLOCK_POPULATE)

            res.json({ block, conflicts, guestConflicts })
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    /** Quitarse de un bloque compartido.
     *
     *  Una invitada no puede mover ni borrar el bloque —no es su calendario—
     *  pero sí dejar de aparecer en él. Que solo pueda quitarlo quien lo creó
     *  convertiría cada etiqueta en algo de lo que no se puede salir. */
    static leaveBlock = async (req: Request, res: Response) => {
        try {
            const block = await TimeBlock.findOne({ _id: req.params.blockId, workspace: req.activeWorkspace })
            if (!block) return res.status(404).json({ error: 'Bloque no encontrado' })

            const isGuest = block.guests.some(guest => guest.toString() === req.user.id.toString())
            if (!isGuest) {
                return res.status(400).json({ error: 'No estás etiquetada en este bloque' })
            }

            block.guests = block.guests.filter(
                guest => guest.toString() !== req.user.id.toString()
            )
            await block.save()
            res.json({ message: 'Te quitaste del bloque' })
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    static deleteBlock = async (req: Request, res: Response) => {
        try {
            const block = await TimeBlock.findOne({ _id: req.params.blockId, workspace: req.activeWorkspace })
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

            const members = await User.find({ confirmed: true, workspace: req.activeWorkspace })
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
                        ...visibleTaskFilter(req.user, req.activeWorkspace)
                    })
                        .populate([
                            { path: 'project', select: '_id projectName' },
                            { path: 'assignee', select: '_id name email' }
                        ])
                        .sort({ dueDate: 1, createdAt: -1 })
                        .limit(50),

                    TimeBlock.find({
                        user: member._id,
                        workspace: req.activeWorkspace,
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
            const users = await User.find({ confirmed: true, workspace: req.activeWorkspace })
                .select('_id name email role')
                .sort({ role: 1, name: 1 })

            res.json(users)
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }
}
