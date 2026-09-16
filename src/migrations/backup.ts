/** Respaldo completo de la base, antes de migrar.
 *
 *  Se escribe en **EJSON**, no en JSON a secas: `JSON.stringify` convierte los
 *  `ObjectId` y las fechas en texto plano, y un respaldo así no se puede
 *  devolver a la base tal cual —los identificadores dejarían de enlazar y las
 *  fechas dejarían de ordenar—. EJSON conserva el tipo de cada valor, de modo
 *  que `restore.ts` puede reponer un documento exactamente como estaba.
 *
 *  Uso: npx ts-node src/migrations/backup.ts <directorio-destino>
 */
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { EJSON } from 'bson'

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
        fs.writeFileSync(file, EJSON.stringify(docs, undefined, 2, { relaxed: false }))
        console.log(`${name}: ${docs.length} documentos -> ${file}`)
    }

    await mongoose.disconnect()
    process.exit(0)
}

run().catch(error => {
    console.error('El respaldo falló:', error)
    process.exit(1)
})
