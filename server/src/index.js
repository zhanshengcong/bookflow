import Fastify from 'fastify'
import cors from '@fastify/cors'
import staticFiles from '@fastify/static'
import multipart from '@fastify/multipart'
import path from 'path'
import { fileURLToPath } from 'url'
import { initDB } from './db.js'
import { booksRouter } from './routes/books.js'
import { libraryRouter } from './routes/library.js'
import { progressRouter } from './routes/progress.js'
import { bookmarksRouter } from './routes/bookmarks.js'
import { uploadRouter } from './routes/upload.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = Fastify({ logger: { level: 'info' } })

await app.register(cors, { origin: true })
await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } }) // 200MB 上限

// 静态文件服务（封面缓存）
const coversDir = path.join(__dirname, '../../cache/covers')
await app.register(staticFiles, {
  root: coversDir,
  prefix: '/covers/',
  decorateReply: false
})

// 初始化数据库
initDB()

// 注册路由
await app.register(booksRouter, { prefix: '/api/books' })
await app.register(libraryRouter, { prefix: '/api/library' })
await app.register(progressRouter, { prefix: '/api/progress' })
await app.register(bookmarksRouter, { prefix: '/api/bookmarks' })
await app.register(uploadRouter, { prefix: '/api/upload' })

// 健康检查
app.get('/api/health', async () => ({ ok: true, ts: Date.now() }))

// 启动
const PORT = process.env.PORT || 3001
try {
  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`BookFlow server running on http://localhost:${PORT}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
