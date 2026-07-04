import { create } from 'zustand'

export const useStore = create((set) => ({
  // 阅读主题
  readerTheme: 'light',
  setReaderTheme: (t) => set({ readerTheme: t }),

  // 字体大小
  fontSize: 16,
  setFontSize: (s) => set({ fontSize: s }),

  // 字体
  fontFamily: 'serif',
  setFontFamily: (f) => set({ fontFamily: f }),

  // 行间距
  lineHeight: 1.8,
  setLineHeight: (lh) => set({ lineHeight: lh }),

  // 页边距
  marginSize: 40,
  setMarginSize: (m) => set({ marginSize: m }),

  // 翻页模式
  pagination: 'scroll', // scroll | paginated
  setPagination: (p) => set({ pagination: p }),

  // 书库
  libraries: [],
  setLibraries: (l) => set({ libraries: l }),

  // 当前阅读的书
  currentBook: null,
  setCurrentBook: (b) => set({ currentBook: b }),

  // 搜索
  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),
}))
