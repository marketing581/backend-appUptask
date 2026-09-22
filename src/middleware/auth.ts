import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { Types } from 'mongoose'
import User, { IUser } from '../models/User'

declare global {
    namespace Express {
        interface Request {
            user?: IUser
            /** El workspace sobre el que trabaja esta request: el propio de
             *  la cuenta, salvo que sea super-admin y haya elegido otro (ver
             *  `authenticate`). Todo controlador que consulte datos de
             *  equipo filtra por este id, nunca por `req.user.workspace`
             *  directamente. */
            activeWorkspace?: Types.ObjectId
        }
    }
}

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
    const bearer = req.headers.authorization
    if(!bearer) {
        const error = new Error('No Autorizado')
        return res.status(401).json({error: error.message})
    }

    const [, token] = bearer.split(' ')

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET)

        if(typeof decoded === 'object' && decoded.id) {
            const user = await User.findById(decoded.id)
                .select('_id name email role timezone schedulePrefs workspace isSuperAdmin')
                .populate('workspace', '_id name')
            if(user) {
                req.user = user

                // Solo una cuenta super-admin puede pedir ver otro workspace
                // distinto al suyo; para cualquier otra esta cabecera se
                // ignora por completo, así que enviarla a mano no logra nada.
                const requestedWorkspace = req.headers['x-workspace-id']
                const workspace = user.workspace as unknown as { _id: Types.ObjectId }
                req.activeWorkspace = (user.isSuperAdmin && typeof requestedWorkspace === 'string')
                    ? new Types.ObjectId(requestedWorkspace)
                    : workspace._id

                next()
            } else {
                res.status(500).json({error: 'Token No Válido'})
            }
        }
    } catch (error) {
        res.status(500).json({error: 'Token No Válido'})
    }

}
