import type { Request, Response } from 'express'
import User from '../models/User'
import { isValidTimezone } from '../utils/datetime'
import { canEditCalendarOf } from '../middleware/authorization'

export class PreferencesController {

    /** Zona horaria y horario de trabajo. El horario por defecto es de 8 a
     *  18, pero se puede ampliar y mostrar fines de semana cuando un evento
     *  lo requiera.
     *
     *  Cada quien edita el suyo; la encargada además puede editar el de
     *  cualquier persona del equipo (`userId` en el cuerpo), porque el
     *  horario de trabajo de Sofi o de Nicole no es una preferencia personal
     *  de pantalla: es un dato real que la propia encargada necesita poder
     *  corregir —por ejemplo, si alguien pasa a trabajar medio tiempo. */
    static updatePreferences = async (req: Request, res: Response) => {
        try {
            const targetId = (req.body.userId ?? req.user.id).toString()

            if (!canEditCalendarOf(req.user, targetId)) {
                return res.status(403).json({
                    error: 'Solo la encargada puede cambiar el horario de otra persona'
                })
            }

            const user = targetId === req.user.id.toString()
                ? req.user
                : await User.findOne({ _id: targetId, workspace: req.activeWorkspace })

            if (!user) return res.status(404).json({ error: 'Usuaria no encontrada' })

            // La zona horaria sí es personal: no viaja con `userId`, cada
            // quien ajusta la suya.
            if (targetId === req.user.id.toString() && 'timezone' in req.body) {
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
                _id: user._id,
                timezone: user.timezone,
                schedulePrefs: user.schedulePrefs
            })
        } catch (error) {
            res.status(500).json({ error: 'Hubo un error' })
        }
    }
}
