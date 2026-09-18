import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { requireReportsAccess } from '../middleware/authorization'
import { ReportController } from '../controllers/ReportController'

const router = Router()

// Autenticación + acceso por id exacto: no basta con iniciar sesión, ni con
// ser encargada — es una sola cuenta.
router.use(authenticate, requireReportsAccess)

router.get('/task-duration', ReportController.getTaskDurationReport)

export default router
