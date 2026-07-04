import { Routes, Route } from 'react-router-dom'
import { LibraryPage } from './pages/LibraryPage'
import { ReaderPage } from './pages/ReaderPage'
import { SettingsPage } from './pages/SettingsPage'
import { useStore } from './store'

export default function App() {
  const { readerTheme } = useStore()

  return (
    <div className={`h-full ${readerTheme === 'dark' ? 'dark' : ''}`}>
      <div className={`h-full ${readerTheme !== 'dark' ? 'reader-light' : 'reader-dark'}`}>
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/reader/:bookId" element={<ReaderPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </div>
    </div>
  )
}
