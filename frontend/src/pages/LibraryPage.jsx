import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Library, BookOpen, Search, Upload, Trash2, RefreshCw, X, Menu,
  Grid3X3, List, CheckSquare, Square, FolderOpen, FileUp, Globe,
  HardDrive, Cloud, ChevronDown, Filter
} from 'lucide-react'
import { useBooks, useLibraries, useStats } from '../hooks/useApi'
import { useStore } from '../store'
import axios from 'axios'

// ── 封面图片组件（带 onError 回退） ──
function CoverImage({ src, title, small }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return small ? (
      <div className="w-full h-full flex items-center justify-center bg-indigo-50">
        <BookOpen size={14} className="text-indigo-300" />
      </div>
    ) : (
      <CoverPlaceholder title={title} />
    )
  }

  if (small) {
    return (
      <img src={src} alt={title} className="w-full h-full object-cover" onError={() => setFailed(true)} />
    )
  }

  return (
    <img src={src} alt={title} className="w-full h-full object-cover" loading="lazy" onError={() => setFailed(true)} />
  )
}

// ── 无封面时的占位组件 ──
function CoverPlaceholder({ title }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50 p-3">
      <BookOpen size={28} className="text-indigo-300 mb-2" />
      <p className="text-[10px] text-center text-gray-400 line-clamp-3 font-medium">{title}</p>
    </div>
  )
}

