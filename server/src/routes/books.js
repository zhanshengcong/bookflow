import fs from 'fs'
import path from 'path'
import mime from 'mime-types'
import { getDB } from '../db.js'

export async function booksRouter(fastify) {
  const db = getDB()

  fastify.get('/', async (req) => {
    const { q, format, author, series, libraryId, sort, order, page, limit } = req.query
    let conditions = ['1=1']
    let params = []

    if (q) { conditions.push('(b.title LIKE ? OR b.author LIKE ?)'); params.push(`%${q}%`, `%${q}%`) }
    if (format) { conditions.push('b.format = ?'); params.push(format) }
    if (author) { conditions.push('b.author = ?'); params.push(author) }
    if (series) { conditions.push('b.series = ?'); params.push(series) }
    if (libraryId) { conditions.push('b.library_id = ?'); params.push(libraryId) }

    const validSort = { title:1, author:1, series:1, added_at:1, last_opened:1 }
    const sortCol = validSort[sort] || 'title'
    const dir = order === 'desc' ? 'DESC' : 'ASC'

    const where = conditions.join(' AND ')
    const baseSQL = `FROM books b LEFT JOIN progress p ON p.book_id = b.id WHERE ${where}`

    const countResult = db.prepare(`SELECT COUNT(*) as cnt ${baseSQL}`).get(...params)
    const total = countResult?.cnt || 0

    const offset = (parseInt(page || 1) - 1) * parseInt(limit || 50)
    const books = db.prepare(`
      SELECT b.*, p.percentage as read_progress ${baseSQL}
      ORDER BY b.${sortCol} ${dir} NULLS LAST
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit || 50), offset)

    return { data: books, total, page: parseInt(page || 1), limit: parseInt(limit || 50) }
  })

  fastify.get('/:id', async (req, reply) => {
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id)
    if (!book) return reply.code(404).send({ error: 'Book not found' })
    return book
  })

  fastify.get('/:id/file', async (req, reply) => {
    const book = db.prepare('SELECT file_path, format FROM books WHERE id = ?').get(req.params.id)
    if (!book) return reply.code(404).send({ error: 'Book not found' })
    if (!fs.existsSync(book.file_path))
      return reply.code(404).send({ error: 'File not found on disk' })

    const stat = fs.statSync(book.file_path)
    const mimeType = mime.lookup(book.file_path) || 'application/octet-stream'

    // 使用 ETag 实现条件请求，避免重复传输整个文件
    const etag = `"${stat.size}-${stat.mtimeMs}"`
    if (req.headers['if-none-match'] === etag) {
      reply.code(304)
      return reply.send()
    }

    const range = req.headers.range
    if (range) {
      const parts = range.replace('bytes=', '').split('-')
      const start = parseInt(parts[0])
      const end = parts[1] ? parseInt(parts[1]) : stat.size - 1
      reply.code(206)
      reply.header('Content-Range', `bytes ${start}-${end}/${stat.size}`)
      reply.header('Accept-Ranges', 'bytes')
      reply.header('Content-Length', end - start + 1)
      reply.header('Content-Type', mimeType)
      reply.header('ETag', etag)
      reply.header('Cache-Control', 'public, max-age=86400')
      return reply.send(fs.createReadStream(book.file_path, { start, end }))
    }

    db.prepare('UPDATE books SET last_opened = ? WHERE id = ?').run(Math.floor(Date.now()/1000), req.params.id)
    reply.header('Content-Type', mimeType)
    reply.header('Content-Length', stat.size)
    reply.header('Accept-Ranges', 'bytes')
    reply.header('ETag', etag)
    reply.header('Cache-Control', 'public, max-age=86400')
    return reply.send(fs.createReadStream(book.file_path))
  })

  // 提取元数据（批量或单本）
  fastify.post('/meta/extract', async (req, reply) => {
    const { parseEpub, parseMobiMeta, parsePdfMeta, parseTxtMeta } = await import('../parser.js')
    const books = req.body?.bookIds
      ? db.prepare('SELECT * FROM books WHERE id IN (' + req.body.bookIds.join(',') + ')').all()
      : db.prepare('SELECT * FROM books WHERE author IS NULL').all()

    let done = 0
    for (const book of books) {
      try {
        const ext = book.format
        let meta = {}
        if (ext === 'epub') meta = await parseEpub(book.file_path, book.id)
        else if (ext === 'mobi' || ext === 'azw3') meta = await parseMobiMeta(book.file_path, book.id)
        else if (ext === 'pdf') meta = await parsePdfMeta(book.file_path)
        else if (ext === 'txt') meta = await parseTxtMeta(book.file_path)

        if (meta.title || meta.author || meta.cover_path || meta.series) {
          db.prepare(`
            UPDATE books SET title = COALESCE(?, title), author = COALESCE(?, author),
            publisher = COALESCE(?, publisher), description = COALESCE(?, description),
            cover_path = COALESCE(?, cover_path), series = COALESCE(?, series),
            series_index = COALESCE(?, series_index), tags = COALESCE(?, tags),
            language = COALESCE(?, language), published_date = COALESCE(?, published_date)
            WHERE id = ?
          `).run(meta.title, meta.author, meta.publisher, meta.description,
            meta.cover_path, meta.series, meta.series_index, meta.tags,
            meta.language, meta.publishedDate, book.id)
          done++
        }
      } catch (e) {
        console.error('[extract]', book.file_path, e.message)
      }
    }
    return { done, total: books.length }
  })

  fastify.get('/meta/authors', async () => {
    return db.prepare('SELECT DISTINCT author FROM books WHERE author IS NOT NULL ORDER BY author').all()
  })

  fastify.get('/meta/series', async () => {
    return db.prepare(`
      SELECT series, COUNT(*) as count, MIN(cover_path) as cover_path
      FROM books WHERE series IS NOT NULL
      GROUP BY series ORDER BY series
    `).all()
  })

  fastify.get('/meta/stats', async () => {
    const total = db.prepare('SELECT COUNT(*) as c FROM books').get()?.c || 0
    const byFormat = db.prepare('SELECT format, COUNT(*) as c FROM books GROUP BY format ORDER BY c DESC').all()
    const recentlyAdded = db.prepare('SELECT id, title, author, cover_path, format FROM books ORDER BY added_at DESC LIMIT 6').all()
    const recentlyOpened = db.prepare('SELECT id, title, author, cover_path, format, last_opened FROM books WHERE last_opened IS NOT NULL ORDER BY last_opened DESC LIMIT 6').all()
    return { total, byFormat, recentlyAdded, recentlyOpened }
  })

  fastify.delete('/:id', async (req, reply) => {
    db.prepare('DELETE FROM books WHERE id = ?').run(req.params.id)
    return { ok: true }
  })

  fastify.post('/batch-delete', async (req, reply) => {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return reply.code(400).send({ error: 'ids is required' })
    }
    const placeholders = ids.map(() => '?').join(',')
    db.prepare(`DELETE FROM books WHERE id IN (${placeholders})`).run(...ids)
    db.prepare(`DELETE FROM progress WHERE book_id IN (${placeholders})`).run(...ids)
    db.prepare(`DELETE FROM bookmarks WHERE book_id IN (${placeholders})`).run(...ids)
    return { ok: true, deleted: ids.length }
  })
}
