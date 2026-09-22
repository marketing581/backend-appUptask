import express from 'express'
import dotenv from 'dotenv'
import cors from 'cors'
import morgan from 'morgan'
import { corsConfig } from './config/cors'
import { connectDB } from './config/db'
import './models'
import authRoutes from './routes/authRoutes'
import projectRoutes from './routes/projectRoutes'
import taskRoutes from './routes/taskRoutes'
import scheduleRoutes from './routes/scheduleRoutes'
import brandRoutes from './routes/brandRoutes'
import memoRoutes from './routes/memoRoutes'
import reportRoutes from './routes/reportRoutes'
import workspaceRoutes from './routes/workspaceRoutes'
import importRoutes from './routes/importRoutes'

dotenv.config()
connectDB()

const app = express()
app.use(cors(corsConfig))

// Logging
app.use(morgan('dev'))

// Leer datos de formularios. El límite por defecto (100kb) se queda corto
// para un CSV de Notion con cientos de filas pegado como texto.
app.use(express.json({ limit: '10mb' }))

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/projects', projectRoutes)
app.use('/api/tasks', taskRoutes)
app.use('/api/schedule', scheduleRoutes)
app.use('/api/brands', brandRoutes)
app.use('/api/notas', memoRoutes)
app.use('/api/reports', reportRoutes)
app.use('/api/workspaces', workspaceRoutes)
app.use('/api/imports', importRoutes)

export default app