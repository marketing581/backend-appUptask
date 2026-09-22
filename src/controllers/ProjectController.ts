import type {Request, Response} from 'express'
import Project from '../models/Project'
import Task from '../models/Task'

export class ProjectController {
    /** Crear un proyecto no pide más que un nombre: cliente, descripción y
     *  área se completan después, cuando hagan falta, igual que un pendiente
     *  rápido. Quien lo crea queda como responsable, pero el proyecto es del
     *  equipo desde el primer momento: las tres lo ven y pueden trabajar en
     *  él. */
    static createProject = async (req: Request, res: Response) => {
        const project = new Project(req.body)
        project.workspace = req.activeWorkspace
        project.manager = req.user.id
        try {
            await project.save()
            res.status(201).json(project)
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    /** Lista con el avance de cada proyecto, para no tener que abrirlos uno a
     *  uno solo para saber cómo van.
     *
     *  El equipo es de tres personas que se ven todo el trabajo entre sí: un
     *  proyecto que crea Sofianne lo ve también Elery, aunque no figure como
     *  su responsable ni esté en el equipo del proyecto. No hay nada privado
     *  aquí —a diferencia de las tareas puntuales, que sí pueden reservarse—,
     *  así que no hace falta filtrar por quién lo creó. */
    static getAllProjects = async (req: Request, res: Response) => {
        try {
            const projects = await Project.find({ workspace: req.activeWorkspace }).lean()

            const rows = await Task.aggregate([
                {
                    $match: {
                        workspace: req.activeWorkspace,
                        project: { $in: projects.map(project => project._id) }
                    }
                },
                {
                    $group: {
                        _id: { project: '$project', status: '$status', review: '$review.needed' },
                        count: { $sum: 1 }
                    }
                }
            ])

            const statsByProject = new Map<string, Record<string, number>>()
            for (const row of rows) {
                const key = row._id.project.toString()
                const stats = statsByProject.get(key)
                    ?? { pending: 0, inProgress: 0, toValidate: 0, done: 0, total: 0 }

                // "Por validar" es En proceso con revisión pedida: se deriva igual
                // que en la interfaz para que ambas cuenten lo mismo.
                const label = row._id.review ? 'toValidate' : row._id.status
                stats[label] = (stats[label] ?? 0) + row.count
                stats.total += row.count
                statsByProject.set(key, stats)
            }

            res.json(projects.map(project => ({
                ...project,
                stats: statsByProject.get(project._id.toString())
                    ?? { pending: 0, inProgress: 0, toValidate: 0, done: 0, total: 0 }
            })))
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    /** Cualquier persona del equipo puede abrir cualquier proyecto: son tres
     *  cuentas que comparten el mismo trabajo, así que no hay un "no te
     *  pertenece" que aplicar aquí. */
    static getProjectById = async (req: Request, res: Response) => {
        const { id } = req.params
        try {
            const project = await Project.findOne({ _id: id, workspace: req.activeWorkspace }).populate({
                path: 'tasks',
                populate: { path: 'assignee', select: '_id name email' }
            })
            if(!project) {
                return res.status(404).json({ error: 'Proyecto no encontrado' })
            }
            res.json(project)
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    static updateProject = async (req: Request, res: Response) => {
        try {            
            req.project.clientName = req.body.clientName ?? ''
            req.project.projectName = req.body.projectName
            req.project.description = req.body.description ?? ''
            if ('brand' in req.body) req.project.brand = req.body.brand || null

            await req.project.save()
            res.json(req.project)
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    static deleteProject = async (req: Request, res: Response) => {
        try {
            await req.project.deleteOne()
            res.json({ message: 'Proyecto eliminado' })
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }
}
