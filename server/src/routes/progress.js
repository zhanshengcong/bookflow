import { getDB } from '../db.js'

export async function progressRouter(fastify) {
  const db = getDB()

  fastify.get('/:bookId', async (req, reply) => {
    const row = db.prepare('SELECT * FROM progress WHERE book_id = ?').get(req.params.bookId)
    return row || { book_id: parseInt(req.params.bookId), cfi: null, page: 0, percentage: 0 }
  })

  fastify.put('/:bookId', async (req, reply) => {
    const { cfi, page, percentage } = req.body
    const bkId = parseInt(req.params.bookId)
    const existing = db.prepare('SELECT id FROM progress WHERE book_id = ?').get(bkId)
    const ts = Math.floor(Date.now() / 1000)
    if (existing) {
      db.prepare('UPDATE progress SET cfi = ?, page = ?, percentage = ?, updated_at = ? WHERE book_id = ?')
        .run(cfi, page, percentage, ts, bkId)
    } else {
      db.prepare('INSERT INTO progress (book_id, cfi, page, percentage, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(bkId, cfi, page, percentage, ts)
    }
    return { ok: true }
  })
}
