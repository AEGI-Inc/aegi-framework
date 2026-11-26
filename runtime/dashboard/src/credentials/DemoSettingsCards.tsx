import { useEffect, useRef, useState } from 'react'
import { reasoningOptions, type ReasoningEffort } from '../assistant/reasoning'
import { hasLocalServer } from '../demoMode'
import { CREDENTIAL_GUIDES } from './credentialGuides'
import { GuideHelpButton, GuidePanel } from './CredentialGuideHelp'

interface AiTestRecord {
  ok: boolean
  provider: string
  model: string
  at: string
  message?: string
}

interface LocalTokenResponse {
  configured: Record<string, boolean>
  hints: Record<string, string>
  aiReady?: boolean
  aiModel?: string
  aiProvider?: string
  aiEffort?: ReasoningEffort | null
  aiEffortSetting?: string
  aiTest?: AiTestRecord | null
  port?: number
  defaultPort?: number
  redirectUri?: string
  portWarning?: string | null
}

interface SplunkSourceResult {
  ref: string
  events: number
  latest?: string
  index?: string
  sourcetype?: string
}

interface SplunkTestResponse {
  ok: boolean
  error?: string
  sources?: SplunkSourceResult[]
  created?: boolean
}

/** 공급자별 API 키 안내. 키는 AEGI_ASSISTANT_API_KEY 하나에 저장하지만 발급 화면은 공급자마다 다르다 */
const AI_KEY_GUIDE = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' } as const

export function defaultModel(provider: string) {
  if (provider === 'gemini') return 'gemini-3.6-flash'
  if (provider === 'openai') return 'gpt-5.5'
  return 'claude-sonnet-5-5'
}

/**
 * 데모 서버(aegi-demo)의 Splunk, AI 설정 카드. 데모 모드에서만 그리고, 데모 서버 API(/__aegi/local-token, splunk-test, ai-models, ai-test)도
 * 이 카드 안에서만 부르므로 운영 화면에서는 요청하지 않는다
 */
export default function DemoSettingsCards() {
  if (!hasLocalServer()) return null
  return <DemoSettingsCardsBody />
}

