import { App as AntdApp, ConfigProvider } from 'antd'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import AppLayout from './components/AppLayout'
import PostingsPage from './pages/PostingsPage'
import SourcesPage from './pages/SourcesPage'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found in index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    {/* Stock theme on purpose. Tokens go in this object when we pick any. */}
    <ConfigProvider theme={{ token: {} }}>
      <AntdApp>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/postings" replace />} />
              <Route path="postings" element={<PostingsPage />} />
              <Route path="sources" element={<SourcesPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  </StrictMode>,
)
