/** Alta de las cuentas del equipo de Desarrollo.
 *
 *  Mismo criterio que `seed-team.ts` para Marketing: crea o actualiza,
 *  ya confirmadas (el envío de correo está caído), con la contraseña
 *  inicial por entorno para no dejarla escrita en el repositorio.
 *
 *  Uso: npx ts-node src/migrations/seed-dev-team.ts
 */
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import User, { UserGender, UserRole } from '../models/User'
import Workspace from '../models/Workspace'
import { hashPassword } from '../utils/auth'

dotenv.config()

const INITIAL_PASSWORD = process.env.TEAM_SEED_PASSWORD

const WORKSPACE_NAME = 'Equipo de Desarrollo'

const TEAM: { name: string, email: string, role: UserRole, gender: UserGender }[] = [
    { name: 'Julio', email: 'desarrollo@greendreams.pe', role: 'manager', gender: 'm' },
    { name: 'Masiel', email: 'masiel@greendreams.pe', role: 'member', gender: 'f' },
    { name: 'Romina', email: 'romina@greendreams.pe', role: 'member', gender: 'f' }
]

const run = async () => {
    if (!INITIAL_PASSWORD) {
        console.error(
            'Falta TEAM_SEED_PASSWORD.\n' +
            'Ejecuta:  TEAM_SEED_PASSWORD="la-que-quieras" npm run seed:dev-team'
        )
        process.exit(1)
    }

    await mongoose.connect(process.env.DATABASE_URL!)

    const workspace = await Workspace.findOne({ name: WORKSPACE_NAME })
    if (!workspace) {
        console.error(`No existe el workspace "${WORKSPACE_NAME}". Corre antes: npm run migrate:003`)
        process.exit(1)
    }

    for (const member of TEAM) {
        const existing = await User.findOne({ email: member.email })

        if (existing) {
            existing.name = member.name
            existing.password = await hashPassword(INITIAL_PASSWORD)
            existing.confirmed = true
            existing.role = member.role
            existing.gender = member.gender
            existing.workspace = workspace._id
            await existing.save()
            console.log(`actualizada  ${member.email} (${member.name}, ${member.role})`)
        } else {
            await User.create({
                name: member.name,
                email: member.email,
                password: await hashPassword(INITIAL_PASSWORD),
                confirmed: true,
                role: member.role,
                gender: member.gender,
                workspace: workspace._id
            })
            console.log(`creada       ${member.email} (${member.name}, ${member.role})`)
        }
    }

    console.log(`\n--- ${WORKSPACE_NAME} ---`)
    for (const user of await User.find({ workspace: workspace._id }).select('name email role confirmed').sort({ role: 1 })) {
        console.log(`${user.email.padEnd(26)} ${user.name.padEnd(14)} ${user.role}`)
    }

    await mongoose.disconnect()
    process.exit(0)
}

run().catch(error => {
    console.error('El alta falló:', error)
    process.exit(1)
})
