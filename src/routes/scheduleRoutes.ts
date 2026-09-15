import { Router } from 'express'
import { body, param } from 'express-validator'
import { authenticate } from '../middleware/auth'
import { handleInputErrors } from '../middleware/validation'
import { ScheduleController } from '../controllers/ScheduleController'
import { PreferencesController } from '../controllers/PreferencesController'

const router = Router()

router.use(authenticate)

router.get('/week', ScheduleController.getWeek)
router.get('/day', ScheduleController.getDay)
router.get('/unscheduled', ScheduleController.getUnscheduled)
router.get('/members', ScheduleController.getTeamMembers)
router.get('/team', ScheduleController.getTeamBoard)

router.post('/blocks',
    body('task').isMongoId().withMessage('Tarea no válida'),
    body('start').notEmpty().withMessage('El inicio es obligatorio'),
    body('end').notEmpty().withMessage('El fin es obligatorio'),
    handleInputErrors,
    ScheduleController.createBlock
)

router.put('/blocks/:blockId',
    param('blockId').isMongoId().withMessage('ID no válido'),
    handleInputErrors,
    ScheduleController.updateBlock
)

router.delete('/blocks/:blockId',
    param('blockId').isMongoId().withMessage('ID no válido'),
    handleInputErrors,
    ScheduleController.deleteBlock
)

router.put('/preferences', PreferencesController.updatePreferences)

export default router
