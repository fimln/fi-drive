import { useEffect, useState } from 'react'
import LoginPage from './LoginPage.jsx'
import DrivePage from './DrivePage.jsx'
import { ApiError, LOGIN_URL, getMe } from './api.js'
import './App.css'

// Auth state is derived from the server, not local storage: SWA owns
// the session cookie, so on every load we ask /api/me whether we're
// signed in. A 401 means "show the login page", anything else is a
// real error worth surfacing.
function PersonalApp() {
  const [status, setStatus] = useState('loading') // loading | signed-out | signed-in | error
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')

  async function loadProfile() {
    try {
      const me = await getMe()
      setProfile(me)
      setStatus('signed-in')
      return me
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setStatus('signed-out')
      } else {
        setError(err.message || 'Failed to load profile.')
        setStatus('error')
      }
      throw err
    }
  }

  useEffect(() => {
    loadProfile().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Anonymous visitors never see an in-app login screen: bounce them
  // straight to the SWA auth route. LoginPage's button stays as a
  // fallback in case this redirect is ever blocked (e.g. JS disabled,
  // browser navigation guard).
  useEffect(() => {
    if (status === 'signed-out') {
      window.location.href = LOGIN_URL
    }
  }, [status])

  if (status === 'loading') {
    return <div className="page">Loading...</div>
  }

  if (status === 'error') {
    return <div className="page">{error}</div>
  }

  // Rendered only for the brief moment before the redirect above fires,
  // or as a manual fallback if the browser ever blocks it.
  if (status === 'signed-out') {
    return <LoginPage />
  }

  return <DrivePage profile={profile} onProfileChange={loadProfile} />
}

function App() {
  const params = new URLSearchParams(window.location.search)
  if (params.has('public')) {
    const token = params.get('public')
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>Public file download</h1>
          {token && /^[A-Za-z0-9_-]{22}$/.test(token) ? (
            <>
              <p>This link allows up to 50 downloads. Click below to download the file.</p>
              <a className="ms-login-btn" href={`/api/public/${token}/download`}>
                Download file
              </a>
            </>
          ) : (
            <p>Invalid public link.</p>
          )}
        </div>
      </div>
    )
  }
  return <PersonalApp />
}

export default App
