import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { ImportController } from '../controllers/ImportController'

const router = Router()

router.use(authenticate)

router.post('/notion', ImportController.importNotion)

export default router
