import { LOGIN_URL } from './api.js'

// Real Entra ID login: this navigates to the Access-protected app root.
// Cloudflare Access verifies the Microsoft account (Entra ID IdP), sets
// the CF_Authorization cookie, and adds Cf-Access-Jwt-Assertion to every
// subsequent /api/* call, which the Worker verifies.
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
          Only authorized owners can access this personal drive.
        </p>
      </div>
    </div>
  )
}

export default LoginPage
