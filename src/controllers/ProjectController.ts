import type {Request, Response} from 'express'
import Project from '../models/Project'
import Task from '../models/Task'

export class ProjectController {
    static createProject = async (req: Request, res: Response) => {
        const project = new Project(req.body)

        // Asigna un manager
        project.manager = req.user.id
        try {
            await project.save() 
            res.send('Proyecto Creando Correctamente')
        } catch (error) {
            console.log(error)
        }
    }

    /** Lista con el avance de cada proyecto, para no tener que abrirlos uno a
     *  uno solo para saber cómo van. */
    static getAllProjects = async (req: Request, res: Response) => {
        try {
            const projects = await Project.find({
                $or: [
                    {manager: {$in: req.user.id}},
                    {team: {$in: req.user.id}}
                ]
            }).lean()

            const rows = await Task.aggregate([
                { $match: { project: { $in: projects.map(project => project._id) } } },
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
            console.log(error)
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    static getProjectById = async (req: Request, res: Response) => {
        const { id } = req.params
        try {
            const project = await Project.findById(id).populate({
                path: 'tasks',
                populate: { path: 'assignee', select: '_id name email' }
            })
            if(!project) {
                const error = new Error('Proyecto no encontrado')
                return res.status(404).json({error: error.message})
            }
            if(project.manager.toString() !== req.user.id.toString() && !project.team.includes(req.user.id)) {
                const error = new Error('Acción no válida')
                return res.status(404).json({error: error.message})
            }
            res.json(project)
        } catch (error) {
            console.log(error)
        }
    }

    static updateProject = async (req: Request, res: Response) => {
        try {            
            req.project.clientName = req.body.clientName
            req.project.projectName = req.body.projectName
            req.project.description = req.body.description

            await req.project.save()
            res.send('Proyecto Actualizado')
        } catch (error) {
            console.log(error)
        }
    }

    static deleteProject = async (req: Request, res: Response) => {
        try {
            await req.project.deleteOne()
            res.send('Proyecto Eliminado')
        } catch (error) {
            console.log(error)
        }
    }
}