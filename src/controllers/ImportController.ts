import type { Request, Response } from 'express'
import User from '../models/User'
import Task, { taskFrequency } from '../models/Task'
import { isManagerRole } from '../middleware/authorization'
import { NOTION_IMPORT_NOTE, planNotionImport } from '../utils/notionImport'

const PREVIEW_LIMIT = 30

export class ImportController {

    /** Autoservicio del mismo import que antes solo se podía correr por
     *  terminal (`migrations/import-past-tasks.ts`): pega el CSV exportado
     *  de Notion, elige para quién es y en qué equipo —el que esté activo—
     *  y entra como pendientes puntuales. Con `dryRun` solo cuenta, no
     *  escribe nada: para revisar antes de confirmar. */
    static importNotion = async (req: Request, res: Response) => {
        try {
            const { content, assigneeId, day, dryRun } = req.body

            if (typeof content !== 'string' || content.trim().length === 0) {
                return res.status(400).json({ error: 'Falta el contenido del CSV' })
            }
            if (typeof assigneeId !== 'string') {
                return res.status(400).json({ error: 'Falta a quién se le asigna' })
            }

            const isSelf = assigneeId === req.user.id.toString()
            if (!isSelf && !isManagerRole(req.user)) {
                return res.status(403).json({ error: 'Solo la encargada puede importar para otra persona' })
            }

            const owner = await User.findOne({ _id: assigneeId, workspace: req.activeWorkspace })
            if (!owner) return res.status(404).json({ error: 'Esa cuenta no es de este equipo' })

            const rows = planNotionImport(content, typeof day === 'string' && day.trim() ? day.trim() : undefined)

            let created = 0
            let updated = 0

            for (const row of rows) {
                const existing = await Task.findOne({
                    name: row.name, assignee: owner._id, workspace: req.activeWorkspace
                })

                if (existing) {
                    updated++
                    if (dryRun) continue
                    existing.status = row.status
                    existing.frequency = taskFrequency.NONE
                    if (row.description && !existing.description) existing.description = row.description
                    await existing.save()
                    continue
                }

                created++
                if (dryRun) continue

                await Task.create({
                    name: row.name,
                    description: row.description,
                    workspace: req.activeWorkspace,
                    assignee: owner._id,
                    createdBy: req.user._id,
                    project: null,
                    frequency: taskFrequency.NONE,
                    status: row.status,
                    onHold: { active: row.onHold, reason: '', waitingOn: '', followUpDate: null },
                    statusHistory: [{
                        from: null,
                        to: row.status,
                        changedBy: req.user._id,
                        changedAt: new Date(),
                        note: NOTION_IMPORT_NOTE
                    }]
                })
            }

            res.json({
                total: rows.length,
                created,
                updated,
                preview: rows.slice(0, PREVIEW_LIMIT).map(row => ({
                    name: row.name, status: row.status, onHold: row.onHold
                }))
            })
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }
}
