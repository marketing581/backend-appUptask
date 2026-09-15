/** Verificación de los flujos de Fase 0 + Fase 1 contra la API en ejecución.
 *
 *  Trabaja con una cuenta temporal propia que crea y borra al terminar, para
 *  no dejar usuarias de prueba en el equipo real.
 *
 *  Uso: npx ts-node src/verify/phase1.ts */
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import User from '../models/User'
import { hashPassword } from '../utils/auth'

dotenv.config()

/** Las suites entran con las cuentas reales del equipo, así que la contraseña
 *  llega por entorno en vez de quedar escrita en el repositorio. */
const TEAM_PASSWORD = process.env.TEAM_SEED_PASSWORD ?? ''

const TEST_USER = {
    name: 'Verificación',
    email: 'verify-flows@verify.local',
    password: 'Kf7x-verify-only-2f19'
}

const API = 'http://localhost:4000/api'
const ORIGIN = 'http://localhost:5173'

let pass = 0
let fail = 0
const failures: string[] = []

function check(label: string, expected: unknown, actual: unknown) {
    const ok = JSON.stringify(expected) === JSON.stringify(actual)
    if (ok) {
        console.log(`  OK    ${label}`)
        pass++
    } else {
        console.log(`  FALLA ${label}\n        esperado: ${JSON.stringify(expected)}\n        obtenido: ${JSON.stringify(actual)}`)
        failures.push(label)
        fail++
    }
}

function section(title: string) {
    console.log(`\n== ${title} ==`)
}

let token = ''

async function api(method: string, path: string, body?: unknown) {
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
    try { data = JSON.parse(text) } catch { /* respuesta en texto plano */ }
    return { status: res.status, data }
}

/** Lunes 2026-09-21 09:00 en Lima (UTC-5) = 14:00 UTC */
const mondayAt = (utcHour: number, utcMinute = 0, dayOffset = 0) =>
    new Date(Date.UTC(2026, 8, 21 + dayOffset, utcHour, utcMinute)).toISOString()

const createdTasks: string[] = []
const createdProjects: string[] = []

