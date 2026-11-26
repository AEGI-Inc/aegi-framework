import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, RefreshCw, TriangleAlert, X, Zap } from 'lucide-react'
import ProviderLogo from '../ProviderLogo'
import { providerLogoId } from '../findings/providers'

const COLLECT_ENDPOINT = '/__aegi/collect'
const COLLECT_STATUS_ENDPOINT = '/__aegi/collect-status'
const COLLECTOR_STATUS_ENDPOINT = '/__aegi/collector-status'

export interface LiveCollectStatus {
  state: 'idle' | 'running' | 'done' | 'failed'
  jobId?: string | null
  provider?: string | null
  step?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  lines?: string[]
  result?: {
    snapshotId?: string
    reused?: boolean
    findings?: number
    accessGaps?: number
    blast?: number
  } | null
  error?: string | null
}

const PROVIDER_NAMES: Record<string, string> = {
  okta: 'Okta',
  google: 'Google Workspace',
  gws: 'Google Workspace',
  github: 'GitHub',
  slack: 'Slack',
  salesforce: 'Salesforce',
  atlassian: 'Atlassian',
  aws: 'AWS',
}

const normalizeProvider = (p: string) => (p === 'google' ? 'gws' : p)

function parseProviderSet(raw?: string | null): Set<string> {
  if (!raw) return new Set()
  return new Set(
    raw
      .split(',')
      .map(s => normalizeProvider(s.trim().toLowerCase()))
      .filter(Boolean),
  )
}

interface ProviderMeta {
  provider: string
  total: number
  lastDone: number
  ready: boolean
}

interface LiveCollectionModalProps {
  open: boolean
  onClose: () => void
  targetProvider?: string | null
  autoStart?: boolean
  onSuccess?: () => void
}

