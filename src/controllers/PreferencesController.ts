import type { Request, Response } from 'express'
import User from '../models/User'
import { isValidTimezone } from '../utils/datetime'

export class PreferencesController {

    /** Zona horaria y franja visible del calendario. La franja por defecto es
     *  de 8 a 18, pero se puede ampliar y mostrar fines de semana cuando un
     *  evento lo requiera. */
    static updatePreferences = async (req: Request, res: Response) => {
        try {
            const user = await User.findById(req.user.id)
            if (!user) return res.status(404).json({ error: 'Usuaria no encontrada' })

            if ('timezone' in req.body) {
                const timezone = String(req.body.timezone)
                if (!isValidTimezone(timezone)) {
                    return res.status(400).json({ error: 'Zona horaria no válida' })
                }
                user.timezone = timezone
            }

            const prefs = req.body.schedulePrefs
            if (prefs) {
                const dayStartHour = Number(prefs.dayStartHour ?? user.schedulePrefs.dayStartHour)
                const dayEndHour = Number(prefs.dayEndHour ?? user.schedulePrefs.dayEndHour)

                if (!Number.isInteger(dayStartHour) || dayStartHour < 0 || dayStartHour > 23) {
                    return res.status(400).json({ error: 'Hora de inicio no válida' })
                }
                if (!Number.isInteger(dayEndHour) || dayEndHour < 1 || dayEndHour > 24) {
                    return res.status(400).json({ error: 'Hora de fin no válida' })
                }
                if (dayEndHour <= dayStartHour) {
                    return res.status(400).json({ error: 'La hora de fin debe ser posterior a la de inicio' })
                }

                user.schedulePrefs.dayStartHour = dayStartHour
                user.schedulePrefs.dayEndHour = dayEndHour
                if ('showWeekends' in prefs) {
                    user.schedulePrefs.showWeekends = !!prefs.showWeekends
                }
            }

            await user.save()
            res.json({
                timezone: user.timezone,
                schedulePrefs: user.schedulePrefs
            })
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }
}
