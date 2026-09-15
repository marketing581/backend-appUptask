import type { Request, Response } from 'express'
import Brand from '../models/Brand'

export class BrandController {

    /** Áreas de trabajo (Contenido, Diseño…). Las comparte todo el equipo. */
    static getBrands = async (_req: Request, res: Response) => {
        try {
            const brands = await Brand.find({}).select('_id name color').sort({ name: 1 })
            res.json(brands)
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }

    static createBrand = async (req: Request, res: Response) => {
        try {
            const name = String(req.body.name ?? '').trim()
            if (name.length === 0) {
                return res.status(400).json({ error: 'El nombre del área es obligatorio' })
            }

            const existing = await Brand.findOne({ name })
            if (existing) return res.json(existing)

            const brand = await Brand.create({
                name,
                color: req.body.color || '#6366f1',
                createdBy: req.user._id
            })
            res.status(201).json(brand)
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }
}
