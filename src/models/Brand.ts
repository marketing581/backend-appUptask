import mongoose, { Schema, Document, Types } from 'mongoose'

/** Marca o área de trabajo. Agrupa proyectos y tareas operativas: "El Resort"
 *  puede tener varios proyectos y además mantenimiento recurrente. */
export interface IBrand extends Document {
    name: string
    color: string
    createdBy: Types.ObjectId
}

const BrandSchema: Schema = new Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    color: {
        type: String,
        default: '#6366f1',
        trim: true
    },
    createdBy: {
        type: Types.ObjectId,
        ref: 'User',
        required: true
    }
}, { timestamps: true })

const Brand = mongoose.model<IBrand>('Brand', BrandSchema)
export default Brand
