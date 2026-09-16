/** Repone documentos de un respaldo hecho con `backup.ts`.
 *
 *  Solo **añade lo que falta**: nunca sobrescribe ni borra lo que hay en la
 *  base. Un respaldo se usa para recuperar algo que se perdió, no para volver
 *  atrás el trabajo que se hizo desde entonces; deshacer eso tendría que ser
 *  una decisión explícita, no el efecto secundario de restaurar una tarea.
 *
 *  Uso:
 *    npx ts-node src/migrations/restore.ts <directorio> <colección> [--id=<_id>] [--dry-run]
 *
 *  Sin `--id` repone todos los documentos de la colección que ya no existan.
 */
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { EJSON } from 'bson'

dotenv.config()

const arg = (name: string) => {
    const found = process.argv.find(item => item.startsWith(`--${name}=`))
    return found ? found.slice(name.length + 3) : ''
}

const run = async () => {
    const [dir, collection] = process.argv.slice(2)
    const onlyId = arg('id')
    const dryRun = process.argv.includes('--dry-run')

    if (!dir || !collection) {
        console.error('Uso: restore.ts <directorio> <colección> [--id=<_id>] [--dry-run]')
        process.exit(1)
    }

    const file = path.join(dir, `${collection}.json`)
    if (!fs.existsSync(file)) {
        console.error(`No existe ${file}`)
        process.exit(1)
    }

    const docs = EJSON.parse(fs.readFileSync(file, 'utf8'), { relaxed: false }) as Record<string, unknown>[]
    if (!Array.isArray(docs)) {
        console.error('El respaldo no contiene una lista de documentos')
        process.exit(1)
    }

    // Un respaldo antiguo, escrito en JSON plano, traería los identificadores
    // como texto: reponerlo rompería los enlaces en silencio.
    const suspect = docs.find(doc => typeof doc._id === 'string')
    if (suspect) {
        console.error(
            'Este respaldo está en JSON plano y no conserva los tipos.\n' +
            'Reponerlo dejaría identificadores de texto que no enlazan con nada.'
        )
        process.exit(1)
    }

    await mongoose.connect(process.env.DATABASE_URL!)
    const target = mongoose.connection.db.collection(collection)

    const wanted = onlyId ? docs.filter(doc => String(doc._id) === onlyId) : docs
    if (onlyId && wanted.length === 0) {
        console.error(`El respaldo no contiene ningún documento con _id ${onlyId}`)
        await mongoose.disconnect()
        process.exit(1)
    }

    let repuestos = 0
    let intactos = 0

    for (const doc of wanted) {
        const existe = await target.findOne({ _id: doc._id as never })
        if (existe) { intactos++; continue }
        repuestos++
        if (!dryRun) await target.insertOne(doc as never)
    }

    console.log(
        `${wanted.length} en el respaldo · ${repuestos} ${dryRun ? 'se repondrían' : 'repuestos'} · ` +
        `${intactos} ya estaban`
    )
    await mongoose.disconnect()
    process.exit(0)
}

run().catch(error => {
    console.error('La reposición falló:', error)
    process.exit(1)
})
