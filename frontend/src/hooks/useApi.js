import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

// ── 书库 ──
export function useLibraries() {
  const [libraries, setLibraries] = useState([])
  const [loading, setLoading] = useState(false)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await axios.get('/api/library')
      setLibraries(data)
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  const addLibrary = async (dirPath) => {
    const { data } = await axios.post('/api/library', {
      dirPath, name: dirPath.split(/[/\\]/).pop()
    })
    await fetch()
    return data
  }

  const removeLibrary = async (id) => {
    await axios.delete(`/api/library/${id}`)
    await fetch()
  }

  const rescan = async (id) => {
    const { data } = await axios.post(`/api/library/${id}/rescan`)
    await fetch()
    return data
  }

  return { libraries, loading, fetch, addLibrary, removeLibrary, rescan }
}

// ── 书籍列表 ──
export function useBooks(params = {}) {
  const [books, setBooks] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  const fetch = useCallback(async (opts = {}) => {
    setLoading(true)
    try {
      const { data } = await axios.get('/api/books', { params: { ...params, ...opts } })
      setBooks(data.data)
      setTotal(data.total)
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [JSON.stringify(params)])

  useEffect(() => { fetch() }, [fetch])

  const removeBooks = async (ids) => {
    await axios.post('/api/books/batch-delete', { ids })
    await fetch()
  }

  const removeBook = async (id) => {
    await axios.delete(`/api/books/${id}`)
    await fetch()
  }

  return { books, total, loading, fetch, removeBooks, removeBook }
}

// ── 统计 ──
export function useStats() {
  const [stats, setStats] = useState(null)
  const fetch = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/books/meta/stats')
      setStats(data)
    } catch (e) { console.error(e) }
  }, [])
  useEffect(() => { fetch() }, [fetch])
  return { stats, refetchStats: fetch }
}

// ── 阅读进度 ──
export function useProgress(bookId) {
  const save = async (cfi, page, percentage) => {
    await axios.put(`/api/progress/${bookId}`, { cfi, page, percentage })
  }
  const load = async () => {
    try {
      const { data } = await axios.get(`/api/progress/${bookId}`)
      return data
    } catch { return null }
  }
  return { save, load }
}

// ── 书签 ──
export function useBookmarks(bookId) {
  const [bookmarks, setBookmarks] = useState([])

  const fetch = useCallback(async () => {
    if (!bookId) return
    try {
      const { data } = await axios.get(`/api/bookmarks/${bookId}`)
      setBookmarks(data)
    } catch { }
  }, [bookId])

  useEffect(() => { fetch() }, [fetch])

  const add = async (cfi, label, excerpt) => {
    const { data } = await axios.post(`/api/bookmarks/${bookId}`, { cfi, label, excerpt })
    await fetch()
    return data
  }

  const remove = async (id) => {
    await axios.delete(`/api/bookmarks/${bookId}/${id}`)
    await fetch()
  }

  return { bookmarks, fetch, add, remove }
}
