import { useEffect, useRef, useImperativeHandle, forwardRef, useState, useCallback } from 'react'
import { useStore } from '../store'
import axios from 'axios'

// ── 防抖 Hook ──
function useDebouncedCallback(fn, delay) {
  const timer = useRef(null)
  return useCallback(
    (...args) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => fn(...args), delay)
    },
    [fn, delay]
  )
}

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
  const currentCfiRef = useRef(null)
  const [loadError, setLoadError] = useState(null)

  const theme = useStore((s) => s.readerTheme)
  const fontSize = useStore((s) => s.fontSize)
  const fontFamily = useStore((s) => s.fontFamily)
  const lineHeight = useStore((s) => s.lineHeight)
  const marginSize = useStore((s) => s.marginSize)

  const isDark = theme === 'dark' || theme === 'night'

  // ── 防抖保存进度 ──
  const saveProgressDebounced = useDebouncedCallback((cfi, pct) => {
    axios.put(`/api/progress/${bookId}`, { cfi, percent: pct }).catch(() => {
      // 进度保存失败不打断阅读，静默重试留给下一次翻页
    })
  }, 500)

  useImperativeHandle(ref, () => ({
    navigateTo(href) {
      if (renditionRef.current) {
        try { renditionRef.current.display(href) } catch { /* ignore */ }
      }
    },
    goPrev() {
      if (renditionRef.current) {
        try { renditionRef.current.prev() } catch { /* ignore */ }
      }
    },
    goNext() {
      if (renditionRef.current) {
        try { renditionRef.current.next() } catch { /* ignore */ }
      }
    },
  }))

  const goPrev = useCallback(() => {
    if (renditionRef.current) {
      try { renditionRef.current.prev() } catch { /* ignore */ }
    }
  }, [])

  const goNext = useCallback(() => {
    if (renditionRef.current) {
      try { renditionRef.current.next() } catch { /* ignore */ }
    }
  }, [])

  const flashNav = useCallback(() => {
    setShowNav(true)
    clearTimeout(navTimerRef.current)
    navTimerRef.current = setTimeout(() => setShowNav(false), 1500)
  }, [])

  // ── 初始化 epub.js（只在 bookId 变化时重建） ──
  useEffect(() => {
    let cancelled = false
    setLoadError(null)

    async function init() {
      const url = `/api/books/${bookId}/file`

      let ePubMod
      try {
        [ePubMod] = await Promise.all([
          import(/* @vite-ignore */ 'epubjs'),
        ])
      } catch (e) {
        if (!cancelled) setLoadError('epub.js 加载失败，请刷新页面重试')
        return
      }

      const { default: ePub } = ePubMod
      if (cancelled) return

      let book
      try {
        book = ePub(url, { openAs: 'epub' })
      } catch (e) {
        if (!cancelled) setLoadError('无法解析该文件，格式可能不支持')
        return
      }
      bookRef.current = book

      let rendition
      try {
        rendition = book.renderTo(viewerRef.current, {
          width: '100%',
          height: '100%',
          spread: 'none',
          flow: 'paginated',
          manager: 'default',
          allowScriptedContent: true,
        })
      } catch (e) {
        if (!cancelled) setLoadError('渲染初始化失败')
        return
      }

      renditionRef.current = rendition

      // 注册主题和字号
      registerThemes(rendition, theme, fontSize, fontFamily, lineHeight, marginSize)
      rendition.themes.select('reader')

      // 键盘翻页：同时监听 iframe 内部和外层
      function handleKeyup(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault()
          try {
            if (e.key === 'ArrowLeft') rendition.prev()
            else rendition.next()
          } catch { /* 忽略边界错误 */ }
        }
      }
      rendition.on('keyup', handleKeyup)
      document.addEventListener('keyup', handleKeyup)

      // ── 鼠标滚轮翻页（带防抖锁） ──
      let wheelLocked = false
      function handleWheel(e) {
        e.preventDefault()
        if (wheelLocked || Math.abs(e.deltaY) < 20) return
        wheelLocked = true
        try {
          if (e.deltaY > 0) rendition.next()
          else rendition.prev()
        } catch { /* ignore */ }
        setTimeout(() => { wheelLocked = false }, 400)
      }

      // ── 点击区域翻页（注入 iframe 内部） ──
      function handleClick(e) {
        const doc = e.currentTarget
        const w = doc.documentElement?.clientWidth || doc.body?.clientWidth || window.innerWidth
        const x = e.clientX
        try {
          if (x < w * 0.3) rendition.prev()
          else if (x > w * 0.7) rendition.next()
        } catch { /* ignore */ }
        // 触发外部箭头闪现
        setShowNav(true)
        clearTimeout(navTimerRef.current)
        navTimerRef.current = setTimeout(() => setShowNav(false), 1500)
      }

      // 通过 hooks.content 注入到每个 iframe 文档
      rendition.hooks.content.register((contents) => {
        contents.document.addEventListener('wheel', handleWheel, { passive: false })
        contents.document.addEventListener('click', handleClick)
      })
      viewerRef.current.addEventListener('wheel', handleWheel, { passive: false })

      await book.ready
      if (cancelled) return

      // 目录
      try {
        const nav = book.navigation
        if (nav && onTocReady) {
          onTocReady(buildToc(nav.toc || []))
        }
      } catch { /* 目录获取失败不影响阅读 */ }

      // 恢复阅读进度
      let savedCfi = null
      try {
        const { data: prog } = await axios.get(`/api/progress/${bookId}`)
        if (prog?.cfi) {
          savedCfi = prog.cfi
        }
      } catch { /* no progress */ }

      try {
        await rendition.display(savedCfi || undefined)
        if (cancelled) return
      } catch (e) {
        if (!cancelled) setLoadError('这本书打不开，文件可能损坏或格式不支持')
        return
      }

      // 监听翻页事件，用 CFI + 百分比保存进度
      rendition.on('relocated', (location) => {
        try {
          const cfi = location?.start?.cfi
          if (!cfi) return
          const pct = book.locations?.percentageFromCfi
            ? Math.round(book.locations.percentageFromCfi(cfi) * 100)
            : 0

          currentCfiRef.current = cfi

          // 获取页码范围
          const startLoc = location.start
          const endLoc = location.end
          const atStart = startLoc?.atStart === true || (startLoc?.displayed?.page === 1)
          const atEnd = endLoc?.atEnd === true || (book.locations?.total && startLoc?.location >= book.locations.total)

          setCanPrev(!atStart)
          setCanNext(!atEnd)

          // 通知外部（用于显示进度）
          if (book.locations?.total) {
            const total = book.locations.total + 1
            const current = (startLoc?.location ?? 0) + 1
            onLocationChange(current, total)
          } else {
            onLocationChange(pct, 100)
          }

          saveProgressDebounced(cfi, pct)
        } catch {
          // 某些 epub 的 location 结构可能异常，静默忽略
        }
      })

      // 初始化完成后触发一次进度
      const initLoc = rendition.currentLocation()
      if (initLoc?.start) {
        const cfi = initLoc.start.cfi
        currentCfiRef.current = cfi
        const pct = book.locations?.percentageFromCfi
          ? Math.round(book.locations.percentageFromCfi(cfi) * 100)
          : 0
        if (book.locations?.total) {
          const total = book.locations.total + 1
          const current = (initLoc.start.location ?? 0) + 1
          onLocationChange(current, total)
        } else {
          onLocationChange(pct, 100)
        }
        saveProgressDebounced(cfi, pct)
      }
    }

    init()

    return () => {
      cancelled = true
      // 清理工作由 effect 闭包处理
      if (renditionRef.current) {
        renditionRef.current.destroy()
        renditionRef.current = null
      }
    }
  }, [bookId])

  // ── 主题变化：只更新样式，不重建实例 ──
  useEffect(() => {
    if (renditionRef.current) {
      registerThemes(renditionRef.current, theme, fontSize, fontFamily, lineHeight, marginSize)
      renditionRef.current.themes.select('reader')
    }
  }, [theme])

  // ── 字号变化：热切换 ──
  useEffect(() => {
    if (renditionRef.current) {
      registerThemes(renditionRef.current, theme, fontSize, fontFamily, lineHeight, marginSize)
      renditionRef.current.themes.select('reader')
    }
  }, [fontSize])

  // ── 字体/行间距/页边距变化：更新主题 ──
  useEffect(() => {
    if (renditionRef.current) {
      registerThemes(renditionRef.current, theme, fontSize, fontFamily, lineHeight, marginSize)
      renditionRef.current.themes.select('reader')
    }
  }, [fontFamily, lineHeight, marginSize])

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
        if (dx > 0) goNext()
        else goPrev()
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

  function registerThemes(rendition, t, fs, ff, lh, ms) {
    const bgMap = {
      light: '#f5f1e8', sepia: '#f4ecd8', dark: '#1a1a2e', night: '#0f0f14'
    }
    const colorMap = {
      light: '#2c2c2a', sepia: '#5b4636', dark: '#d4d4dc', night: '#a0a0b0'
    }
    rendition.themes.register('reader', {
      body: {
        background: bgMap[t] || '#f5f1e8',
        color: colorMap[t] || '#2c2c2a',
        'font-family': ff === 'sans' ? 'Inter, "Noto Sans SC", system-ui, sans-serif'
          : ff === 'mono' ? '"JetBrains Mono", monospace'
          : 'Georgia, "Noto Serif SC", serif',
        'font-size': `${fs}px`,
        'line-height': lh,
        padding: `${ms}px ${ms * 0.75}px`,
      },
      p: {
        'font-size': `${fs}px`,
        'line-height': lh,
      },
      'h1, h2, h3, h4, h5, h6': {
        'font-family': ff === 'sans' ? 'Inter, "Noto Sans SC", system-ui, sans-serif'
          : ff === 'mono' ? '"JetBrains Mono", monospace'
          : 'Georgia, "Noto Serif SC", serif',
      },
      a: { color: 'inherit' },
    })
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
    <div className="relative w-full h-full select-none flex justify-center">
      {/* epub.js 渲染容器 */}
      <div ref={viewerRef} className="w-full h-full epub-container" style={{ maxWidth: '900px' }} />

      {/* 加载错误 */}
      {loadError && (
        <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: isDark ? '#1a1a2e' : '#f5f1e8' }}>
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
      )}

      {/* ── 左右翻页箭头覆盖层 ── */}
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
    </div>
  )
})
