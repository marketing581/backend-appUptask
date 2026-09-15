/** Respaldo completo de la base a archivos JSON, antes de migrar.
 *  Uso: npx ts-node src/migrations/backup.ts <directorio-destino> */
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'

dotenv.config()

const run = async () => {
    const outDir = process.argv[2]
    if (!outDir) {
        console.error('Falta el directorio destino')
        process.exit(1)
    }

    await mongoose.connect(process.env.DATABASE_URL!)
    const db = mongoose.connection.db

    fs.mkdirSync(outDir, { recursive: true })

    const collections = await db.listCollections().toArray()
    for (const { name } of collections) {
        const docs = await db.collection(name).find({}).toArray()
        const file = path.join(outDir, `${name}.json`)
        fs.writeFileSync(file, JSON.stringify(docs, null, 2))
        console.log(`${name}: ${docs.length} documentos -> ${file}`)
    }

    await mongoose.disconnect()
    process.exit(0)
}

run().catch(error => {
    console.error('El respaldo falló:', error)
    process.exit(1)
})
