import mongoose, { Schema, Document, Types } from 'mongoose'

/** Notas del equipo (en la interfaz, «Notas»).
 *
 *  No confundir con `Note`, que son los comentarios de una tarea. Esto es un
 *  bloc: listas de pendientes, prompts, datos de facturación, acuerdos de
 *  reunión… cosas que se consultan, no que se ejecutan.
 *
 *  El contenido se guarda en Markdown a propósito: es texto plano, así que la
 *  nota se puede copiar a cualquier otra herramienta sin perder el formato y
 *  no queda atada a esta aplicación. */

export const memoVisibility = {
    /** Solo su autora. */
    PRIVATE: 'private',
    /** Todo el equipo puede leerla. */
    TEAM: 'team'
} as const

export type MemoVisibility = typeof memoVisibility[keyof typeof memoVisibility]

export const memoPriority = {
    NONE: 'none',
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high'
} as const

export type MemoPriority = typeof memoPriority[keyof typeof memoPriority]

export interface IMemo extends Document {
    workspace: Types.ObjectId
    title: string
    content: string
    owner: Types.ObjectId
    visibility: MemoVisibility
    priority: MemoPriority
    date: Date | null
    archived: boolean
}

const MemoSchema: Schema = new Schema({
    workspace: {
        type: Types.ObjectId,
        ref: 'Workspace',
        required: true
    },
    title: {
        type: String,
        trim: true,
        required: true
    },
    /** Markdown: títulos, negritas, listas y checklists (`- [ ]` / `- [x]`). */
    content: {
        type: String,
        default: ''
    },
    owner: {
        type: Types.ObjectId,
        ref: 'User',
        required: true
    },
    visibility: {
        type: String,
        enum: Object.values(memoVisibility),
        default: memoVisibility.TEAM
    },
    priority: {
        type: String,
        enum: Object.values(memoPriority),
        default: memoPriority.NONE
    },
    date: {
        type: Date,
        default: null
    },
    /** Archivada: sale del tablero pero no se pierde. */
    archived: {
        type: Boolean,
        default: false
    }
}, { timestamps: true })

MemoSchema.index({ workspace: 1, owner: 1, archived: 1 })
MemoSchema.index({ workspace: 1, visibility: 1, archived: 1 })

const Memo = mongoose.model<IMemo>('Memo', MemoSchema)
export default Memo
