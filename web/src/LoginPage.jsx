import { LOGIN_URL } from './api.js'

// Email OTP login: this navigates to the Access-protected app root.
// Cloudflare Access verifies the owner's email, sets
// the CF_Authorization cookie, and adds Cf-Access-Jwt-Assertion to every
// subsequent /api/* call, which the Worker verifies.
// We never see a password or token here.
function LoginPage() {
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">☁️</div>
        <h1>fi-drive</h1>
        <p>Sign in with a code sent to your email.</p>

        <a href={LOGIN_URL} className="ms-login-btn">
          Sign in with email
        </a>
        <p className="login-note">
          Only authorized owners can access this personal drive.
        </p>
      </div>
    </div>
  )
}

export default LoginPage