async function run() {
    await mongoose.connect(process.env.DATABASE_URL!)
    await User.deleteOne({ email: TEST_USER.email })
    await User.create({
        name: TEST_USER.name,
        email: TEST_USER.email,
        password: await hashPassword(TEST_USER.password),
        confirmed: true,
        role: 'member'
    })

    section('Login')
    const login = await api('POST', '/auth/login', { email: TEST_USER.email, password: TEST_USER.password })
    token = typeof login.data === 'string' ? login.data : ''
    check('login devuelve token', true, token.length > 20)
    if (!token) throw new Error('sin token, no se puede continuar')

    section('Perfil migrado: rol, zona horaria y franja')
    const me = await api('GET', '/auth/user')
    check('rol asignado', 'member', me.data.role)
    check('zona horaria', 'America/Lima', me.data.timezone)
    check('franja visible 8-18', [8, 18], [me.data.schedulePrefs?.dayStartHour, me.data.schedulePrefs?.dayEndHour])

    section('Tarea puntual sin proyecto (creación rápida: solo título)')
    const created = await api('POST', '/tasks', { name: 'Enviar brief a imprenta' })
    const taskId = created.data._id
    createdTasks.push(taskId)
    check('se crea con 201', 201, created.status)
    check('sin proyecto', null, created.data.project)
    check('estado inicial Pendiente', 'pending', created.data.status)
    check('prioridad por defecto media', 'medium', created.data.priority)
    check('responsable es quien la crea', me.data._id, created.data.assignee?._id)
    check('historial inicia con una entrada', 1, created.data.statusHistory?.length)

    section('Campos progresivos de la sección 2')
    const updated = await api('PUT', `/tasks/${taskId}`, {
        priority: 'high',
        estimatedMinutes: 30,
        definitionOfDone: 'Brief enviado y confirmado por la imprenta',
        checklist: [{ text: 'Adjuntar logos', done: false }, { text: 'Confirmar tiraje', done: false }]
    })
    check('prioridad actualizada', 'high', updated.data.priority)
    check('estimación de esfuerzo', 30, updated.data.estimatedMinutes)
    check('criterio de terminado', 'Brief enviado y confirmado por la imprenta', updated.data.definitionOfDone)
    check('checklist con 2 ítems', 2, updated.data.checklist?.length)

    section('Escenario: tarea puntual programada 15 min sin crear proyecto')
    const block = await api('POST', '/schedule/blocks', {
        task: taskId, start: mondayAt(14, 0), end: mondayAt(14, 15)
    })
    check('bloque creado', 201, block.status)
    check('sin conflictos', 0, block.data.conflicts?.length)
    const blockId = block.data.block?._id

    section('Validación de la rejilla de 15 minutos')
    const misaligned = await api('POST', '/schedule/blocks', {
        task: taskId, start: mondayAt(14, 7), end: mondayAt(14, 22)
    })
    check('rechaza inicio desalineado', 400, misaligned.status)

    const inverted = await api('POST', '/schedule/blocks', {
        task: taskId, start: mondayAt(15, 0), end: mondayAt(14, 0)
    })
    check('rechaza fin anterior al inicio', 400, inverted.status)

    section('Cruce de horario: avisa, no reprograma en silencio')
    const overlapping = await api('POST', '/schedule/blocks', {
        task: taskId, start: mondayAt(14, 0), end: mondayAt(14, 30)
    })
    check('el bloque se crea igual', 201, overlapping.status)
    check('devuelve el cruce detectado', 1, overlapping.data.conflicts?.length)

    section('Mover y redimensionar no cambia el estado de la tarea')
    const beforeMove = await api('GET', `/tasks/${taskId}`)
    const moved = await api('PUT', `/schedule/blocks/${blockId}`, {
        start: mondayAt(20, 0), end: mondayAt(21, 0)
    })
    check('bloque movido y redimensionado a 1 h', 60,
        (new Date(moved.data.block.end).getTime() - new Date(moved.data.block.start).getTime()) / 60000)
    const afterMove = await api('GET', `/tasks/${taskId}`)
    check('el estado de la tarea no cambió', beforeMove.data.task.status, afterMove.data.task.status)

    section('Escenario: tarea de 6 h en varios bloques, contada una sola vez')
    const long = await api('POST', '/tasks', { name: 'Producir catálogo', estimatedMinutes: 360 })
    const longId = long.data._id
    createdTasks.push(longId)

    await api('POST', '/schedule/blocks', { task: longId, start: mondayAt(14, 0, 1), end: mondayAt(17, 0, 1) })
    await api('POST', '/schedule/blocks', { task: longId, start: mondayAt(14, 0, 2), end: mondayAt(17, 0, 2) })

    const unscheduled = await api('GET', `/schedule/unscheduled?date=${mondayAt(12)}`)
    const rows = unscheduled.data.filter((row: any) => row.task._id === longId)
    // El trabajo operativo se repite: nada se esconde por estar ya programado,
    // solo se marca como cubierto.
    check('sigue listada una sola vez, sin duplicar', 1, rows.length)
    check('se marca como ya cubierta', true, rows[0]?.fullyScheduled)
    check('suma las 6 h de sus dos bloques', 360, rows[0]?.scheduledMinutes)
    check('su estimación no se duplicó', 360, long.data.estimatedMinutes)

    const partial = await api('POST', '/tasks', { name: 'Revisar formularios web', estimatedMinutes: 120 })
    const partialId = partial.data._id
    createdTasks.push(partialId)
    await api('POST', '/schedule/blocks', { task: partialId, start: mondayAt(18, 0, 3), end: mondayAt(18, 30, 3) })
    const unscheduled2 = await api('GET', `/schedule/unscheduled?date=${mondayAt(12)}`)
    const partialRow = unscheduled2.data.find((row: any) => row.task._id === partialId)
    check('esfuerzo pendiente de la semana (120 - 30)', 90, partialRow?.remainingMinutes)

    // Lo programado se cuenta por semana, no desde el principio de los tiempos.
    const otherWeek = await api('GET', `/schedule/unscheduled?date=${mondayAt(12, 0, 14)}`)
    const otherWeekRow = otherWeek.data.find((row: any) => row.task._id === partialId)
    check('en otra semana vuelve a estar entera por programar', 120, otherWeekRow?.remainingMinutes)

    section('Semana: la misma tarea se ve en el calendario')
    const week = await api('GET', `/schedule/week?date=${mondayAt(12)}`)
    check('zona horaria de la semana', 'America/Lima', week.data.timezone)
    const mondayBlocks = week.data.blocks.filter((b: any) => b.start.startsWith('2026-09-21'))
    check('bloques del lunes', 2, mondayBlocks.length)
    check('el bloque trae su tarea con nombre', true, !!mondayBlocks[0]?.task?.name)

    section('Estados: Pendiente -> En proceso -> Listo, con historial')
    await api('POST', `/tasks/${taskId}/status`, { status: 'inProgress' })
    const done = await api('POST', `/tasks/${taskId}/status`, { status: 'done' })
    check('pasa a Listo', 'done', done.data.task?.status)
    const detail = await api('GET', `/tasks/${taskId}`)
    check('historial acumula 3 entradas', 3, detail.data.task.statusHistory.length)
    check('guarda el estado anterior', 'inProgress', detail.data.task.statusHistory[2].from)

    section('Aprobación: no se puede saltar la revisión')
    const withApprover = await api('POST', '/tasks', {
        name: 'Aprobar arte final', approver: me.data._id
    })
    const approvalId = withApprover.data._id
    createdTasks.push(approvalId)
    const tryDone = await api('POST', `/tasks/${approvalId}/status`, { status: 'done' })
    check('terminar ejecución solicita revisión en vez de cerrar', true, tryDone.data.awaitingApproval)
    check('queda En proceso', 'inProgress', tryDone.data.task.status)
    const forcedDone = await api('POST', `/tasks/${approvalId}/status`, { status: 'done' })
    check('no permite cerrar sin aprobar', 400, forcedDone.status)
    const approved = await api('POST', `/tasks/${approvalId}/review`, { approved: true })
    check('la aprobación sí cierra', 'done', approved.data.status)

    section('Trabajo recurrente: se completa la ocurrencia, no la tarea')
    const daily = await api('POST', '/tasks', {
        name: 'Historias de verificación', frequency: 'daily', estimatedMinutes: 60
    })
    const dailyId = daily.data._id
    createdTasks.push(dailyId)
    check('nace como diaria', 'daily', daily.data.frequency)

    const completed = await api('POST', `/tasks/${dailyId}/status`, { status: 'done' })
    check('completarla cierra la ocurrencia, no la tarea', true, completed.data.occurrenceCompleted)
    check('vuelve a Pendiente para la próxima vez', 'pending', completed.data.task.status)

    const listed = await api('GET', '/tasks')
    const stillThere = listed.data.find((task: any) => task._id === dailyId)
    check('sigue existiendo tras completarla', true, !!stillThere)
    check('y se marca como hecha hoy', true, stillThere?.doneForPeriod)

    const reopened = await api('POST', `/tasks/${dailyId}/status`, { status: 'pending' })
    check('desmarcarla deshace la ocurrencia de hoy', null, reopened.data.task.lastCompletedAt)

    section('Cobertura de lo recurrente: por días, no por minutos')
    // Lunes y martes de la semana de prueba.
    await api('POST', '/schedule/blocks', { task: dailyId, start: mondayAt(14), end: mondayAt(15) })
    await api('POST', '/schedule/blocks', { task: dailyId, start: mondayAt(14, 0, 1), end: mondayAt(15, 0, 1) })

    const backlog = await api('GET', `/schedule/unscheduled?date=${mondayAt(12)}`)
    const dailyRow = backlog.data.find((row: any) => row.task._id === dailyId)
    check('una diaria pide hueco los 5 días', 5, dailyRow?.expectedPerWeek)
    check('lleva 2 días cubiertos', 2, dailyRow?.scheduledDays)
    check('aún no está cubierta pese a sumar 2 h', false, dailyRow?.fullyScheduled)
    check('sigue disponible para darle hora otro día', true, !!dailyRow)

    const weeklyTask = await api('POST', '/tasks', { name: 'Reporte semanal', frequency: 'weekly' })
    createdTasks.push(weeklyTask.data._id)
    await api('POST', '/schedule/blocks', {
        task: weeklyTask.data._id, start: mondayAt(16, 0, 2), end: mondayAt(17, 0, 2)
    })
    const backlog2 = await api('GET', `/schedule/unscheduled?date=${mondayAt(12)}`)
    const weeklyRow = backlog2.data.find((row: any) => row.task._id === weeklyTask.data._id)
    check('una semanal pide hueco una vez', 1, weeklyRow?.expectedPerWeek)
    check('con un día ya queda cubierta', true, weeklyRow?.fullyScheduled)

    section('Etiqueta "Por validar"')
    const toValidate = await api('POST', '/tasks', { name: 'Arte del flyer' })
    const validateId = toValidate.data._id
    createdTasks.push(validateId)

    const requested = await api('POST', `/tasks/${validateId}/review/request`, {})
    check('enviar a validación deja la revisión pedida', true, requested.data.review?.needed)
    check('por debajo sigue En proceso', 'inProgress', requested.data.status)

    const blockedClose = await api('POST', `/tasks/${validateId}/status`, { status: 'done' })
    check('no se puede cerrar mientras está Por validar', 400, blockedClose.status)

    // Sacarla de validación la devuelve a ejecución y retira la solicitud.
    const backToWork = await api('POST', `/tasks/${validateId}/status`, { status: 'inProgress' })
    check('devolverla a En proceso retira la validación', false, backToWork.data.task.review?.needed)

    const notInReview = await api('POST', `/tasks/${validateId}/review`, { approved: true })
    check('no se valida una tarea que no está en validación', 400, notInReview.status)

    // Sin aprobadora designada solo la encargada valida (se comprueba en
    // verify/permissions.ts). Aquí se designa una para probar el mecanismo.
    await api('POST', `/tasks/${validateId}/review/request`, {})
    const notMyTask = await api('POST', `/tasks/${validateId}/review`, { approved: true })
    check('quien no es aprobadora ni encargada no puede validar', 403, notMyTask.status)

    await api('POST', `/tasks/${validateId}/review/request`, { approver: me.data._id })
    const approvedTask = await api('POST', `/tasks/${validateId}/review`, { approved: true })
    check('la aprobadora designada la cierra', 'done', approvedTask.data.status)
    check('y deja de estar Por validar', false, approvedTask.data.review?.needed)

    const rejectTest = await api('POST', '/tasks', { name: 'Banner para redes' })
    createdTasks.push(rejectTest.data._id)
    await api('POST', `/tasks/${rejectTest.data._id}/review/request`, { approver: me.data._id })
    const rejected = await api('POST', `/tasks/${rejectTest.data._id}/review`, { approved: false })
    check('rechazar la devuelve a ejecución', 'inProgress', rejected.data.status)
    check('sin quedar Por validar', false, rejected.data.review?.needed)

    const doneTask = await api('POST', '/tasks', { name: 'Ya terminada' })
    createdTasks.push(doneTask.data._id)
    await api('POST', `/tasks/${doneTask.data._id}/status`, { status: 'done' })
    const lateValidation = await api('POST', `/tasks/${doneTask.data._id}/review/request`, {})
    check('una tarea Listo no se manda a validar', 400, lateValidation.status)

    section('Tarea puntual convertida en tarea de proyecto conserva historial')
    await api('POST', '/projects', {
        projectName: 'Proyecto de verificación',
        clientName: 'Interno',
        description: 'Creado por la verificación automática'
    })
    const projects = await api('GET', '/projects')
    const verifyProject = projects.data.find((p: any) => p.projectName === 'Proyecto de verificación')
    createdProjects.push(verifyProject._id)

    const standalone = await api('POST', '/tasks', { name: 'Cotizar banners' })
    const standaloneId = standalone.data._id
    createdTasks.push(standaloneId)
    await api('POST', `/tasks/${standaloneId}/status`, { status: 'inProgress' })
    const converted = await api('POST', `/tasks/${standaloneId}/convert`, { project: verifyProject._id })
    check('queda vinculada al proyecto', verifyProject._id, converted.data.project?._id)
    const convDetail = await api('GET', `/tasks/${standaloneId}`)
    check('conserva el historial previo', 3, convDetail.data.task.statusHistory.length)
    check('mantiene su estado', 'inProgress', convDetail.data.task.status)
    check('la conversión queda anotada en el historial', true,
        convDetail.data.task.statusHistory[2].note.includes('Convertida en tarea del proyecto'))

    section('Permisos aplicados en el servidor')
    const members = await api('GET', '/schedule/members')
    check('ve al equipo para poder coordinarse', true, members.data.length >= 2)
    const foreign = await api('GET', '/schedule/week?userId=000000000000000000000000')
    check('un calendario inexistente devuelve 404', 404, foreign.status)
    const assignOther = await api('POST', '/tasks', {
        name: 'Tarea ajena', assignee: '000000000000000000000000'
    })
    check('no puede asignar trabajo a otra persona', 403, assignOther.status)

    section('Mi día')
    const day = await api('GET', `/schedule/day?date=${mondayAt(12)}`)
    check('devuelve minutos programados', true, typeof day.data.scheduledMinutes === 'number')
    check('separa entregables de hoy', true, Array.isArray(day.data.dueToday))
    check('separa vencidos', true, Array.isArray(day.data.overdue))
    check('franja visible de 10 h', 600, day.data.windowMinutes)
}

async function cleanup() {
    for (const id of createdTasks) {
        await api('DELETE', `/tasks/${id}`)
    }
    for (const id of createdProjects) {
        await api('DELETE', `/projects/${id}`)
    }
    if (mongoose.connection.readyState !== 1) {
        await mongoose.connect(process.env.DATABASE_URL!)
    }
    await User.deleteOne({ email: TEST_USER.email })
    await mongoose.disconnect()
    console.log(`\n(limpieza: ${createdTasks.length} tareas, ${createdProjects.length} proyectos y la cuenta temporal)`)
}

run()
    .then(cleanup)
    .then(() => {
        console.log('\n================================')
        console.log(`  Correctas: ${pass}   Fallidas: ${fail}`)
        if (failures.length) console.log(`  Fallos: ${failures.join(', ')}`)
        console.log('================================\n')
        process.exit(fail === 0 ? 0 : 1)
    })
    .catch(async error => {
        console.error('\nError en la verificación:', error.message)
        await cleanup()
        process.exit(1)
    })
