/** Verifica el alcance de permisos del equipo contra la API en ejecución.
 *
 *  Regla que se comprueba: una integrante gestiona su trabajo y el de los
 *  proyectos a los que pertenece, pero no toca el calendario de nadie más.
 *
 *  Uso: npx ts-node src/verify/permissions.ts
 */
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import User from '../models/User'
import { hashPassword } from '../utils/auth'

dotenv.config()

/** Las suites entran con las cuentas reales del equipo, así que la contraseña
 *  llega por entorno en vez de quedar escrita en el repositorio. */
const TEAM_PASSWORD = process.env.TEAM_SEED_PASSWORD ?? ''

const API = 'http://localhost:4000/api'
const ORIGIN = 'http://localhost:5173'

const TEMP_MANAGER = { name: 'Encargada temporal', email: 'temp-manager@verify.local', password: 'Kf7x-verify-only-2f19' }

let pass = 0
let fail = 0
const failures: string[] = []

function check(label: string, expected: unknown, actual: unknown) {
    if (JSON.stringify(expected) === JSON.stringify(actual)) {
        console.log(`  OK    ${label}`)
        pass++
    } else {
        console.log(`  FALLA ${label}\n        esperado: ${JSON.stringify(expected)}\n        obtenido: ${JSON.stringify(actual)}`)
        failures.push(label)
        fail++
    }
}

const section = (title: string) => console.log(`\n== ${title} ==`)

async function api(token: string, method: string, path: string, body?: unknown) {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Origin': ORIGIN,
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    })
    const text = await res.text()
    let data: any = text
    try { data = JSON.parse(text) } catch { /* texto plano */ }
    return { status: res.status, data }
}

async function login(email: string, password: string) {
    const res = await api('', 'POST', '/auth/login', { email, password })
    return typeof res.data === 'string' ? res.data : ''
}

const cleanup: { token: string, path: string }[] = []

