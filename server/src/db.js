import initSqlJs from 'sql.js'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbDir = path.join(__dirname, '../../data')
const dbPath = path.join(dbDir, 'bookflow.db')

let SQL = null
let db = null

function saveToDisk() {
  if (db) {
    fs.writeFileSync(dbPath, Buffer.from(db.export()))
  }
}

export function getDB() {
  return {
    prepare(sql) {
      let c = 0
      const params = []
      // Replace ? placeholders with positional $1, $2, etc for sql.js
      const mapped = sql.replace(/\?/g, () => `$${++c}`)
      return {
        get(...args) {
          try {
            const stmt = db.prepare(mapped)
            stmt.bind(args)
            if (stmt.step()) {
              const row = stmt.getAsObject()
              stmt.free()
              return row
            }
            stmt.free()
            return undefined
          } catch (e) {
            console.error('[DB get]', sql.slice(0, 80), e.message)
            return undefined
          }
        },
        all(...args) {
          try {
            const stmt = db.prepare(mapped)
            stmt.bind(args)
            const rows = []
            while (stmt.step()) rows.push(stmt.getAsObject())
            stmt.free()
            return rows
          } catch (e) {
            console.error('[DB all]', sql.slice(0, 80), e.message)
            return []
          }
        },
        run(...args) {
          try {
            db.run(mapped, args)
            const meta = db.exec('SELECT last_insert_rowid() as id, changes() as changes')
            const id = meta?.[0]?.values?.[0]?.[0]
            const changes = meta?.[0]?.values?.[0]?.[1]
            saveToDisk()
            return { lastInsertRowid: id, changes }
          } catch (e) {
            console.error('[DB run]', sql.slice(0, 80), e.message)
            return { lastInsertRowid: undefined, changes: 0 }
          }
        },
        raw(...args) {
          const stmt = db.prepare(mapped)
          stmt.bind(args)
          const rows = []
          while (stmt.step()) rows.push(stmt.getAsObject())
          stmt.free()
          return rows
        }
      }
    },
    exec(sql) {
      try {
        db.run(sql)
        saveToDisk()
      } catch (e) {
        console.error('[DB exec]', sql.slice(0, 80), e.message)
      }
    }
  }
}

export async function initDB() {
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })
  SQL = await initSqlJs()

  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath))
  } else {
    db = new SQL.Database()
  }

  db.run('PRAGMA foreign_keys = ON')

  const d = getDB()
  d.exec(`
    CREATE TABLE IF NOT EXISTS libraries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `)
  d.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      library_id INTEGER,
      file_path TEXT NOT NULL UNIQUE,
      format TEXT NOT NULL,
      title TEXT,
      author TEXT,
      publisher TEXT,
      description TEXT,
      cover_path TEXT,
      series TEXT,
      series_index REAL,
      tags TEXT,
      language TEXT,
      published_date TEXT,
      file_size INTEGER,
      word_count INTEGER,
      added_at INTEGER DEFAULT (unixepoch()),
      last_opened INTEGER
    )
  `)
  d.exec(`
    CREATE TABLE IF NOT EXISTS progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER UNIQUE,
      cfi TEXT,
      page INTEGER,
      percentage REAL DEFAULT 0,
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `)
  d.exec(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER,
      cfi TEXT,
      label TEXT,
      excerpt TEXT,
      color TEXT DEFAULT 'yellow',
      type TEXT DEFAULT 'bookmark',
      created_at INTEGER DEFAULT (unixepoch())
    )
  `)
  d.exec('CREATE INDEX IF NOT EXISTS idx_books_library ON books(library_id)')
  d.exec('CREATE INDEX IF NOT EXISTS idx_books_title ON books(title)')
  d.exec('CREATE INDEX IF NOT EXISTS idx_books_author ON books(author)')
  d.exec('CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id)')

  console.log('[DB] sql.js Initialized:', dbPath)
  return db
}
