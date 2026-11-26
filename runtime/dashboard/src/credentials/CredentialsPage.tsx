import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ChevronRight, Cloud, Download, HardDrive, KeyRound, Lock, Plus, RefreshCw, Search, Server, ShieldCheck, TriangleAlert, Upload, X } from 'lucide-react'
import {
  ACTION_LABELS,
  CATEGORY_LABELS,
  EXPIRING_SOON_DAYS,
  KIND_LABELS,
  PLAN_CATALOG,
  PROVIDER_LABELS,
  STATE_LABELS,
  STATE_ORDER,
  STATUS_LABELS,
  credentialState,
  daysLeft,
  fieldsProblem,
  actorProblem,
  cleanFields,
  newCredential,
  todayString,
  ID_PATTERN,
  isGenerated,
  type CollectionCredential,
  type CredentialCategory,
  type CredentialChange,
  type CredentialFields,
  type CredentialKind,
  type CredentialProvider,
  type CredentialState,
  type CredentialStatus,
} from '../model/collectionCredential'
import { loadActor, saveActor } from '../exceptions/store'
import { formatDate, formatDateTime } from '../exceptions/format'
import { utcTitle } from '../utils/time'
import ProviderLogo from '../ProviderLogo'
import type { ProviderId } from '../providerOverviewData'
import { buildExport, previewImport, type CollectorStatus, type ImportPreview } from './store'
import type { CredentialsApi, NewCredential } from './useCredentials'
import {
  ChipGroup,
  DetailHead,
  HeadBadge,
  Hero,
  LiveCount,
  Segmented,
  detailHash,
  readListMemory,
  scrollBox,
  useDetailId,
  writeListMemory,
} from '../ui/ListScreen'
import { backOr, isListHash } from '../ui/backNav'

type ReadinessRow = CollectorStatus['credentials'][number]

const PROVIDERS = Object.keys(PROVIDER_LABELS) as CredentialProvider[]
const COMPLETENESS_LABELS: Record<string, string> = { full: '완료', partial: '일부', best_effort: '부분 수집', failed: '실패', skipped: '생략' }
const LOGO_OF: Partial<Record<CredentialProvider, ProviderId>> = { github: 'github', okta: 'okta', slack: 'slack', gws: 'google-workspace', salesforce: 'salesforce', atlassian: 'atlassian' }
const OVERDUE: CredentialState[] = ['expired', 'dispose_due']

/* 주소: 목록은 #adapters, 상세는 #adapters?id=<CRED-… / ACCT-…>. 옛 #credentials 주소는 appRouting이 바꾼다 */
const LIST_HASH = '#adapters'
const MEMORY_KEY = 'aegi.credentials.list'
type ListMemory = { scrollTop: number; lastId: string; category: CredentialCategory | 'all' }

export interface CredentialsPageProps {
  api: CredentialsApi
  now: Date
  /** 배포본에서 세션이 없을 때 — 실측으로 바꿔 팀 비밀번호 화면을 띄운다 */
  onLogin: () => void
  /** 목록 위에 그릴 화면 머리 (Adapters 화면 이름과 SaaS 연결 카드) */
  header: ReactNode
}

function SaasLogo({ provider }: { provider: CredentialProvider }) {
  const id = LOGO_OF[provider]
  return (
    <span className="lst-logo" title={PROVIDER_LABELS[provider]}>
      {id ? <ProviderLogo provider={id} /> : <Server size={16} strokeWidth={2} aria-hidden="true" />}
    </span>
  )
}

/** 만료, 폐기 기한 중 가까운 쪽을 크게. 사용 중일 때만 7일 안이나 지난 것을 빨강으로. */
function dueOf(c: CollectionCredential, now: Date) {
  const dates = [
    { label: '만료', date: c.expiresAt },
    { label: '폐기', date: c.disposeBy },
  ].flatMap(d => {
    const left = daysLeft(d.date, now)
    return d.date && left !== null ? [{ ...d, date: d.date, left }] : []
  })
  if (dates.length === 0) return null
  const near = dates.reduce((a, b) => (b.left < a.left ? b : a))
  const big = near.left < 0 ? `${-near.left}일 초과` : near.left === 0 ? '오늘' : `D-${near.left}`
  return { big, near, dates, alert: c.status === 'active' && near.left <= EXPIRING_SOON_DAYS }
}

/**
 * 수집 자격증명 · 계정 관리 (Adapters 화면 아래 칸, #adapters).
 *
 * 실측 수집기가 쓰는 자격증명(CRED-…)과 수집 때문에 만든 계정(ACCT-…)의 대장이다. 목록 위에 기한이 지난
 * 항목 수를 크게 두고, 상태와 SaaS 칩으로 거른다. 줄을 누르면 상세에서 발급 · 교체 · 폐기를 이력과 함께 남긴다.
 * dev 서버에서는 이 PC 의 `.env.collector` 가 채워졌는지와 마지막 수집 결과도 붙인다 (값은 보이지 않는다).
 */
