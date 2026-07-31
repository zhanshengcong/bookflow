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
    const FORMAT_PRIORITY = { epub: 5, azw3: 4, mobi: 3, pdf: 2, txt: 1 }

    const SUPPORTED_EXTS = ['.epub', '.mobi', '.azw3', '.pdf', '.txt']

    for await (const part of parts) {
      if (!part.file) continue

      const ext = path.extname(part.filename).toLowerCase()
      // 严格过滤：只接受电子书格式
      if (!SUPPORTED_EXTS.includes(ext)) {
        await part.file.resume() // 跳过不支持的文件
        uploaded.push({ filename: part.filename, status: 'skipped_unsupported' })
        continue
      }

      const nameNoExt = path.basename(part.filename, ext)
      const format = ext.slice(1)
      const priority = FORMAT_PRIORITY[format] || 0

      // 检查数据库中是否已有同名书（不同格式）
      const sameName = db.prepare(
        'SELECT id, format, file_path FROM books WHERE title = ? LIMIT 1'
      ).get(nameNoExt)

      if (sameName) {
        const existingPriority = FORMAT_PRIORITY[sameName.format] || 0
        if (priority > existingPriority) {
          // 新文件优先级更高，删除旧记录，插入新记录
          try { fs.unlinkSync(sameName.file_path) } catch {}
          db.prepare('DELETE FROM books WHERE id = ?').run(sameName.id)

          const safeName = `${Date.now()}_${part.filename}`
          const destPath = path.join(UPLOAD_DIR, safeName)
          await pipeline(part.file, fs.createWriteStream(destPath))
          const stat = fs.statSync(destPath)

          db.prepare(`
            INSERT INTO books (library_id, file_path, format, title, file_size)
            VALUES (NULL, ?, ?, ?, ?)
          `).run(destPath, format, nameNoExt, stat.size)

          uploaded.push({ filename: part.filename, format, size: stat.size, status: 'replaced' })
        } else {
          // 已有同名书且优先级不低于当前，跳过
          uploaded.push({ filename: part.filename, format, status: 'skipped_lower_priority' })
          // 跳过文件写入
          await part.file.resume()
        }
      } else {
        // 没有同名书，正常写入
        const safeName = `${Date.now()}_${part.filename}`
        const destPath = path.join(UPLOAD_DIR, safeName)
        await pipeline(part.file, fs.createWriteStream(destPath))
        const stat = fs.statSync(destPath)

        db.prepare(`
          INSERT INTO books (library_id, file_path, format, title, file_size)
          VALUES (NULL, ?, ?, ?, ?)
        `).run(destPath, format, nameNoExt, stat.size)

        uploaded.push({ filename: part.filename, format, size: stat.size, status: 'added' })
      }
    }

    return { ok: true, uploaded }
  })

  // 扫描已上传目录
  fastify.post('/scan-uploads', async () => {
    const SUPPORTED_EXTS = ['.epub', '.mobi', '.azw3', '.pdf', '.txt']
    const FORMAT_PRIORITY = { epub: 5, azw3: 4, mobi: 3, pdf: 2, txt: 1 }
    const fileMap = new Map() // key: name(noext) -> { path, ext, priority }

    function walk(dir) {
      let entries
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) }
      catch { return }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (!SUPPORTED_EXTS.includes(ext)) continue
          const nameNoExt = path.basename(entry.name, ext)
          const priority = FORMAT_PRIORITY[ext.slice(1)] || 0
          const existing = fileMap.get(nameNoExt)
          if (!existing || priority > existing.priority) {
            fileMap.set(nameNoExt, { path: full, ext, priority })
          }
        }
      }
    }
    walk(UPLOAD_DIR)

    const files = Array.from(fileMap.values()).sort((a, b) => b.priority - a.priority)

    let added = 0, skipped = 0
    for (const { path: fp, ext } of files) {
      const existing = db.prepare('SELECT id FROM books WHERE file_path = ?').get(fp)
      if (existing) { skipped++; continue }
      const title = path.basename(fp, path.extname(fp))
      const stat = fs.statSync(fp)
      db.prepare(`
        INSERT INTO books (library_id, file_path, format, title, file_size)
        VALUES (NULL, ?, ?, ?, ?)
      `).run(fp, ext.slice(1), title, stat.size)
      added++
    }

    return { ok: true, added, skipped, total: files.length }
  })
}
