import mongoose, {Schema, Document, Types} from 'mongoose'
import Note from './Note'
import TimeBlock from './TimeBlock'

/** Estados principales: Pendiente -> En proceso -> Listo.
 *  "En espera/Bloqueada" y "Necesita revisión" son indicadores que se
 *  superponen al estado, no estados en sí mismos. */
export const taskStatus = {
    PENDING: 'pending',
    IN_PROGRESS: 'inProgress',
    DONE: 'done'
} as const

export type TaskStatus = typeof taskStatus[keyof typeof taskStatus]

/** Cadencia del trabajo operativo. De momento es una etiqueta: describe cada
 *  cuánto toca hacerlo y permite agrupar la lista. La generación automática de
 *  ocurrencias llega con el motor de recurrencias. */
export const taskFrequency = {
    NONE: 'none',
    DAILY: 'daily',
    EVERY_OTHER_DAY: 'everyOtherDay',
    WEEKLY: 'weekly',
    BIWEEKLY: 'biweekly',
    MONTHLY: 'monthly',
    ON_DEMAND: 'onDemand'
} as const

export type TaskFrequency = typeof taskFrequency[keyof typeof taskFrequency]

export const taskPriority = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    URGENT: 'urgent'
} as const

export type TaskPriority = typeof taskPriority[keyof typeof taskPriority]

/** Marca visual del pendiente: solo un color, sin nombre ni lista que
 *  mantener. `null` es "sin definir". */
export const taskColorTag = {
    ORANGE: 'orange',
    GREEN: 'green',
    FUCHSIA: 'fuchsia',
    CELESTE: 'celeste'
} as const

export type TaskColorTag = typeof taskColorTag[keyof typeof taskColorTag]

export interface ITask extends Document {
    name: string
    description: string
    workspace: Types.ObjectId
    project: Types.ObjectId | null
    brand: Types.ObjectId | null
    colorTag: TaskColorTag | null
    status: TaskStatus
    onHold: {
        active: boolean
        reason: string
        waitingOn: string
        followUpDate: Date | null
    }
    review: {
        needed: boolean
        approver: Types.ObjectId | null
        requestedAt: Date | null
    }
    assignee: Types.ObjectId | null
    collaborators: Types.ObjectId[]
    createdBy: Types.ObjectId | null
    isPrivate: boolean
    frequency: TaskFrequency
    lastCompletedAt: Date | null
    definitionOfDone: string
    priority: TaskPriority
    estimatedMinutes: number | null
    dueDate: Date | null
    /** El día en que una piensa hacerlo, sin hora. Es la manera rápida de
     *  decir "esto lo hago hoy": no reserva un hueco en el calendario —eso
     *  sigue siendo `TimeBlock`, con su propia hora—, solo separa "para hoy"
     *  de "para cuando sea" en la lista de pendientes. */
    plannedDate: Date | null
    /** Posición manual dentro de su propia lista (Pendientes, un día, Por
     *  validar): a igual valor, se conserva el orden que ya traía; al
     *  arrastrar una fila sobre otra, se reescribe para toda la lista
     *  visible en ese momento. No compite con nada más —una tarea vive en
     *  una sola lista a la vez—, así que un solo número alcanza. */
    order: number
    checklist: { text: string, done: boolean }[]
    dependencies: Types.ObjectId[]
    parentTask: Types.ObjectId | null
    statusHistory: {
        from: TaskStatus | null
        to: TaskStatus
        changedBy: Types.ObjectId
        changedAt: Date
        note: string
    }[]
    notes: Types.ObjectId[]
}

