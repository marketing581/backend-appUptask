import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { requireManagerRole } from '../middleware/authorization'
import { BrandController } from '../controllers/BrandController'

const router = Router()

router.use(authenticate)

router.get('/', BrandController.getBrands)
// Crear áreas nuevas reorganiza cómo se clasifica el trabajo del equipo.
router.post('/', requireManagerRole, BrandController.createBrand)

export default router
