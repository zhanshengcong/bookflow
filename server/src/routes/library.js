import fs from 'fs'
import path from 'path'
import { getDB } from '../db.js'
import { parseEpub, parseMobiMeta, parsePdfMeta, parseTxtMeta } from '../parser.js'
import { execSync } from 'child_process'

const SUPPORTED_EXTS = ['.epub', '.mobi', '.azw3', '.pdf', '.txt']

// 格式优先级：epub > azw3 > mobi > pdf > txt，同名书只保留优先级最高的格式
const FORMAT_PRIORITY = { epub: 5, azw3: 4, mobi: 3, pdf: 2, txt: 1 }

async function scanFiles(files, libraryId, db) {
  const results = { added: 0, skipped: 0, errors: 0 }

  for (const filePath of files) {
    try {
      const existing = db.prepare('SELECT id FROM books WHERE file_path = ?').get(filePath)
      if (existing) { results.skipped++; continue }

      const ext = path.extname(filePath).toLowerCase().slice(1)
      const stat = fs.statSync(filePath)

      const fileName = path.basename(filePath, path.extname(filePath))
      const dirName = path.basename(path.dirname(filePath))
      let title = fileName

      // 检查是否有不同路径的同名书，加上父目录区分
      const sameNameCount = db.prepare(
        'SELECT COUNT(*) as cnt FROM books WHERE title = ?'
      ).get(fileName)?.cnt || 0
      if (sameNameCount > 0) {
        title = `${dirName}/${fileName}`
      }

      // 跳过元数据解析，直接用文件名（后续可以异步补充）
      db.prepare(`
        INSERT INTO books (library_id, file_path, format, title, file_size)
        VALUES (?, ?, ?, ?, ?)
      `).run(libraryId, filePath, ext, title, stat.size)

      results.added++
    } catch (e) {
      console.error('[scan] Error:', filePath, e.message)
      results.errors++
    }
  }
  return results
}

function collectFiles(dirPath) {
  const fileMap = new Map() // key: dir/name(noext) -> { path, ext, priority }

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
        const key = `${dir}::${nameNoExt}`
        const priority = FORMAT_PRIORITY[ext.slice(1)] || 0
        const existing = fileMap.get(key)
        if (!existing || priority > existing.priority) {
          fileMap.set(key, { path: full, ext, priority })
        }
      }
    }
  }
  walk(dirPath)

  // 按优先级排序，确保 EPUB 先处理
  return Array.from(fileMap.values())
    .sort((a, b) => b.priority - a.priority)
    .map((f) => f.path)
}

export async function libraryRouter(fastify) {
  const db = getDB()

  fastify.get('/', async () => {
    return db.prepare('SELECT * FROM libraries ORDER BY created_at DESC').all()
  })

  fastify.post('/', async (req, reply) => {
    const { name, dirPath: dir } = req.body
    if (!dir || !fs.existsSync(dir)) {
      return reply.code(400).send({ error: '目录不存在: ' + dir })
    }

    let library = db.prepare('SELECT * FROM libraries WHERE path = ?').get(dir)
    if (!library) {
      const r = db.prepare('INSERT INTO libraries (name, path) VALUES (?, ?)').run(
        name || path.basename(dir), dir
      )
      library = db.prepare('SELECT * FROM libraries WHERE id = ?').get(r.lastInsertRowid)
    }

    const files = collectFiles(dir)
    const scan = await scanFiles(files, library.id, db)

    return { library, scan: { ...scan, total: files.length } }
  })

  fastify.post('/:id/rescan', async (req, reply) => {
    const lib = db.prepare('SELECT * FROM libraries WHERE id = ?').get(req.params.id)
    if (!lib) return reply.code(404).send({ error: 'Library not found' })
    const files = collectFiles(lib.path)
    const scan = await scanFiles(files, lib.id, db)
    return { scan: { ...scan, total: files.length } }
  })

  fastify.delete('/:id', async (req, reply) => {
    db.prepare('DELETE FROM libraries WHERE id = ?').run(req.params.id)
    return { ok: true }
  })
}