function DemoSettingsCardsBody() {
  const [tokenData, setTokenData] = useState<LocalTokenResponse | null>(null)
  const [savingSplunk, setSavingSplunk] = useState(false)
  const [testingSplunk, setTestingSplunk] = useState(false)
  const [splunkResult, setSplunkResult] = useState<{ ok: boolean; message: string; sources?: SplunkSourceResult[] } | null>(null)
  const [copyingSources, setCopyingSources] = useState(false)

  // Splunk fields
  const [splunkUrl, setSplunkUrl] = useState('')
  const [splunkToken, setSplunkToken] = useState('')
  const [tlsKind, setTlsKind] = useState<'system' | 'fingerprint' | 'ca'>('system')
  const [tlsSha256, setTlsSha256] = useState('')
  const [tlsCaFile, setTlsCaFile] = useState('')

  // AI fields
  const [savingAi, setSavingAi] = useState(false)
  const [testingAi, setTestingAi] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [aiProvider, setAiProvider] = useState<'anthropic' | 'gemini' | 'openai'>('anthropic')
  const [aiApiKey, setAiApiKey] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [aiEffort, setAiEffort] = useState('')
  const [detailOpen, setDetailOpen] = useState(false)
  const aiFieldsLoadedRef = useRef(false)
  const [aiModelList, setAiModelList] = useState<string[]>([])
  const [aiNotice, setAiNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [openGuide, setOpenGuide] = useState<string | null>(null)

  /** 칸 제목과 안내. SaaS 연결 카드(SaasConnect)와 같은 단추와 안내를 쓴다 */
  const fieldHead = (label: string, guideKey: string, opts: { htmlFor?: string; env?: string } = {}) => {
    const guide = CREDENTIAL_GUIDES[guideKey]
    const open = openGuide === guideKey
    return (
      <>
        <div className="sc-field-head">
          {opts.htmlFor ? <label htmlFor={opts.htmlFor}>{label}</label> : <span>{label}</span>}
          {guide && <GuideHelpButton guide={guide} label={label} open={open} onToggle={() => setOpenGuide(open ? null : guideKey)} />}
          {opts.env && <code>{opts.env}</code>}
        </div>
        {guide && open && <GuidePanel guide={guide} label={label} />}
      </>
    )
  }

  const loadStatus = async () => {
    try {
      const res = await fetch('/__aegi/local-token')
      if (res.ok) {
        const data = (await res.json()) as LocalTokenResponse
        setTokenData(data)
        if (data.hints?.SPLUNK_URL && !splunkUrl) setSplunkUrl(data.hints.SPLUNK_URL)
        if (data.hints?.SPLUNK_TLS_SHA256 && !tlsSha256) {
          setTlsSha256(data.hints.SPLUNK_TLS_SHA256)
          setTlsKind('fingerprint')
        } else if (data.hints?.SPLUNK_CA_FILE && !tlsCaFile) {
          setTlsCaFile(data.hints.SPLUNK_CA_FILE)
          setTlsKind('ca')
        }
        if (data.hints?.AEGI_ASSISTANT_PROVIDER) {
          const p = data.hints.AEGI_ASSISTANT_PROVIDER.toLowerCase()
          if (p === 'gemini' || p === 'openai' || p === 'anthropic') setAiProvider(p)
        }
        // 저장된 모델과 추론 강도는 처음 한 번만 칸에 채운다. 저장은 칸 값을 그대로 보내므로 비어 있으면 저장된 값이 지워진다
        if (!aiFieldsLoadedRef.current) {
          aiFieldsLoadedRef.current = true
          setAiModel(data.hints?.AEGI_ASSISTANT_MODEL ?? '')
          setAiEffort(data.aiEffortSetting ?? '')
        }
      }
    } catch {
      // ignore network errors
    }
  }

  useEffect(() => {
    void loadStatus()
  }, [])

  const handleSaveSplunk = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingSplunk(true)
    setSplunkResult(null)
    const values: Record<string, string> = {}
    if (splunkUrl.trim()) values.SPLUNK_URL = splunkUrl.trim()
    if (splunkToken.trim()) values.SPLUNK_TOKEN = splunkToken.trim()
    if (tlsKind === 'fingerprint' && tlsSha256.trim()) values.SPLUNK_TLS_SHA256 = tlsSha256.trim()
    if (tlsKind === 'ca' && tlsCaFile.trim()) values.SPLUNK_CA_FILE = tlsCaFile.trim()

    try {
      const res = await fetch('/__aegi/local-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string }
      if (!res.ok || body.error) {
        setSplunkResult({ ok: false, message: body.detail || body.error || 'Splunk 설정 저장 실패' })
      } else {
        setSplunkToken('')
        setSplunkResult({ ok: true, message: 'Splunk 설정이 로컬 .env 에 저장되었습니다.' })
        await loadStatus()
      }
    } catch {
      setSplunkResult({ ok: false, message: '로컬 서버 통신 오류' })
    } finally {
      setSavingSplunk(false)
    }
  }

  const handleTestSplunk = async () => {
    setTestingSplunk(true)
    setSplunkResult(null)
    try {
      const res = await fetch('/__aegi/splunk-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = (await res.json().catch(() => ({}))) as SplunkTestResponse
      if (!res.ok || !body.ok) {
        setSplunkResult({ ok: false, message: body.error || `연결 시험 실패, HTTP ${res.status}` })
      } else {
        setSplunkResult({
          ok: true,
          message: 'Splunk 검색 REST 연결 성공',
          sources: body.sources ?? [],
        })
      }
    } catch {
      setSplunkResult({ ok: false, message: '로컬 서버 연결 실패' })
    } finally {
      setTestingSplunk(false)
    }
  }

  const handleCopySources = async () => {
    setCopyingSources(true)
    try {
      const res = await fetch('/__aegi/splunk-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initSources: true }),
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; created?: boolean }
      if (body.ok) {
        setSplunkResult({
          ok: true,
          message: body.created
            ? 'splunk.sources.example.json 을 splunk.sources.json 으로 복사했습니다.'
            : 'splunk.sources.json 파일이 이미 존재합니다.',
        })
      }
    } catch {
      setSplunkResult({ ok: false, message: '출처 설정 복사 실패' })
    } finally {
      setCopyingSources(false)
    }
  }

  const handleLoadModels = async () => {
    setLoadingModels(true)
    setAiNotice(null)
    try {
      const res = await fetch('/__aegi/ai-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: aiProvider,
          apiKey: aiApiKey.trim() || undefined,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok: boolean
        models?: string[]
        error?: string
      }
      if (body.ok && Array.isArray(body.models)) {
        setAiModelList(body.models)
        setAiNotice({ ok: true, text: `모델 ${body.models.length}개를 불러왔습니다.` })
      } else {
        setAiNotice({ ok: false, text: body.error || `모델 목록 불러오기 실패, HTTP ${res.status}` })
      }
    } catch {
      setAiNotice({ ok: false, text: '로컬 서버 통신 오류' })
    } finally {
      setLoadingModels(false)
    }
  }

  const handleTestAi = async () => {
    setTestingAi(true)
    setAiNotice(null)
    try {
      const payload: Record<string, unknown> = {
        provider: aiProvider,
        model: aiModel.trim() || undefined,
        apiKey: aiApiKey.trim() || undefined,
      }
      if (aiEffort.trim()) {
        payload.effort = aiEffort.trim()
      }
      const res = await fetch('/__aegi/ai-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok: boolean
        provider: string
        model: string
        effort?: string | null
        servedModel?: string
        ms: number
        error?: { code?: string; status?: number; message?: string }
      }
      if (body.ok) {
        const displayModel = body.servedModel || body.model
        const displayEffort = body.effort ?? '해당 없음'
        setAiNotice({
          ok: true,
          text: `연결 확인: ${body.provider} / ${displayModel}, 추론 ${displayEffort}, ${body.ms}ms`,
        })
      } else {
        const statusPart = body.error?.status ? ` (${body.error.status})` : ''
        const reason = body.error?.message || body.error?.code || '오류'
        setAiNotice({
          ok: false,
          text: `연결 실패${statusPart}: ${reason}`,
        })
      }
      await loadStatus()
    } catch {
      setAiNotice({ ok: false, text: '로컬 서버 통신 오류' })
    } finally {
      setTestingAi(false)
    }
  }

  const handleSaveAi = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingAi(true)
    setAiNotice(null)
    if (!aiApiKey.trim() && !aiReady) {
      setAiNotice({ ok: false, text: 'API 키 미입력' })
      setSavingAi(false)
      return
    }
    /* 공급자와 키를 함께 저장한다. 흔한 이름(ANTHROPIC_API_KEY 등)보다 AEGI_ASSISTANT_* 가 앞선다 */
    const values: Record<string, string> = {
      AEGI_ASSISTANT_PROVIDER: aiProvider,
    }
    if (aiApiKey.trim()) {
      values.AEGI_ASSISTANT_API_KEY = aiApiKey.trim()
    }
    values.AEGI_ASSISTANT_MODEL = aiModel.trim()
    values.AEGI_ASSISTANT_REASONING_EFFORT = aiEffort.trim()

    try {
      const res = await fetch('/__aegi/local-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string }
      if (!res.ok || body.error) {
        setAiNotice({ ok: false, text: body.detail || body.error || 'AI 설정 저장 실패' })
      } else {
        setAiApiKey('')
        setAiNotice({ ok: true, text: 'AI 설정이 저장되었습니다.' })
        await loadStatus()
      }
    } catch {
      setAiNotice({ ok: false, text: '로컬 서버 통신 오류' })
    } finally {
      setSavingAi(false)
    }
  }

  const splunkConfigured = Boolean(tokenData?.configured?.SPLUNK_URL && tokenData?.configured?.SPLUNK_TOKEN)
  const aiReady = Boolean(tokenData?.aiReady)

  let aiStateText = '연결 안 됨'
  let aiStateClass = ''
  if (aiReady) {
    if (!tokenData?.aiTest) {
      aiStateText = '키 저장됨, 시험 전'
      aiStateClass = ''
    } else if (tokenData.aiTest.ok) {
      aiStateText = '연결 확인됨'
      aiStateClass = 'is-ok'
    } else {
      aiStateText = '시험 실패'
      aiStateClass = 'is-bad'
    }
  }

  const savedProvider = (tokenData?.hints?.AEGI_ASSISTANT_PROVIDER?.toLowerCase() as 'anthropic' | 'gemini' | 'openai' | undefined) || 'anthropic'
  const currentModelForEffort = aiModel.trim() || (savedProvider === aiProvider && tokenData?.hints?.AEGI_ASSISTANT_MODEL) || defaultModel(aiProvider)
  const { options: effortOptions, auto: autoEffort } = reasoningOptions(aiProvider, currentModelForEffort)

  useEffect(() => {
    if (aiEffort && !effortOptions.includes(aiEffort as ReasoningEffort)) {
      setAiEffort('')
    }
  }, [effortOptions, aiEffort])

  const effectiveProvider = tokenData?.aiProvider || tokenData?.hints?.AEGI_ASSISTANT_PROVIDER || aiProvider
  const effectiveModel = tokenData?.aiModel || tokenData?.hints?.AEGI_ASSISTANT_MODEL || defaultModel(effectiveProvider)

  return (
    <div className="demo-settings-cards">
      {/* Splunk 카드 */}
      <article className="integration-card demo-settings-card">
        <div className="integration-card-head">
          <span className="integration-card-name">
            <b>Splunk 연결</b>
            <small>검색 REST 연결 및 감사 로그 출처 설정</small>
          </span>
          <span className={`sc-state ${splunkConfigured ? 'is-ok' : ''}`}>
            {splunkConfigured ? '저장됨' : '연결 안 됨'}
          </span>
        </div>

        <form onSubmit={handleSaveSplunk} className="demo-settings-form">
          <div className="sc-field">
            {fieldHead('Splunk URL', 'SPLUNK_URL', { htmlFor: 'splunk-url', env: 'SPLUNK_URL' })}
            <input
              id="splunk-url"
              className="ex-input"
              type="text"
              placeholder={tokenData?.configured?.SPLUNK_URL ? '저장됨' : 'https://splunk.example.com:8089'}
              value={splunkUrl}
              onChange={e => setSplunkUrl(e.target.value)}
            />
          </div>

          <div className="sc-field">
            {fieldHead('인증 토큰', 'SPLUNK_TOKEN', { htmlFor: 'splunk-token', env: 'SPLUNK_TOKEN' })}
            <input
              id="splunk-token"
              className="ex-input"
              type="password"
              autoComplete="off"
              placeholder={tokenData?.configured?.SPLUNK_TOKEN ? '저장됨, 바꾸려면 새 값 입력' : '검색 권한 토큰'}
              value={splunkToken}
              onChange={e => setSplunkToken(e.target.value)}
            />
          </div>

          <div className="sc-field">
            {fieldHead('인증서 확인 방법', 'SPLUNK_TLS')}
            <div className="demo-settings-radio-group">
              <label className="demo-settings-radio">
                <input
                  type="radio"
                  name="tlsKind"
                  value="system"
                  checked={tlsKind === 'system'}
                  onChange={() => setTlsKind('system')}
                />
                시스템 기본
              </label>
              <label className="demo-settings-radio">
                <input
                  type="radio"
                  name="tlsKind"
                  value="fingerprint"
                  checked={tlsKind === 'fingerprint'}
                  onChange={() => setTlsKind('fingerprint')}
                />
                SHA-256 지문
              </label>
              <label className="demo-settings-radio">
                <input
                  type="radio"
                  name="tlsKind"
                  value="ca"
                  checked={tlsKind === 'ca'}
                  onChange={() => setTlsKind('ca')}
                />
                CA 파일 경로
              </label>
            </div>
          </div>

          {tlsKind === 'fingerprint' && (
            <div className="sc-field">
              {fieldHead('인증서 SHA-256 지문', 'SPLUNK_TLS_SHA256', { htmlFor: 'splunk-tls-sha256', env: 'SPLUNK_TLS_SHA256' })}
              <input
                id="splunk-tls-sha256"
                className="ex-input"
                type="text"
                placeholder={tokenData?.configured?.SPLUNK_TLS_SHA256 ? '저장됨' : '서버 인증서 지문'}
                value={tlsSha256}
                onChange={e => setTlsSha256(e.target.value)}
              />
            </div>
          )}

          {tlsKind === 'ca' && (
            <div className="sc-field">
              {fieldHead('CA 파일 경로', 'SPLUNK_CA_FILE', { htmlFor: 'splunk-ca-file', env: 'SPLUNK_CA_FILE' })}
              <input
                id="splunk-ca-file"
                className="ex-input"
                type="text"
                placeholder={tokenData?.configured?.SPLUNK_CA_FILE ? '저장됨' : 'ca.pem'}
                value={tlsCaFile}
                onChange={e => setTlsCaFile(e.target.value)}
              />
            </div>
          )}

          <div className="demo-settings-actions">
            <button type="submit" className="ex-btn primary" disabled={savingSplunk}>
              {savingSplunk ? '저장 중…' : '설정 저장'}
            </button>
            <button
              type="button"
              className="ex-btn"
              disabled={testingSplunk}
              onClick={() => void handleTestSplunk()}
            >
              {testingSplunk ? '시험 중…' : '연결 시험'}
            </button>
            <button
              type="button"
              className="ex-btn"
              disabled={copyingSources}
              onClick={() => void handleCopySources()}
              title="splunk.sources.example.json 을 splunk.sources.json 으로 복사"
            >
              출처 설정 복사
            </button>
            <GuideHelpButton
              guide={CREDENTIAL_GUIDES.SPLUNK_SOURCES_FILE}
              label="출처 설정"
              open={openGuide === 'SPLUNK_SOURCES_FILE'}
              onToggle={() => setOpenGuide(openGuide === 'SPLUNK_SOURCES_FILE' ? null : 'SPLUNK_SOURCES_FILE')}
            />
          </div>
          {openGuide === 'SPLUNK_SOURCES_FILE' && <GuidePanel guide={CREDENTIAL_GUIDES.SPLUNK_SOURCES_FILE} label="출처 설정" />}
        </form>

        {splunkResult && (
          <div className={`sc-banner ${splunkResult.ok ? 'is-ok' : 'is-bad'}`} style={{ marginTop: '12px' }}>
            <p style={{ margin: 0 }}>{splunkResult.message}</p>
            {splunkResult.sources && splunkResult.sources.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: '18px', fontSize: 'var(--font-size-xs)' }}>
                {splunkResult.sources.map(s => (
                  <li key={s.ref}>
                    <strong>{s.ref}</strong>: 최근 7일 이벤트 {s.events}건{s.latest ? `, 마지막 ${s.latest}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </article>

      {/* AI 카드 */}
      <article className="integration-card demo-settings-card">
        <div className="integration-card-head">
          <span className="integration-card-name">
            <b>AI 연결</b>
            <small>대시보드 AI 질문 및 감사 로그 분석 지원</small>
          </span>
          <span className={`sc-state ${aiStateClass}`}>
            {aiStateText}
          </span>
        </div>

        <form onSubmit={handleSaveAi} className="demo-settings-form">
          <div className="sc-field">
            {fieldHead('공급자', 'AEGI_ASSISTANT_PROVIDER', { htmlFor: 'ai-provider', env: 'AEGI_ASSISTANT_PROVIDER' })}
            <select
              id="ai-provider"
              className="ex-input"
              value={aiProvider}
              onChange={e => {
                const p = e.target.value as 'anthropic' | 'gemini' | 'openai'
                setAiProvider(p)
                setAiModel('')
                setAiEffort('')
              }}
            >
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>

          <div className="sc-field">
            {fieldHead('API 키', AI_KEY_GUIDE[aiProvider], { htmlFor: 'ai-api-key', env: 'AEGI_ASSISTANT_API_KEY' })}
            <input
              id="ai-api-key"
              className="ex-input"
              type="password"
              autoComplete="off"
              placeholder={aiReady ? '저장됨, 바꾸려면 새 키 입력' : 'API 키'}
              value={aiApiKey}
              onChange={e => setAiApiKey(e.target.value)}
            />
          </div>

          <div className="demo-settings-actions">
            <button type="submit" className="ex-btn primary" disabled={savingAi}>
              {savingAi ? '저장 중…' : '설정 저장'}
            </button>
            <button
              type="button"
              className="ex-btn"
              disabled={testingAi}
              onClick={() => void handleTestAi()}
            >
              {testingAi ? '시험 중…' : '연결 시험'}
            </button>
          </div>

          {aiNotice && (
            <div className={`sc-banner ${aiNotice.ok ? 'is-ok' : 'is-bad'}`} style={{ marginTop: '12px' }}>
              {aiNotice.text}
            </div>
          )}

          <div style={{ marginTop: '12px', fontSize: 'var(--font-size-xs)' }}>
            지금 설정: {effectiveProvider} / {effectiveModel}, 추론 {tokenData?.aiEffort ?? '해당 없음'}
          </div>

          <div style={{ marginTop: '16px' }}>
            <button
              type="button"
              className="ex-btn"
              onClick={() => setDetailOpen(v => !v)}
            >
              {detailOpen ? '세부 설정 접기' : '세부 설정'}
            </button>
          </div>

          {detailOpen && (
            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="sc-field">
                {fieldHead('모델', 'AEGI_ASSISTANT_MODEL', { htmlFor: 'ai-model', env: 'AEGI_ASSISTANT_MODEL' })}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    id="ai-model"
                    className="ex-input"
                    type="text"
                    list="ai-model-list"
                    placeholder={`기본: ${defaultModel(aiProvider)}`}
                    value={aiModel}
                    onChange={e => setAiModel(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="ex-btn"
                    disabled={loadingModels}
                    onClick={() => void handleLoadModels()}
                  >
                    {loadingModels ? '불러오는 중…' : '모델 목록 불러오기'}
                  </button>
                </div>
                <datalist id="ai-model-list">
                  {aiModelList.map(m => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>

              <div className="sc-field">
                {fieldHead('추론 강도', 'AEGI_ASSISTANT_REASONING_EFFORT', { htmlFor: 'ai-effort', env: 'AEGI_ASSISTANT_REASONING_EFFORT' })}
                <select
                  id="ai-effort"
                  className="ex-input"
                  disabled={effortOptions.length === 0}
                  value={effortOptions.length === 0 ? '' : aiEffort}
                  onChange={e => setAiEffort(e.target.value)}
                >
                  {effortOptions.length === 0 ? (
                    <option value="">추론 강도 미지원 모델</option>
                  ) : (
                    <>
                      <option value="">{`자동: ${autoEffort ?? '해당 없음'}`}</option>
                      {effortOptions.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </>
                  )}
                </select>
                {aiProvider === 'openai' && effortOptions.length === 1 && effortOptions[0] === 'none' && (
                  <div style={{ marginTop: '4px', fontSize: 'var(--font-size-xs)' }}>
                    이 모델은 도구 호출과 함께 쓸 때 none 만 됩니다.
                  </div>
                )}
              </div>
            </div>
          )}
        </form>
      </article>
    </div>
  )
}
