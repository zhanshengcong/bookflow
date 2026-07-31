import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react'
import { useStore } from '../store'
import axios from 'axios'

export const PdfViewer = forwardRef(function PdfViewer({ bookId, onLocationChange, onTocReady }, ref) {
  const containerRef = useRef(null)
  const pdfDocRef = useRef(null)
  const pageCanvasesRef = useRef({})
  const onLocationChangeRef = useRef(onLocationChange)
  const renderTaskRef = useRef(null)
  const visiblePagesRef = useRef(new Set())
  const scrollTimerRef = useRef(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1.5)
  const [loadError, setLoadError] = useState(null)
  const [loading, setLoading] = useState(true)

  const theme = useStore((s) => s.readerTheme)

  useEffect(() => { onLocationChangeRef.current = onLocationChange }, [onLocationChange])

  // 获取容器可用宽度（减去 padding 和 gap）
  const getContainerWidth = useCallback(() => {
    const el = containerRef.current
    if (!el) return 800
    // 减去左右 padding (16px each = 32px)
    return el.clientWidth - 32
  }, [])

  // 核心：渲染单页到指定 canvas，宽度自适应容器
  const renderPageToCanvas = useCallback(async (pageNum, canvas, scaleVal) => {
    if (!pdfDocRef.current || !canvas) return
    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel() } catch {}
      renderTaskRef.current = null
    }
    try {
      const page = await pdfDocRef.current.getPage(pageNum)
      const baseViewport = page.getViewport({ scale: 1 })
      // 计算自适应缩放：使页面宽度 ≤ 容器宽度
      const containerWidth = getContainerWidth()
      const fitScale = containerWidth / baseViewport.width
      const finalScale = scaleVal * fitScale
      const viewport = page.getViewport({ scale: finalScale })
      const dpr = Math.min(window.devicePixelRatio || 1, 2) // 限制 DPR 避免内存过大
      canvas.height = viewport.height * dpr
      canvas.width = viewport.width * dpr
      canvas.style.height = viewport.height + 'px'
      canvas.style.width = viewport.width + 'px'
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const task = page.render({ canvasContext: ctx, viewport })
      renderTaskRef.current = task
      await task.promise
      renderTaskRef.current = null
    } catch (e) {
      renderTaskRef.current = null
      if (e?.name === 'RenderingCancelledException' || e?.message?.includes('cancelled')) return
      console.error('PDF render error:', e)
    }
  }, [getContainerWidth])

  // 可视区域检测 + 渲染
  const updateVisiblePages = useCallback(() => {
    const el = containerRef.current
    if (!el || !pdfDocRef.current) return
    const rect = el.getBoundingClientRect()
    const containerTop = el.scrollTop
    const containerBottom = containerTop + rect.height
    const buffer = rect.height // 预渲染一屏的缓冲

    const newVisible = new Set()
    for (let i = 1; i <= pdfDocRef.current.numPages; i++) {
      const pageEl = document.getElementById(`pdf-page-${i}`)
      if (!pageEl) continue
      const top = pageEl.offsetTop
      const bottom = top + pageEl.offsetHeight
      if (bottom >= containerTop - buffer && top <= containerBottom + buffer) {
        newVisible.add(i)
      }
    }

    // 渲染新进入可视区的页面
    for (const p of newVisible) {
      if (!visiblePagesRef.current.has(p)) {
        const canvas = pageCanvasesRef.current[p]
        if (canvas) {
          renderPageToCanvas(p, canvas, scale)
        }
      }
    }
    visiblePagesRef.current = newVisible
  }, [scale, renderPageToCanvas])

  // 计算当前页码
  const updateCurrentPage = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const centerY = el.scrollTop + el.clientHeight / 2
    let bestPage = 1
    let bestDist = Infinity
    for (let i = 1; i <= numPages; i++) {
      const pageEl = document.getElementById(`pdf-page-${i}`)
      if (!pageEl) continue
      const mid = pageEl.offsetTop + pageEl.offsetHeight / 2
      const dist = Math.abs(centerY - mid)
      if (dist < bestDist) { bestDist = dist; bestPage = i }
    }
    if (bestPage !== currentPage) {
      setCurrentPage(bestPage)
      onLocationChangeRef.current(bestPage, numPages)
    }
  }, [numPages, currentPage])

  // 保存进度（防抖）
  const saveProgress = useCallback((page) => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      axios.put(`/api/progress/${bookId}`, { page }).catch(() => {})
    }, 500)
  }, [bookId])

  // 滚动事件
  const handleScroll = useCallback(() => {
    updateVisiblePages()
    updateCurrentPage()
    // 粗略保存进度
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      const el = containerRef.current
      if (!el) return
      const centerY = el.scrollTop + el.clientHeight / 2
      let bestPage = 1, bestDist = Infinity
      for (let i = 1; i <= numPages; i++) {
        const pageEl = document.getElementById(`pdf-page-${i}`)
        if (!pageEl) continue
        const mid = pageEl.offsetTop + pageEl.offsetHeight / 2
        const dist = Math.abs(centerY - mid)
        if (dist < bestDist) { bestDist = dist; bestPage = i }
      }
      axios.put(`/api/progress/${bookId}`, { page: bestPage }).catch(() => {})
    }, 500)
  }, [updateVisiblePages, updateCurrentPage, numPages, bookId])

  useImperativeHandle(ref, () => ({
    navigateTo(href) {
      const match = href?.match(/page=(\d+)/)
      if (match) scrollToPage(parseInt(match[1]))
    },
    goPrev() {
      setCurrentPage(p => { const n = Math.max(1, p - 1); scrollToPage(n); return n })
    },
    goNext() {
      setCurrentPage(p => { const n = Math.min(numPages, p + 1); scrollToPage(n); return n })
    },
  }))

  const scrollToPage = useCallback((pageNum) => {
    const pageEl = document.getElementById(`pdf-page-${pageNum}`)
    if (pageEl && containerRef.current) {
      containerRef.current.scrollTo({ top: pageEl.offsetTop - 16, behavior: 'smooth' })
    }
  }, [])

  // 缩放
  const zoomIn = useCallback(() => setScale(s => Math.min(4.0, +(s + 0.25).toFixed(2))), [])
  const zoomOut = useCallback(() => setScale(s => Math.max(0.5, +(s - 0.25).toFixed(2))), [])

  // 缩放变化时重新渲染所有已渲染的页面
  useEffect(() => {
    for (const p of visiblePagesRef.current) {
      const canvas = pageCanvasesRef.current[p]
      if (canvas) renderPageToCanvas(p, canvas, scale)
    }
  }, [scale, renderPageToCanvas])

  // 初始化
  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    setLoading(true)
    visiblePagesRef.current = new Set()
    pageCanvasesRef.current = {}

    async function load() {
      try {
        const [pdfjs] = await Promise.all([import('pdfjs-dist')])
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url
        ).toString()

        const url = `/api/books/${bookId}/file`
        const loadingTask = pdfjs.getDocument(url)
        const pdf = await loadingTask.promise
        if (cancelled) return

        pdfDocRef.current = pdf
        setNumPages(pdf.numPages)
        setLoading(false)

        // 目录
        try {
          const outline = await pdf.getOutline()
          if (outline && onTocReady) {
            const toc = []
            for (const item of outline || []) {
              if (item.dest) {
                const dest = typeof item.dest === 'string' ? item.dest : `page=${item.dest?.[0]?.objId || 1}`
                toc.push({ label: item.title, href: dest, level: 0 })
              }
            }
            onTocReady(toc)
          }
        } catch {}

        // 恢复进度
        let startPage = 1
        try {
          const { data: prog } = await axios.get(`/api/progress/${bookId}`)
          if (prog?.page && prog.page > 0 && prog.page <= pdf.numPages) {
            startPage = prog.page
          }
        } catch {}

        setCurrentPage(startPage)
        setTimeout(() => scrollToPage(startPage), 100)
      } catch (e) {
        console.error('PDF load error:', e)
        if (!cancelled) {
          setLoadError('PDF 加载失败，文件可能损坏或格式不支持')
          setLoading(false)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [bookId])

  // 初始化后渲染可见页
  useEffect(() => {
    if (numPages > 0 && !loading) {
      setTimeout(updateVisiblePages, 200)
    }
  }, [numPages, loading, updateVisiblePages])

  // 键盘翻页
  useEffect(() => {
    const handleKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        setCurrentPage(p => { const n = Math.min(numPages, p + 1); scrollToPage(n); return n })
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        setCurrentPage(p => { const n = Math.max(1, p - 1); scrollToPage(n); return n })
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [numPages, scrollToPage])

  // 窗口 resize 时重新渲染（宽度变化影响自适应缩放）
  useEffect(() => {
    let resizeTimer
    const handleResize = () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        visiblePagesRef.current.forEach(p => {
          const canvas = pageCanvasesRef.current[p]
          if (canvas) renderPageToCanvas(p, canvas, scale)
        })
      }, 300)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [scale, renderPageToCanvas])

  // 触摸滑动（保留原生滚动，仅检测左右滑动翻页）
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let touchStartX = 0, touchStartY = 0
    const handleTouchStart = (e) => {
      touchStartX = e.touches[0].clientX
      touchStartY = e.touches[0].clientY
    }
    const handleTouchEnd = (e) => {
      const dx = touchStartX - e.changedTouches[0].clientX
      const dy = touchStartY - e.changedTouches[0].clientY
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 60) {
        if (dx > 0) {
          setCurrentPage(p => { const n = Math.min(numPages, p + 1); scrollToPage(n); return n })
        } else {
          setCurrentPage(p => { const n = Math.max(1, p - 1); scrollToPage(n); return n })
        }
      }
    }
    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchend', handleTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchend', handleTouchEnd)
    }
  }, [numPages, scrollToPage])

  const bgMap = { light: '#f5f1e8', sepia: '#f4ecd8', dark: '#1a1a2e', night: '#0f0f14' }
  const isDark = theme === 'dark' || theme === 'night'

  if (loadError) {
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ background: bgMap[theme] || '#f5f1e8' }}>
        <div className="text-center">
          <p className="text-sm text-red-500 mb-3">{loadError}</p>
          <button onClick={() => window.history.back()} className="px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm hover:bg-indigo-600">
            返回书库
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex flex-col" style={{ background: bgMap[theme] || '#f5f1e8' }}>
      {/* 缩放控制栏 */}
      {numPages > 0 && (
        <div className={`flex items-center justify-center gap-3 py-1.5 text-xs border-b z-10 ${isDark ? 'bg-gray-800/90 border-gray-700 text-gray-300' : 'bg-white/80 border-gray-200 text-gray-500'}`}>
          <button onClick={zoomOut} className="px-2 py-0.5 rounded hover:bg-gray-200/50">−</button>
          <span className="w-12 text-center">{Math.round(scale * 100)}%</span>
          <button onClick={zoomIn} className="px-2 py-0.5 rounded hover:bg-gray-200/50">+</button>
          <span className="opacity-50">{currentPage} / {numPages}</span>
        </div>
      )}

      {/* 滚动阅读区 */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden"
        onScroll={handleScroll}
      >
        {loading && (
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-400 animate-pulse">加载中...</p>
          </div>
        )}

        <div className="flex flex-col items-center py-4 gap-4 px-2">
          {Array.from({ length: numPages }, (_, i) => i + 1).map(p => (
            <div key={p} id={`pdf-page-${p}`} className="pdf-page-wrapper shadow-lg rounded overflow-hidden" style={{ maxWidth: '100%' }}>
              <canvas
                ref={el => { if (el) pageCanvasesRef.current[p] = el }}
                className="block"
                style={{ maxWidth: '100%', height: 'auto' }}
              />
              <div className={`text-center py-1 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {p}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})
