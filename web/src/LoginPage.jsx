import { LOGIN_URL } from './api.js'

// Real Entra ID login: this just redirects to the Static Web Apps auth
// route. SWA verifies the Microsoft account, sets a session cookie,
// and injects x-ms-client-principal on every subsequent /api/* call.
// We never see a password or token here.
function LoginPage() {
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">☁️</div>
        <h1>fi-drive</h1>
        <p>Sign in with your Microsoft account.</p>

        <a href={LOGIN_URL} className="ms-login-btn">
          <span className="ms-logo" aria-hidden="true">
            ⊞
          </span>
          Sign in with Microsoft
        </a>
        <p className="login-note">
          Only the owner can access this personal drive.
        </p>
      </div>
    </div>
  )
}

export default LoginPage
