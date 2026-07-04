import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ChevronLeft, ChevronRight, List, Bookmark, BookmarkPlus,
  Settings, Sun, Moon, Type, AlignJustify, X
} from 'lucide-react'
import { useStore } from '../store'
import { useProgress, useBookmarks } from '../hooks/useApi'
import { EpubViewer } from '../components/EpubViewer'
import { PdfViewer } from '../components/PdfViewer'
import { TxtViewer } from '../components/TxtViewer'
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
  const theme = useStore((s) => s.readerTheme)
  const { save, load } = useProgress(bookId)
  const { bookmarks, add: addBookmark, remove: removeBookmark, fetch: fetchBookmarks } = useBookmarks(bookId)

  const readerTheme = useStore((s) => s.readerTheme)
  const fontSize = useStore((s) => s.fontSize)
  const fontFamily = useStore((s) => s.fontFamily)
  const lineHeight = useStore((s) => s.lineHeight)
  const marginSize = useStore((s) => s.marginSize)
  const pagination = useStore((s) => s.pagination)

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
    console.log('[ReaderPage] handleLocationChange:', { loc, total, pct: total > 0 ? Math.round((loc / total) * 100) : 0 })
    setCurrentLocation(loc)
    setTotalLocations(total)
    // loc 现在是 1-based，保存时转换为 0-based 存到后端
    const pct = total > 0 ? Math.round((loc / total) * 100) : 0
    save(null, loc - 1, pct)
  }, [save])

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

  return (
    <div className={`h-full flex flex-col ${getReaderBg()}`}>
      {/* ── 顶部工具栏 ── */}
      <header className={`flex items-center justify-between px-3 py-2 ${getHeaderBg()}`}>
        <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-black/5">
          <ArrowLeft size={20} />
        </button>

        <p className="text-xs opacity-60 truncate max-w-[50%]">{book.title}</p>

        <div className="flex items-center gap-1">
          <button onClick={() => setShowToc(!showToc)} className="p-2 rounded-lg hover:bg-black/5">
            <List size={18} />
          </button>
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
      <div className="flex-1 relative overflow-hidden">
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
        ) : (
          <EpubViewer
            bookId={book.id}
            onLocationChange={handleLocationChange}
            onTocReady={handleTocReady}
            ref={readerRef}
          />
        )}
      </div>

      {/* ── 底部导航栏 ── */}
      <footer className={`px-3 py-2 ${getFooterBg()} border-t border-gray-200/20`}>
        {/* 翻页按钮行 */}
        <div className="flex items-center justify-center gap-2 mb-1.5">
          <button
            onClick={() => readerRef.current?.goPrev?.()}
            className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-gray-100/80 hover:bg-gray-200/80
              dark:bg-gray-700/50 dark:hover:bg-gray-600/50 text-xs transition-colors"
          >
            <ChevronLeft size={14} />
            上一页
          </button>
          <span className="text-xs opacity-40 min-w-[60px] text-center">
            {totalLocations === 100 && pagination === 'scroll'
              ? `${progressPct}%`
              : totalLocations > 0
                ? `${currentLocation}/${totalLocations}`
                : '加载中...'}
          </span>
          <button
            onClick={() => readerRef.current?.goNext?.()}
            className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-indigo-100/80 hover:bg-indigo-200/80
              dark:bg-indigo-900/30 dark:hover:bg-indigo-800/40 text-xs text-indigo-700 dark:text-indigo-300 transition-colors"
          >
            下一页
            <ChevronRight size={14} />
          </button>
        </div>
        {/* 进度条 */}
        <div className="flex items-center gap-2">
          <span className="text-xs opacity-40 w-8 text-right">{progressPct}%</span>
          <div className="flex-1 h-1 rounded-full bg-gray-300/30 overflow-hidden">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
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

// ── 阅读设置弹出面板 ──
function ReaderSettings({ onClose }) {
  const { readerTheme, setReaderTheme, fontSize, setFontSize, fontFamily, setFontFamily,
    lineHeight, setLineHeight, marginSize, setMarginSize, pagination, setPagination } = useStore()
  const store = useStore()

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

      {/* 翻页模式 */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
          <span>翻页模式</span>
        </div>
        <div className="flex gap-2">
          {[
            { key: 'scroll', label: '滚动' },
            { key: 'paginated', label: '翻页' },
          ].map((m) => (
            <button
              key={m.key}
              onClick={() => setPagination(m.key)}
              className={`flex-1 py-1.5 rounded-lg text-xs border
                ${pagination === m.key ? 'border-indigo-500 bg-indigo-50 text-indigo-600' : 'border-gray-200'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* 操作提示 */}
      <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
        <p className="text-xs text-gray-400 mb-2">操作方式</p>
        <div className="space-y-1.5 text-[11px] text-gray-500 leading-relaxed">
          <p><kbd className="px-1 py-0.5 rounded bg-gray-100 text-[10px] font-mono">← →</kbd> 键盘方向键翻页</p>
          <p><kbd className="px-1 py-0.5 rounded bg-gray-100 text-[10px] font-mono">PageUp/Down</kbd> 翻页键翻页</p>
          <p>点击屏幕 <span className="text-indigo-500">左侧</span> / <span className="text-indigo-500">右侧</span> 区域翻页</p>
          <p>手机端 <span className="text-indigo-500">左右滑动</span> 翻页</p>
        </div>
      </div>
    </div>
  )
}
