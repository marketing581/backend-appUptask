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

dotenv.config()
connectDB()

const app = express()
app.use(cors(corsConfig))

// Logging
app.use(morgan('dev'))

// Leer datos de formularios
app.use(express.json())

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/projects', projectRoutes)
app.use('/api/tasks', taskRoutes)
app.use('/api/schedule', scheduleRoutes)
app.use('/api/brands', brandRoutes)
app.use('/api/notas', memoRoutes)
app.use('/api/reports', reportRoutes)

export default app