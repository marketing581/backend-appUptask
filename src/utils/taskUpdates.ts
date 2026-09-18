import { Types } from 'mongoose'
import { ITask, TaskStatus, taskStatus, taskPriority, taskFrequency, taskColorTag } from '../models/Task'
import { isRecurring } from './recurrence'

/** Campos que se pueden editar directamente desde la API.
 *  `status` tiene su propio endpoint (registra historial) y `project` se cambia
 *  con la conversión a tarea de proyecto, que preserva el historial. */
const EDITABLE_FIELDS = [
    'name',
    'description',
    'brand',
    'colorTag',
    'assignee',
    'collaborators',
    'definitionOfDone',
    'priority',
    'frequency',
    'estimatedMinutes',
    'dueDate',
    'plannedDate',
    'checklist',
    'dependencies',
    'parentTask'
] as const

const toObjectIdOrNull = (value: unknown): Types.ObjectId | null => {
    if (value === null || value === undefined || value === '') return null
    return new Types.ObjectId(String(value))
}

export function applyTaskFields(task: ITask, body: Record<string, unknown>) {
    for (const field of EDITABLE_FIELDS) {
        if (!(field in body)) continue
        const value = body[field]

        switch (field) {
            case 'brand':
            case 'assignee':
            case 'parentTask':
                task[field] = toObjectIdOrNull(value)
                break
            case 'colorTag':
                task.colorTag = (Object.values(taskColorTag) as string[]).includes(String(value))
                    ? (value as typeof task.colorTag)
                    : null
                break
            case 'collaborators':
            case 'dependencies':
                task[field] = Array.isArray(value)
                    ? value.map(id => new Types.ObjectId(String(id)))
                    : []
                break
            case 'estimatedMinutes':
                task.estimatedMinutes = value === null || value === '' ? null : Number(value)
                break
            case 'dueDate':
                task.dueDate = value === null || value === '' ? null : new Date(String(value))
                break
            case 'plannedDate':
                task.plannedDate = value === null || value === '' ? null : new Date(String(value))
                break
            case 'checklist':
                task.checklist = Array.isArray(value)
                    ? value.map((item: Record<string, unknown>) => ({
                        text: String(item.text ?? ''),
                        done: !!item.done
                    })).filter(item => item.text.length > 0)
                    : []
                break
            case 'priority':
                if (Object.values(taskPriority).includes(value as never)) {
                    task.priority = value as ITask['priority']
                }
                break
            case 'frequency':
                if (Object.values(taskFrequency).includes(value as never)) {
                    task.frequency = value as ITask['frequency']
                }
                break
            default:
                task[field] = value === null || value === undefined ? '' : String(value)
        }
    }
}

/** Indicadores "En espera / Bloqueada" y "Necesita revisión".
 *  Se superponen al estado principal en vez de reemplazarlo. */
export function applyOnHold(task: ITask, body: Record<string, unknown>) {
    const onHold = body.onHold as Record<string, unknown> | undefined
    if (!onHold) return

    task.onHold.active = !!onHold.active
    task.onHold.reason = String(onHold.reason ?? '')
    task.onHold.waitingOn = String(onHold.waitingOn ?? '')
    task.onHold.followUpDate = onHold.followUpDate
        ? new Date(String(onHold.followUpDate))
        : null
}

export function applyApprover(task: ITask, body: Record<string, unknown>) {
    if (!('approver' in body)) return
    task.review.approver = toObjectIdOrNull(body.approver)
}

export class TaskStatusError extends Error {}

/** Cambia el estado y deja constancia del anterior en el historial.
 *
 *  Si la tarea tiene aprobadora, terminar la ejecución no la pasa a Listo:
 *  la deja En proceso solicitando revisión. Solo la aprobación cierra. */
export function changeTaskStatus(
    task: ITask,
    nextStatus: TaskStatus,
    actorId: Types.ObjectId,
    note = ''
) {
    if (!Object.values(taskStatus).includes(nextStatus)) {
        throw new TaskStatusError('Estado no válido')
    }

    const previous = task.status

    // Desmarcar una recurrente equivale a deshacer la ocurrencia de hoy.
    if (nextStatus === taskStatus.PENDING && isRecurring(task) && task.lastCompletedAt) {
        task.lastCompletedAt = null
    }

    if (nextStatus === taskStatus.DONE && task.review.approver && !task.review.needed) {
        // Nunca salta la aprobación: se solicita revisión en lugar de cerrar.
        task.status = taskStatus.IN_PROGRESS
        task.review.needed = true
        task.review.requestedAt = new Date()
        task.statusHistory.push({
            from: previous,
            to: taskStatus.IN_PROGRESS,
            changedBy: actorId,
            changedAt: new Date(),
            note: note || 'Ejecución terminada: pendiente de aprobación'
        })
        return { status: task.status, awaitingApproval: true, occurrenceCompleted: false }
    }

    if (nextStatus === taskStatus.DONE && task.review.needed) {
        throw new TaskStatusError('La tarea necesita aprobación antes de pasar a Listo')
    }

    // Devolverla a Pendiente o En proceso retira la solicitud de validación.
    const withdrewReview = task.review.needed && nextStatus !== taskStatus.DONE
    if (withdrewReview) {
        task.review.needed = false
        task.review.requestedAt = null
    }

    // El trabajo recurrente no se termina "del todo": se termina esta vez.
    // Se anota la ocurrencia y vuelve a Pendiente para la siguiente, en lugar
    // de desaparecer del sistema hasta que alguien lo reabra a mano.
    if (nextStatus === taskStatus.DONE && isRecurring(task)) {
        task.lastCompletedAt = new Date()
        task.onHold.active = false
        task.status = taskStatus.PENDING

        task.statusHistory.push({
            from: previous,
            to: taskStatus.PENDING,
            changedBy: actorId,
            changedAt: new Date(),
            note: note || 'Ocurrencia completada; queda lista para la siguiente'
        })

        return { status: task.status, awaitingApproval: false, occurrenceCompleted: true }
    }

    task.status = nextStatus
    if (nextStatus === taskStatus.DONE) {
        task.onHold.active = false
    }

    task.statusHistory.push({
        from: previous,
        to: nextStatus,
        changedBy: actorId,
        changedAt: new Date(),
        note: note || (withdrewReview ? 'Retirada de validación' : '')
    })

    return { status: task.status, awaitingApproval: false, occurrenceCompleted: false }
}
