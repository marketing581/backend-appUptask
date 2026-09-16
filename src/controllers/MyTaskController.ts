import type { Request, Response } from 'express'
import { Types } from 'mongoose'
import Task, { taskFrequency, taskStatus } from '../models/Task'
import { isDoneForPeriod } from '../utils/recurrence'
import { DEFAULT_TIMEZONE } from '../utils/datetime'
import Project from '../models/Project'
import TimeBlock from '../models/TimeBlock'
import {
    canEditTask, canTogglePrivacy, canViewTask, isManagerRole, visibleTaskFilter
} from '../middleware/authorization'
import {
    applyApprover,
    applyOnHold,
    applyTaskFields,
    changeTaskStatus,
    TaskStatusError
} from '../utils/taskUpdates'

const TASK_POPULATE = [
    { path: 'assignee', select: '_id name email' },
    { path: 'collaborators', select: '_id name email' },
    { path: 'review.approver', select: '_id name email' },
    { path: 'project', select: '_id projectName' },
    { path: 'brand', select: '_id name color' }
]

export class MyTaskController {

    /** Tareas visibles para la usuaria: las suyas y las del equipo, salvo las
     *  reservadas.
     *
     *  `kind` separa las tres naturalezas del trabajo, que se gestionan de
     *  forma distinta: lo que se repite, lo que se hace una vez y lo que forma
     *  parte de un proyecto con seguimiento. */
    static getTasks = async (req: Request, res: Response) => {
        try {
            const { assignee, status, includeDone, kind, limit, q } = req.query

            const filter: Record<string, unknown> = {}

            if (assignee) filter.assignee = new Types.ObjectId(assignee.toString())

            if (kind === 'maintenance') {
                filter.project = null
                filter.frequency = { $nin: [taskFrequency.NONE, null] }
            } else if (kind === 'oneOff') {
                filter.project = null
                filter.frequency = { $in: [taskFrequency.NONE, null] }
            } else if (kind === 'project') {
                filter.project = { $ne: null }
            }

            if (status) filter.status = status
            else if (includeDone !== 'true') filter.status = { $ne: taskStatus.DONE }

            // La búsqueda va contra la colección entera, no contra la página
            // que se está mostrando: buscar en el histórico y no encontrar algo
            // que sí está sería peor que no tener buscador.
            const term = typeof q === 'string' ? q.trim() : ''
            if (term) {
                const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                filter.name = { $regex: escaped, $options: 'i' }
            }

            // Lo terminado se ordena por cuándo se cerró; lo abierto, por urgencia.
            const sort: Record<string, 1 | -1> = status === taskStatus.DONE
                ? { updatedAt: -1 }
                : { dueDate: 1, createdAt: -1 }

            const query = Task.find({ ...filter, ...visibleTaskFilter(req.user) })
                .populate(TASK_POPULATE)
                .sort(sort)

            // El historial de pendientes cerrados puede ser de cientos: se pagina
            // para no traer de golpe lo que la pantalla no va a mostrar.
            const max = Number(limit)
            if (Number.isFinite(max) && max > 0) query.limit(Math.min(max, 200))

            const tasks = await query

            // `doneForPeriod` dice si la ocurrencia de hoy (o de esta semana)
            // ya está hecha, sin que la tarea deje de existir.
            const timezone = req.user.timezone || DEFAULT_TIMEZONE
            const payload = tasks.map(task => ({
                ...task.toObject(),
                doneForPeriod: isDoneForPeriod(task, timezone)
            }))

            if (Number.isFinite(max) && max > 0) {
                const total = await Task.countDocuments({ ...filter, ...visibleTaskFilter(req.user) })
                res.setHeader('X-Total-Count', String(total))
            }

            res.json(payload)
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    /** Creación rápida: basta el título. Todo lo demás es progresivo. */
    static createTask = async (req: Request, res: Response) => {
        try {
            const assignee = req.body.assignee ?? req.user.id

            if (assignee.toString() !== req.user.id.toString() && !isManagerRole(req.user)) {
                return res.status(403).json({ error: 'Solo la encargada puede asignar tareas a otra persona' })
            }

            const task = new Task({
                name: req.body.name,
                assignee,
                createdBy: req.user.id,
                statusHistory: [{
                    from: null,
                    to: taskStatus.PENDING,
                    changedBy: req.user.id,
                    changedAt: new Date(),
                    note: 'Tarea creada'
                }]
            })

            applyTaskFields(task, req.body)
            applyApprover(task, req.body)

            if (req.body.isPrivate) {
                if (!canTogglePrivacy(req.user, task)) {
                    return res.status(403).json({
                        error: 'Solo la encargada puede reservar, y solo sus propias tareas'
                    })
                }
                task.isPrivate = true
            }

            // Una tarea puntual puede nacer ya dentro de un proyecto.
            if (req.body.project) {
                const project = await Project.findById(req.body.project)
                if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
                task.project = project._id
                project.tasks.push(task._id)
                await project.save()
            }

            await task.save()
            await task.populate(TASK_POPULATE)
            res.status(201).json(task)
        } catch (error) {
            console.error('createTask:', error)
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    static getTaskById = async (req: Request, res: Response) => {
        try {
            const task = await Task.findById(req.params.taskId)
                .populate(TASK_POPULATE)
                .populate({ path: 'statusHistory.changedBy', select: '_id name email' })
                .populate({ path: 'notes', populate: { path: 'createdBy', select: '_id name email' } })
                .populate({ path: 'dependencies', select: '_id name status' })

            if (!task) return res.status(404).json({ error: 'Tarea no encontrada' })
            if (!await canViewTask(req.user, task)) {
                return res.status(403).json({ error: 'No tienes acceso a esta tarea' })
            }

            const blocks = await TimeBlock.find({ task: task._id }).sort({ start: 1 })
            res.json({ task, blocks })
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    static updateTask = async (req: Request, res: Response) => {
        try {
            const task = await Task.findById(req.params.taskId)
            if (!task) return res.status(404).json({ error: 'Tarea no encontrada' })
            if (!await canEditTask(req.user, task)) {
                return res.status(403).json({ error: 'No puedes modificar esta tarea' })
            }

            if (
                'assignee' in req.body &&
                String(req.body.assignee ?? '') !== String(task.assignee ?? '') &&
                !isManagerRole(req.user)
            ) {
                return res.status(403).json({ error: 'Solo la encargada puede reasignar una tarea' })
            }

            applyTaskFields(task, req.body)
            applyOnHold(task, req.body)
            applyApprover(task, req.body)

            if ('isPrivate' in req.body && !!req.body.isPrivate !== task.isPrivate) {
                if (!canTogglePrivacy(req.user, task)) {
                    return res.status(403).json({
                        error: 'Solo la encargada puede reservar, y solo sus propias tareas'
                    })
                }

                // Reservar algo que ya está compartido en el calendario de otra
                // persona dejaría el bloque en su agenda convertido en
                // «Reservado»: sabría que hay algo y no qué. Mejor decirlo y
                // que se decida a mano.
                if (req.body.isPrivate) {
                    const shared = await TimeBlock.exists({
                        task: task._id,
                        guests: { $exists: true, $ne: [] }
                    })
                    if (shared) {
                        return res.status(400).json({
                            error: 'Este pendiente está compartido en el calendario. ' +
                                'Quita a las personas etiquetadas antes de reservarlo.'
                        })
                    }
                }

                task.isPrivate = !!req.body.isPrivate
            }

            await task.save()
            await task.populate(TASK_POPULATE)
            res.json(task)
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    static updateStatus = async (req: Request, res: Response) => {
        try {
            const task = await Task.findById(req.params.taskId)
            if (!task) return res.status(404).json({ error: 'Tarea no encontrada' })
            if (!await canEditTask(req.user, task)) {
                return res.status(403).json({ error: 'No puedes modificar esta tarea' })
            }

            const result = changeTaskStatus(task, req.body.status, req.user._id, req.body.note ?? '')
            await task.save()
            await task.populate(TASK_POPULATE)
            res.json({ task, ...result })
        } catch (error) {
            if (error instanceof TaskStatusError) {
                return res.status(400).json({ error: error.message })
            }
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    /** Marca la tarea como "Por validar": sigue En proceso por debajo, pero
     *  esperando aprobación. No la cierra. */
    static requestReview = async (req: Request, res: Response) => {
        try {
            const task = await Task.findById(req.params.taskId)
            if (!task) return res.status(404).json({ error: 'Tarea no encontrada' })
            if (!await canEditTask(req.user, task)) {
                return res.status(403).json({ error: 'No puedes modificar esta tarea' })
            }
            if (task.status === taskStatus.DONE) {
                return res.status(400).json({ error: 'Una tarea Listo ya no necesita validación' })
            }

            if ('approver' in req.body) applyApprover(task, req.body)

            const previous = task.status
            task.status = taskStatus.IN_PROGRESS
            task.review.needed = true
            task.review.requestedAt = new Date()

            task.statusHistory.push({
                from: previous,
                to: taskStatus.IN_PROGRESS,
                changedBy: req.user._id,
                changedAt: new Date(),
                note: req.body.note || 'Enviada a validación'
            })

            await task.save()
            await task.populate(TASK_POPULATE)
            res.json(task)
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    /** Aprobar cierra la tarea; rechazar la devuelve a ejecución. */
    static resolveReview = async (req: Request, res: Response) => {
        try {
            const task = await Task.findById(req.params.taskId)
            if (!task) return res.status(404).json({ error: 'Tarea no encontrada' })
            if (!task.review.needed) {
                return res.status(400).json({ error: 'Esta tarea no está en revisión' })
            }

            const isAssignedApprover = task.review.approver &&
                task.review.approver.toString() === req.user.id.toString()
            if (!isAssignedApprover && !isManagerRole(req.user)) {
                return res.status(403).json({ error: 'No eres la aprobadora de esta tarea' })
            }

            const approved = req.body.approved !== false
            task.review.needed = false

            if (approved) {
                task.status = taskStatus.DONE
                task.onHold.active = false
                task.statusHistory.push({
                    from: taskStatus.IN_PROGRESS,
                    to: taskStatus.DONE,
                    changedBy: req.user._id,
                    changedAt: new Date(),
                    note: req.body.note || 'Aprobada'
                })
            } else {
                task.statusHistory.push({
                    from: taskStatus.IN_PROGRESS,
                    to: taskStatus.IN_PROGRESS,
                    changedBy: req.user._id,
                    changedAt: new Date(),
                    note: req.body.note || 'Revisión rechazada: vuelve a ejecución'
                })
            }

            await task.save()
            await task.populate(TASK_POPULATE)
            res.json(task)
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    /** Convierte una tarea puntual en tarea de proyecto conservando su
     *  historial, sus bloques y su tiempo registrado. */
    static convertToProjectTask = async (req: Request, res: Response) => {
        try {
            const task = await Task.findById(req.params.taskId)
            if (!task) return res.status(404).json({ error: 'Tarea no encontrada' })
            if (!await canEditTask(req.user, task)) {
                return res.status(403).json({ error: 'No puedes modificar esta tarea' })
            }
            if (task.project) {
                return res.status(400).json({ error: 'La tarea ya pertenece a un proyecto' })
            }

            const project = await Project.findById(req.body.project)
            if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

            task.project = project._id
            task.statusHistory.push({
                from: task.status,
                to: task.status,
                changedBy: req.user._id,
                changedAt: new Date(),
                note: `Convertida en tarea del proyecto "${project.projectName}"`
            })

            project.tasks.push(task._id)
            await Promise.all([task.save(), project.save()])
            await task.populate(TASK_POPULATE)
            res.json(task)
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    static deleteTask = async (req: Request, res: Response) => {
        try {
            const task = await Task.findById(req.params.taskId)
            if (!task) return res.status(404).json({ error: 'Tarea no encontrada' })
            if (!await canEditTask(req.user, task)) {
                return res.status(403).json({ error: 'No puedes eliminar esta tarea' })
            }

            if (task.project) {
                await Project.updateOne({ _id: task.project }, { $pull: { tasks: task._id } })
            }
            await task.deleteOne()
            res.json({ message: 'Tarea eliminada' })
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }
}
