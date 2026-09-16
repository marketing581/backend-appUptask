import mongoose, { Schema, Document, Types } from 'mongoose'

/** Un bloque programado: CUÁNDO se piensa trabajar una tarea.
 *
 *  No es el esfuerzo estimado (Task.estimatedMinutes) ni el tiempo realmente
 *  registrado. Una tarea de 6 horas puede repartirse en varios bloques sin que
 *  su estimación se duplique. Terminar un bloque tampoco completa la tarea.
 *
 *  Un bloque puede ser compartido: además de su calendario (`user`), aparece
 *  en el de quienes estén en `invitados`. Es **un solo registro**, como un
 *  evento con invitadas en un calendario al uso: si se mueve, se mueve para
 *  todas. Duplicar el bloque en cada calendario habría dejado copias que se
 *  desincronizan en cuanto alguien cambia la hora.
 *
 *  Los instantes se guardan en UTC; cada usuaria los ve en su zona horaria. */
export interface ITimeBlock extends Document {
    task: Types.ObjectId
    user: Types.ObjectId
    start: Date
    end: Date
    note: string
    createdBy: Types.ObjectId
    guests: Types.ObjectId[]
}

const TimeBlockSchema: Schema = new Schema({
    task: {
        type: Types.ObjectId,
        ref: 'Task',
        required: true
    },
    // Calendario al que pertenece el bloque.
    user: {
        type: Types.ObjectId,
        ref: 'User',
        required: true
    },
    start: {
        type: Date,
        required: true
    },
    end: {
        type: Date,
        required: true
    },
    note: {
        type: String,
        trim: true,
        default: ''
    },
    createdBy: {
        type: Types.ObjectId,
        ref: 'User',
        required: true
    },
    /** Personas etiquetadas en un pendiente compartido. Ven el bloque en su
     *  calendario y su hora cuenta como ocupada, pero el bloque sigue siendo
     *  del calendario de `user`: moverlo o quitarlo es cosa suya (o de la
     *  encargada). Una invitada sí puede quitarse a sí misma. */
    guests: [
        {
            type: Types.ObjectId,
            ref: 'User'
        }
    ]
}, { timestamps: true })

TimeBlockSchema.index({ user: 1, start: 1 })
TimeBlockSchema.index({ guests: 1, start: 1 })
TimeBlockSchema.index({ task: 1 })

const TimeBlock = mongoose.model<ITimeBlock>('TimeBlock', TimeBlockSchema)
export default TimeBlock
