import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// §2.4.8 renderability invariant — async, non-blocking, logs to console only
import('./lib/seedAssertions').then(m => m.runSeedAssertions()).catch(console.error)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
