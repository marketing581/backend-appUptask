/** Alta de las cuentas del equipo.
 *
 *  Crea o actualiza las integrantes con rol `member`, ya confirmadas (el envío
 *  de correo está caído, así que no podrían confirmarse solas).
 *
 *  Uso: npx ts-node src/migrations/seed-team.ts
 */
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import User from '../models/User'
import { hashPassword } from '../utils/auth'

dotenv.config()

/** La contraseña inicial llega por entorno: escribirla aquí la publicaría en
 *  el repositorio. Cada integrante debería cambiarla al entrar por primera vez. */
const INITIAL_PASSWORD = process.env.TEAM_SEED_PASSWORD

const TEAM = [
    { name: 'Sofianne', email: 'sofi@greendreams.pe' },
    { name: 'Nicole', email: 'nicole@greendreams.pe' }
]

const run = async () => {
    if (!INITIAL_PASSWORD) {
        console.error(
            'Falta TEAM_SEED_PASSWORD.\n' +
            'Ejecuta:  TEAM_SEED_PASSWORD="la-que-quieras" npm run seed:team'
        )
        process.exit(1)
    }

    await mongoose.connect(process.env.DATABASE_URL!)

    for (const member of TEAM) {
        const existing = await User.findOne({ email: member.email })

        if (existing) {
            existing.name = member.name
            existing.password = await hashPassword(INITIAL_PASSWORD)
            existing.confirmed = true
            existing.role = 'member'
            await existing.save()
            console.log(`actualizada  ${member.email} (${member.name})`)
        } else {
            await User.create({
                name: member.name,
                email: member.email,
                password: await hashPassword(INITIAL_PASSWORD),
                confirmed: true,
                role: 'member'
            })
            console.log(`creada       ${member.email} (${member.name})`)
        }
    }

    console.log('\n--- equipo ---')
    for (const user of await User.find({}).select('name email role confirmed').sort({ role: 1 })) {
        console.log(`${user.email.padEnd(26)} ${user.name.padEnd(14)} ${user.role}`)
    }

    await mongoose.disconnect()
    process.exit(0)
}

run().catch(error => {
    console.error('El alta falló:', error)
    process.exit(1)
})
