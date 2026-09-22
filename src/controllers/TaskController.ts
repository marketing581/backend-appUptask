import type {Request, Response} from 'express'
import Task, { taskStatus } from '../models/Task'
import TimeBlock from '../models/TimeBlock'
import { applyApprover, applyOnHold, applyTaskFields, changeTaskStatus, TaskStatusError } from '../utils/taskUpdates'
import { isManagerRole } from '../middleware/authorization'

const TASK_POPULATE = [
    { path: 'assignee', select: '_id name email' },
    { path: 'collaborators', select: '_id name email' },
    { path: 'review.approver', select: '_id name email' },
    { path: 'brand', select: '_id name color' }
]

export class TaskController {
    static createTask = async (req: Request, res: Response) => {
        try {
            // Toda tarea nace con responsable: sin ella no llegaría a ningún
            // calendario. Por defecto, quien la crea.
            const assignee = req.body.assignee ?? req.user.id

            if (assignee.toString() !== req.user.id.toString() && !isManagerRole(req.user)) {
                return res.status(403).json({ error: 'Solo la encargada puede asignar tareas a otra persona' })
            }

            const task = new Task({
                name: req.body.name,
                workspace: req.activeWorkspace,
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

            task.project = req.project.id
            req.project.tasks.push(task.id)

            await Promise.all([task.save(), req.project.save()])
            res.send('Tarea creada correctamente')
        } catch (error) {
            res.status(500).json({error: 'Hubo un error'})
        }
    }

    static getProjectTasks = async (req: Request, res: Response) => {
        try {
            const tasks = await Task.find({ project: req.project.id, workspace: req.activeWorkspace })
                .populate('project')
                .populate(TASK_POPULATE)
            res.json(tasks)
        } catch (error) {
            res.status(500).json({error: 'Hubo un error'})
        }
    }

    static getTaskById = async (req: Request, res: Response) => {
        try {
            const task = await Task.findById(req.task.id)
                            .populate(TASK_POPULATE)
                            .populate({path: 'statusHistory.changedBy', select: '_id name email'})
                            .populate({path: 'notes', populate: {path: 'createdBy', select: '_id name email' }})
                            .populate({path: 'dependencies', select: '_id name status'})

            const blocks = await TimeBlock.find({ task: req.task.id, workspace: req.activeWorkspace }).sort({ start: 1 })
            res.json({ task, blocks })
        } catch (error) {
            res.status(500).json({error: 'Hubo un error'})
        }
    }

    static updateTask = async (req: Request, res: Response) => {
        try {
            if (
                'assignee' in req.body &&
                String(req.body.assignee ?? '') !== String(req.task.assignee ?? '') &&
                !isManagerRole(req.user)
            ) {
                return res.status(403).json({ error: 'Solo la encargada puede reasignar una tarea' })
            }

            applyTaskFields(req.task, req.body)
            applyOnHold(req.task, req.body)
            applyApprover(req.task, req.body)

            await req.task.save()
            res.send("Tarea Actualizada Correctamente")
        } catch (error) {
            res.status(500).json({error: 'Hubo un error'})
        }
    }

    static deleteTask = async (req: Request, res: Response) => {
        try {
            req.project.tasks = req.project.tasks.filter( task => task.toString() !== req.task.id.toString() )
            await Promise.all([ req.task.deleteOne(), req.project.save() ])
            res.send("Tarea Eliminada Correctamente")
        } catch (error) {
            res.status(500).json({error: 'Hubo un error'})
        }
    }

    static updateStatus = async (req: Request, res: Response) => {
        try {
            const result = changeTaskStatus(req.task, req.body.status, req.user._id, req.body.note ?? '')
            await req.task.save()
            res.json({ message: 'Tarea Actualizada', ...result })
        } catch (error) {
            if (error instanceof TaskStatusError) {
                return res.status(400).json({ error: error.message })
            }
            res.status(500).json({error: 'Hubo un error'})
        }
    }
}