export const TaskSchema : Schema = new Schema({
    name: {
        type: String,
        trim: true,
        required: true
    },
    // Opcional: una tarea simple se crea solo con título y responsable.
    description: {
        type: String,
        trim: true,
        default: ''
    },
    workspace: {
        type: Types.ObjectId,
        ref: 'Workspace',
        required: true
    },
    // Opcional: las tareas puntuales existen sin proyecto y pueden
    // convertirse en tarea de proyecto conservando su historial.
    project: {
        type: Types.ObjectId,
        ref: 'Project',
        default: null
    },
    brand: {
        type: Types.ObjectId,
        ref: 'Brand',
        default: null
    },
    colorTag: {
        type: String,
        enum: Object.values(taskColorTag),
        default: null
    },
    status: {
        type: String,
        enum: Object.values(taskStatus),
        default: taskStatus.PENDING
    },
    onHold: {
        active: { type: Boolean, default: false },
        reason: { type: String, trim: true, default: '' },
        waitingOn: { type: String, trim: true, default: '' },
        followUpDate: { type: Date, default: null }
    },
    review: {
        needed: { type: Boolean, default: false },
        approver: { type: Types.ObjectId, ref: 'User', default: null },
        requestedAt: { type: Date, default: null }
    },
    assignee: {
        type: Types.ObjectId,
        ref: 'User',
        default: null
    },
    collaborators: [
        {
            type: Types.ObjectId,
            ref: 'User'
        }
    ],
    createdBy: {
        type: Types.ObjectId,
        ref: 'User',
        default: null
    },
    /** Tarea reservada: la ven su responsable y la encargada del equipo, nadie
     *  más. Sirve para trabajo que todavía no se quiere comunicar (una
     *  búsqueda de personal, por ejemplo). La interfaz lo explica así a todo
     *  el mundo: nadie cree tener más privacidad de la que tiene. */
    isPrivate: {
        type: Boolean,
        default: false
    },
    frequency: {
        type: String,
        enum: Object.values(taskFrequency),
        default: taskFrequency.NONE
    },
    /** Última vez que se completó una ocurrencia del trabajo recurrente.
     *  Una tarea diaria no se termina nunca "del todo": se termina hoy y
     *  vuelve a hacer falta mañana, así que en vez de quedarse en Listo
     *  regresa a Pendiente y aquí queda constancia de cuándo se hizo. */
    lastCompletedAt: {
        type: Date,
        default: null
    },
    definitionOfDone: {
        type: String,
        trim: true,
        default: ''
    },
    priority: {
        type: String,
        enum: Object.values(taskPriority),
        default: taskPriority.MEDIUM
    },
    /** Esfuerzo total que necesita la tarea. No es lo mismo que los bloques
     *  programados (cuándo se trabajará) ni que el tiempo real registrado. */
    estimatedMinutes: {
        type: Number,
        default: null,
        min: 0
    },
    dueDate: {
        type: Date,
        default: null
    },
    plannedDate: {
        type: Date,
        default: null
    },
    order: {
        type: Number,
        default: 0
    },
    checklist: [
        {
            text: { type: String, trim: true, required: true },
            done: { type: Boolean, default: false }
        }
    ],
    dependencies: [
        {
            type: Types.ObjectId,
            ref: 'Task'
        }
    ],
    parentTask: {
        type: Types.ObjectId,
        ref: 'Task',
        default: null
    },
    statusHistory: [
        {
            from: {
                type: String,
                enum: [...Object.values(taskStatus), null],
                default: null
            },
            to: {
                type: String,
                enum: Object.values(taskStatus),
                required: true
            },
            changedBy: { type: Types.ObjectId, ref: 'User', default: null },
            changedAt: { type: Date, default: Date.now },
            note: { type: String, trim: true, default: '' }
        }
    ],
    notes: [
        {
            type: Types.ObjectId,
            ref: 'Note'
        }
    ]
}, {timestamps: true})

TaskSchema.index({ workspace: 1, assignee: 1, status: 1 })
TaskSchema.index({ assignee: 1, plannedDate: 1 })
TaskSchema.index({ project: 1 })

// Middleware
TaskSchema.pre('deleteOne', {document: true}, async function() {
    const taskId = this._id
    if(!taskId) return
    await Note.deleteMany({task: taskId})
    await TimeBlock.deleteMany({task: taskId})
})

const Task = mongoose.model<ITask>('Task', TaskSchema)
export default Task