// ── 导入面板 ──
function ImportPanel({ onClose, onImported }) {
  const [activeTab, setActiveTab] = useState('local') // local | url | cloud
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')
  const fileInputRef = useRef(null)
  const folderInputRef = useRef(null)

  const handleFileUpload = async (files) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadMsg('')

    const formData = new FormData()
    for (const f of files) {
      formData.append('files', f)
    }

    try {
      const { data } = await axios.post('/api/upload/files', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (e.total) {
            setUploadMsg(`上传中 ${Math.round(e.progress * 100)}%...`)
          }
        }
      })
      const added = data.uploaded?.filter(u => u.status === 'added').length || 0
      setUploadMsg(`成功导入 ${added} 本书`)
      onImported()
      setTimeout(() => onClose(), 1500)
    } catch (e) {
      setUploadMsg('上传失败: ' + (e.response?.data?.error || e.message))
    }
    setUploading(false)
  }

  const tabs = [
    { id: 'local', label: '本地文件', icon: HardDrive, desc: '从电脑选择电子书文件' },
    { id: 'url', label: '网址导入', icon: Globe, desc: '输入电子书下载链接', disabled: true },
    { id: 'cloud', label: '网盘导入', icon: Cloud, desc: '从云盘导入书籍', disabled: true },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl animate-slide-up p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">导入书籍</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex gap-2 mb-4 p-1 bg-gray-100 rounded-xl">
          {tabs.map((t) => (
            <button
              key={t.id}
              disabled={t.disabled}
              onClick={() => !t.disabled && setActiveTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-sm font-medium transition-all
                ${t.disabled ? 'opacity-40 cursor-not-allowed' : ''}
                ${activeTab === t.id
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
                }`}
            >
              <t.icon size={16} />
              {t.label}
            </button>
          ))}
        </div>

        {/* 面板内容 */}
        {activeTab === 'local' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">支持 EPUB、MOBI、AZW3、PDF、TXT 格式</p>

            {/* 选择文件按钮 */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-gray-200 hover:border-indigo-400 hover:bg-indigo-50/50 transition-colors disabled:opacity-50"
              >
                <FileUp size={28} className="text-indigo-500" />
                <span className="text-sm font-medium text-gray-700">选择文件</span>
                <span className="text-xs text-gray-400">支持多选</span>
              </button>
              <button
                onClick={() => folderInputRef.current?.click()}
                disabled={uploading}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-gray-200 hover:border-indigo-400 hover:bg-indigo-50/50 transition-colors disabled:opacity-50"
              >
                <FolderOpen size={28} className="text-indigo-500" />
                <span className="text-sm font-medium text-gray-700">选择文件夹</span>
                <span className="text-xs text-gray-400">批量导入</span>
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".epub,.mobi,.azw3,.pdf,.txt"
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files)}
            />
            <input
              ref={folderInputRef}
              type="file"
              /* @ts-ignore */
              webkitdirectory=""
              /* @ts-ignore */
              directory=""
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files)}
            />

            {/* 上传状态 */}
            {uploading && (
              <div className="flex items-center gap-2 text-sm text-indigo-600">
                <RefreshCw size={14} className="animate-spin" />
                {uploadMsg || '上传中...'}
              </div>
            )}
            {uploadMsg && !uploading && (
              <p className="text-sm text-green-600">{uploadMsg}</p>
            )}
          </div>
        )}

        {activeTab === 'url' && (
          <div className="text-center py-8 text-gray-400">
            <Globe size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">网址导入功能即将上线</p>
            <p className="text-xs mt-1">支持粘贴电子书下载链接直接导入</p>
          </div>
        )}

        {activeTab === 'cloud' && (
          <div className="text-center py-8 text-gray-400">
            <Cloud size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">网盘导入功能即将上线</p>
            <p className="text-xs mt-1">后续将支持百度网盘、阿里云盘等</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 主页面 ──
export function LibraryPage() {
  const navigate = useNavigate()
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)

  const [viewMode, setViewMode] = useState('grid')
  const [showImport, setShowImport] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [formatFilter, setFormatFilter] = useState('') // '' = 全部
  const { libraries, addLibrary, removeLibrary, rescan } = useLibraries()
  const { books, total, fetch: refetchBooks, removeBooks, removeBook } = useBooks({
    q: searchQuery, limit: 200, ...(formatFilter ? { format: formatFilter } : {})
  })
  const { stats, refetchStats } = useStats()

  const handleImported = () => {
    refetchBooks()
    refetchStats()
  }

  const handleOpenBook = (book) => {
    if (selectMode) {
      toggleSelect(book.id)
      return
    }
    navigate(`/reader/${book.id}`)
  }

  const toggleSelect = (id) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === books.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(books.map((b) => b.id)))
    }
  }

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    await removeBooks([...selectedIds])
    setSelectedIds(new Set())
    setSelectMode(false)
    refetchStats()
  }

  const handleDeleteOne = async (e, id) => {
    e.stopPropagation()
    await removeBook(id)
    refetchStats()
  }

  const handleFormatClick = (format) => {
    if (formatFilter === format) {
      setFormatFilter('') // 取消筛选
    } else {
      setFormatFilter(format)
    }
  }

  const formatSize = (bytes) => {
    if (!bytes) return ''
    return bytes > 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
      : `${Math.round(bytes / 1024)}KB`
  }

  return (
    <div className="h-full flex flex-col bg-[#fafaf8]">
      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <div
            onClick={() => navigate('/')}
            className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <BookOpen size={16} className="text-white" />
            </div>
            <h1 className="font-bold text-lg tracking-tight text-gray-800">BookFlow</h1>
          </div>
          {selectMode && (
            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
              已选 {selectedIds.size} 本
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {selectMode ? (
            <>
              <button
                onClick={toggleSelectAll}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 font-medium transition-colors"
              >
                {selectedIds.size === books.length ? '取消全选' : '全选'}
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Trash2 size={14} /> 删除
              </button>
              <button
                onClick={() => { setSelectMode(false); setSelectedIds(new Set()) }}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 font-medium transition-colors"
              >
                取消
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                title={viewMode === 'grid' ? '列表视图' : '网格视图'}
              >
                {viewMode === 'grid' ? <List size={18} className="text-gray-500" /> : <Grid3X3 size={18} className="text-gray-500" />}
              </button>
              <button
                onClick={() => setSelectMode(true)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                title="批量管理"
              >
                <CheckSquare size={18} className="text-gray-500" />
              </button>
              <button
                onClick={() => setShowImport(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-medium hover:from-indigo-600 hover:to-purple-700 shadow-sm hover:shadow transition-all"
              >
                <Upload size={15} /> 导入
              </button>
              <button
                onClick={() => navigate('/settings')}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                title="设置"
              >
                <Menu size={18} className="text-gray-500" />
              </button>
            </>
          )}
        </div>
      </header>

      {/* ── 搜索栏 + 统计 ── */}
      <div className="px-4 py-3 space-y-3">
        {/* 搜索 */}
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索书名、作者..."
            className="w-full pl-9 pr-9 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100">
              <X size={14} className="text-gray-400" />
            </button>
          )}
        </div>

        {/* 统计 + 格式筛选 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400 mr-1">
            {searchQuery ? `搜索 "${searchQuery}" · ` : ''}
            {stats?.total || 0} 本
          </span>

          {!searchQuery && stats?.byFormat?.map((f) => (
            <button
              key={f.format}
              onClick={() => handleFormatClick(f.format)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all
                ${formatFilter === f.format
                  ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700'
                }`}
            >
              {f.format.toUpperCase()}
              <span className={formatFilter === f.format ? 'text-indigo-500' : 'text-gray-400'}>{f.c}</span>
            </button>
          ))}

          {formatFilter && (
            <button
              onClick={() => setFormatFilter('')}
              className="text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-0.5"
            >
              <X size={12} /> 清除筛选
            </button>
          )}
        </div>
      </div>

      {/* ── 书籍展示 ── */}
      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {books.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Library size={48} className="mb-3 opacity-30" />
            <p className="text-sm">
              {searchQuery || formatFilter
                ? '没有找到匹配的书籍'
                : '书库空空，点击右上角"导入"添加书籍'}
            </p>
            {!searchQuery && !formatFilter && (
              <button
                onClick={() => setShowImport(true)}
                className="mt-3 px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm hover:bg-indigo-600 transition-colors"
              >
                导入第一本书
              </button>
            )}
          </div>
        )}

        {viewMode === 'grid' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4">
            {books.map((book) => (
              <div
                key={book.id}
                onClick={() => handleOpenBook(book)}
                className="group cursor-pointer animate-fade relative"
              >
                {/* 选择框 */}
                {selectMode && (
                  <div className="absolute top-2 left-2 z-10" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => toggleSelect(book.id)} className="p-0.5">
                      {selectedIds.has(book.id)
                        ? <CheckSquare size={20} className="text-indigo-600 drop-shadow-sm" />
                        : <Square size={20} className="text-gray-400 drop-shadow-sm" />
                      }
                    </button>
                  </div>
                )}
                {/* 单本删除 */}
                {!selectMode && (
                  <button
                    onClick={(e) => handleDeleteOne(e, book.id)}
                    className="absolute top-2 right-2 z-10 p-1.5 rounded-lg bg-white/80 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                  >
                    <Trash2 size={14} className="text-red-400 hover:text-red-600" />
                  </button>
                )}
                {/* 封面 */}
                <div className="aspect-[3/4] rounded-xl overflow-hidden bg-gray-100 mb-2 shadow-sm group-hover:shadow-md transition-shadow relative">
                  {book.cover_path ? (
                    <CoverImage src={book.cover_path} title={book.title} />
                  ) : (
                    <CoverPlaceholder title={book.title} />
                  )}
                  {/* 格式标签 */}
                  <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-black/50 text-white">
                    {book.format}
                  </span>
                  {/* 进度条 */}
                  {book.read_progress > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-200/50">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-400 to-purple-500 transition-all"
                        style={{ width: `${book.read_progress}%` }}
                      />
                    </div>
                  )}
                </div>
                {/* 元数据 */}
                <p className="text-xs font-medium text-gray-700 line-clamp-2 leading-tight">{book.title}</p>
                <p className="text-[11px] text-gray-400 line-clamp-1 mt-0.5">
                  {book.author || ''}
                  {book.file_size ? `${book.author ? ' · ' : ''}${formatSize(book.file_size)}` : ''}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-0.5">
            {books.map((book) => (
              <div
                key={book.id}
                onClick={() => handleOpenBook(book)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-100/70 cursor-pointer group transition-colors"
              >
                {selectMode && (
                  <button onClick={(e) => { e.stopPropagation(); toggleSelect(book.id) }} className="flex-shrink-0">
                    {selectedIds.has(book.id)
                      ? <CheckSquare size={18} className="text-indigo-600" />
                      : <Square size={18} className="text-gray-400" />
                    }
                  </button>
                )}
                <div className="w-9 h-12 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0 shadow-sm">
                  {book.cover_path ? (
                    <CoverImage src={book.cover_path} title={book.title} small />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50">
                      <BookOpen size={14} className="text-indigo-300" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate text-gray-700">{book.title}</p>
                  <p className="text-xs text-gray-400">
                    {[book.author, book.format?.toUpperCase(), book.series].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {book.read_progress > 0 && (
                  <span className="text-xs text-indigo-500 font-medium">{Math.round(book.read_progress)}%</span>
                )}
                {!selectMode && (
                  <button
                    onClick={(e) => handleDeleteOne(e, book.id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                  >
                    <Trash2 size={14} className="text-red-400" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 导入弹窗 ── */}
      {showImport && (
        <ImportPanel onClose={() => setShowImport(false)} onImported={handleImported} />
      )}
    </div>
  )
}
