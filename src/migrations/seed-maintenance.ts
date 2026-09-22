/** Carga la operación de mantenimiento del equipo tal como está en Notion.
 *
 *  Cada ítem entra como tarea operativa (sin proyecto), con su área y su
 *  cadencia. La frecuencia es de momento una etiqueta: agrupa y ordena la
 *  lista, pero todavía no genera ocurrencias automáticas.
 *
 *  Es idempotente: identifica por nombre + responsable, así que reejecutarlo
 *  actualiza en vez de duplicar.
 *
 *  Uso: npx ts-node src/migrations/seed-maintenance.ts
 */
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import User from '../models/User'
import Brand from '../models/Brand'
import Task, { taskStatus } from '../models/Task'

dotenv.config()

type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'onDemand'

interface AreaSeed {
    area: string
    color: string
    ownerEmail: string
    items: { name: string, frequency: Frequency }[]
}

const AREAS: AreaSeed[] = [
    {
        area: 'Contenido',
        color: '#db2777',
        ownerEmail: 'nicole@greendreams.pe',
        items: [
            { name: 'Historias', frequency: 'daily' },
            { name: 'Retoque de imágenes', frequency: 'daily' },
            { name: 'Post GD - 3', frequency: 'weekly' },
            { name: 'Post Resort - 3', frequency: 'weekly' },
            { name: 'Post Gaia - 2', frequency: 'weekly' },
            { name: 'Contenido UGC', frequency: 'weekly' },
            { name: 'Actualizar historias destacadas', frequency: 'biweekly' },
            { name: 'Optimización de redes, actualizaciones, novedades', frequency: 'monthly' },
            { name: 'Enviar imágenes influencers al grupo de fotografía', frequency: 'onDemand' }
        ]
    },
    {
        area: 'Diseño',
        color: '#7c3aed',
        ownerEmail: 'sofi@greendreams.pe',
        items: [
            { name: 'Creación de videos con AI', frequency: 'weekly' },
            { name: 'Limpiar accesos en Drive - material impreso', frequency: 'monthly' },
            { name: 'Seguimiento de influencers', frequency: 'onDemand' },
            { name: 'Bloqueo de lotes - MY', frequency: 'onDemand' },
            { name: 'Subir archivos impresos a Drive', frequency: 'onDemand' },
            { name: 'Seguimiento de impresión', frequency: 'onDemand' },
            { name: 'Actualización de álbumes de fotos con las ediciones', frequency: 'onDemand' },
            { name: 'Edición y elección de fotos OTAs', frequency: 'onDemand' }
        ]
    }
]

const run = async () => {
    await mongoose.connect(process.env.DATABASE_URL!)

    const manager = await User.findOne({ role: 'manager' })
    if (!manager) throw new Error('No hay encargada registrada')

    let created = 0
    let updated = 0

    for (const seed of AREAS) {
        const owner = await User.findOne({ email: seed.ownerEmail })
        if (!owner) {
            console.log(`  omitida el área "${seed.area}": no existe ${seed.ownerEmail}`)
            continue
        }

        let brand = await Brand.findOne({ name: seed.area })
        if (!brand) {
            brand = await Brand.create({
                name: seed.area,
                color: seed.color,
                createdBy: manager._id,
                workspace: manager.workspace
            })
            console.log(`área creada: ${seed.area}`)
        }

        console.log(`\n${seed.area} — ${owner.name}`)
        for (const item of seed.items) {
            const existing = await Task.findOne({ name: item.name, assignee: owner._id })

            if (existing) {
                existing.frequency = item.frequency
                existing.brand = brand._id
                await existing.save()
                updated++
                console.log(`  actualizada  ${item.name}`)
            } else {
                await Task.create({
                    name: item.name,
                    workspace: manager.workspace,
                    assignee: owner._id,
                    createdBy: manager._id,
                    brand: brand._id,
                    frequency: item.frequency,
                    status: taskStatus.PENDING,
                    statusHistory: [{
                        from: null,
                        to: taskStatus.PENDING,
                        changedBy: manager._id,
                        changedAt: new Date(),
                        note: 'Importada de la operación de mantenimiento'
                    }]
                })
                created++
                console.log(`  creada       ${item.name}`)
            }
        }
    }

    console.log(`\nCreadas: ${created}   Actualizadas: ${updated}`)
    await mongoose.disconnect()
    process.exit(0)
}

run().catch(error => {
    console.error('La carga falló:', error)
    process.exit(1)
})