async function run() {
    // La cuenta temporal de encargada se crea directamente en la base.
    await mongoose.connect(process.env.DATABASE_URL!)

    section('Acceso de las colaboradoras')
    const nicole = await login('nicole@greendreams.pe', TEAM_PASSWORD)
    const sofianne = await login('sofi@greendreams.pe', TEAM_PASSWORD)
    check('Nicole puede entrar', true, nicole.length > 20)
    check('Sofianne puede entrar', true, sofianne.length > 20)
    if (!nicole || !sofianne) throw new Error('sin acceso, no se puede continuar')

    const nicoleMe = (await api(nicole, 'GET', '/auth/user')).data
    const sofianneMe = (await api(sofianne, 'GET', '/auth/user')).data
    check('Nicole es integrante, no encargada', 'member', nicoleMe.role)
    check('Sofianne es integrante, no encargada', 'member', sofianneMe.role)

    section('Cada una gestiona su propio día')
    check('Nicole ve su semana', 200, (await api(nicole, 'GET', '/schedule/week')).status)
    check('Nicole ve su día', 200, (await api(nicole, 'GET', '/schedule/day')).status)

    const ownTask = await api(nicole, 'POST', '/tasks', { name: 'Tarea propia de Nicole' })
    check('Nicole crea su propia tarea', 201, ownTask.status)
    check('queda a su nombre', nicoleMe._id, ownTask.data.assignee?._id)
    cleanup.push({ token: nicole, path: `/tasks/${ownTask.data._id}` })

    const ownBlock = await api(nicole, 'POST', '/schedule/blocks', {
        task: ownTask.data._id,
        start: new Date(Date.UTC(2026, 9, 5, 14, 0)).toISOString(),
        end: new Date(Date.UTC(2026, 9, 5, 15, 0)).toISOString()
    })
    check('Nicole programa su propio bloque', 201, ownBlock.status)

    section('El equipo se ve entre sí para coordinarse')
    check('Nicole ve la semana de Sofianne', 200,
        (await api(nicole, 'GET', `/schedule/week?userId=${sofianneMe._id}`)).status)
    check('Nicole ve el día de Sofianne', 200,
        (await api(nicole, 'GET', `/schedule/day?userId=${sofianneMe._id}`)).status)
    check('Nicole ve lo que Sofianne tiene por programar', 200,
        (await api(nicole, 'GET', `/schedule/unscheduled?userId=${sofianneMe._id}`)).status)
    check('Nicole ve el panel del equipo', 200,
        (await api(nicole, 'GET', '/schedule/team')).status)

    section('Pero nadie reorganiza la agenda ajena')
    check('Nicole no programa en el calendario de Sofianne', 403,
        (await api(nicole, 'POST', '/schedule/blocks', {
            task: ownTask.data._id,
            user: sofianneMe._id,
            start: new Date(Date.UTC(2026, 9, 6, 14, 0)).toISOString(),
            end: new Date(Date.UTC(2026, 9, 6, 15, 0)).toISOString()
        })).status)

    section('Ninguna reasigna trabajo a la otra')
    check('Nicole no crea tareas a nombre de Sofianne', 403,
        (await api(nicole, 'POST', '/tasks', { name: 'Ajena', assignee: sofianneMe._id })).status)
    check('Nicole no se reasigna su tarea a Sofianne', 403,
        (await api(nicole, 'PUT', `/tasks/${ownTask.data._id}`, { assignee: sofianneMe._id })).status)

    section('Reservar es solo de la encargada, y solo sobre lo suyo')
    const nicoleTry = await api(nicole, 'POST', '/tasks', {
        name: 'Intento de reserva', isPrivate: true
    })
    cleanup.push({ token: nicole, path: `/tasks/${nicoleTry.data._id ?? ''}` })
    check('una integrante no puede crear una tarea reservada', 403, nicoleTry.status)

    const plain = await api(nicole, 'POST', '/tasks', { name: 'Tarea normal de Nicole' })
    cleanup.push({ token: nicole, path: `/tasks/${plain.data._id}` })
    check('una integrante no puede reservar la suya después', 403,
        (await api(nicole, 'PUT', `/tasks/${plain.data._id}`, { isPrivate: true })).status)

    section('Sofianne no edita el trabajo de Nicole')
    check('no puede editarlo', 403,
        (await api(sofianne, 'PUT', `/tasks/${ownTask.data._id}`, { name: 'Secuestrada' })).status)
    check('no puede cambiarle el estado', 403,
        (await api(sofianne, 'POST', `/tasks/${ownTask.data._id}/status`, { status: 'done' })).status)
    check('no puede eliminarla', 403,
        (await api(sofianne, 'DELETE', `/tasks/${ownTask.data._id}`)).status)
    check('no puede mover su bloque', 403,
        (await api(sofianne, 'PUT', `/schedule/blocks/${ownBlock.data.block._id}`, {
            start: new Date(Date.UTC(2026, 9, 5, 16, 0)).toISOString(),
            end: new Date(Date.UTC(2026, 9, 5, 17, 0)).toISOString()
        })).status)

    section('Sí pueden trabajar en los proyectos a los que pertenecen')
    const project = await api(nicole, 'POST', '/projects', {
        projectName: 'Proyecto de permisos',
        clientName: 'Interno',
        description: 'Verificación automática'
    })
    check('Nicole puede crear un proyecto', 201, project.status === 200 ? 201 : project.status)
    const projects = await api(nicole, 'GET', '/projects')
    const projectId = projects.data.find((p: any) => p.projectName === 'Proyecto de permisos')._id
    cleanup.push({ token: nicole, path: `/projects/${projectId}` })

    check('la responsable crea tareas en él', 200,
        (await api(nicole, 'POST', `/projects/${projectId}/tasks`, { name: 'Tarea del proyecto' })).status)

    check('Sofianne, fuera del equipo, no puede crear tareas ahí', 403,
        (await api(sofianne, 'POST', `/projects/${projectId}/tasks`, { name: 'Intrusa' })).status)
    check('ni editar el proyecto', 403,
        (await api(sofianne, 'PUT', `/projects/${projectId}`, {
            projectName: 'Robado', clientName: 'X', description: 'Y'
        })).status)
    check('ni añadir colaboradoras', 403,
        (await api(sofianne, 'POST', `/projects/${projectId}/team`, { id: sofianneMe._id })).status)

    // La responsable la suma al equipo: a partir de ahí sí puede trabajar.
    await api(nicole, 'POST', `/projects/${projectId}/team`, { id: sofianneMe._id })
    check('una vez en el equipo, Sofianne sí crea tareas', 200,
        (await api(sofianne, 'POST', `/projects/${projectId}/tasks`, { name: 'Tarea compartida' })).status)
    check('pero sigue sin poder editar el proyecto', 403,
        (await api(sofianne, 'PUT', `/projects/${projectId}`, {
            projectName: 'Robado', clientName: 'X', description: 'Y'
        })).status)
    check('ni eliminarlo', 403,
        (await api(sofianne, 'DELETE', `/projects/${projectId}`)).status)

    section('La encargada sí alcanza todo el equipo')
    await User.create({
        name: TEMP_MANAGER.name,
        email: TEMP_MANAGER.email,
        password: await hashPassword(TEMP_MANAGER.password),
        confirmed: true,
        role: 'manager'
    })
    const boss = await login(TEMP_MANAGER.email, TEMP_MANAGER.password)
    check('la encargada entra', true, boss.length > 20)

    check('ve el calendario de Nicole', 200,
        (await api(boss, 'GET', `/schedule/week?userId=${nicoleMe._id}`)).status)
    check('ve el calendario de Sofianne', 200,
        (await api(boss, 'GET', `/schedule/week?userId=${sofianneMe._id}`)).status)
    const members = await api(boss, 'GET', '/schedule/members')
    check('ve a todo el equipo', true, members.data.length >= 4)
    const assigned = await api(boss, 'POST', '/tasks', {
        name: 'Encargo de verificación', assignee: nicoleMe._id
    })
    check('puede asignar trabajo a Nicole', 201, assigned.status)
    // Solo se limpia lo que esta verificación creó: recoger aquí todas las
    // tareas de Nicole borraría su trabajo real.
    cleanup.push({ token: boss, path: `/tasks/${assigned.data._id}` })

    const bossTasks = await api(boss, 'GET', `/tasks?assignee=${nicoleMe._id}`)
    check('puede revisar las tareas de Nicole', 200, bossTasks.status)

    section('Lo que la encargada reserva no lo ve nadie más')
    const bossMe = (await api(boss, 'GET', '/auth/user')).data
    const secret = await api(boss, 'POST', '/tasks', {
        name: 'Búsqueda de personal', isPrivate: true
    })
    const secretId = secret.data._id
    cleanup.push({ token: boss, path: `/tasks/${secretId}` })
    check('la encargada sí puede reservar la suya', true, secret.data.isPrivate)
    check('queda a su nombre', bossMe._id, secret.data.assignee?._id)

    const nicoleSees = await api(nicole, 'GET', `/tasks?assignee=${bossMe._id}`)
    check('no aparece en el listado de una integrante', false,
        nicoleSees.data.some((task: any) => task._id === secretId))
    check('ni se puede abrir directamente', 403,
        (await api(nicole, 'GET', `/tasks/${secretId}`)).status)

    const nicoleBoard = await api(nicole, 'GET', '/schedule/team')
    const bossPanel = nicoleBoard.data.panels.find((p: any) => p.user._id === bossMe._id)
    check('tampoco aparece en el panel del equipo', false,
        bossPanel.tasks.some((task: any) => task._id === secretId))
    check('y no se anuncia cuántas hay ocultas', undefined, bossPanel.hiddenCount)

    check('su dueña sí la ve', 200, (await api(boss, 'GET', `/tasks/${secretId}`)).status)
}

async function doCleanup() {
    for (const item of cleanup.reverse()) {
        await api(item.token, 'DELETE', item.path)
    }
    if (mongoose.connection.readyState !== 1) {
        await mongoose.connect(process.env.DATABASE_URL!)
    }
    await User.deleteOne({ email: TEMP_MANAGER.email })
    await mongoose.disconnect()
    console.log('\n(limpieza completada)')
}

run()
    .then(doCleanup)
    .then(() => {
        console.log('\n================================')
        console.log(`  Correctas: ${pass}   Fallidas: ${fail}`)
        if (failures.length) console.log(`  Fallos: ${failures.join(', ')}`)
        console.log('================================\n')
        process.exit(fail === 0 ? 0 : 1)
    })
    .catch(async error => {
        console.error('\nError en la verificación:', error.message)
        await doCleanup().catch(() => {})
        process.exit(1)
    })
