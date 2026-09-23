import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './ui/workspace.css'
import './ui/motion.css'
import './ui/mobile.css'
import './ui/atomic-crm.css'
import { installViewportEnvironment } from './ui/viewport'

const disposeViewport = installViewportEnvironment()
if (import.meta.hot) import.meta.hot.dispose(disposeViewport)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined)
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
