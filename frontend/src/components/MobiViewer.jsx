import { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback, useMemo } from 'react'
import { useStore } from '../store'
import axios from 'axios'

// ── 智能格式化文本：识别章节、段落分组、空行处理 ──
function formatContent(raw) {
  if (!raw) return []

  // 规范化换行
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // 按连续换行分割为块（段落组）
  const blocks = text.split(/\n{2,}/)

  const result = []
  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.trim())
    if (lines.length === 0) continue

    // 保留的HTML标签（mobi转文字后可能残留）
    const joined = lines.join(' ').replace(/<[^>]+>/g, '').trim()
    if (!joined) continue

    // 章节标题检测
    const chapterPatterns = [
      /^第[零一二三四五六七八九十百千万0-9]+[章节卷部篇回集].*/,
      /^Chapter\s+\d+.*/i,
      /^PART\s+[IVX]+/i,
      /^\d+[\.\、\s].{0,8}$/,
      /^(序|前言|楔子|跋|后记|尾声|结语|附录|引言)/,
      /^(作者|译者|编者)(序|前言|的话|简介)/,
    ]
    const isChapter = chapterPatterns.some(p => p.test(joined)) && joined.length < 50

    // 极短单独行可能是副标题（如作者名）
    const isShort = joined.length < 15 && lines.length === 1

    // 是否全大写/英文为主（可能是英文原标题）
    const isTitleCase = joined.length < 80 && /^[A-Z\s\-:,']+$/.test(joined) && joined.replace(/\s/g, '').length > 3

    result.push({
      text: joined,
      isChapter: isChapter,
      isSubtitle: isShort && !isChapter,
      isTitleCase: isTitleCase,
    })
  }
  return result
}

export const MobiViewer = forwardRef(function MobiViewer({ bookId, onLocationChange }, ref) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const containerRef = useRef(null)
  const saveTimerRef = useRef(null)
  const linesRef = useRef(0)

  const fontSize = useStore((s) => s.fontSize)
  const fontFamily = useStore((s) => s.fontFamily)
  const lineHeight = useStore((s) => s.lineHeight)
  const marginSize = useStore((s) => s.marginSize)
  const theme = useStore((s) => s.readerTheme)

  // 格式化后的段落数据
  const paragraphs = useMemo(() => formatContent(content), [content])

  const scrollPage = useCallback((direction) => {
    const el = containerRef.current
    if (el) {
      el.scrollBy({ top: direction * el.clientHeight * 0.85, behavior: 'smooth' })
    }
  }, [])

  useImperativeHandle(ref, () => ({
    navigateTo() {},
    navigateToPercent(pct) {
      const el = containerRef.current
      if (el) {
        const maxScroll = el.scrollHeight - el.clientHeight
        el.scrollTop = maxScroll * Math.max(0, Math.min(1, pct))
      }
    },
    goPrev() { scrollPage(-1) },
    goNext() { scrollPage(1) },
  }))

  // 加载文本
  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    setLoading(true)

    async function load() {
      try {
        const resp = await axios.get(`/api/books/${bookId}/file`, {
          responseType: 'text',
          timeout: 60000,
        })
        if (cancelled) return
        const text = typeof resp.data === 'string' ? resp.data : String(resp.data)
        setContent(text)
        linesRef.current = text.split('\n').length
        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          setLoadError('文件加载失败，格式可能不支持')
          setLoading(false)
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [bookId])

  // 滚动进度
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

  // 键盘翻页
  useEffect(() => {
    const handleKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault(); scrollPage(1)
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault(); scrollPage(-1)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [scrollPage])

  // 触摸滑动
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let touchStartX = 0
    let touchStartY = 0
    const handleTouchStart = (e) => {
      touchStartX = e.touches[0].clientX
      touchStartY = e.touches[0].clientY
    }
    const handleTouchEnd = (e) => {
      const dx = touchStartX - e.changedTouches[0].clientX
      const dy = touchStartY - e.changedTouches[0].clientY
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 60) {
        scrollPage(dx > 0 ? 1 : -1)
      }
    }
    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchend', handleTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchend', handleTouchEnd)
    }
  }, [scrollPage])

  // 恢复进度
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
          <button onClick={() => window.history.back()} className="px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm hover:bg-indigo-600">
            返回书库
          </button>
        </div>
      </div>
    )
  }

  const ff = fontFamily === 'sans' ? 'Inter, "Noto Sans SC", system-ui, sans-serif'
    : fontFamily === 'mono' ? '"JetBrains Mono", monospace'
    : 'Georgia, "Noto Serif SC", serif'

  const hFont = fontFamily === 'sans' ? 'Inter, "Noto Sans SC", system-ui, sans-serif' : ff

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-y-auto gesture-area"
      style={{
        background: bgMap[theme] || '#f5f1e8',
        color: colorMap[theme] || '#2c2c2a',
        padding: `${marginSize}px ${marginSize * 0.75}px`,
        maxWidth: 800,
        margin: '0 auto',
      }}
    >
      <div style={{
        fontFamily: ff,
        fontSize: `${fontSize}px`,
        lineHeight,
      }}>
        {paragraphs.map((p, i) => {
          if (p.isChapter) {
            return (
              <h2
                key={i}
                style={{
                  fontFamily: hFont,
                  fontSize: `${fontSize * 1.4}px`,
                  fontWeight: 700,
                  lineHeight: lineHeight * 1.3,
                  marginTop: i > 0 ? '2.5em' : '0.5em',
                  marginBottom: '1em',
                  textAlign: 'center',
                }}
              >
                {p.text}
              </h2>
            )
          }
          if (p.isSubtitle) {
            return (
              <h3
                key={i}
                style={{
                  fontFamily: hFont,
                  fontSize: `${fontSize * 0.85}px`,
                  fontWeight: 400,
                  opacity: 0.6,
                  marginBottom: '1.5em',
                  textAlign: 'center',
                }}
              >
                {p.text}
              </h3>
            )
          }
          if (p.isTitleCase) {
            return (
              <h3
                key={i}
                style={{
                  fontFamily: hFont,
                  fontSize: `${fontSize * 1.1}px`,
                  fontWeight: 600,
                  opacity: 0.7,
                  marginTop: '1.5em',
                  marginBottom: '0.8em',
                  textAlign: 'center',
                  letterSpacing: '0.05em',
                }}
              >
                {p.text}
              </h3>
            )
          }
          // 普通段落
          return (
            <p
              key={i}
              style={{
                textIndent: '2em',
                marginBottom: '0.6em',
                textAlign: 'justify',
              }}
            >
              {p.text}
            </p>
          )
        })}
      </div>
    </div>
  )
})
