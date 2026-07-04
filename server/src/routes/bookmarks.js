import { getDB } from '../db.js'

export async function bookmarksRouter(fastify) {
  const db = getDB()

  fastify.get('/:bookId', async (req) => {
    return db.prepare('SELECT * FROM bookmarks WHERE book_id = ? ORDER BY created_at DESC').all(req.params.bookId)
  })

  fastify.post('/:bookId', async (req) => {
    const { cfi, label, excerpt, color = 'yellow', type = 'bookmark' } = req.body
    const info = db.prepare(`
      INSERT INTO bookmarks (book_id, cfi, label, excerpt, color, type)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.params.bookId, cfi, label, excerpt, color, type)
    return db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(info.lastInsertRowid)
  })

  fastify.delete('/:bookId/:id', async (req) => {
    db.prepare('DELETE FROM bookmarks WHERE id = ? AND book_id = ?').run(req.params.id, req.params.bookId)
    return { ok: true }
  })
}
