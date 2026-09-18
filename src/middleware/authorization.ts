import type { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { IUser, userRole } from '../models/User'
import { ITask } from '../models/Task'
import Project from '../models/Project'

const sameId = (a: unknown, b: unknown) => !!a && !!b && a.toString() === b.toString()

export const isManagerRole = (user: IUser) => user.role === userRole.MANAGER

/** Dueña de la tarea: su responsable, quien la creó o sus colaboradoras. */
const ownsTask = (user: IUser, task: ITask) =>
    sameId(task.assignee, user._id) ||
    sameId(task.createdBy, user._id) ||
    !!task.collaborators?.some(id => sameId(id, user._id))

/* ----------------------------------------------------------- Calendarios */

/** El equipo trabaja a la vista: cualquiera puede consultar el calendario de
 *  las demás para coordinarse. */
export const canViewCalendarOf = (_user: IUser, _targetUserId: Types.ObjectId | string) => true

/** Reservar, mover o borrar bloques en un calendario ajeno solo lo hace la
 *  encargada: nadie reorganiza la agenda de otra persona por su cuenta. */
export const canEditCalendarOf = (user: IUser, targetUserId: Types.ObjectId | string) =>
    isManagerRole(user) || sameId(user._id, targetUserId)

/* ---------------------------------------------------------------- Tareas */

/** Puede modificar la tarea: su dueña, la responsable del proyecto al que
 *  pertenece, o la encargada del equipo. */
export const canEditTask = async (user: IUser, task: ITask): Promise<boolean> => {
    if (isManagerRole(user)) return true
    if (ownsTask(user, task)) return true

    if (task.project) {
        const project = await Project.findById(task.project).select('manager team')
        if (project && sameId(project.manager, user._id)) return true
    }
    return false
}

/** Puede consultar la tarea.
 *
 *  El trabajo del equipo es visible entre sus integrantes. La excepción son
 *  las tareas reservadas, que solo ve su dueña —ni siquiera la encargada, si
 *  no es suya—. */
export const canViewTask = async (user: IUser, task: ITask): Promise<boolean> => {
    if (task.isPrivate) return ownsTask(user, task)
    return true
}

/** Condición de Mongo equivalente a `canViewTask`, para filtrar listados sin
 *  traerse todo a memoria. */
export const visibleTaskFilter = (user: IUser): Record<string, unknown> => ({
    $or: [
        { isPrivate: { $ne: true } },
        { assignee: user._id },
        { createdBy: user._id },
        { collaborators: user._id }
    ]
})

/** Reservar una tarea es potestad de la encargada, y solo sobre trabajo
 *  propio: nadie puede ocultarle a alguien su propia tarea, y una integrante
 *  no tiene un botón que le prometa una privacidad que no tendría. */
export const canTogglePrivacy = (user: IUser, task: ITask) =>
    isManagerRole(user) && sameId(task.assignee, user._id)

/** Solo la encargada aprueba, asigna trabajo a terceras y prioriza fuera de su
 *  propio alcance. */
export function requireManagerRole(req: Request, res: Response, next: NextFunction) {
    if (!isManagerRole(req.user)) {
        return res.status(403).json({ error: 'Solo la encargada puede realizar esta acción' })
    }
    next()
}

/* --------------------------------------------------------------- Informes */

/** Los informes de tiempo son de una sola cuenta, por id exacto —no por
 *  rol—: ni siquiera otra encargada que se agregue más adelante tendría
 *  acceso solo por serlo. */
const REPORTS_OWNER_ID = '6aa94c7d5c6817e6ae2e46d3'

export function requireReportsAccess(req: Request, res: Response, next: NextFunction) {
    if (!sameId(req.user._id, REPORTS_OWNER_ID)) {
        return res.status(403).json({ error: 'No tienes acceso a los informes' })
    }
    next()
}
