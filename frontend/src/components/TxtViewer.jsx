import { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react'
import { useStore } from '../store'
import axios from 'axios'

export const TxtViewer = forwardRef(function TxtViewer({ bookId, onLocationChange }, ref) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const containerRef = useRef(null)
  const linesRef = useRef(0)
  const saveTimerRef = useRef(null)

  const fontSize = useStore((s) => s.fontSize)
  const fontFamily = useStore((s) => s.fontFamily)
  const lineHeight = useStore((s) => s.lineHeight)
  const marginSize = useStore((s) => s.marginSize)
  const theme = useStore((s) => s.readerTheme)

  const scrollPage = useCallback((direction) => {
    const el = containerRef.current
    if (el) {
      el.scrollBy({ top: direction * el.clientHeight * 0.85, behavior: 'smooth' })
    }
  }, [])

  useImperativeHandle(ref, () => ({
    navigateTo() {
      // TXT 没有章节导航
    },
    navigateToPercent(pct) {
      const el = containerRef.current
      if (el) {
        const maxScroll = el.scrollHeight - el.clientHeight
        el.scrollTop = maxScroll * Math.max(0, Math.min(1, pct))
      }
    },
    goPrev() {
      scrollPage(-1)
    },
    goNext() {
      scrollPage(1)
    },
  }))

  // ── 加载文本内容 ──
  useEffect(() => {
    let cancelled = false
    setLoadError(null)

    async function load() {
      try {
        const resp = await axios.get(`/api/books/${bookId}/file`, {
          responseType: 'text',
          // 大文件需要较长超时
          timeout: 30000,
        })
        if (cancelled) return
        const text = typeof resp.data === 'string' ? resp.data : String(resp.data)
        setContent(text)
        linesRef.current = text.split('\n').length
      } catch (e) {
        console.error('TXT load error:', e)
        if (!cancelled) {
          setLoadError('文本加载失败，文件可能过大或格式不支持')
        }
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [bookId])

  // ── 滚动进度 ──
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      const total = scrollHeight - clientHeight
      const progress = total > 0 ? scrollTop / total : 0
      const lines = linesRef.current
      const currentLine = Math.round(progress * lines)
      onLocationChange?.(currentLine, lines)

      // 防抖保存进度（500ms）
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        axios.put(`/api/progress/${bookId}`, {
          page: currentLine,
          percentage: Math.round(progress * 100),
        }).catch(() => {})
      }, 500)
    }

    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', handleScroll)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [content, onLocationChange, bookId])

  // ── 键盘翻页 ──
  useEffect(() => {
    const handleKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        scrollPage(1)
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        scrollPage(-1)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [scrollPage])

  // ── 鼠标滚轮翻页（大文本时用分页式滚轮） ──
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // TXT 默认允许自由滚动，不拦截滚轮
    // 但如果需要精确翻页，可以在此添加
    // 目前保留原生滚动体验
  }, [])

  // ── 触摸滑动翻页 ──
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let touchStartX = 0
    const handleTouchStart = (e) => { touchStartX = e.touches[0].clientX }
    const handleTouchEnd = (e) => {
      const diff = touchStartX - e.changedTouches[0].clientX
      if (Math.abs(diff) > 60) {
        scrollPage(diff > 0 ? 1 : -1)
      }
    }

    el.addEventListener('touchstart', handleTouchStart)
    el.addEventListener('touchend', handleTouchEnd)
    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchend', handleTouchEnd)
    }
  }, [scrollPage])

  // ── 恢复滚动位置 ──
  useEffect(() => {
    if (!content || !containerRef.current) return

    axios.get(`/api/progress/${bookId}`).then(({ data }) => {
      if (data?.percentage && containerRef.current) {
        const el = containerRef.current
        const maxScroll = el.scrollHeight - el.clientHeight
        const target = maxScroll * (data.percentage / 100)
        el.scrollTop = Math.max(0, Math.min(target, maxScroll))
      }
    }).catch(() => {})
  }, [content, bookId])

  const bgMap = { light: '#f5f1e8', sepia: '#f4ecd8', dark: '#1a1a2e', night: '#0f0f14' }
  const colorMap = { light: '#2c2c2a', sepia: '#5b4636', dark: '#d4d4dc', night: '#a0a0b0' }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: bgMap[theme] || '#f5f1e8' }}>
        <p className="text-gray-400 animate-pulse">加载中...</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: bgMap[theme] || '#f5f1e8' }}>
        <div className="text-center">
          <p className="text-sm text-red-500 mb-3">{loadError}</p>
          <button
            onClick={() => window.history.back()}
            className="px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm hover:bg-indigo-600 transition-colors"
          >
            返回书库
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-y-auto gesture-area"
      style={{
        background: bgMap[theme] || '#f5f1e8',
        color: colorMap[theme] || '#2c2c2a',
        fontSize: `${fontSize}px`,
        fontFamily: fontFamily === 'sans' ? 'Inter, "Noto Sans SC", system-ui, sans-serif'
          : fontFamily === 'mono' ? '"JetBrains Mono", monospace'
          : 'Georgia, "Noto Serif SC", serif',
        lineHeight,
        padding: `${marginSize}px ${marginSize * 0.75}px`,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxWidth: 800,
        margin: '0 auto',
      }}
    >
      {content}
    </div>
  )
})
