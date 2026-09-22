import mongoose, { Schema, Document, Types } from "mongoose"

export const userRole = {
    MANAGER: 'manager',
    MEMBER: 'member'
} as const

export type UserRole = typeof userRole[keyof typeof userRole]

export interface ISchedulePrefs {
    dayStartHour: number
    dayEndHour: number
    showWeekends: boolean
}

export interface IUser extends Document {
    email: string
    password: string
    name: string
    confirmed: boolean
    role: UserRole
    timezone: string
    schedulePrefs: ISchedulePrefs
    /** El equipo/área al que pertenece la cuenta. Determina qué ve: nada de
     *  otro workspace es visible, aunque se conozca el id exacto. */
    workspace: Types.ObjectId
    /** Administra todos los workspaces (crea equipos, cambia de uno a otro).
     *  Distinto de `role`: ese sigue siendo el permiso operativo dentro de
     *  su propio workspace. */
    isSuperAdmin: boolean
}

const userSchema: Schema = new Schema({
    email : {
        type: String,
        required: true,
        lowercase: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    confirmed: {
        type: Boolean,
        default: false
    },
    role: {
        type: String,
        enum: Object.values(userRole),
        default: userRole.MEMBER
    },
    timezone: {
        type: String,
        default: 'America/Lima'
    },
    schedulePrefs: {
        dayStartHour: { type: Number, default: 8, min: 0, max: 23 },
        dayEndHour: { type: Number, default: 18, min: 1, max: 24 },
        showWeekends: { type: Boolean, default: false }
    },
    workspace: {
        type: Types.ObjectId,
        ref: 'Workspace',
        required: true
    },
    isSuperAdmin: {
        type: Boolean,
        default: false
    }
})

const User = mongoose.model<IUser>('User', userSchema)
export default User
