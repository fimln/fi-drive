import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <div className="app-shell">
      <App />
      <footer className="site-footer">
        <p>Made with ❤️ and ☕ by <a href="https://alfi.ai.id/">Alfi</a> and other contributors.</p>
        <p>Using <a href="https://react.dev/">React</a>, <a href="https://vite.dev/">Vite</a>, <a href="https://workers.cloudflare.com/">Cloudflare Workers®</a>, <a href="https://developers.cloudflare.com/d1/">D1</a>, <a href="https://developers.cloudflare.com/r2/">R2</a>, and <a href="https://developers.cloudflare.com/cloudflare-one/access/">Cloudflare Access™</a>.</p>
        <p className="trademark">Cloudflare, Cloudflare Workers, and Cloudflare Access are trademarks and/or registered trademarks of Cloudflare, Inc. in the United States and other jurisdictions.</p>
      </footer>
    </div>
  </StrictMode>,
)
