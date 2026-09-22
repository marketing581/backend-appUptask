import type { Request, Response } from 'express'
import Workspace from '../models/Workspace'

export class WorkspaceController {

    /** La administradora ve todos los equipos (para el selector); cualquier
     *  otra cuenta solo ve el suyo. */
    static getWorkspaces = async (req: Request, res: Response) => {
        try {
            const filter = req.user.isSuperAdmin ? {} : { _id: req.activeWorkspace }
            const workspaces = await Workspace.find(filter).select('_id name').sort({ name: 1 })
            res.json(workspaces)
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    static createWorkspace = async (req: Request, res: Response) => {
        try {
            const name = String(req.body.name ?? '').trim()
            if (name.length === 0) {
                return res.status(400).json({ error: 'El nombre del equipo es obligatorio' })
            }

            const existing = await Workspace.findOne({ name })
            if (existing) {
                return res.status(409).json({ error: 'Ya existe un equipo con ese nombre' })
            }

            const workspace = await Workspace.create({ name })
            res.status(201).json(workspace)
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }
}
