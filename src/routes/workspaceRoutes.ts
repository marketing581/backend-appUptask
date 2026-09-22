import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { requireSuperAdmin } from '../middleware/authorization'
import { WorkspaceController } from '../controllers/WorkspaceController'

const router = Router()

router.use(authenticate)

router.get('/', WorkspaceController.getWorkspaces)
// Crear un equipo nuevo es cosa de la administradora, no de cada encargada.
router.post('/', requireSuperAdmin, WorkspaceController.createWorkspace)

export default router
