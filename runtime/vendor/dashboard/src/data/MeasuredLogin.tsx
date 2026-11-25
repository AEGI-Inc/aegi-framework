import { useState, type FormEvent } from 'react'
import { loginMeasured, datasetProblem } from './datasetBootstrap'

/**
 * 로그인과 최신 실측 로딩이 끝나야 App을 연다.
 */
export default function MeasuredLogin({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(datasetProblem() ?? null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError(null)
    const outcome = await loginMeasured(password)
    if (outcome.ok) {
      onDone()
      return
    }
    setBusy(false)
    setError(outcome.message)
  }

  return (
    <div className="measured-login">
      <form className="measured-login-card" onSubmit={submit}>
        <h1>실측 데이터</h1>
        <p>실제 테넌트에서 수집한 데이터입니다. 팀원만 볼 수 있습니다.</p>
        <label htmlFor="measured-password">팀 비밀번호</label>
        <input
          id="measured-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={e => setPassword(e.target.value)}
          disabled={busy}
        />
        {error && <p className="measured-login-error" role="alert">{error}</p>}
        <div className="measured-login-actions">
          <button type="submit" disabled={busy || !password}>{busy ? '확인 중…' : '열기'}</button>
        </div>
      </form>
    </div>
  )
}
