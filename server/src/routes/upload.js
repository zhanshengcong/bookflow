import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { getDB } from '../db.js'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = path.join(__dirname, '../../../cache/uploads')

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
}

export async function uploadRouter(fastify) {
  const db = getDB()

  // 上传文件（支持多文件）
  fastify.post('/files', async (req, reply) => {
    const parts = req.files()
    const uploaded = []

    for await (const part of parts) {
      if (!part.file) continue

      const ext = path.extname(part.filename).toLowerCase()
      const safeName = `${Date.now()}_${part.filename}`
      const destPath = path.join(UPLOAD_DIR, safeName)

      await pipeline(part.file, fs.createWriteStream(destPath))

      // 检查是否已存在
      const existing = db.prepare('SELECT id FROM books WHERE file_path = ?').get(destPath)
      if (!existing) {
        const format = ext.slice(1)
        const title = path.basename(part.filename, ext)
        const stat = fs.statSync(destPath)

        db.prepare(`
          INSERT INTO books (library_id, file_path, format, title, file_size)
          VALUES (NULL, ?, ?, ?, ?)
        `).run(destPath, format, title, stat.size)

        uploaded.push({ filename: part.filename, format, size: stat.size, status: 'added' })
      } else {
        uploaded.push({ filename: part.filename, status: 'skipped' })
      }
    }

    return { ok: true, uploaded }
  })

  // 扫描已上传目录
  fastify.post('/scan-uploads', async () => {
    const SUPPORTED_EXTS = ['.epub', '.mobi', '.azw3', '.pdf', '.txt']
    const files = []

    function walk(dir) {
      let entries
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) }
      catch { return }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.isFile() && SUPPORTED_EXTS.includes(path.extname(entry.name).toLowerCase())) {
          files.push(full)
        }
      }
    }
    walk(UPLOAD_DIR)

    let added = 0, skipped = 0
    for (const fp of files) {
      const existing = db.prepare('SELECT id FROM books WHERE file_path = ?').get(fp)
      if (existing) { skipped++; continue }
      const ext = path.extname(fp).toLowerCase().slice(1)
      const title = path.basename(fp, path.extname(fp))
      const stat = fs.statSync(fp)
      db.prepare(`
        INSERT INTO books (library_id, file_path, format, title, file_size)
        VALUES (NULL, ?, ?, ?, ?)
      `).run(fp, ext, title, stat.size)
      added++
    }

    return { ok: true, added, skipped, total: files.length }
  })
}
