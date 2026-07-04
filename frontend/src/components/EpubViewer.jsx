import { useEffect, useRef, useImperativeHandle, forwardRef, useState, useCallback } from 'react'
import { useStore } from '../store'
import axios from 'axios'

export const EpubViewer = forwardRef(function EpubViewer({ bookId, onLocationChange, onTocReady }, ref) {
  const viewerRef = useRef(null)
  const bookRef = useRef(null)
  const renditionRef = useRef(null)
  const [showNav, setShowNav] = useState(false)
  const navTimerRef = useRef(null)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(true)
  const locationsRef = useRef(null)
  const scrollContainerRef = useRef(null)

  const theme = useStore((s) => s.readerTheme)
  const fontSize = useStore((s) => s.fontSize)
  const fontFamily = useStore((s) => s.fontFamily)
  const lineHeight = useStore((s) => s.lineHeight)
  const marginSize = useStore((s) => s.marginSize)
  const pagination = useStore((s) => s.pagination)

  const isDark = theme === 'dark' || theme === 'night'
  const isScroll = pagination === 'scroll'

  useImperativeHandle(ref, () => ({
    navigateTo(href) {
      if (renditionRef.current) {
        renditionRef.current.display(href)
      }
    },
    goPrev() {
      if (renditionRef.current) {
        renditionRef.current.prev()
      }
    },
    goNext() {
      if (renditionRef.current) {
        renditionRef.current.next()
      }
    },
  }))

  const goPrev = useCallback(() => {
    if (renditionRef.current) {
      renditionRef.current.prev()
    }
  }, [])

  const goNext = useCallback(() => {
    if (renditionRef.current) {
      renditionRef.current.next()
    }
  }, [])

  const flashNav = useCallback(() => {
    setShowNav(true)
    clearTimeout(navTimerRef.current)
    navTimerRef.current = setTimeout(() => setShowNav(false), 1500)
  }, [])

  // ── 滚动进度：监听外层 container 的滚动 ──
  const updateScrollProgress = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el || !isScroll) return
    const scrollTop = el.scrollTop
    const maxScroll = Math.max(1, el.scrollHeight - el.clientHeight)
    const pct = Math.min(1, Math.max(0, scrollTop / maxScroll))
    onLocationChange(Math.round(pct * 100), 100)
    setCanPrev(pct > 0.01)
    setCanNext(pct < 0.99)
  }, [isScroll, onLocationChange])

  useEffect(() => {
    let cancelled = false

    async function init() {
      const url = `/api/books/${bookId}/file`

      const [ePubMod] = await Promise.all([
        import(/* @vite-ignore */ 'epubjs'),
      ])

      const { default: ePub } = ePubMod
      if (cancelled) return

      const book = ePub(url, { openAs: 'epub' })
      bookRef.current = book

      const rendition = book.renderTo(viewerRef.current, {
        width: '100%',
        height: '100%',
        spread: 'none',
        flow: isScroll ? 'scrolled-doc' : 'paginated',
        manager: 'default',
        allowScriptedContent: true,
      })

      renditionRef.current = rendition

      await book.ready

      // 目录
      if (!cancelled) {
        const nav = book.navigation
        if (nav) {
          const toc = buildToc(nav.toc || [])
          onTocReady(toc)
        }
      }

      // 配置样式
      rendition.themes.register('reader', buildTheme())
      rendition.themes.select('reader')

      // 恢复阅读进度
      let savedCfi = null
      try {
        const { data: prog } = await axios.get(`/api/progress/${bookId}`)
        if (prog?.cfi) {
          savedCfi = prog.cfi
        }
      } catch { /* no progress */ }

      // 立即显示内容
      if (savedCfi) {
        await rendition.display(savedCfi)
      } else {
        await rendition.display()
      }

      if (cancelled) return

      // 找到滚动容器（epub.js 的 stage container，滚动发生在这个 div 上）
      // epub.js 在 viewerRef.current 下创建了一个 div 作为 stage container
      const stageContainer = viewerRef.current?.querySelector(':scope > div')
      if (stageContainer) {
        scrollContainerRef.current = stageContainer

        if (isScroll) {
          // 滚动模式：监听 stage container 的 scroll 事件
          stageContainer.addEventListener('scroll', updateScrollProgress, { passive: true })
          // 初始触发
          setTimeout(updateScrollProgress, 100)
        }
      }

      if (!isScroll) {
        // 翻页模式：生成分页位置
        const locations = book.locations
        locationsRef.current = locations

        locations.generate(1200).then(() => {
          if (cancelled) return
          const t = locations.total + 1
          const loc = rendition.currentLocation()
          const raw = loc?.start?.location
          let current
          if (raw !== undefined && raw >= 0) {
            current = raw + 1
          } else {
            current = 1
          }
          onLocationChange(current, t)
          setCanPrev(current > 1)
          setCanNext(current < t)
        })

        rendition.on('relocated', (loc) => {
          const l = locationsRef.current
          if (!l || l.total < 0) {
            onLocationChange(0, 0)
            return
          }
          const t = l.total + 1
          const raw = loc?.start?.location
          let current
          if (raw !== undefined && raw >= 0) {
            current = raw + 1
          } else {
            current = 1
          }
          onLocationChange(current, t)
          setCanPrev(current > 1)
          setCanNext(current < t)
        })
      }
    }

    init()

    return () => {
      cancelled = true
      if (scrollContainerRef.current) {
        scrollContainerRef.current.removeEventListener('scroll', updateScrollProgress)
      }
      if (renditionRef.current) {
        renditionRef.current.destroy()
      }
    }
  }, [bookId])

  // 主题/字体变化时更新
  useEffect(() => {
    if (renditionRef.current) {
      const r = renditionRef.current
      r.themes.register('reader', buildTheme())
      r.themes.select('reader')
      if (r.currentLocation) {
        r.display(r.currentLocation?.start?.cfi)
      }
    }
  }, [theme, fontSize, fontFamily, lineHeight, marginSize])

  // ── 键盘翻页 ──
  useEffect(() => {
    const handleKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        goNext()
        flashNav()
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        goPrev()
        flashNav()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [goNext, goPrev, flashNav])

  // ── 触摸滑动翻页 ──
  useEffect(() => {
    const el = viewerRef.current
    if (!el) return

    const handleTouchStart = (e) => {
      touchStartX.current = e.touches[0].clientX
      touchStartY.current = e.touches[0].clientY
    }

    const handleTouchEnd = (e) => {
      const dx = touchStartX.current - e.changedTouches[0].clientX
      const dy = touchStartY.current - e.changedTouches[0].clientY

      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 60) {
        if (dx > 0) {
          goNext()
        } else {
          goPrev()
        }
        flashNav()
      }
    }

    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchend', handleTouchEnd)
    }
  }, [goNext, goPrev, flashNav])

  function buildTheme() {
    const bgMap = {
      light: '#f5f1e8', sepia: '#f4ecd8', dark: '#1a1a2e', night: '#0f0f14'
    }
    const colorMap = {
      light: '#2c2c2a', sepia: '#5b4636', dark: '#d4d4dc', night: '#a0a0b0'
    }
    return {
      body: {
        background: bgMap[theme] || '#f5f1e8',
        color: colorMap[theme] || '#2c2c2a',
        'font-family': fontFamily === 'sans' ? 'Inter, Noto Sans SC, system-ui, sans-serif'
          : fontFamily === 'mono' ? '"JetBrains Mono", monospace'
          : 'Georgia, Noto Serif SC, serif',
        'font-size': `${fontSize}px`,
        'line-height': lineHeight,
        padding: `${marginSize}px ${marginSize * 0.75}px`,
        'max-width': '800px',
        margin: '0 auto',
      },
      p: {
        'font-size': `${fontSize}px`,
        'line-height': lineHeight,
      },
      'h1, h2, h3, h4, h5, h6': {
        'font-family': fontFamily === 'sans' ? 'Inter, Noto Sans SC, system-ui, sans-serif'
          : fontFamily === 'mono' ? '"JetBrains Mono", monospace'
          : 'Georgia, Noto Serif SC, serif',
      },
      a: { color: 'inherit' },
    }
  }

  function buildToc(items, level = 0) {
    const result = []
    for (const item of items || []) {
      result.push({ label: item.label, href: item.href, level })
      if (item.subitems) {
        result.push(...buildToc(item.subitems, level + 1))
      }
    }
    return result
  }

  const arrowColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.25)'

  return (
    <div className="relative w-full h-full select-none">
      {/* epub.js 渲染容器 */}
      <div ref={viewerRef} className="w-full h-full epub-container" />

      {/* ── 左右翻页箭头覆盖层 ── */}
      {pagination === 'paginated' && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); goPrev(); flashNav() }}
            className={`absolute left-3 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center
              rounded-full transition-all duration-300 z-10
              ${showNav && canPrev ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            style={{
              background: `rgba(${isDark ? '255,255,255' : '0,0,0'},0.08)`,
              backdropFilter: 'blur(4px)',
            }}
            aria-label="上一页"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ color: arrowColor }}
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); goNext(); flashNav() }}
            className={`absolute right-3 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center
              rounded-full transition-all duration-300 z-10
              ${showNav && canNext ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            style={{
              background: `rgba(${isDark ? '255,255,255' : '0,0,0'},0.08)`,
              backdropFilter: 'blur(4px)',
            }}
            aria-label="下一页"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ color: arrowColor }}
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </>
      )}
    </div>
  )
})
