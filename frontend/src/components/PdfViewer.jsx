import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react'
import { useStore } from '../store'

export const PdfViewer = forwardRef(function PdfViewer({ bookId, onLocationChange, onTocReady }, ref) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const pdfDocRef = useRef(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1.2)

  const theme = useStore((s) => s.readerTheme)

  useImperativeHandle(ref, () => ({
    navigateTo(href) {
      const match = href?.match(/page=(\d+)/)
      if (match) {
        renderPage(parseInt(match[1]))
      }
    },
    goPrev() {
      if (currentPage > 1) {
        const n = currentPage - 1
        setCurrentPage(n)
        renderPage(n)
      }
    },
    goNext() {
      if (currentPage < numPages) {
        const n = currentPage + 1
        setCurrentPage(n)
        renderPage(n)
      }
    },
  }))

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [pdfjs] = await Promise.all([
        import('pdfjs-dist')
      ])

      pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`

      const url = `/api/books/${bookId}/file`
      const loadingTask = pdfjs.getDocument(url)
      const pdf = await loadingTask.promise

      if (cancelled) return
      pdfDocRef.current = pdf
      setNumPages(pdf.numPages)

      // 目录
      const outline = await pdf.getOutline()
      if (outline && onTocReady) {
        const toc = buildPdfToc(outline)
        onTocReady(toc)
      }

      // 尝试恢复进度
      try {
        const axios = (await import('axios')).default
        const { data: prog } = await axios.get(`/api/progress/${bookId}`)
        if (prog?.page && prog.page > 0) {
          renderPage(prog.page)
        } else {
          renderPage(1)
        }
      } catch {
        renderPage(1)
      }
    }

    load()
    return () => { cancelled = true }
  }, [bookId])

  const renderPage = useCallback(async (pageNum) => {
    if (!pdfDocRef.current || !canvasRef.current) return

    const page = await pdfDocRef.current.getPage(pageNum)
    const viewport = page.getViewport({ scale })
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    canvas.height = viewport.height
    canvas.width = viewport.width

    await page.render({ canvasContext: ctx, viewport }).promise

    setCurrentPage(pageNum)
    onLocationChange(pageNum, pdfDocRef.current.numPages)
  }, [scale, onLocationChange])

  // 翻页处理
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        setCurrentPage((p) => { const n = Math.min(p + 1, numPages); renderPage(n); return n })
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        setCurrentPage((p) => { const n = Math.max(p - 1, 1); renderPage(n); return n })
      }
    }

    // 触摸滑动
    let touchStartX = 0
    const handleTouchStart = (e) => { touchStartX = e.touches[0].clientX }
    const handleTouchEnd = (e) => {
      const diff = touchStartX - e.changedTouches[0].clientX
      if (Math.abs(diff) > 60) {
        if (diff > 0) {
          setCurrentPage((p) => { const n = Math.min(p + 1, numPages); renderPage(n); return n })
        } else {
          setCurrentPage((p) => { const n = Math.max(p - 1, 1); renderPage(n); return n })
        }
      }
    }

    window.addEventListener('keydown', handleKey)
    const el = containerRef.current
    if (el) {
      el.addEventListener('touchstart', handleTouchStart)
      el.addEventListener('touchend', handleTouchEnd)
    }

    return () => {
      window.removeEventListener('keydown', handleKey)
      if (el) {
        el.removeEventListener('touchstart', handleTouchStart)
        el.removeEventListener('touchend', handleTouchEnd)
      }
    }
  }, [numPages, renderPage])

  function buildPdfToc(outline) {
    const result = []
    for (const item of outline || []) {
      if (item.dest) {
        const dest = typeof item.dest === 'string' ? item.dest : `page=${item.dest?.[0]?.objId || 1}`
        result.push({ label: item.title, href: dest, level: 0 })
      }
    }
    return result
  }

  const bgMap = { light: '#f5f1e8', sepia: '#f4ecd8', dark: '#1a1a2e', night: '#0f0f14' }

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-auto flex flex-col items-center py-4 gesture-area"
      style={{ background: bgMap[theme] || '#f5f1e8' }}
    >
      <canvas ref={canvasRef} className="pdf-container shadow-lg rounded" />
      <div className="flex items-center gap-4 mt-4 text-sm text-gray-500">
        <button
          onClick={() => { if (currentPage > 1) { const n = currentPage - 1; renderPage(n) } }}
          className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300"
        >
          上一页
        </button>
        <span>{currentPage} / {numPages}</span>
        <button
          onClick={() => { if (currentPage < numPages) { const n = currentPage + 1; renderPage(n) } }}
          className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300"
        >
          下一页
        </button>
        <button
          onClick={() => {
            const newScale = scale === 1.2 ? 1.8 : scale === 1.8 ? 1.0 : 1.2
            setScale(newScale)
            renderPage(currentPage)
          }}
          className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300"
        >
          {scale * 100}%
        </button>
      </div>
    </div>
  )
})
