import { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react'
import { useStore } from '../store'

export const TxtViewer = forwardRef(function TxtViewer({ bookId, onLocationChange }, ref) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const containerRef = useRef(null)

  const fontSize = useStore((s) => s.fontSize)
  const fontFamily = useStore((s) => s.fontFamily)
  const lineHeight = useStore((s) => s.lineHeight)
  const marginSize = useStore((s) => s.marginSize)
  const theme = useStore((s) => s.readerTheme)

  useImperativeHandle(ref, () => ({
    navigateTo() {},
    goPrev() {
      const el = containerRef.current
      if (el) el.scrollBy({ top: -el.clientHeight * 0.85, behavior: 'smooth' })
    },
    goNext() {
      const el = containerRef.current
      if (el) el.scrollBy({ top: el.clientHeight * 0.85, behavior: 'smooth' })
    },
  }))

  useEffect(() => {
    async function load() {
      try {
        const resp = await fetch(`/api/books/${bookId}/file`)
        const text = await resp.text()
        setContent(text)
      } catch (e) {
        console.error(e)
        setContent('加载失败')
      }
      setLoading(false)
    }
    load()
  }, [bookId])

  // 滚动进度
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      const total = scrollHeight - clientHeight
      const progress = total > 0 ? scrollTop / total : 0
      const lines = content.split('\n').length
      onLocationChange?.(Math.round(progress * lines), lines)
    }

    el.addEventListener('scroll', handleScroll)
    return () => el.removeEventListener('scroll', handleScroll)
  }, [content, onLocationChange])

  // ── 键盘翻页（TXT = 按屏幕高度滚动） ──
  useEffect(() => {
    const handleKey = (e) => {
      const el = containerRef.current
      if (!el) return
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        el.scrollBy({ top: el.clientHeight * 0.85, behavior: 'smooth' })
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        el.scrollBy({ top: -el.clientHeight * 0.85, behavior: 'smooth' })
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const bgMap = { light: '#f5f1e8', sepia: '#f4ecd8', dark: '#1a1a2e', night: '#0f0f14' }
  const colorMap = { light: '#2c2c2a', sepia: '#5b4636', dark: '#d4d4dc', night: '#a0a0b0' }

  if (loading) {
    return <div className="h-full flex items-center justify-center"><p className="text-gray-400 animate-pulse">加载中...</p></div>
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-y-auto gesture-area"
      style={{
        background: bgMap[theme] || '#f5f1e8',
        color: colorMap[theme] || '#2c2c2a',
        fontSize: `${fontSize}px`,
        fontFamily: fontFamily === 'sans' ? 'Inter, Noto Sans SC, system-ui, sans-serif'
          : fontFamily === 'mono' ? '"JetBrains Mono", monospace'
          : 'Georgia, Noto Serif SC, serif',
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
