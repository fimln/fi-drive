import { useEffect, useState } from 'react'
import { MAX_FILE_SIZE } from './validation.js'
import {
  ApiError,
  LOGOUT_URL,
  createPublicLink,
  deleteFile,
  downloadUrl,
  listFiles,
  uploadFile,
} from './api.js'

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function UploadForm({ remaining, onUploaded }) {
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const [isUploading, setIsUploading] = useState(false)

  function handleFileChange(e) {
    const picked = e.target.files[0] ?? null
    setError('')

    if (!picked) {
      setFile(null)
      return
    }

    if (picked.size > MAX_FILE_SIZE) {
      setError('File exceeds the 10 MB per-file limit.')
      setFile(null)
      return
    }

    setFile(picked)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file) return

    setIsUploading(true)
    setError('')

    try {
      await uploadFile(file)
      setFile(null)
      e.target.reset()
      await onUploaded()
    } catch (err) {
      if (err instanceof ApiError && err.status === 413) {
        setError('File too large or quota exceeded.')

      } else {
        setError(err.message || 'Upload failed.')
      }
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <form className="upload-card" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="file">Upload a new file</label>
        <input
          id="file"
          type="file"
          onChange={handleFileChange}
          required
        />
        <span className="hint">
          Any file type. Max 10 MB per file, {formatSize(Math.max(remaining, 0))}{' '}
          quota remaining.
        </span>
        {error && <span className="field-error">{error}</span>}
      </div>

      <button type="submit" disabled={isUploading || !file}>
        {isUploading ? 'Uploading...' : 'Upload'}
      </button>
    </form>
  )
}

function QuotaBar({ usedBytes, quotaBytes }) {
  const percent = quotaBytes ? Math.min((usedBytes / quotaBytes) * 100, 100) : 0
  return (
    <div className="quota-card">
      <div className="quota-labels">
        <span>Quota used</span>
        <span>
          {formatSize(usedBytes)} / {formatSize(quotaBytes)}
        </span>
      </div>
      <div className="quota-track">
        <div className="quota-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

function Thumbnail({ contentType }) {
  const label = contentType === 'application/pdf' ? 'PDF' : contentType?.startsWith('image/') ? 'IMG' : 'FILE'
  return <div className="thumb thumb-icon">{label}</div>
}

function PublicLinkControls({ file }) {
  const [error, setError] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [publicLink, setPublicLink] = useState('')
  const [publicRemaining, setPublicRemaining] = useState(null)
  const [copied, setCopied] = useState(false)

  async function handlePublicLink() {
    setIsBusy(true)
    setError('')
    try {
      const link = await createPublicLink(file.id)
      const url = new URL(link.path, window.location.origin).href
      setPublicLink(url)
      setPublicRemaining(link.remainingDownloads)
      setCopied(false)
      try {
        await navigator.clipboard.writeText(url)
        setCopied(true)
      } catch {
        // Link tetap terlihat di bawah tombol untuk disalin manual.
      }
    } catch (err) {
      setError(err.message || 'Failed to create public link.')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="public-link-controls">
      <div className="public-link-row">
        <button className="public-link-btn" type="button" disabled={isBusy} onClick={handlePublicLink}>
          Public link
        </button>
      </div>
      {publicLink && (
        <div className="public-link-result">
          <input aria-label="Public link" readOnly value={publicLink} onFocus={(e) => e.target.select()} />
          <span>{copied ? 'Link copied. ' : ''}{publicRemaining} of 50 downloads left.</span>
        </div>
      )}
      {error && <span className="field-error">{error}</span>}
    </div>
  )
}

function FileRow({ file, onDeleted }) {
  const [isDeleting, setIsDeleting] = useState(false)

  async function handleDelete() {
    setIsDeleting(true)
    try {
      await deleteFile(file.id)
      await onDeleted()
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <li className="file-row">
      <Thumbnail contentType={file.contentType} />
      <div className="file-info">
        <span className="file-name">{file.name}</span>
        <span className="file-meta">
          You &middot; {formatSize(file.size)}
        </span>
      </div>
      <a className="download-btn" href={downloadUrl(file.id)}>
        Download
      </a>
      <button className="delete-btn" disabled={isDeleting} onClick={handleDelete}>
        {isDeleting ? 'Deleting...' : 'Delete'}
      </button>
      <PublicLinkControls file={file} />
    </li>
  )
}

function DrivePage({ profile, onProfileChange }) {
  const [files, setFiles] = useState({ owned: [] })
  const [loadError, setLoadError] = useState('')

  async function refresh() {
    try {
      const [fileList] = await Promise.all([listFiles(), onProfileChange()])
      setFiles(fileList)
      setLoadError('')
    } catch (err) {
      setLoadError(err.message || 'Failed to load files.')
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const remaining = profile ? profile.quotaBytes - profile.usedBytes : 0

  return (
    <div className="drive-page">
      <header className="drive-header">
        <div className="drive-header-title">
          <span className="drive-header-icon" aria-hidden="true">
            ☁️
          </span>
          <div>
            <h1>fi-drive</h1>
            <p>Signed in as {profile?.email}</p>
          </div>
        </div>
        <a className="logout-btn" href={LOGOUT_URL}>
          Sign out
        </a>
      </header>

      <main className="drive-grid">
        <div className="drive-col drive-col-left">
          {profile && (
            <QuotaBar usedBytes={profile.usedBytes} quotaBytes={profile.quotaBytes} />
          )}

          <UploadForm remaining={remaining} onUploaded={refresh} />

          {loadError && <p className="field-error">{loadError}</p>}
        </div>

        <div className="drive-col drive-col-right">
          <section className="file-list-card">
            <h2>My files</h2>
            {files.owned.length === 0 ? (
              <p className="empty">No files yet.</p>
            ) : (
              <ul className="file-list">
                {files.owned.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    onDeleted={refresh}
                  />
                ))}
              </ul>
            )}
          </section>

        </div>
      </main>
    </div>
  )
}

export default DrivePage
