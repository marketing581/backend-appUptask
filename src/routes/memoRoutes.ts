import { Router } from 'express'
import { body, param } from 'express-validator'
import { authenticate } from '../middleware/auth'
import { handleInputErrors } from '../middleware/validation'
import { MemoController } from '../controllers/MemoController'

const router = Router()

router.use(authenticate)

router.get('/', MemoController.getMemos)

router.post('/',
    body('title').notEmpty().withMessage('El título de la nota es obligatorio'),
    handleInputErrors,
    MemoController.createMemo
)

router.get('/:memoId',
    param('memoId').isMongoId().withMessage('ID no válido'),
    handleInputErrors,
    MemoController.getMemoById
)

router.put('/:memoId',
    param('memoId').isMongoId().withMessage('ID no válido'),
    body('title').optional().notEmpty().withMessage('El título de la nota es obligatorio'),
    handleInputErrors,
    MemoController.updateMemo
)

router.delete('/:memoId',
    param('memoId').isMongoId().withMessage('ID no válido'),
    handleInputErrors,
    MemoController.deleteMemo
)

export default router
