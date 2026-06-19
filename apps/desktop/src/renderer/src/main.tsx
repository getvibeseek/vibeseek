import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ConfirmProvider } from './components/Confirm'
import './i18n'
import './styles/global.css'

// Tag the document with the host OS so platform-specific chrome (macOS traffic
// lights vs. in-app window controls) is styled in CSS from the first paint.
document.documentElement.dataset.platform = window.api.platform

// Forward uncaught renderer errors to the main process app log.
window.addEventListener('error', (e) => {
  window.api.logs.reportError(e.message, { stack: e.error?.stack })
})
window.addEventListener('unhandledrejection', (e) => {
  window.api.logs.reportError('unhandledrejection', { reason: String(e.reason) })
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </React.StrictMode>
)
