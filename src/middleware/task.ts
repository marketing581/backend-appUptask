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
        const task = await Task.findOne({ _id: taskId, workspace: req.activeWorkspace })
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

/** Trabajar dentro del proyecto: crear, editar y mover tareas.
 *
 *  El equipo es de tres personas que comparten todo el trabajo, así que
 *  cualquier cuenta confirmada puede trabajar en cualquier proyecto — estar
 *  o no en `project.team` no lo condiciona. Ese campo queda para marcar quién
 *  está más de cerca en un proyecto puntual, no como permiso de acceso. */
export function canWorkOnProject(req: Request, res: Response, next: NextFunction ) {
    if (!req.user) {
        const error = new Error('No autenticada')
        return res.status(401).json({error: error.message})
    }
    next()
}
