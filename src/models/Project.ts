import mongoose, {Schema, Document, PopulatedDoc, Types} from 'mongoose'
import Task, { ITask } from './Task'
import { IUser } from './User'
import Note from './Note'
import TimeBlock from './TimeBlock'

export interface IProject extends Document {
    projectName: string
    clientName: string
    description: string
    brand: Types.ObjectId | null
    tasks: PopulatedDoc<ITask & Document>[]
    manager: PopulatedDoc<IUser & Document>
    team: PopulatedDoc<IUser & Document>[]
}

const ProjectSchema: Schema = new Schema({
    projectName: {
        type: String,
        required: true,
        trim: true
    },
    clientName: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        required: true,
        trim: true
    },
    // Los proyectos existentes quedan sin marca: la reclasificación es manual.
    brand: {
        type: Types.ObjectId,
        ref: 'Brand',
        default: null
    },
    tasks: [
        {
            type: Types.ObjectId,
            ref: 'Task'
        }
    ],
    manager: {
        type: Types.ObjectId,
        ref: 'User'
    },
    team: [
        {
            type: Types.ObjectId,
            ref: 'User'
        }
    ],
}, {timestamps: true})

// Middleware
ProjectSchema.pre('deleteOne', {document: true}, async function() {
    const projectId = this._id
    if(!projectId) return

    const tasks = await Task.find({ project: projectId })
    const taskIds = tasks.map(task => task._id)

    await Note.deleteMany({ task: { $in: taskIds } })
    await TimeBlock.deleteMany({ task: { $in: taskIds } })
    await Task.deleteMany({project: projectId})
})

const Project = mongoose.model<IProject>('Project', ProjectSchema)
export default Project