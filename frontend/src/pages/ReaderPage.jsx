import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, List, Bookmark, BookmarkPlus,
  Settings, Sun, Moon, X
} from 'lucide-react'
import { useStore } from '../store'
import { useBookmarks } from '../hooks/useApi'
import { EpubViewer } from '../components/EpubViewer'
import { PdfViewer } from '../components/PdfViewer'
import { TxtViewer } from '../components/TxtViewer'
import { MobiViewer } from '../components/MobiViewer'
import axios from 'axios'

export function ReaderPage() {
  const { bookId } = useParams()
  const navigate = useNavigate()

  const [book, setBook] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showToc, setShowToc] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showBookmarks, setShowBookmarks] = useState(false)
  const [toc, setToc] = useState([])
  const [currentLocation, setCurrentLocation] = useState(0)
  const [totalLocations, setTotalLocations] = useState(0)

  const readerRef = useRef(null)
  const readerTheme = useStore((s) => s.readerTheme)
  const { bookmarks, add: addBookmark, remove: removeBookmark } = useBookmarks(bookId)

  useEffect(() => {
    axios.get(`/api/books/${bookId}`).then(({ data }) => {
      setBook(data)
      setLoading(false)
    }).catch(() => {
      console.error('Failed to load book')
      setLoading(false)
    })
  }, [bookId])

  const handleLocationChange = useCallback((loc, total) => {
    setCurrentLocation(loc)
    setTotalLocations(total)
    // 进度保存由 EpubViewer 内部通过 CFI + 防抖处理，这里只更新UI显示
  }, [])

  const handleTocReady = useCallback((items) => {
    setToc(items)
  }, [])

  const handleAddBookmark = async () => {
    const text = window.getSelection()?.toString().slice(0, 100) || ''
    await addBookmark(
      `loc-${currentLocation}`,
      `书签 ${bookmarks.length + 1}`,
      text || `位置 ${currentLocation}/${totalLocations}`
    )
  }

  const handleNavigateToc = (href) => {
    if (readerRef.current?.navigateTo) {
      readerRef.current.navigateTo(href)
    }
    setShowToc(false)
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center reader-light">
        <div className="text-gray-400 animate-pulse">加载中...</div>
      </div>
    )
  }

  if (!book) {
    return (
      <div className="h-full flex flex-col items-center justify-center reader-light gap-3">
        <p className="text-gray-400">书籍未找到</p>
        <button onClick={() => navigate('/')} className="text-indigo-500 text-sm">返回书库</button>
      </div>
    )
  }

  const progressPct = totalLocations > 0 ? Math.round((currentLocation / totalLocations) * 100) : 0
  const unitLabel = book?.format === 'txt' ? '行' : '页'

  return (
    <div className={`h-full flex flex-col ${getReaderBg()}`}>
      {/* ── 顶部工具栏 ── */}
      <header className={`flex items-center justify-between px-3 py-2 ${getHeaderBg()}`}>
        <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-black/5">
          <ArrowLeft size={20} />
        </button>

        <p className="text-xs opacity-60 truncate max-w-[50%]">{book.title}</p>

        <div className="flex items-center gap-1">
          {book.format !== 'txt' && (
            <button onClick={() => setShowToc(!showToc)} className="p-2 rounded-lg hover:bg-black/5">
              <List size={18} />
            </button>
          )}
          <button onClick={() => setShowBookmarks(!showBookmarks)} className="p-2 rounded-lg hover:bg-black/5">
            <Bookmark size={18} />
          </button>
          <button onClick={handleAddBookmark} className="p-2 rounded-lg hover:bg-black/5">
            <BookmarkPlus size={18} />
          </button>
          <button onClick={() => setShowSettings(!showSettings)} className="p-2 rounded-lg hover:bg-black/5">
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* ── 阅读区域 ── */}
      <div className="flex-1 relative overflow-hidden flex justify-center">
        {book.format === 'pdf' ? (
          <PdfViewer
            bookId={book.id}
            onLocationChange={handleLocationChange}
            onTocReady={handleTocReady}
            ref={readerRef}
          />
        ) : book.format === 'txt' ? (
          <TxtViewer
            bookId={book.id}
            onLocationChange={handleLocationChange}
            ref={readerRef}
          />
        ) : book.format === 'mobi' || book.format === 'azw3' ? (
          <MobiViewer
            bookId={book.id}
            onLocationChange={handleLocationChange}
            ref={readerRef}
          />
        ) : (
          <EpubViewer
            bookId={book.id}
            onLocationChange={handleLocationChange}
            onTocReady={handleTocReady}
            ref={readerRef}
          />
        )}
      </div>

      {/* ── 底部进度栏（支持拖拽滑动） ── */}
      <footer className={`px-4 py-2.5 ${getFooterBg()} border-t border-gray-200/20`}>
        <div className="flex items-center gap-3">
          <span className="text-xs opacity-50 min-w-[80px]">
            {totalLocations > 0
              ? `${currentLocation} / ${totalLocations} ${unitLabel}`
              : '加载中...'}
          </span>
          <ProgressBar
            progressPct={progressPct}
            totalLocations={totalLocations}
            onSeek={(newLoc) => {
              setCurrentLocation(newLoc)
              // 通知 Viewer 跳转到对应位置
              if (book.format === 'pdf') {
                const page = Math.round((newLoc / totalLocations) * totalLocations) || 1
                readerRef.current?.navigateTo?.(`page=${page}`)
              } else if (book.format === 'txt' || book.format === 'mobi' || book.format === 'azw3') {
                // 对于滚动型 Viewer，使用百分比跳转
                const pct = totalLocations > 0 ? newLoc / totalLocations : 0
                readerRef.current?.navigateToPercent?.(pct)
              }
            }}
          />
          <span className="text-xs opacity-50 w-10 text-right">{progressPct}%</span>
        </div>
      </footer>

      {/* ── 目录侧边栏 ── */}
      {showToc && (
        <div className="fixed inset-0 z-20" onClick={() => setShowToc(false)}>
          <div
            className="absolute left-0 top-0 bottom-0 w-72 max-w-[80vw] bg-white dark:bg-gray-900 shadow-xl overflow-y-auto animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-medium text-sm">目录</h3>
              <button onClick={() => setShowToc(false)}><X size={16} /></button>
            </div>
            <div className="px-2 py-2 space-y-0.5">
              {toc.length === 0 && <p className="text-sm text-gray-400 px-3 py-4">暂无目录</p>}
              {toc.map((item, i) => (
                <button
                  key={i}
                  onClick={() => handleNavigateToc(item.href)}
                  className="block w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-100 truncate"
                  style={{ paddingLeft: `${12 + (item.level || 0) * 12}px` }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── 书签侧边栏 ── */}
      {showBookmarks && (
        <div className="fixed inset-0 z-20" onClick={() => setShowBookmarks(false)}>
          <div
            className="absolute right-0 top-0 bottom-0 w-72 max-w-[80vw] bg-white dark:bg-gray-900 shadow-xl overflow-y-auto animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-medium text-sm">书签</h3>
              <button onClick={() => setShowBookmarks(false)}><X size={16} /></button>
            </div>
            <div className="px-2 py-2 space-y-1">
              {bookmarks.length === 0 && <p className="text-sm text-gray-400 px-3 py-4">暂无书签</p>}
              {bookmarks.map((bm) => (
                <div key={bm.id} className="flex items-start justify-between px-3 py-2 rounded hover:bg-gray-50">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{bm.label}</p>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{bm.excerpt}</p>
                    <p className="text-[10px] text-gray-300 mt-1">
                      {new Date(bm.created_at * 1000).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  <button onClick={() => removeBookmark(bm.id)} className="p-1 hover:text-red-500">
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── 设置面板 ── */}
      {showSettings && (
        <div className="fixed inset-0 z-30" onClick={() => setShowSettings(false)}>
          <ReaderSettings onClose={() => setShowSettings(false)} />
        </div>
      )}
    </div>
  )

  function getReaderBg() {
    const map = { light: 'reader-light', sepia: 'reader-sepia', dark: 'reader-dark', night: 'reader-night' }
    return map[readerTheme] || 'reader-light'
  }
  function getHeaderBg() {
    return readerTheme === 'dark' || readerTheme === 'night' ? 'bg-gray-900/80' : 'bg-white/70 backdrop-blur'
  }
  function getFooterBg() {
    return readerTheme === 'dark' || readerTheme === 'night' ? 'bg-gray-900/80' : 'bg-white/70 backdrop-blur'
  }
}

// ── 可拖拽进度条组件 ──
function ProgressBar({ progressPct, totalLocations, onSeek }) {
  const barRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  const calcProgress = useCallback((clientX) => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
    const pct = x / rect.width
    return Math.round(pct * totalLocations)
  }, [totalLocations])

  const handleMouseDown = useCallback((e) => {
    e.preventDefault()
    setDragging(true)
    const loc = calcProgress(e.clientX)
    onSeek?.(loc)
  }, [calcProgress, onSeek])

  useEffect(() => {
    if (!dragging) return
    const handleMove = (e) => {
      const loc = calcProgress(e.clientX)
      onSeek?.(loc)
    }
    const handleUp = () => setDragging(false)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragging, calcProgress, onSeek])

  // 触摸事件
  const handleTouchStart = useCallback((e) => {
    setDragging(true)
    const loc = calcProgress(e.touches[0].clientX)
    onSeek?.(loc)
  }, [calcProgress, onSeek])

  useEffect(() => {
    if (!dragging) return
    const handleTouchMove = (e) => {
      const loc = calcProgress(e.touches[0].clientX)
      onSeek?.(loc)
    }
    const handleTouchEnd = () => setDragging(false)
    window.addEventListener('touchmove', handleTouchMove)
    window.addEventListener('touchend', handleTouchEnd)
    return () => {
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [dragging, calcProgress, onSeek])

  const pct = totalLocations > 0 ? Math.min(100, Math.max(0, (progressPct || 0))) : 0

  return (
    <div
      ref={barRef}
      className="flex-1 h-2 rounded-full bg-gray-300/30 cursor-pointer relative group"
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      <div
        className="h-full rounded-full bg-indigo-500 transition-all duration-150"
        style={{ width: `${pct}%` }}
      />
      <div
        className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-indigo-500 shadow-md
          transition-opacity duration-150 ${dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        style={{ left: `calc(${pct}% - 8px)` }}
      />
    </div>
  )
}

// ── 阅读设置弹出面板 ──
function ReaderSettings({ onClose }) {
  const { readerTheme, setReaderTheme, fontSize, setFontSize, fontFamily, setFontFamily,
    lineHeight, setLineHeight, marginSize, setMarginSize } = useStore()

  const themes = [
    { key: 'light', label: '亮白', icon: Sun, bg: '#f5f1e8', text: '#2c2c2a' },
    { key: 'sepia', label: '护眼', icon: Sun, bg: '#f4ecd8', text: '#5b4636' },
    { key: 'dark', label: '深色', icon: Moon, bg: '#1a1a2e', text: '#d4d4dc' },
    { key: 'night', label: '夜间', icon: Moon, bg: '#0f0f14', text: '#a0a0b0' },
  ]

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`fixed bottom-16 left-4 right-4 max-w-md mx-auto rounded-2xl shadow-2xl p-5 z-30 animate-slide-up
        ${readerTheme === 'dark' || readerTheme === 'night' ? 'bg-gray-800 text-gray-100' : 'bg-white'}`}
    >
      <h3 className="text-sm font-medium mb-4">阅读设置</h3>

      {/* 主题 */}
      <div className="mb-4">
        <p className="text-xs text-gray-400 mb-2">主题</p>
        <div className="flex gap-2">
          {themes.map((t) => (
            <button
              key={t.key}
              onClick={() => setReaderTheme(t.key)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all
                ${readerTheme === t.key ? 'ring-2 ring-indigo-500 scale-105' : 'ring-1 ring-gray-200'}`}
              style={{ background: t.bg, color: t.text }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 字体 */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
          <span>字体</span>
          <span>{fontSize}px</span>
        </div>
        <div className="flex gap-2 mb-2">
          {['sans', 'serif', 'mono'].map((f) => (
            <button
              key={f}
              onClick={() => setFontFamily(f)}
              className={`flex-1 py-1.5 rounded-lg text-xs border
                ${fontFamily === f ? 'border-indigo-500 bg-indigo-50 text-indigo-600' : 'border-gray-200'}`}
            >
              {f === 'sans' ? '无衬线' : f === 'serif' ? '衬线' : '等宽'}
            </button>
          ))}
        </div>
        <input
          type="range"
          min="12" max="28" value={fontSize}
          onChange={(e) => setFontSize(Number(e.target.value))}
          className="w-full accent-indigo-500"
        />
      </div>

      {/* 行间距 */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
          <span>行间距</span>
          <span>{lineHeight}</span>
        </div>
        <input
          type="range" min="1.2" max="3" step="0.1"
          value={lineHeight}
          onChange={(e) => setLineHeight(Number(e.target.value))}
          className="w-full accent-indigo-500"
        />
      </div>

      {/* 页边距 */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
          <span>页边距</span>
        </div>
        <div className="flex gap-2">
          {[16, 32, 48, 64].map((m) => (
            <button
              key={m}
              onClick={() => setMarginSize(m)}
              className={`flex-1 py-1.5 rounded-lg text-xs border
                ${marginSize === m ? 'border-indigo-500 bg-indigo-50 text-indigo-600' : 'border-gray-200'}`}
            >
              {m === 16 ? '窄' : m === 32 ? '适中' : m === 48 ? '宽' : '超宽'}
            </button>
          ))}
        </div>
      </div>

      {/* 操作提示 */}
      <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
        <p className="text-xs text-gray-400 mb-2">操作方式</p>
        <div className="space-y-1.5 text-[11px] text-gray-500 leading-relaxed">
          <p><kbd className="px-1 py-0.5 rounded bg-gray-100 text-[10px] font-mono">← →</kbd> 键盘方向键翻页</p>
          <p>鼠标 <span className="text-indigo-500">滚轮</span> 上下翻页（EPUB）</p>
          <p>点击屏幕两侧 <span className="text-indigo-500">半透明箭头</span> 翻页（EPUB）</p>
          <p>底部 <span className="text-indigo-500">进度条</span> 可拖拽跳转</p>
          <p>手机端 <span className="text-indigo-500">左右滑动</span> 翻页</p>
        </div>
      </div>
    </div>
  )
}
