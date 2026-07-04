import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Sun, Moon, Monitor } from 'lucide-react'
import { useStore } from '../store'

export function SettingsPage() {
  const navigate = useNavigate()
  const readerTheme = useStore((s) => s.readerTheme)
  const setReaderTheme = useStore((s) => s.setReaderTheme)
  const fontSize = useStore((s) => s.fontSize)
  const setFontSize = useStore((s) => s.setFontSize)

  return (
    <div className="h-full flex flex-col reader-light">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-200/50 bg-white/70">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-gray-100">
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-medium text-base">设置</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6 max-w-lg">
        {/* 默认阅读主题 */}
        <section>
          <h2 className="text-sm text-gray-400 mb-3">默认阅读主题</h2>
          <div className="flex gap-2">
            {[
              { key: 'light', label: '亮白', icon: Sun },
              { key: 'sepia', label: '护眼', icon: Sun },
              { key: 'dark', label: '深色', icon: Moon },
              { key: 'night', label: '夜间', icon: Moon },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setReaderTheme(t.key)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all
                  ${readerTheme === t.key ? 'ring-2 ring-indigo-500 bg-indigo-50 text-indigo-600' : 'border-gray-200 text-gray-600'}`}
              >
                <t.icon size={14} className="mx-auto mb-1" />
                {t.label}
              </button>
            ))}
          </div>
        </section>

        {/* 默认字体大小 */}
        <section>
          <h2 className="text-sm text-gray-400 mb-3">默认字体大小：{fontSize}px</h2>
          <input
            type="range" min="12" max="28" value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="w-full accent-indigo-500"
          />
        </section>

        {/* 关于 */}
        <section>
          <h2 className="text-sm text-gray-400 mb-3">关于 BookFlow</h2>
          <div className="p-4 rounded-xl border border-gray-200 bg-white">
            <p className="text-sm text-gray-600">BookFlow v1.0.0</p>
            <p className="text-xs text-gray-400 mt-1">
              本地优先的小说阅读器，支持 EPUB / MOBI / AZW3 / PDF / TXT 格式。
              响应式设计，适配桌面浏览器和移动端。
            </p>
          </div>
        </section>

        {/* 快捷键提示 */}
        <section>
          <h2 className="text-sm text-gray-400 mb-3">快捷键</h2>
          <div className="space-y-2 text-xs text-gray-500">
            <div className="flex justify-between"><span>ESC</span><span>关闭弹窗 / 返回</span></div>
            <div className="flex justify-between"><span>← →</span><span>上一页 / 下一页 (PDF)</span></div>
            <div className="flex justify-between"><span>PageUp / PageDown</span><span>上下翻页 (PDF)</span></div>
            <div className="flex justify-between"><span>滑动 / 滚轮</span><span>滚动 / 翻页</span></div>
          </div>
        </section>
      </div>
    </div>
  )
}
