import type { Request, Response, NextFunction } from 'express'
import Task, { ITask } from '../models/Task'

declare global {
    namespace Express {
        interface Request {
            task: ITask
        }
    }
}

export async function taskExists( req: Request, res: Response, next: NextFunction ) {
    try {
        const { taskId } = req.params
        const task = await Task.findById(taskId)
        if(!task) {
            const error = new Error('Tarea no encontrada')
            return res.status(404).json({error: error.message})
        }
        req.task = task
        next()
    } catch (error) {
        res.status(500).json({error: 'Hubo un error'})
    }
}

export function taskBelongsToProject(req: Request, res: Response, next: NextFunction ) {
    if(req.task.project.toString() !== req.project.id.toString()) {
        const error = new Error('Acción no válida')
        return res.status(400).json({error: error.message}) 
    }
    next()
}

const sameId = (a: unknown, b: unknown) => !!a && !!b && a.toString() === b.toString()

/** Editar el proyecto en sí (nombre, cliente, descripción) o eliminarlo:
 *  solo su manager o la encargada del equipo. */
export function isProjectManager(req: Request, res: Response, next: NextFunction ) {
    if( !sameId(req.user._id, req.project.manager) && req.user.role !== 'manager' ) {
        const error = new Error('Solo la responsable del proyecto puede hacer este cambio')
        return res.status(403).json({error: error.message})
    }
    next()
}

/** Trabajar dentro del proyecto (crear, editar y mover tareas): su manager,
 *  cualquier integrante de su equipo, o la encargada. */
export function canWorkOnProject(req: Request, res: Response, next: NextFunction ) {
    const isManager = sameId(req.user._id, req.project.manager)
    const isTeamMember = req.project.team?.some(memberId => sameId(memberId, req.user._id))

    if( !isManager && !isTeamMember && req.user.role !== 'manager' ) {
        const error = new Error('No perteneces a este proyecto')
        return res.status(403).json({error: error.message})
    }
    next()
}
