import type { Request, Response } from 'express'
import Memo, { memoVisibility } from '../models/Memo'
import { isManagerRole } from '../middleware/authorization'

const OWNER_POPULATE = { path: 'owner', select: '_id name email' }

const sameId = (a: unknown, b: unknown) => !!a && !!b && a.toString() === b.toString()

export class MemoController {

    /** Notas visibles: las propias y las que el equipo ha compartido.
     *  Una nota personal no la ve nadie más, tampoco la encargada: esto es un
     *  bloc de apuntes, no seguimiento de trabajo. */
    static getMemos = async (req: Request, res: Response) => {
        try {
            const { archived } = req.query

            const memos = await Memo.find({
                archived: archived === 'true',
                $or: [
                    { owner: req.user._id },
                    { visibility: memoVisibility.TEAM }
                ]
            })
                .populate(OWNER_POPULATE)
                .sort({ updatedAt: -1 })

            res.json(memos)
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    static createMemo = async (req: Request, res: Response) => {
        try {
            const memo = new Memo({
                title: req.body.title,
                content: req.body.content ?? '',
                owner: req.user._id,
                visibility: req.body.visibility ?? memoVisibility.TEAM,
                priority: req.body.priority ?? 'none',
                date: req.body.date ? new Date(req.body.date) : null
            })

            await memo.save()
            await memo.populate(OWNER_POPULATE)
            res.status(201).json(memo)
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    static getMemoById = async (req: Request, res: Response) => {
        try {
            const memo = await Memo.findById(req.params.memoId).populate(OWNER_POPULATE)
            if (!memo) return res.status(404).json({ error: 'Nota no encontrada' })

            const visible = memo.visibility === memoVisibility.TEAM || sameId(memo.owner, req.user._id)
            if (!visible) return res.status(403).json({ error: 'Esta nota es personal' })

            res.json(memo)
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    /** Editar una nota compartida lo puede hacer cualquiera del equipo: son
     *  apuntes comunes y turnarse a pedir permiso solo estorbaría. Las
     *  personales, solo su autora. */
    static updateMemo = async (req: Request, res: Response) => {
        try {
            const memo = await Memo.findById(req.params.memoId)
            if (!memo) return res.status(404).json({ error: 'Nota no encontrada' })

            const isOwner = sameId(memo.owner, req.user._id)
            if (!isOwner && memo.visibility !== memoVisibility.TEAM) {
                return res.status(403).json({ error: 'Esta nota es personal' })
            }

            if ('title' in req.body) memo.title = String(req.body.title)
            if ('content' in req.body) memo.content = String(req.body.content)
            if ('priority' in req.body) memo.priority = req.body.priority
            if ('date' in req.body) {
                memo.date = req.body.date ? new Date(String(req.body.date)) : null
            }
            if ('archived' in req.body) memo.archived = !!req.body.archived

            // Cambiar a personal la sacaría de la vista del resto: solo su autora.
            if ('visibility' in req.body && req.body.visibility !== memo.visibility) {
                if (!isOwner) {
                    return res.status(403).json({
                        error: 'Solo quien creó la nota puede cambiar con quién se comparte'
                    })
                }
                memo.visibility = req.body.visibility
            }

            await memo.save()
            await memo.populate(OWNER_POPULATE)
            res.json(memo)
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    static deleteMemo = async (req: Request, res: Response) => {
        try {
            const memo = await Memo.findById(req.params.memoId)
            if (!memo) return res.status(404).json({ error: 'Nota no encontrada' })

            // Borrar es irreversible: solo su autora, o la encargada.
            if (!sameId(memo.owner, req.user._id) && !isManagerRole(req.user)) {
                return res.status(403).json({ error: 'Solo quien creó la nota puede eliminarla' })
            }

            await memo.deleteOne()
            res.json({ message: 'Nota eliminada' })
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }
}