export default function LiveCollectionModal({
  open,
  onClose,
  targetProvider,
  autoStart,
  onSuccess,
}: LiveCollectionModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const logTerminalRef = useRef<HTMLDivElement>(null)

  const [status, setStatus] = useState<LiveCollectStatus>({
    state: 'idle',
    lines: [],
  })
  const [elapsedSec, setElapsedSec] = useState<number>(0)
  const [isStarting, setIsStarting] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<string | null | undefined>(targetProvider)
  const [providerMetas, setProviderMetas] = useState<ProviderMeta[]>([])
  const [checkedProviders, setCheckedProviders] = useState<Record<string, boolean>>({})
  const initializedCheckRef = useRef(false)

  useEffect(() => {
    setSelectedProvider(targetProvider)
    initializedCheckRef.current = false
  }, [targetProvider, open])

  useEffect(() => {
    if (!open || initializedCheckRef.current || providerMetas.length === 0) return
    initializedCheckRef.current = true
    const normTarget = targetProvider ? normalizeProvider(targetProvider) : null
    const next: Record<string, boolean> = {}
    for (const m of providerMetas) {
      const p = normalizeProvider(m.provider)
      next[p] = m.ready && (!normTarget || p === normTarget)
    }
    setCheckedProviders(next)
  }, [open, targetProvider, providerMetas])

  // SaaS별 전체 호출 수(m), 최근 수집 완료 수, 연동 여부 로드
  useEffect(() => {
    if (!open) return
    let active = true
    fetch(COLLECTOR_STATUS_ENDPOINT, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { credentials?: Array<{ ready?: boolean; calls?: Array<{ id?: string; provider?: string; last?: { completeness?: string } | null }> }> } | null) => {
        if (!active || !d?.credentials) return
        const map = new Map<string, { total: number; lastDone: number; ready: boolean }>()
        for (const cred of d.credentials) {
          for (const call of cred.calls || []) {
            const p = call.provider
            if (!p || !call.id || call.id.startsWith('RG-')) continue
            const cur = map.get(p) ?? { total: 0, lastDone: 0, ready: false }
            cur.total += 1
            if (call.last?.completeness === 'full' || call.last?.completeness === 'partial') {
              cur.lastDone += 1
            }
            if (cred.ready) cur.ready = true
            map.set(p, cur)
          }
        }
        setProviderMetas(Array.from(map.entries()).map(([provider, info]) => ({ provider, ...info })))
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [open, status.state])

  // 다이얼로그 열기 / 닫기
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  // 자동 시작 트리거
  useEffect(() => {
    if (open && autoStart && !hasStarted && status.state !== 'running') {
      setHasStarted(true)
      void triggerCollect(targetProvider)
    }
    if (!open) {
      setHasStarted(false)
    }
  }, [open, autoStart, targetProvider, hasStarted, status.state])

  // 상태 폴링 (열려있거나 수집 중일 때 1초 간격)
  useEffect(() => {
    let active = true

    const poll = async () => {
      try {
        const res = await fetch(COLLECT_STATUS_ENDPOINT, { cache: 'no-store' })
        if (!res.ok || !active) return
        const data = (await res.json()) as LiveCollectStatus
        setStatus(data)

        if (data.startedAt && data.state === 'running') {
          const startMs = new Date(data.startedAt).getTime()
          setElapsedSec(Math.max(0, Math.floor((Date.now() - startMs) / 1000)))
        } else if (data.startedAt && data.finishedAt) {
          const startMs = new Date(data.startedAt).getTime()
          const endMs = new Date(data.finishedAt).getTime()
          setElapsedSec(Math.max(0, Math.floor((endMs - startMs) / 1000)))
        }
      } catch {
        // 일시 네트워크 오류 무시
      }
    }

    void poll()
    const interval = window.setInterval(() => {
      void poll()
    }, 1000)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [open])

  // 새 로그 수신 시 터미널 맨 아래로 자동 스크롤
  useEffect(() => {
    if (logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight
    }
  }, [status.lines])

  const triggerCollect = async (provider?: string | null) => {
    const normalizedProvider = provider
      ? provider.split(',').map(s => normalizeProvider(s.trim())).filter(Boolean).join(',')
      : null
    setSelectedProvider(normalizedProvider)
    setIsStarting(true)
    try {
      const payload = normalizedProvider ? { provider: normalizedProvider } : {}
      const res = await fetch(COLLECT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok && res.status !== 202 && body.error !== 'collection_in_progress') {
        setStatus(prev => ({
          ...prev,
          state: 'failed',
          error: body.detail || body.error || `수집 시작 실패 (HTTP ${res.status})`,
        }))
      } else {
        setStatus(prev => ({
          ...prev,
          state: 'running',
          provider: normalizedProvider,
          step: '1/4 수집 시작 중…',
          error: null,
        }))
      }
    } catch (err) {
      setStatus(prev => ({
        ...prev,
        state: 'failed',
        error: err instanceof Error ? err.message : '로컬 서버와 통신할 수 없습니다.',
      }))
    } finally {
      setIsStarting(false)
    }
  }

  const isRunning = status.state === 'running' || isStarting
  const isDone = status.state === 'done'
  const isFailed = status.state === 'failed'

  const activeProvider = isRunning ? (status.provider || selectedProvider) : selectedProvider

  const timeText = elapsedSec < 60
    ? `${elapsedSec}초`
    : `${Math.floor(elapsedSec / 60)}분 ${elapsedSec % 60}초`

  const stepRaw = status.step || ''
  const currentStepNum = stepRaw.includes('2/4') || stepRaw.includes('정규화')
    ? 2
    : stepRaw.includes('3/4') || stepRaw.includes('판정') || stepRaw.includes('분석')
      ? 3
      : stepRaw.includes('4/4') || isDone
        ? 4
        : 1

  const saasProgress = useMemo(() => {
    const doneByProv = new Map<string, Set<string>>()
    let lastProv: string | null = null
    for (const line of status.lines || []) {
      const m = line.trim().match(/^[✓◐✗–]\s+\[([a-z0-9_-]+)\]\s+([A-Z0-9_-]+)/i)
      if (!m) continue
      const p = normalizeProvider(m[1]!.toLowerCase())
      const callId = m[2]!
      lastProv = p
      if (callId.startsWith('RG-')) continue
      let set = doneByProv.get(p)
      if (!set) {
        set = new Set<string>()
        doneByProv.set(p, set)
      }
      set.add(callId)
    }

    const normTarget = targetProvider ? normalizeProvider(targetProvider) : null
    const activeSet = parseProviderSet(activeProvider)
    const statusSet = parseProviderSet(status.provider)
    const baseList = providerMetas.filter(
      m => m.ready || (doneByProv.get(normalizeProvider(m.provider))?.size ?? 0) > 0 || normalizeProvider(m.provider) === normTarget,
    )
    const items = (baseList.length ? baseList : providerMetas).map(m => {
      const normProv = normalizeProvider(m.provider)
      const liveDone = doneByProv.get(normProv)?.size ?? 0
      const useLive = isRunning
        ? (activeSet.size === 0 || activeSet.has(normProv))
        : (statusSet.size > 0 && statusSet.has(normProv) && (status.lines?.length ?? 0) > 0)
      const done = useLive
        ? Math.min(liveDone, m.total || Number.MAX_SAFE_INTEGER)
        : Math.min(m.lastDone, m.total || Number.MAX_SAFE_INTEGER)
      return { ...m, normProv, done }
    })
    const targetedItems = items.filter(it => activeSet.size === 0 || activeSet.has(it.normProv))
    const firstTargetedProv = targetedItems[0]?.normProv ?? null
    return items.map(item => {
      const isComplete = item.total > 0 && item.done >= item.total
      const isTargeted = activeSet.size === 0 || activeSet.has(item.normProv)
      const tIdx = targetedItems.findIndex(it => it.normProv === item.normProv)
      const prevDone = tIdx > 0 && targetedItems.slice(0, tIdx).every(prev => prev.total > 0 && prev.done >= prev.total)
      const isActive = Boolean(
        isRunning &&
        currentStepNum === 1 &&
        !isComplete &&
        isTargeted &&
        (activeSet.size === 1
          ? true
          : lastProv
            ? item.normProv === lastProv || prevDone
            : item.normProv === firstTargetedProv),
      )
      return { ...item, isComplete, isActive }
    })
  }, [status.lines, status.provider, providerMetas, activeProvider, targetProvider, isRunning, currentStepNum])

  const readyProviders = useMemo(
    () => saasProgress.filter(i => i.ready).map(i => i.normProv),
    [saasProgress],
  )
  const chosenProviders = useMemo(
    () => readyProviders.filter(p => Boolean(checkedProviders[p])),
    [readyProviders, checkedProviders],
  )
  const collectBtnLabel =
    chosenProviders.length === 0
      ? 'SaaS를 선택하세요'
      : chosenProviders.length === readyProviders.length
        ? `전체 수집 시작 (${chosenProviders.length}개)`
        : chosenProviders.length === 1
          ? `${PROVIDER_NAMES[chosenProviders[0]!] || chosenProviders[0]} 수집 시작`
          : `선택 수집 시작 (${chosenProviders.length}개)`

  const displayProviders = isRunning
    ? Array.from(parseProviderSet(activeProvider))
    : chosenProviders.length > 0
      ? chosenProviders
      : Array.from(parseProviderSet(activeProvider))
  const targetLabel =
    displayProviders.length === 0 || (readyProviders.length > 0 && displayProviders.length >= readyProviders.length)
      ? '전체 SaaS'
      : displayProviders.length === 1
        ? (PROVIDER_NAMES[displayProviders[0]!] || displayProviders[0]!)
        : `선택 SaaS (${displayProviders.length}개)`

  const runSelectedCollect = () => {
    if (chosenProviders.length === 0) return
    const arg = chosenProviders.length === readyProviders.length ? null : chosenProviders.join(',')
    void triggerCollect(arg)
  }

  const selectAllReady = () => {
    const next: Record<string, boolean> = {}
    for (const p of readyProviders) next[p] = true
    setCheckedProviders(next)
  }

  const clearAllReady = () => {
    const next: Record<string, boolean> = {}
    for (const p of readyProviders) next[p] = false
    setCheckedProviders(next)
  }

  if (!open) return null

  return (
    <dialog ref={dialogRef} className="sc-dialog sc-live-dialog" onClose={onClose}>
      <header className="sc-live-header">
        <div>
          <div className="sc-live-title-row">
            <h2>{targetLabel} 데이터 수집 및 분석</h2>
            <span className={`sc-live-badge is-${status.state}`}>
              {isRunning && (
                <>
                  <span className="sc-stepper-spinner" aria-hidden="true" />
                  실행 중 ({timeText})
                </>
              )}
              {isDone && (
                <>
                  <Check size={13} strokeWidth={2.5} />
                  수집 및 분석 완료 ({timeText})
                </>
              )}
              {isFailed && (
                <>
                  <TriangleAlert size={13} strokeWidth={2.5} />
                  실행 실패
                </>
              )}
              {status.state === 'idle' && '대기 중'}
            </span>
          </div>
          <p className="sc-live-subtitle">
            {isRunning
              ? '수집 엔진이 API를 호출하고 객체·권한 관계를 정규화하여 그래프를 생성하고 있습니다.'
              : isDone
                ? '수집된 데이터가 최신 그래프 스냅샷으로 정상 반영되었습니다.'
                : isFailed
                  ? '수집 실행 중 오류가 발생했습니다. 아래 로그를 확인하세요.'
                  : '실시간 수집 실행 로그를 확인합니다.'}
          </p>
        </div>
        <button
          type="button"
          className="sc-close-btn"
          aria-label="닫기"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>

      {/* SaaS별 수집 현황 및 대상 선택 */}
      {saasProgress.length > 0 && (
        <div className="sc-stepper" role="status" aria-label="SaaS별 수집 현황">
          <div className="sc-saas-progress" aria-label="SaaS별 수집 대상 선택">
            {saasProgress.map(item => {
              const isChecked = Boolean(item.ready && checkedProviders[item.normProv])
              return (
                <label
                  key={item.provider}
                  className={`sc-saas-chip ${isChecked ? 'is-checked' : ''} ${!item.ready ? 'is-disabled' : ''} ${item.isActive ? 'is-running' : item.isComplete ? 'is-done' : ''}`}
                  title={item.ready ? `${PROVIDER_NAMES[item.provider] || item.provider} 수집 대상 포함/제외` : '연결 설정이 필요합니다'}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={isRunning || !item.ready}
                    onChange={e =>
                      setCheckedProviders(prev => ({ ...prev, [item.normProv]: e.target.checked }))
                    }
                  />
                  <span className="sc-saas-chip-logo">
                    <ProviderLogo provider={providerLogoId(item.normProv)} />
                  </span>
                  <span className="sc-saas-chip-name">{PROVIDER_NAMES[item.provider] || item.provider}</span>
                  <span className="sc-saas-chip-count">({item.done}/{item.total})</span>
                  {item.isActive && <span className="sc-saas-chip-state is-running">수집중</span>}
                  {!item.isActive && item.isComplete && <span className="sc-saas-chip-state is-done">완료</span>}
                  {!item.ready && <span className="sc-saas-chip-state">미연동</span>}
                </label>
              )
            })}
          </div>
          <div className="sc-saas-toolbar">
            <div className="sc-saas-toolbar-left">
              <button
                type="button"
                className="sc-saas-chip-btn"
                disabled={isRunning || readyProviders.length === 0 || chosenProviders.length === readyProviders.length}
                onClick={selectAllReady}
              >
                전체 선택
              </button>
              <button
                type="button"
                className="sc-saas-chip-btn"
                disabled={isRunning || chosenProviders.length === 0}
                onClick={clearAllReady}
              >
                전체 해제
              </button>
              <span className="sc-saas-select-summary">
                {chosenProviders.length}/{readyProviders.length}개 선택됨
              </span>
            </div>
            <button
              type="button"
              className="sc-btn-primary sc-saas-collect-all-btn"
              disabled={isRunning || chosenProviders.length === 0}
              onClick={runSelectedCollect}
              title="체크된 SaaS 데이터를 수집하고 대시보드 그래프를 갱신합니다"
            >
              <Zap size={13} strokeWidth={2.5} />
              {collectBtnLabel}
            </button>
          </div>
        </div>
      )}

      {/* 실시간 로그 터미널 */}
      <div className="sc-terminal-wrap">
        <div className="sc-terminal-bar">
          <span className="sc-terminal-dot red" />
          <span className="sc-terminal-dot yellow" />
          <span className="sc-terminal-dot green" />
          <span className="sc-terminal-title">Collector Process Console</span>
          <span className="sc-terminal-count">{(status.lines || []).length}줄</span>
        </div>
        <div ref={logTerminalRef} className="sc-terminal-logs">
          {(status.lines && status.lines.length > 0) ? (
            status.lines.map((line, idx) => {
              const trimmed = line.trim()
              let lineType = 'normal'
              if (trimmed.startsWith('✓')) lineType = 'ok'
              else if (trimmed.startsWith('◐')) lineType = 'partial'
              else if (trimmed.startsWith('–')) lineType = 'skip'
              else if (trimmed.startsWith('✗') || trimmed.includes('http_40') || trimmed.includes('http_50')) lineType = 'bad'
              else if (/^\d+\/\d+/.test(trimmed)) lineType = 'step'

              return (
                <div key={idx} className={`sc-log-line is-${lineType}`}>
                  {line}
                </div>
              )
            })
          ) : (
            <div className="sc-log-empty">
              {isRunning ? '로그 출력을 기다리는 중…' : '기록된 수집 로그가 없습니다.'}
            </div>
          )}
        </div>
      </div>

      {/* 하단 제어 및 안내 영역 */}
      <footer className="sc-live-footer">
        {isRunning && (
          <div className="sc-live-status-desc">
            <span className="sc-live-dot-pulse" />
            <span>수집은 백그라운드 프로세스로 동작합니다. 이 창을 닫아도 백그라운드에서 중단 없이 완료됩니다.</span>
          </div>
        )}
        {isDone && (
          <div className="sc-live-status-desc is-done">
            <Check size={16} />
            <span>
              수집 및 판정이 완료되어 대시보드에 자동 반영됩니다…
            </span>
          </div>
        )}
        {isFailed && (
          <div className="sc-live-status-desc is-bad">
            <TriangleAlert size={16} />
            <span>오류 발생: {status.error || '수집 작업에 실패했습니다.'}</span>
          </div>
        )}

        <div className="sc-live-actions">
          {!isRunning && (
            <button
              type="button"
              className="sc-btn-primary"
              disabled={chosenProviders.length === 0}
              onClick={runSelectedCollect}
            >
              <Zap size={14} />
              {collectBtnLabel}
            </button>
          )}

          {isDone && (
            <button
              type="button"
              className="sc-btn-primary"
              onClick={() => {
                onSuccess?.()
                window.location.reload()
              }}
            >
              <RefreshCw size={14} />
              대시보드 새로고침하여 반영
            </button>
          )}

          <button
            type="button"
            className="sc-btn-secondary"
            onClick={onClose}
          >
            {isRunning ? '창 닫기 (백그라운드 유지)' : '닫기'}
          </button>
        </div>
      </footer>
    </dialog>
  )
}
