import { Router } from 'express'
import { body, param } from 'express-validator'
import { authenticate } from '../middleware/auth'
import { handleInputErrors } from '../middleware/validation'
import { MyTaskController } from '../controllers/MyTaskController'

/** Tareas fuera del contexto de un proyecto.
 *  Las rutas anidadas en /api/projects/:projectId/tasks siguen funcionando. */
const router = Router()

router.use(authenticate)

router.get('/', MyTaskController.getTasks)

router.post('/',
    body('name').notEmpty().withMessage('El nombre de la tarea es obligatorio'),
    handleInputErrors,
    MyTaskController.createTask
)

router.get('/:taskId',
    param('taskId').isMongoId().withMessage('ID no válido'),
    handleInputErrors,
    MyTaskController.getTaskById
)

router.put('/:taskId',
    param('taskId').isMongoId().withMessage('ID no válido'),
    body('name').optional().notEmpty().withMessage('El nombre de la tarea es obligatorio'),
    handleInputErrors,
    MyTaskController.updateTask
)

router.post('/:taskId/status',
    param('taskId').isMongoId().withMessage('ID no válido'),
    body('status').notEmpty().withMessage('El estado es obligatorio'),
    handleInputErrors,
    MyTaskController.updateStatus
)

router.post('/:taskId/review/request',
    param('taskId').isMongoId().withMessage('ID no válido'),
    handleInputErrors,
    MyTaskController.requestReview
)

router.post('/:taskId/review',
    param('taskId').isMongoId().withMessage('ID no válido'),
    handleInputErrors,
    MyTaskController.resolveReview
)

router.post('/:taskId/convert',
    param('taskId').isMongoId().withMessage('ID no válido'),
    body('project').isMongoId().withMessage('Proyecto no válido'),
    handleInputErrors,
    MyTaskController.convertToProjectTask
)

router.delete('/:taskId',
    param('taskId').isMongoId().withMessage('ID no válido'),
    handleInputErrors,
    MyTaskController.deleteTask
)

export default router
