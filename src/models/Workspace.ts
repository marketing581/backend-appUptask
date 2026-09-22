import mongoose, { Schema, Document } from 'mongoose'

/** Un equipo/área aislado: Marketing, Desarrollo, etc. Todo lo demás
 *  (usuarias, tareas, proyectos, notas, bloques, marcas) pertenece a
 *  exactamente uno, y nada se ve entre workspaces distintos. */
export interface IWorkspace extends Document {
    name: string
}

const WorkspaceSchema: Schema = new Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        unique: true
    }
}, { timestamps: true })

const Workspace = mongoose.model<IWorkspace>('Workspace', WorkspaceSchema)
export default Workspace
