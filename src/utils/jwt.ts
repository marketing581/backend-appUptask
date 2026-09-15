import jwt from 'jsonwebtoken'
import { Types } from 'mongoose'

type UserPayload = {
    // `Types.ObjectId` es el tipo del valor que devuelve `_id`.
    // Importar mongoose por defecto y llamarlo `Types` apuntaba al tipo de
    // esquema, que es otra cosa: compilaba por casualidad según la versión.
    id: Types.ObjectId
}

export const generateJWT = (payload: UserPayload) => {
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: '180d'
    })
    return token
}