export default function CredentialsPage({ api, now, onLogin, header }: CredentialsPageProps) {
  const { items, storage, status } = api
  const [openId, setOpenId] = useDetailId(LIST_HASH)
  const [category, setCategory] = useState<CredentialCategory | 'all'>(() => readListMemory<ListMemory>(MEMORY_KEY).category ?? 'all')
  const [lastId, setLastId] = useState(() => readListMemory<ListMemory>(MEMORY_KEY).lastId ?? '')
  const [providers, setProviders] = useState<CredentialProvider[]>([])
  const [states, setStates] = useState<CredentialState[]>([])
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<CollectionCredential | 'new' | null>(null)
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [seedActor, setSeedActor] = useState(loadActor)
  const [seedError, setSeedError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const pageRef = useRef<HTMLElement>(null)

  /* 이 PC 의 수집기 준비 상태는 .env.collector 가 있을 때만 줄마다 보인다. 대장만 보는 PC(수집기를 쓰지 않음)에서
     모든 줄에 「누락」이 뜨면 대장이 틀린 것처럼 보였다 — 그때는 머리 표시 하나만 둔다 */
  const pcStatus = status?.envFile ? status : null
  const readiness = useMemo(() => new Map((pcStatus?.credentials ?? []).map(r => [r.id, r])), [pcStatus])
  const stateOf = (c: CollectionCredential) => credentialState(c, now)

  const inCategory = items.filter(c => category === 'all' || c.category === category)
  const countState = new Map<CredentialState, number>()
  const countProvider = new Map<CredentialProvider, number>()
  for (const c of inCategory) {
    countState.set(stateOf(c), (countState.get(stateOf(c)) ?? 0) + 1)
    countProvider.set(c.provider, (countProvider.get(c.provider) ?? 0) + 1)
  }
  const overdue = items.filter(c => OVERDUE.includes(stateOf(c))).length

  const needle = query.trim().toLowerCase()
  const visible = inCategory
    .filter(c => !providers.length || providers.includes(c.provider))
    .filter(c => !states.length || states.includes(stateOf(c)))
    .filter(c => !needle || [c.id, c.name, c.principal, c.owner, c.storage, c.notes, ...c.permissions, ...c.envKeys, ...c.calls].some(t => t.toLowerCase().includes(needle)))
    .sort((a, b) => STATE_ORDER.indexOf(stateOf(a)) - STATE_ORDER.indexOf(stateOf(b)) || a.id.localeCompare(b.id))
  // 발급일이 하나도 없으면(이 PC 칸이 없을 때) 칸을 숨긴다
  const showIssued = !pcStatus && items.some(c => c.issuedAt)

  const opened = openId ? items.find(c => c.id === openId) : undefined

  // 뒤로 가기 등으로 다른 항목이나 목록으로 가면 열려 있던 수정 창을 닫는다
  useEffect(() => {
    setEditing(prev => (prev === 'new' ? prev : null))
  }, [openId])

  // 목록이 보일 때: 보던 자리로 되돌리고, 굴릴 때마다 적어 둔다.
  useLayoutEffect(() => {
    if (opened) return
    const box = scrollBox(pageRef.current)
    box.scrollTop = readListMemory<ListMemory>(MEMORY_KEY).scrollTop ?? 0
    const recent = lastId ? pageRef.current?.querySelector<HTMLElement>(`[data-cred-id="${CSS.escape(lastId)}"]`) : null
    recent?.scrollIntoView({ block: 'nearest' })
    let frame = 0
    const target: HTMLElement | Window = box === document.scrollingElement ? window : box
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => writeListMemory<ListMemory>(MEMORY_KEY, { scrollTop: box.scrollTop }))
    }
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      target.removeEventListener('scroll', onScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(opened)])

  // 상세는 맨 위부터.
  useLayoutEffect(() => {
    if (opened) scrollBox(pageRef.current).scrollTop = 0
  }, [opened])

  const changeCategory = (next: CredentialCategory | 'all') => {
    setCategory(next)
    writeListMemory<ListMemory>(MEMORY_KEY, { category: next })
  }

  const openItem = (id: string, replace = false) => {
    if (!opened) writeListMemory<ListMemory>(MEMORY_KEY, { scrollTop: scrollBox(pageRef.current).scrollTop })
    writeListMemory<ListMemory>(MEMORY_KEY, { lastId: id })
    setLastId(id)
    setOpenId(id)
    setEditing(null)
    // 이전 · 다음은 방문 기록을 쌓지 않는다. 뒤로 가기 한 번이면 목록이다.
    if (replace) window.history.replaceState(window.history.state, '', detailHash(LIST_HASH, id))
    else window.location.hash = detailHash(LIST_HASH, id)
  }

  /* 목록에서 열었으면 브라우저 뒤로 가기로 돌아가 기록을 쌓지 않는다 */
  const backToList = () => {
    setEditing(null)
    backOr(isListHash(LIST_HASH, 'id'), () => {
      setOpenId('')
      window.location.hash = LIST_HASH
    })
  }

  const missingSeeds = PLAN_CATALOG.filter(s => !items.some(i => i.id === s.id))
  const loadSeeds = () => {
    // 다른 창과 같이 칸 아래에 오류를 보인다 (전에는 브라우저 경고 창)
    const problem = actorProblem(seedActor)
    setSeedError(problem)
    if (problem) return
    saveActor(seedActor.trim())
    const at = new Date().toISOString()
    void api.importItems(missingSeeds.map(s => newCredential(s, seedActor, at, 'imported', '계획서 V2 4.1절 기본 목록')))
  }

  const exportFile = () => {
    const blob = new Blob([JSON.stringify(buildExport(items, new Date()), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aegi-collection-credentials-${todayString(new Date())}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const readImport = async (file: File) => setImportPreview(previewImport(await file.text(), new Set(items.map(i => i.id))))

  if (storage === 'locked') {
    return (
      <main className="page credentials-page lst-page">
        {header}
        <section className="panel cr-locked">
          <Lock size={20} strokeWidth={1.75} />
          <div>
            <h3>팀원 전용</h3>
            <p>수집 자격증명 대장은 실측 데이터와 같은 팀 비밀번호로 보호. 실측 데이터셋으로 바꾸면 비밀번호 화면 표시</p>
            <button type="button" className="ex-btn primary" onClick={onLogin}>
              팀 비밀번호로 로그인
            </button>
          </div>
        </section>
      </main>
    )
  }

  const storageBadge =
    storage === 'remote' ? (
      <HeadBadge icon={<Cloud size={14} strokeWidth={2} />} title="팀 공용 저장소 D1에 저장. 같은 팀 비밀번호로 로그인한 사람은 모두 같은 대장 열람">
        팀 공용 저장소
        <button type="button" className="lst-icon-btn" aria-label="다시 불러오기" title="다시 불러오기" onClick={api.refresh}>
          <RefreshCw size={13} strokeWidth={2} />
        </button>
      </HeadBadge>
    ) : (
      <HeadBadge
        icon={<HardDrive size={14} strokeWidth={2} />}
        title={
          storage === 'local-fallback'
            ? '팀 공용 저장소가 없어 이 브라우저에 저장 중'
            : '이 브라우저에 저장. 팀원과 공유하려면 내보낸 파일을 상대가 가져오기'
        }
      >
        이 브라우저
        {storage === 'local' && (
          <button type="button" className="lst-icon-btn" aria-label="수집기 상태 다시 읽기" title="수집기 상태 다시 읽기" onClick={api.refresh}>
            <RefreshCw size={13} strokeWidth={2} />
          </button>
        )}
      </HeadBadge>
    )
  const pcBadge = status && (
    <HeadBadge icon={<KeyRound size={14} strokeWidth={2} />} title={collectorTitle(status)}>
      .env.collector {status.envFile ? '있음' : '없음'}
    </HeadBadge>
  )

  const banners = (
    <>
      {api.warning && (
        <p className="ex-banner warn" role="status">
          <TriangleAlert size={14} strokeWidth={2} /> {api.warning}
        </p>
      )}
      {api.notice && (
        <p className={`ex-banner ${api.notice.ok ? 'info' : 'warn'} cr-notice`} role="status">
          {api.notice.ok ? <ShieldCheck size={14} strokeWidth={2} /> : <TriangleAlert size={14} strokeWidth={2} />} {api.notice.text}
          <button type="button" className="ex-icon-btn" aria-label="알림 닫기" onClick={api.clearNotice}>
            <X size={14} strokeWidth={2} />
          </button>
        </p>
      )}
      {status?.envFile && status.callsProblem && (
        <p className="ex-banner warn" role="status">
          <TriangleAlert size={14} strokeWidth={2} /> {status.callsProblem}
        </p>
      )}
    </>
  )

  const form = editing && (
    <CredentialForm
      key={editing === 'new' ? 'new' : `edit-${editing.id}`}
      initial={editing === 'new' ? null : editing}
      existingIds={new Set(items.map(i => i.id))}
      onCancel={() => setEditing(null)}
      onSubmit={async (draft, actor) => {
        const ok =
          editing === 'new'
            ? await api.create(draft, actor)
            : await api.change(editing.id, { type: 'edit', fields: stripId(draft) }, actor)
        if (ok) {
          setEditing(null)
          if (editing === 'new') openItem(draft.id.toUpperCase())
        }
      }}
    />
  )

  if (opened) {
    // 이전 · 다음은 목록에 보이던 순서를 따른다. 거르기로 빠진 항목을 열었으면 전체 순서를 쓴다.
    const order = visible.some(c => c.id === opened.id) ? visible : [...items].sort((a, b) => STATE_ORDER.indexOf(stateOf(a)) - STATE_ORDER.indexOf(stateOf(b)) || a.id.localeCompare(b.id))
    const index = order.findIndex(c => c.id === opened.id)
    const prev = order[index - 1]
    const next = order[index + 1]
    return (
      <main className="page credentials-page lst-page is-detail" ref={pageRef}>
        <DetailHead
          title="수집 자격증명 상세"
          index={index + 1}
          total={order.length}
          back="Adapters"
          unit="항목"
          onBack={backToList}
          onPrev={prev ? () => openItem(prev.id, true) : undefined}
          onNext={next ? () => openItem(next.id, true) : undefined}
        />
        {banners}
        {editing && editing !== 'new' && editing.id === opened.id && form}
        <CredentialDetail
          key={`detail-${opened.id}`}
          item={opened}
          state={stateOf(opened)}
          ready={readiness.get(opened.id)}
          pc={!!pcStatus}
          now={now}
          api={api}
          onEdit={() => setEditing(opened)}
          onOpen={id => openItem(id)}
          onRemoved={backToList}
          knownIds={new Set(items.map(i => i.id))}
        />
      </main>
    )
  }

  return (
    <main className="page credentials-page lst-page" ref={pageRef}>
      {header}

      {/* 제목 줄에는 제목만. 저장 위치, 수집기 상태, 단추, 기본 목록 넣기는 흰 칸 하나에 */}
      <div className="lst-actionbar">
        <div className="lst-actionbar-row">
          {storageBadge}
          {pcBadge}
          <div className="lst-actionbar-end">
            <button type="button" className="ex-btn primary" onClick={() => setEditing('new')}>
              <Plus size={14} strokeWidth={2} /> 새 항목
            </button>
            <button type="button" className="ex-btn" onClick={exportFile} disabled={items.length === 0}>
              <Download size={14} strokeWidth={2} /> 내보내기
            </button>
            <button type="button" className="ex-btn" onClick={() => fileInput.current?.click()}>
              <Upload size={14} strokeWidth={2} /> 가져오기
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={event => {
                const file = event.target.files?.[0]
                if (file) void readImport(file)
                event.target.value = ''
              }}
            />
          </div>
        </div>
      {!api.loading && missingSeeds.length > 0 && (
        <section className="lst-actionbar-row cr-seed-line" aria-label="기본 목록 넣기">
          <b title={`계획서 V2 4.1절: ${missingSeeds.map(s => s.id).join(', ')}`}>기본 목록 {missingSeeds.length}건</b>
          <div className="cr-seed-body">
            <label className="cr-inline-field">
              <span>처리자</span>
              <input
                className="ex-input"
                value={seedActor}
                maxLength={60}
                placeholder="이름"
                aria-invalid={seedError ? true : undefined}
                aria-describedby={seedError ? 'cr-seed-error' : undefined}
                onChange={e => {
                  setSeedActor(e.target.value)
                  setSeedError(null)
                }}
              />
            </label>
            <button type="button" className="ex-btn primary" onClick={loadSeeds}>
              넣기
            </button>
            {seedError && (
              <p id="cr-seed-error" className="ex-errors-inline cr-seed-error" role="alert">
                {seedError}
              </p>
            )}
          </div>
        </section>
      )}
      </div>

      {banners}

      {api.loading && <p className="lst-note">팀 공용 저장소에서 대장을 불러오는 중…</p>}

      {importPreview && (
        <section className="panel ex-import" aria-label="가져오기 미리보기">
          <div className="panel-head">
            <h3>가져오기 미리보기</h3>
            <button type="button" className="ex-icon-btn" aria-label="닫기" onClick={() => setImportPreview(null)}>
              <X size={14} strokeWidth={2} />
            </button>
          </div>
          <div className="ex-import-body">
            {importPreview.error ? (
              <p className="ex-errors-inline">{importPreview.error}</p>
            ) : (
              <>
                <p>
                  가져올 항목 <b>{importPreview.accepted.length}</b>건, 제외 항목 <b>{importPreview.skipped.length}</b>건
                </p>
                {importPreview.droppedFields.length > 0 && (
                  <p>
                    대장에 없는 칸은 제외:{' '}
                    {importPreview.droppedFields.slice(0, 6).map((key, i) => (
                      <Fragment key={key}>
                        {i > 0 && ', '}
                        <code>{key}</code>
                      </Fragment>
                    ))}
                    {importPreview.droppedFields.length > 6 ? ` 외 ${importPreview.droppedFields.length - 6}개` : ''}
                  </p>
                )}
                {importPreview.skipped.length > 0 && (
                  <ul className="ex-import-skipped">
                    {importPreview.skipped.map((s, i) => (
                      <li key={`${s.id ?? 'unknown'}-${i}`}>
                        <code>{s.id ?? 'ID 없음'}</code> {s.reason}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="ex-actions">
                  <button type="button" className="ex-btn" onClick={() => setImportPreview(null)}>
                    취소
                  </button>
                  <button
                    type="button"
                    className="ex-btn primary"
                    disabled={importPreview.accepted.length === 0}
                    onClick={() => {
                      void api.importItems(importPreview.accepted)
                      setImportPreview(null)
                    }}
                  >
                    {importPreview.accepted.length}건 가져오기
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {editing === 'new' && form}

      <div className="lst-toolbar">
        <Segmented
          label="분류"
          items={(['all', 'credential', 'account'] as const).map(key => ({
            key,
            label: key === 'all' ? '전체' : CATEGORY_LABELS[key],
            count: key === 'all' ? items.length : items.filter(i => i.category === key).length,
          }))}
          value={category}
          onChange={changeCategory}
        />
        <Hero label="기한 초과" count={overdue} unit="건" onClick={() => { changeCategory('all'); setStates(OVERDUE) }} none="기한 초과 항목 없음" />
      </div>

      <div className="ti-filterbar ti-filterbar-stack lst-filters">
        <div className="ti-filter-row">
          <div className="ti-search">
            <Search size={14} strokeWidth={2} aria-hidden="true" />
            <input type="search" value={query} placeholder="ID, 이름, 주체, scope, 변수 이름 검색" aria-label="대장 검색" onChange={e => setQuery(e.target.value)} />
            {query && (
              <button type="button" className="ti-search-clear" aria-label="검색어 지우기" onClick={() => setQuery('')}>
                <X size={13} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
        <ChipGroup
          legend="상태"
          items={STATE_ORDER.map(key => ({
            key,
            label: STATE_LABELS[key],
            count: countState.get(key) ?? 0,
            alert: key === 'expired' || key === 'dispose_due' || key === 'expiring',
          }))}
          isOn={key => states.includes(key)}
          onToggle={key => setStates(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))}
        />
        <ChipGroup
          legend="SaaS"
          items={PROVIDERS.map(key => ({
            key,
            label: LOGO_OF[key] ? <ProviderLogo provider={LOGO_OF[key]!} /> : <Server size={14} strokeWidth={2} />,
            count: countProvider.get(key) ?? 0,
            logo: true,
            title: PROVIDER_LABELS[key],
            ariaLabel: `${PROVIDER_LABELS[key]} ${countProvider.get(key) ?? 0}건`,
          }))}
          isOn={key => providers.includes(key)}
          onToggle={key => setProviders(prev => (prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key]))}
        />
      </div>

      <section aria-label="자격증명, 계정 목록">
        {visible.length === 0 ? (
          <p className="lst-empty">{items.length ? '조건에 맞는 항목 없음' : '등록한 항목 없음'}</p>
        ) : (
          <>
            <div className={`lst-head cr-grid ${pcStatus || showIssued ? 'has-extra' : ''}`} aria-hidden="true">
              <span>이름</span>
              <span>ID</span>
              <span>유형</span>
              <span>상태</span>
              <span>만료, 폐기 기한</span>
              {(pcStatus || showIssued) && <span>{pcStatus ? '이 PC' : '발급'}</span>}
              <span />
            </div>
            <LiveCount count={visible.length} noun="수집 자격증명" unit="개" />
            <div className="lst-list">
              {visible.map(c => {
                const state = stateOf(c)
                const due = dueOf(c, now)
                const ready = readiness.get(c.id)
                return (
                  <button
                    type="button"
                    key={c.id}
                    data-cred-id={c.id}
                    className={`lst-row cr-grid ${pcStatus || showIssued ? 'has-extra' : ''} ${c.id === lastId ? 'is-recent' : ''}`}
                    onClick={() => openItem(c.id)}
                  >
                    <span className="cr-name-cell">
                      <SaasLogo provider={c.provider} />
                      <span className="lst-main">
                        <b>{c.name}</b>
                        {c.principal && <span className="lst-text">{c.principal}</span>}
                      </span>
                    </span>
                    <code className="cr-id">{c.id}</code>
                    <span className="lst-text">{CATEGORY_LABELS[c.category]}, {KIND_LABELS[c.kind]}</span>
                    <span className={`lst-status ${OVERDUE.includes(state) || state === 'expiring' ? 'is-alert' : ''}`}>{STATE_LABELS[state]}</span>
                    {due ? (
                      <span className={`lst-due ${due.alert ? 'is-alert' : ''}`}>
                        <b>{due.big}</b>
                        <span>{due.dates.map(d => `${d.label} ${d.date}`).join(', ')}</span>
                      </span>
                    ) : (
                      <span className="lst-text">—</span>
                    )}
                    {pcStatus ? (
                      <span className="lst-text">{c.envKeys.length === 0 && !ready ? '—' : <ReadyText row={ready} active={c.status === 'active'} />}</span>
                    ) : (
                      showIssued && <span className="lst-text">{c.issuedAt ?? '—'}</span>
                    )}
                    <ChevronRight className="lst-row-go" size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                )
              })}
            </div>
          </>
        )}
      </section>
    </main>
  )
}

const stripId = (draft: NewCredential): Partial<CredentialFields> => {
  const { id: _id, status: _status, ...fields } = draft
  return fields
}

/** 머리 표시에 커서를 올리면 뜨는 이 PC 수집기 상태 (값은 보이지 않는다) */
function collectorTitle(status: CollectorStatus): string {
  if (!status.envFile) return '이 PC에 .env.collector가 없어 줄마다 빠진 값, 마지막 수집 같은 준비 상태 미표시. 수집하는 PC에서 열면 표시'
  return [
    '이 PC 수집기: .env.collector 있음',
    `수집 설정 ${status.configFile ? '있음' : '없음'}`,
    `실행 기록 ${status.runs}건`,
    status.lastRun ? `마지막 수집 ${formatDateTime(status.lastRun.at)}` : '',
  ]
    .filter(Boolean)
    .join(', ')
}

function ReadyText({ row, active }: { row?: ReadinessRow; active: boolean }) {
  if (!row) return <>미등록 ID</>
  if (row.ready) return <>설정됨</>
  const missing = row.keys.filter(k => !k.set).length
  return <b className={active ? 'cr-bad' : ''}>누락 {missing}</b>
}

// ---------------------------------------------------------------------------
// 상세
// ---------------------------------------------------------------------------

type ActionKind = 'activate' | 'rotate' | 'revoke' | 'restore'

function CredentialDetail({
  item,
  state,
  ready,
  pc,
  now,
  api,
  onEdit,
  onOpen,
  onRemoved,
  knownIds,
}: {
  item: CollectionCredential
  state: CredentialState
  ready?: ReadinessRow
  pc: boolean
  now: Date
  api: CredentialsApi
  onEdit: () => void
  onOpen: (id: string) => void
  onRemoved: () => void
  knownIds: Set<string>
}) {
  const [action, setAction] = useState<ActionKind | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const calls = ready?.calls ?? []
  const extraCalls = item.calls.filter(id => !calls.some(c => c.id === id))
  const due = dueOf(item, now)
  const alert = OVERDUE.includes(state) || state === 'expiring'
  return (
    <section className="lst-panel cr-detail-panel">
      <div className="lst-dhead">
        <div className="lst-dhead-main">
          <h2 className="lst-name">
            <SaasLogo provider={item.provider} /> {item.name}
          </h2>
          <dl className="lst-meta">
            <div><dt>ID</dt><dd><code>{item.id}</code></dd></div>
            <div><dt>SaaS</dt><dd>{PROVIDER_LABELS[item.provider]}</dd></div>
            <div><dt>유형</dt><dd>{CATEGORY_LABELS[item.category]}, {KIND_LABELS[item.kind]}</dd></div>
            <div><dt>상태</dt><dd className={alert ? 'cr-bad' : ''}>{STATE_LABELS[state]}</dd></div>
          </dl>
        </div>
        <div className="lst-dside">
          <p className={`lst-big ${due?.alert ? 'is-alert' : ''}`}>{due ? due.big : '기한 없음'}</p>
          {due && <p className="lst-big-sub">{due.near.date} {due.near.label === '만료' ? '만료' : '폐기 예정'}</p>}
        </div>
      </div>

      <div className="lst-dgrid">
        <section>
          <h3 className="lst-h3">기본 정보</h3>
          <dl className="lst-dl">
            <dt>주체, 계정</dt><dd>{item.principal || '—'}</dd>
            <dt>발급, 관리</dt><dd>{item.owner || '—'}</dd>
            <dt>비밀값 보관 위치</dt><dd>{item.storage || '—'}</dd>
            <dt>발급일</dt><dd>{item.issuedAt ?? '—'}</dd>
            <dt>만료일</dt><dd>{item.expiresAt ?? '없음'}</dd>
            <dt>폐기 예정, 방법</dt><dd>{item.disposeBy ?? '—'}{item.disposal ? `, ${item.disposal}` : ''}</dd>
            <dt>기록 상태</dt><dd>{STATUS_LABELS[item.status]}{item.revokedAt ? `, ${formatDateTime(item.revokedAt)} ${item.revokedBy ?? ''}` : ''}</dd>
            {item.related.length > 0 && (
              <>
                <dt>관련 항목</dt>
                <dd className="lst-codes">
                  {item.related.map(id =>
                    knownIds.has(id) ? (
                      <button type="button" key={id} className="lst-link" onClick={() => onOpen(id)}>{id}</button>
                    ) : (
                      <code key={id}>{id}</code>
                    )
                  )}
                </dd>
              </>
            )}
            {item.notes && (<><dt>메모</dt><dd>{item.notes}</dd></>)}
          </dl>
        </section>

        <section>
          <h3 className="lst-h3">권한, scope</h3>
          {item.permissions.length ? (
            <ul className="lst-plain">{item.permissions.map(p => <li key={p}>{p}</li>)}</ul>
          ) : (
            <p className="lst-none">적힌 권한 없음</p>
          )}

          <h3 className="lst-h3">환경 변수 <small><code>.env.collector</code></small></h3>
          {ready ? (
            <ul className="lst-plain">
              {ready.keys.map(k => (
                <li key={k.name} className={k.set ? '' : 'is-bad'}>
                  <code>{k.name}</code> {k.set ? (k.source === 'file' ? '파일에서 읽음' : '설정됨') : k.source === 'file_unreadable' ? '파일 읽기 실패' : '비어 있음'}
                </li>
              ))}
            </ul>
          ) : item.envKeys.length ? (
            <ul className="lst-plain">{item.envKeys.map(k => <li key={k}><code>{k}</code></li>)}</ul>
          ) : (
            <p className="lst-none">없음</p>
          )}
          {pc && !ready && item.envKeys.length > 0 && <p className="lst-none">미등록 ID</p>}
        </section>
      </div>

      {(calls.length > 0 || extraCalls.length > 0) && (
        <section className="lst-hist">
          <h3 className="lst-h3">
            수집 호출 {calls.length + extraCalls.length}개
            {ready?.lastUsedAt && <small>마지막 사용 {formatDateTime(ready.lastUsedAt)}</small>}
          </h3>
          <table className="lst-table">
            <thead><tr><th scope="col">호출</th><th scope="col">내용</th><th scope="col">마지막 결과</th></tr></thead>
            <tbody>
              {calls.map(c => (
                <tr key={c.id} className={c.last && c.last.completeness !== 'full' ? 'is-changed' : ''}>
                  <td><code>{c.id}</code></td>
                  <td>{c.title}</td>
                  <td>
                    {c.last ? (
                      <>
                        <span className={`collect-stat is-${c.last.completeness === 'full' ? 'full' : c.last.completeness === 'failed' ? 'fail' : 'partial'}`}>
                          {COMPLETENESS_LABELS[c.last.completeness] ?? c.last.completeness}
                        </span>
                        {`, ${formatDate(c.last.at)}`}
                      </>
                    ) : '실행 기록 없음'}
                    {(c.unavailable || (c.last?.reasons.length ?? 0) > 0) && <div>{c.unavailable ?? c.last?.reasons.join(', ')}</div>}
                  </td>
                </tr>
              ))}
              {extraCalls.map(id => (
                <tr key={id}>
                  <td><code>{id}</code></td>
                  <td>대장에 적은 호출</td>
                  <td>—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="lst-hist">
        <h3 className="lst-h3">이력</h3>
        <ol>
          {[...item.history].reverse().map((h, i) => (
            <li key={`${h.at}-${i}`}>
              <time title={utcTitle(h.at)}>{formatDateTime(h.at)}</time>
              <b>{ACTION_LABELS[h.action]}</b>
              {h.actor && <span>{h.actor}</span>}
              {h.note && <span>{h.note}</span>}
            </li>
          ))}
        </ol>
      </section>

      <div className="lst-actions">
        {action ? (
          <ActionForm
            kind={action}
            item={item}
            now={now}
            onCancel={() => setAction(null)}
            onConfirm={async (change, actor) => {
              if (await api.change(item.id, change, actor)) setAction(null)
            }}
          />
        ) : confirmingDelete ? (
          <div className="cr-delete-confirm" role="group" aria-label="삭제 확인">
            <p>
              <b>{item.id}</b>를 대장에서 삭제. 발급 전 항목이라 이력 없이 삭제. 쓰던 항목이면 「폐기」로 기록
            </p>
            <div className="ex-actions">
              <button type="button" className="ex-btn" autoFocus onClick={() => setConfirmingDelete(false)}>
                취소
              </button>
              <button
                type="button"
                className="ex-btn danger"
                onClick={() => {
                  setConfirmingDelete(false)
                  void api.remove(item.id).then(onRemoved)
                }}
              >
                삭제
              </button>
            </div>
          </div>
        ) : isGenerated(item) ? (
          <p className="cr-generated">자동 생성 항목. 환경 정의를 고치면 다음 동기화에 반영</p>
        ) : (
          <div className="ex-actions">
            {item.status !== 'revoked' && <button type="button" className="ex-btn" onClick={onEdit}>수정</button>}
            {item.status === 'planned' && <button type="button" className="ex-btn primary" onClick={() => setAction('activate')}>발급 처리</button>}
            {item.status === 'active' && <button type="button" className="ex-btn" onClick={() => setAction('rotate')}>교체</button>}
            {item.status !== 'revoked' && <button type="button" className="ex-btn danger" onClick={() => setAction('revoke')}>폐기</button>}
            {item.status === 'revoked' && <button type="button" className="ex-btn" onClick={() => setAction('restore')}>복원</button>}
            {item.status === 'planned' && (
              <button type="button" className="ex-btn danger" onClick={() => setConfirmingDelete(true)}>
                삭제
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

const ACTION_TEXT: Record<ActionKind, { title: string; help: string; confirm: string }> = {
  activate: { title: '발급 처리', help: '실제로 발급했으면 발급일과 만료일 기록. 값은 .env.collector나 팀 비밀 보관소에 보관', confirm: '발급 처리' },
  rotate: { title: '교체', help: '비밀값을 새로 발급해 바꿨을 때 기록. 옛 값은 SaaS에서 먼저 폐기', confirm: '교체' },
  revoke: { title: '폐기', help: 'SaaS에서 토큰 삭제, scope 회수, 계정 정지 등을 마친 뒤 한 일을 기록. 기록은 삭제하지 않고 보존', confirm: '폐기로 표시' },
  restore: { title: '복원', help: '폐기로 잘못 표시했거나 다시 발급해 쓰게 됐을 때.', confirm: '복원' },
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return todayString(new Date(y, m - 1, d + days))
}

function ActionForm({
  kind,
  item,
  now,
  onCancel,
  onConfirm,
}: {
  kind: ActionKind
  item: CollectionCredential
  now: Date
  onCancel: () => void
  onConfirm: (change: CredentialChange, actor: string) => Promise<void>
}) {
  const today = todayString(now)
  const [actor, setActor] = useState(loadActor)
  const [issuedAt, setIssuedAt] = useState(today)
  const [expiresAt, setExpiresAt] = useState(item.kind === 'personal_token' ? addDays(today, 7) : '')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const text = ACTION_TEXT[kind]
  const withDates = kind === 'activate' || kind === 'rotate'

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = actorProblem(actor) ?? (kind === 'revoke' && !note.trim() ? '무엇을 폐기했는지 적어 주세요' : null) ?? (withDates ? fieldsProblem({ issuedAt: issuedAt || null, expiresAt: expiresAt || null }) : null)
    if (problem) return setError(problem)
    saveActor(actor.trim())
    const change: CredentialChange =
      kind === 'activate'
        ? { type: 'activate', issuedAt: issuedAt || null, expiresAt: expiresAt || null, note }
        : kind === 'rotate'
          ? { type: 'rotate', issuedAt, expiresAt: expiresAt || null, note }
          : { type: kind, note }
    setBusy(true)
    await onConfirm(change, actor)
    setBusy(false)
  }

  return (
    <form className="cr-action-form" onSubmit={submit}>
      <h4 title={text.help}>{text.title}</h4>
      <div className="cr-form-grid">
        {withDates && (
          <>
            <label>
              <span>발급일</span>
              <input className="ex-input" type="date" value={issuedAt} onChange={e => setIssuedAt(e.target.value)} required={kind === 'rotate'} />
            </label>
            <label>
              <span>만료일, 없으면 비움</span>
              <input className="ex-input" type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
            </label>
          </>
        )}
        <label>
          <span>처리자</span>
          <input className="ex-input" value={actor} maxLength={60} onChange={e => setActor(e.target.value)} />
        </label>
        <label className="wide">
          <span>{kind === 'revoke' ? '폐기 내용, 필수' : '메모'}</span>
          <input className="ex-input" value={note} maxLength={500} placeholder={kind === 'revoke' ? item.disposal : ''} onChange={e => setNote(e.target.value)} />
        </label>
      </div>
      {error && <p className="ex-errors-inline">{error}</p>}
      <div className="ex-actions">
        <button type="button" className="ex-btn" onClick={onCancel}>취소</button>
        <button type="submit" className={`ex-btn ${kind === 'revoke' ? 'danger' : 'primary'}`} disabled={busy}>{text.confirm}</button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// 등록 · 수정 창
// ---------------------------------------------------------------------------

const lines = (s: string) => s.split(/\r?\n|,(?![^()]*\))/).map(x => x.trim()).filter(Boolean)

function CredentialForm({
  initial,
  existingIds,
  onCancel,
  onSubmit,
}: {
  initial: CollectionCredential | null
  existingIds: Set<string>
  onCancel: () => void
  onSubmit: (draft: NewCredential, actor: string) => Promise<void>
}) {
  const [f, setF] = useState(() => ({
    id: initial?.id ?? '',
    status: (initial?.status ?? 'planned') as CredentialStatus,
    category: initial?.category ?? ('credential' as CredentialCategory),
    provider: initial?.provider ?? ('github' as CredentialProvider),
    kind: initial?.kind ?? ('api_token' as CredentialKind),
    name: initial?.name ?? '',
    principal: initial?.principal ?? '',
    owner: initial?.owner ?? '',
    permissions: (initial?.permissions ?? []).join('\n'),
    envKeys: (initial?.envKeys ?? []).join('\n'),
    storage: initial?.storage ?? '',
    calls: (initial?.calls ?? []).join(', '),
    related: (initial?.related ?? []).join(', '),
    issuedAt: initial?.issuedAt ?? '',
    expiresAt: initial?.expiresAt ?? '',
    disposeBy: initial?.disposeBy ?? '',
    disposal: initial?.disposal ?? '',
    notes: initial?.notes ?? '',
  }))
  const [actor, setActor] = useState(loadActor)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof f>(key: K, value: (typeof f)[K]) => setF(prev => ({ ...prev, [key]: value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const id = f.id.trim().toUpperCase()
    const draft: NewCredential = cleanFields({
      id,
      status: f.status,
      category: f.category,
      provider: f.provider,
      kind: f.kind,
      name: f.name,
      principal: f.principal,
      owner: f.owner,
      permissions: f.permissions.split(/\r?\n/).map(s => s.trim()).filter(Boolean),
      envKeys: lines(f.envKeys),
      storage: f.storage,
      calls: lines(f.calls),
      related: lines(f.related).map(s => s.toUpperCase()),
      issuedAt: f.issuedAt || null,
      expiresAt: f.expiresAt || null,
      disposeBy: f.disposeBy || null,
      disposal: f.disposal,
      notes: f.notes,
    })
    const problem =
      (!initial && !ID_PATTERN.test(id) ? 'ID 형식: CRED-GH-03, ACCT-SL-02' : null) ??
      (!initial && existingIds.has(id) ? `이미 있는 ID: ${id}` : null) ??
      actorProblem(actor) ??
      fieldsProblem(draft)
    if (problem) return setError(problem)
    saveActor(actor.trim())
    setBusy(true)
    await onSubmit(draft, actor)
    setBusy(false)
  }

  return (
    <section className="panel cr-form" aria-label={initial ? '항목 수정' : '새 항목'}>
      <div className="panel-head">
        <h3>{initial ? `${initial.id} 수정` : '새 자격증명, 계정'}</h3>
        <button type="button" className="ex-icon-btn" aria-label="닫기" onClick={onCancel}>
          <X size={14} strokeWidth={2} />
        </button>
      </div>
      <form className="cr-form-body" onSubmit={submit}>
        <p className="cr-secret-note small">
          <ShieldCheck size={13} strokeWidth={2} /> 토큰, 키 값 입력 금지. 환경 변수는 <b>이름</b>만, 보관은 <b>위치</b>만 기록
        </p>
        <div className="cr-form-grid">
          <label>
            <span>ID</span>
            <input className="ex-input" value={f.id} disabled={!!initial} placeholder="CRED-GH-03" onChange={e => set('id', e.target.value)} />
          </label>
          {!initial && (
            <label>
              <span>상태</span>
              <select className="ex-select" value={f.status} onChange={e => set('status', e.target.value as CredentialStatus)}>
                <option value="planned">{STATUS_LABELS.planned}</option>
                <option value="active">{STATUS_LABELS.active}</option>
              </select>
            </label>
          )}
          <label>
            <span>분류</span>
            <select className="ex-select" value={f.category} onChange={e => set('category', e.target.value as CredentialCategory)}>
              {(Object.keys(CATEGORY_LABELS) as CredentialCategory[]).map(k => <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>)}
            </select>
          </label>
          <label>
            <span>SaaS</span>
            <select className="ex-select" value={f.provider} onChange={e => set('provider', e.target.value as CredentialProvider)}>
              {PROVIDERS.map(k => <option key={k} value={k}>{PROVIDER_LABELS[k]}</option>)}
            </select>
          </label>
          <label>
            <span>유형</span>
            <select className="ex-select" value={f.kind} onChange={e => set('kind', e.target.value as CredentialKind)}>
              {(Object.keys(KIND_LABELS) as CredentialKind[]).map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
          </label>
          <label className="wide">
            <span>이름</span>
            <input className="ex-input" value={f.name} maxLength={200} placeholder="예: GitHub App aegi-collector 조직 설치" onChange={e => set('name', e.target.value)} />
          </label>
          <label className="wide">
            <span>주체, 계정</span>
            <input className="ex-input" value={f.principal} maxLength={200} placeholder="예: 서비스 계정 collector@… , 봇 사용자" onChange={e => set('principal', e.target.value)} />
          </label>
          <label>
            <span>발급, 관리 책임</span>
            <input className="ex-input" value={f.owner} maxLength={200} onChange={e => set('owner', e.target.value)} />
          </label>
          <label>
            <span>비밀값 보관 위치</span>
            <input className="ex-input" value={f.storage} maxLength={200} placeholder="팀 비밀 보관소, .env.collector" onChange={e => set('storage', e.target.value)} />
          </label>
          <label className="wide">
            <span>권한, scope 한 줄에 하나씩</span>
            <textarea className="ex-input" rows={4} value={f.permissions} onChange={e => set('permissions', e.target.value)} />
          </label>
          <label>
            <span>환경 변수 이름, 쉼표나 줄바꿈으로 구분</span>
            <textarea className="ex-input" rows={3} value={f.envKeys} placeholder="GITHUB_OWNER_TOKEN" onChange={e => set('envKeys', e.target.value)} />
          </label>
          <label>
            <span>수집 호출, 관련 ID</span>
            <input className="ex-input" value={f.calls} placeholder="호출: GH-20, GH-22" onChange={e => set('calls', e.target.value)} />
            <input className="ex-input" value={f.related} placeholder="관련: ACCT-GW-01" onChange={e => set('related', e.target.value)} />
          </label>
          <label>
            <span>발급일</span>
            <input className="ex-input" type="date" value={f.issuedAt} onChange={e => set('issuedAt', e.target.value)} />
          </label>
          <label>
            <span>만료일</span>
            <input className="ex-input" type="date" value={f.expiresAt} onChange={e => set('expiresAt', e.target.value)} />
          </label>
          <label>
            <span>폐기 예정일</span>
            <input className="ex-input" type="date" value={f.disposeBy} onChange={e => set('disposeBy', e.target.value)} />
          </label>
          <label>
            <span>폐기 방법</span>
            <input className="ex-input" value={f.disposal} maxLength={200} placeholder="App 제거, scope 회수" onChange={e => set('disposal', e.target.value)} />
          </label>
          <label className="wide">
            <span>메모</span>
            <textarea className="ex-input" rows={2} value={f.notes} maxLength={1000} onChange={e => set('notes', e.target.value)} />
          </label>
          <label>
            <span>처리자</span>
            <input className="ex-input" value={actor} maxLength={60} onChange={e => setActor(e.target.value)} />
          </label>
        </div>
        {error && <p className="ex-errors-inline">{error}</p>}
        <div className="ex-actions">
          <button type="button" className="ex-btn" onClick={onCancel}>취소</button>
          <button type="submit" className="ex-btn primary" disabled={busy}>{initial ? '저장' : '등록'}</button>
        </div>
      </form>
    </section>
  )
}
