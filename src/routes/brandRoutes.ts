import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { BrandController } from '../controllers/BrandController'

const router = Router()

router.use(authenticate)

router.get('/', BrandController.getBrands)
// Etiquetar de qué marca es un pendiente lo hace cualquiera del equipo, igual
// que renombrar o mover una tarea: no reorganiza nada de otras personas.
router.post('/', BrandController.createBrand)

export default router
