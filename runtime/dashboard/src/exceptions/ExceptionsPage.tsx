import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Cloud, CloudUpload, Download, HardDrive, RefreshCw, Search, TriangleAlert, Upload, X } from 'lucide-react'
import {
  approverProblem,
  approverRequired,
  decisionKeyOf,
  DEFAULT_EXPIRY_DAYS,
  EXPIRING_SOON_DAYS,
  expiryRestricted,
  MIN_REASON_LENGTH,
  REASON_LABELS,
  SCOPE_LABELS,
  validateExpiry,
  daysUntil,
  type ExceptionDataset,
  type ExceptionReasonCategory,
  type ExceptionScope,
  type ThreatException,
} from '../model/exception'
import { scenarioTag, tagOptions, tagGroupKey, tagClass, type ThreatGroupKey } from '../findings/scenarioTags'
import SeverityDot from '../findings/SeverityDot'
import { STATUS_LABELS, type ExceptionResult, type ExceptionStatus } from './applyExceptions'
import { buildExport, loadActor, previewImport, type ImportPreview } from './store'
import { ExpiryPicker, expiryFromChoice, type ExpiryChoice } from './ExceptionDialog'
import type { ExceptionEdit, ExceptionStorage } from './useExceptions'
import { formatDate, formatDateTime } from './format'
import { utcTitle } from '../utils/time'
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
import { backOr } from '../ui/backNav'
import { downloadText, toCsv } from '../utils/csv'

type Tab = 'current' | 'expired' | 'revoked' | 'all'
/** 상태 칩. 하나만 고른다 (다시 누르면 풀린다). */
type Flag = 'review' | 'soon' | 'unmatched'

const TAB_LABELS: Record<Tab, string> = { current: '적용 중', expired: '만료', revoked: '취소됨', all: '전체' }
const TABS = Object.keys(TAB_LABELS) as Tab[]

const tabOf = (status: ExceptionStatus): Tab =>
  status === 'expired' ? 'expired' : status === 'revoked' ? 'revoked' : 'current'

/* 주소: 목록은 #threat?view=exceptions, 상세는 &id=<예외 id>. 위협 상세의 예외 링크도 이 주소로 온다. 옛 #exceptions 는 appRouting 이 바꾼다 */
const LIST_HASH = '#threat?view=exceptions'
const MEMORY_KEY = 'aegi.exceptions.list'
type ListMemory = { scrollTop: number; lastId: string; tab: Tab }

export interface ExceptionsPageProps {
  exceptions: ThreatException[]
  result: ExceptionResult
  dataset: ExceptionDataset
  now: Date
  warning?: string
  /** 어디에 저장하나 — 머리 오른쪽 표시와 서버 올리기 단추에 쓴다 */
  storage?: ExceptionStorage
  loading?: boolean
  /** 서버 저장소를 쓰는데 이 브라우저에만 남은 예외 수 */
  localPending?: number
  onUploadLocal?: () => void
  onRefresh?: () => void
  onOpenFinding: (findingId: string) => void
  onRevoke: (ids: string[], actor: string, note?: string) => void
  onExtend: (id: string, expiresAt: string | null, actor: string) => void
  onEdit: (id: string, patch: ExceptionEdit, actor: string) => void
  onReapply: (id: string, reason: string, expiresAt: string | null, actor: string, approver?: string) => void
  onImport: (items: ThreatException[]) => void
  /** 제목 줄 보기 전환 스위치 (위협, 조치, 예외) */
  viewSwitch: ReactNode
}

/** 지금 가린 수. 사람 단위 예외는 사람 수, 목적지 전체는 위협 수다. 위협 전체는 세지 않는다 */
function maskedText(exc: ThreatException, count: number): string {
  return exc.scope === 'destination' ? `위협 ${count}개 제외` : `${count}명 제외`
}

/** 대상 칸의 이름. 위협 전체는 대상이 없다 */
const subjectOf = (exc: ThreatException) => (exc.scope === 'finding' ? '위협 전체' : exc.subjectLabel ?? exc.subjectKey)

/** 만료 칸: D-day 를 굵게, 날짜를 아래에. 30일 안이면 빨강. */
function dueOf(exc: ThreatException, current: boolean, now: Date): { big: string; date: string; alert: boolean } {
  if (exc.expiresAt === null) return { big: '무기한', date: '', alert: false }
  const days = daysUntil(exc.expiresAt, now)
  const date = formatDate(exc.expiresAt)
  if (!current) return { big: days <= 0 ? '만료됨' : date, date: days <= 0 ? date : '', alert: false }
  if (days <= 0) return { big: '만료', date, alert: true }
  return { big: `D-${days}`, date, alert: days <= EXPIRING_SOON_DAYS }
}

/**
 * Threat 의 예외 보기 (#threat?view=exceptions). 메뉴에 따로 두지 않는다.
 *
 * 예외는 한 번 걸고 잊기 쉽다. 그래서 목록 위에 재검토가 필요한 예외 수를 크게 두고, 만료가 가까운 것과
 * 적용 대상이 없어진 것을 칩으로 거른다. 줄을 누르면 상세(등록 당시와 지금 비교, 이력)로 가서
 * 취소, 연장, 수정, 다시 적용을 한다. Access Gaps 처럼 목록으로 돌아오면 보던 자리가 그대로다.
 */
export default function ExceptionsPage({
  exceptions,
  result,
  dataset,
  now,
  warning,
  storage = 'local',
  loading = false,
  localPending = 0,
  onUploadLocal,
  onRefresh,
  onOpenFinding,
  onRevoke,
  onExtend,
  onEdit,
  onReapply,
  onImport,
  viewSwitch,
}: ExceptionsPageProps) {
  const listHash = LIST_HASH
  const [openId, setOpenId] = useDetailId(listHash)
  const [tab, setTab] = useState<Tab>(() => readListMemory<ListMemory>(MEMORY_KEY).tab ?? 'current')
  const [lastId, setLastId] = useState(() => readListMemory<ListMemory>(MEMORY_KEY).lastId ?? '')
  /* 펼친 결정 묶음. 마지막으로 연 예외가 묶음 안에 있으면 그 묶음을 펼친 채로 돌아온다 */
  const [expanded, setExpanded] = useState<string[]>(() => {
    const last = exceptions.find(e => e.id === readListMemory<ListMemory>(MEMORY_KEY).lastId)
    return last ? [decisionKeyOf(last)] : []
  })
  const [flag, setFlag] = useState<Flag | null>(null)
  const [groups, setGroups] = useState<ThreatGroupKey[]>([])
  const [reasonFilter, setReasonFilter] = useState<ExceptionReasonCategory | 'all'>('all')
  const [scopeFilter, setScopeFilter] = useState<ExceptionScope | 'all'>('all')
  const [actorFilter, setActorFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<string[]>([])
  const [bulkNote, setBulkNote] = useState<string | null>(null)
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const pageRef = useRef<HTMLElement>(null)

  const statusOf = (exc: ThreatException) => result.info.get(exc.id)?.status ?? 'unmatched'
  const reviewOf = (exc: ThreatException) => result.info.get(exc.id)?.reviewReasons ?? []
  const flagOf: Record<Flag, (exc: ThreatException) => boolean> = {
    review: exc => reviewOf(exc).length > 0,
    soon: exc => statusOf(exc) === 'active' && !!exc.expiresAt && daysUntil(exc.expiresAt, now) <= EXPIRING_SOON_DAYS,
    unmatched: exc => statusOf(exc) === 'unmatched',
  }

  const sorted = useMemo(
    () => [...exceptions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [exceptions]
  )
  const actors = useMemo(() => [...new Set(exceptions.map(e => e.actor))].sort(), [exceptions])
  const countByTab = useMemo(() => {
    // 결정(한 번에 등록한 묶음) 단위로 센다. 17명을 한 번에 가린 결정은 1이다
    const keys: Record<Tab, Set<string>> = { current: new Set(), expired: new Set(), revoked: new Set(), all: new Set() }
    for (const exc of exceptions) {
      keys.all.add(decisionKeyOf(exc))
      keys[tabOf(statusOf(exc))].add(decisionKeyOf(exc))
    }
    return { current: keys.current.size, expired: keys.expired.size, revoked: keys.revoked.size, all: keys.all.size }
  }, [exceptions, result])

  // 칩의 개수는 지금 보는 탭 안에서 센다.
  const inTab = sorted.filter(exc => tab === 'all' || tabOf(statusOf(exc)) === tab)
  const countBy = <K extends string>(key: (exc: ThreatException) => K) => {
    const sets = new Map<K, Set<string>>()
    for (const exc of inTab) sets.set(key(exc), (sets.get(key(exc)) ?? new Set()).add(decisionKeyOf(exc)))
    return new Map([...sets].map(([k, set]) => [k, set.size]))
  }
  const byGroup = countBy(exc => tagGroupKey(exc.scenarioKey) ?? 'other')
  const byReason = countBy(exc => exc.reasonCategory)

  const needle = query.trim().toLowerCase()
  const visible = inTab.filter(exc => {
    if (flag && !flagOf[flag](exc)) return false
    if (groups.length && !groups.some(key => key === tagGroupKey(exc.scenarioKey))) return false
    if (reasonFilter !== 'all' && exc.reasonCategory !== reasonFilter) return false
    if (scopeFilter !== 'all' && exc.scope !== scopeFilter) return false
    if (actorFilter !== 'all' && exc.actor !== actorFilter) return false
    if (needle) {
      const text = [exc.id, exc.reason, exc.subjectLabel, exc.subjectKey, exc.snapshot.title, exc.snapshot.findingId, exc.actor, exc.reference]
        .join(' ')
        .toLowerCase()
      if (!text.includes(needle)) return false
    }
    return true
  })

  /* 한 번에 등록한 예외를 한 줄로 묶는다. 순서는 목록 순서(최근 등록 먼저)를 따른다 */
  const decisionGroups = (() => {
    const groups = new Map<string, { key: string; items: ThreatException[] }>()
    for (const exc of visible) {
      const key = decisionKeyOf(exc)
      const group = groups.get(key) ?? { key, items: [] }
      group.items.push(exc)
      groups.set(key, group)
    }
    return [...groups.values()]
  })()

  // 오탐은 규칙 개선 근거로 따로 모은다 (등록 당시 판정 근거에 추정이 섞였는지 함께).
  const fpByRule = useMemo(() => {
    const fpByRule = new Map<string, { ruleId: string; scenarioKey: ThreatException['scenarioKey']; total: number; current: number; inferred: number }>()
    for (const exc of exceptions) {
      if (exc.reasonCategory !== 'false_positive') continue
      const row = fpByRule.get(exc.ruleId) ?? { ruleId: exc.ruleId, scenarioKey: exc.scenarioKey, total: 0, current: 0, inferred: 0 }
      row.total += 1
      if (tabOf(statusOf(exc)) === 'current') row.current += 1
      if (Object.values(exc.snapshot.checkStates).includes('inferred')) row.inferred += 1
      fpByRule.set(exc.ruleId, row)
    }
    return [...fpByRule.values()].sort((a, b) => b.total - a.total)
  }, [exceptions, result])

  const opened = openId ? exceptions.find(e => e.id === openId) : undefined

  // 목록이 보일 때: 보던 자리로 되돌리고, 굴릴 때마다 적어 둔다.
  useLayoutEffect(() => {
    if (opened) return
    const box = scrollBox(pageRef.current)
    box.scrollTop = readListMemory<ListMemory>(MEMORY_KEY).scrollTop ?? 0
    const recent = lastId ? pageRef.current?.querySelector<HTMLElement>(`[data-exc-id="${CSS.escape(lastId)}"]`) : null
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

  const changeTab = (next: Tab) => {
    setTab(next)
    setChecked([])
    writeListMemory<ListMemory>(MEMORY_KEY, { tab: next })
  }

  const toggleFlag = (next: Flag) => {
    if (flag === next) return setFlag(null)
    setFlag(next)
    changeTab('current')
  }

  const targetDetailHash = (id: string) => {
    return listHash.includes('?')
      ? `${listHash}&id=${encodeURIComponent(id)}`
      : detailHash(listHash, id)
  }

  const openException = (id: string, replace = false) => {
    if (!opened) writeListMemory<ListMemory>(MEMORY_KEY, { scrollTop: scrollBox(pageRef.current).scrollTop })
    writeListMemory<ListMemory>(MEMORY_KEY, { lastId: id })
    setLastId(id)
    setOpenId(id)
    const nextHash = targetDetailHash(id)
    // 이전 · 다음은 방문 기록을 쌓지 않는다. 뒤로 가기 한 번이면 목록이다.
    if (replace) window.history.replaceState(window.history.state, '', nextHash)
    else window.location.hash = nextHash
  }

  /* 목록에서 열었으면 브라우저 뒤로 가기로 돌아가 기록을 쌓지 않는다 */
  const backToList = () => {
    const isTargetListHash = (hash: string) => {
      const lower = hash.toLowerCase()
      const p = listHash.toLowerCase()
      const matchesPrefix = lower === p || lower.startsWith(p.includes('?') ? `${p}&` : `${p}?`)
      return matchesPrefix && !/[?&]id=/i.test(hash)
    }
    backOr(isTargetListHash, () => {
      setOpenId('')
      window.location.hash = listHash
    })
  }

  const exportFile = () => {
    const payload = buildExport(dataset, exceptions, now)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `aegi-exceptions-${dataset}-${formatDate(now.toISOString())}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  /* 감사 제출용 CSV. 가져오기용 JSON(내보내기)과 달리 사람이 읽는 열만, 한 줄에 예외 하나. 취소, 만료한 예외도 넣는다 */
  const exportAuditCsv = () => {
    const rows = [...exceptions].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(exc => [
      exc.decisionId ?? '',
      exc.snapshot.findingId,
      exc.snapshot.title,
      SCOPE_LABELS[exc.scope],
      exc.subjectLabel ?? '',
      REASON_LABELS[exc.reasonCategory],
      exc.reason,
      exc.reference ?? '',
      exc.actor,
      exc.approver ?? '',
      formatDateTime(exc.createdAt),
      exc.expiresAt ? formatDateTime(exc.expiresAt) : '무기한',
      STATUS_LABELS[statusOf(exc)],
      exc.revokedBy ?? '',
      exc.revokedAt ? formatDateTime(exc.revokedAt) : '',
      exc.revokeReason ?? '',
    ])
    downloadText(`aegi-exceptions-audit-${dataset}-${formatDate(now.toISOString())}.csv`, toCsv([
      ['결정 ID', '위협 ID', '위협 제목', '범위', '대상', '사유 분류', '사유', '참조', '처리자', '승인자', '등록 시각', '만료', '상태', '취소자', '취소 시각', '취소 사유'],
      ...rows,
    ]))
  }

  const readImport = async (file: File) => {
    const text = await file.text()
    setImportPreview(previewImport(text, dataset, new Set(exceptions.map(e => e.id))))
  }

  const storageBadge =
    storage === 'remote' ? (
      <HeadBadge
        icon={<Cloud size={14} strokeWidth={2} />}
        title="팀 공용 저장소 D1에 저장. 같은 팀 비밀번호로 로그인한 사람은 모두 같은 목록 열람. 다른 사람이 바꾼 내용은 1분마다, 이 탭으로 돌아올 때 다시 불러옴"
      >
        팀 공용 저장소
        {onRefresh && (
          <button type="button" className="lst-icon-btn" aria-label="지금 다시 불러오기" title="지금 다시 불러오기" onClick={onRefresh}>
            <RefreshCw size={13} strokeWidth={2} />
          </button>
        )}
      </HeadBadge>
    ) : (
      <HeadBadge
        icon={<HardDrive size={14} strokeWidth={2} />}
        title={
          storage === 'local-fallback'
            ? '이 브라우저에 데이터셋별로 저장 중. 서버 저장소를 설정하면 팀 공용으로 전환'
            : '이 브라우저에 데이터셋별로 저장. 팀원과 공유하려면 내보낸 파일을 상대가 가져오기'
        }
      >
        이 브라우저
      </HeadBadge>
    )

  const warningBanner = warning && (
    <p className="ex-banner warn" role="status">
      <TriangleAlert size={14} strokeWidth={2} /> {warning}
    </p>
  )

  if (opened) {
    // 이전 · 다음은 목록에 보이던 순서를 따른다. 거르기로 빠진 예외를 열었으면 전체 순서를 쓴다.
    const order = visible.some(e => e.id === opened.id) ? visible : sorted
    const index = order.findIndex(e => e.id === opened.id)
    const prev = order[index - 1]
    const next = order[index + 1]
    return (
      <main className="page exceptions-page lst-page is-detail" ref={pageRef}>
        <DetailHead
          title="Exceptions 상세"
          index={index + 1}
          total={order.length}
          back="Threat"
          unit="예외"
          onBack={backToList}
          onPrev={prev ? () => openException(prev.id, true) : undefined}
          onNext={next ? () => openException(next.id, true) : undefined}
        />
        {warningBanner}
        <ExceptionDetail
          key={opened.id}
          exc={opened}
          status={statusOf(opened)}
          review={reviewOf(opened)}
          result={result}
          now={now}
          decisionSize={exceptions.filter(e => decisionKeyOf(e) === decisionKeyOf(opened)).length}
          onOpenFinding={onOpenFinding}
          onRevoke={onRevoke}
          onExtend={onExtend}
          onEdit={onEdit}
          onReapply={onReapply}
        />
      </main>
    )
  }

  const currentChecked = checked.filter(id => visible.some(e => e.id === id && tabOf(statusOf(e)) === 'current'))

  /** 예외 한 건의 줄. member 면 결정 묶음을 펼친 안쪽 줄이다 */
  const renderRow = (exc: ThreatException, member = false) => {
    const info = result.info.get(exc.id)
    const status = info?.status ?? 'unmatched'
    const review = info?.reviewReasons ?? []
    const isCurrent = tabOf(status) === 'current'
    const due = dueOf(exc, isCurrent, now)
    const masked = status === 'active' && info && exc.scope !== 'finding' ? info.matchedSubjectKeys.length : 0
    const alert = review.length > 0
    const subject = subjectOf(exc)
    return (
      <div
        key={exc.id}
        data-exc-id={exc.id}
        className={`lst-row ex-grid ${member ? 'is-member' : ''} ${exc.id === lastId ? 'is-recent' : ''}`}
        role="link"
        tabIndex={0}
        aria-label={`${exc.id} ${subject} 상세`}
        onClick={event => {
          // 체크박스는 제 할 일만 한다.
          if ((event.target as HTMLElement).closest('input, label')) return
          openException(exc.id)
        }}
        onKeyDown={event => {
          if (event.key === 'Enter' && event.target === event.currentTarget) openException(exc.id)
        }}
      >
        <span className="ex-cell-check">
          {isCurrent && (
            <input
              type="checkbox"
              aria-label={`${exc.id} 선택`}
              checked={checked.includes(exc.id)}
              onChange={() => setChecked(prev => (prev.includes(exc.id) ? prev.filter(id => id !== exc.id) : [...prev, exc.id]))}
            />
          )}
        </span>
        <span className="lst-main">
          <b>{subject}</b>
          <code>{exc.id}</code>
        </span>
        <span className="lst-main">
          <span className="ti-tag-row">
            <span className={`scenario-tag-badge ${tagClass(exc.scenarioKey)}`}>{scenarioTag(exc.scenarioKey).label}</span>
          </span>
          <b className="ex-title">{exc.snapshot.title}</b>
        </span>
        <span className="lst-text">{SCOPE_LABELS[exc.scope]}</span>
        <span className="lst-main">
          <b className="ex-reason-cat">{REASON_LABELS[exc.reasonCategory]}</b>
          <span className="lst-text lst-clip" title={exc.reason}>{exc.reason}</span>
        </span>
        <span className="lst-main">
          <span className="lst-text">{exc.actor}</span>
          <span className="lst-text">{formatDate(exc.createdAt)}</span>
        </span>
        <span className={`lst-due ${due.alert ? 'is-alert' : ''}`}>
          <b>{due.big}</b>
          {due.date && <span>{due.date}</span>}
        </span>
        <span className="lst-main" title={review.length ? review.join('\n') : undefined}>
          <span className={`lst-status ${alert ? 'is-alert' : ''}`}>{review.length ? '재검토 필요' : STATUS_LABELS[status]}</span>
          {review.length > 0 && <span className="lst-text">{STATUS_LABELS[status]}</span>}
          {masked > 0 && <span className="lst-text">{maskedText(exc, masked)}</span>}
        </span>
        <ChevronRight className="lst-row-go" size={16} strokeWidth={2} aria-hidden="true" />
      </div>
    )
  }

  return (
    <main className="page exceptions-page lst-page" ref={pageRef}>
      <div className="page-head page-title-bar page-title-bar-inset">
        <h1>Threat</h1>
        {viewSwitch}
      </div>

      {/* 제목 줄에는 제목만. 저장 위치와 파일 단추는 흰 칸 한 줄로 */}
      <div className="lst-actionbar">
        <div className="lst-actionbar-row">
          {storageBadge}
          <div className="lst-actionbar-end">
            <button type="button" className="ex-btn" onClick={exportFile} disabled={exceptions.length === 0}>
              <Download size={14} strokeWidth={2} /> 내보내기
            </button>
            <button type="button" className="ex-btn" onClick={exportAuditCsv} disabled={exceptions.length === 0}>
              <Download size={14} strokeWidth={2} /> 감사용 CSV
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
      </div>

      {warningBanner}

      {storage === 'remote' && localPending > 0 && onUploadLocal && (
        <div className="ex-banner info" role="status">
          <CloudUpload size={14} strokeWidth={2} />
          <span>팀 공용 저장소가 생기기 전에 이 브라우저에만 저장한 예외 {localPending}건</span>
          <button type="button" className="ex-btn" onClick={onUploadLocal}>
            팀 공용 저장소로 올리기
          </button>
        </div>
      )}

      {loading && <p className="lst-note">팀 공용 저장소에서 예외를 불러오는 중…</p>}

      {importPreview && (
        <ImportPanel
          preview={importPreview}
          onClose={() => setImportPreview(null)}
          onConfirm={() => {
            onImport(importPreview.accepted)
            setImportPreview(null)
          }}
        />
      )}

      <div className="lst-toolbar">
        <Segmented
          label="예외 상태"
          items={TABS.map(key => ({ key, label: TAB_LABELS[key], count: countByTab[key] }))}
          value={tab}
          onChange={changeTab}
        />
        <Hero label="재검토 필요" count={result.summary.review} unit="건" onClick={() => { setFlag('review'); changeTab('current') }} none="재검토할 예외 없음" />
      </div>

      <div className="ti-filterbar ti-filterbar-stack lst-filters">
        <div className="ti-filter-row">
          <div className="ti-search">
            <Search size={14} strokeWidth={2} aria-hidden="true" />
            <input type="search" value={query} placeholder="사유, 대상, 위협, 처리자 검색" aria-label="예외 검색" onChange={e => setQuery(e.target.value)} />
            {query && (
              <button type="button" className="ti-search-clear" aria-label="검색어 지우기" onClick={() => setQuery('')}>
                <X size={13} strokeWidth={2.5} />
              </button>
            )}
          </div>
          <select className="ex-select" aria-label="범위" value={scopeFilter} onChange={e => setScopeFilter(e.target.value as ExceptionScope | 'all')}>
            <option value="all">모든 범위</option>
            {(Object.keys(SCOPE_LABELS) as ExceptionScope[]).map(key => <option key={key} value={key}>{SCOPE_LABELS[key]}</option>)}
          </select>
          <select className="ex-select" aria-label="처리자" value={actorFilter} onChange={e => setActorFilter(e.target.value)}>
            <option value="all">모든 처리자</option>
            {actors.map(actor => <option key={actor} value={actor}>{actor}</option>)}
          </select>
        </div>
        <ChipGroup
          legend="상태"
          items={[
            { key: 'review' as Flag, label: '재검토 필요', count: result.summary.review, alert: true, title: '등록 후 상황이 바뀐 예외' },
            { key: 'soon' as Flag, label: `${EXPIRING_SOON_DAYS}일 내 만료`, count: result.summary.expiringSoon, alert: true, title: '만료되면 위협 다시 표시' },
            { key: 'unmatched' as Flag, label: '대상 없음', count: result.summary.unmatched, title: '이미 조치됐을 수 있음, 정리 권장' },
          ]}
          isOn={key => flag === key}
          onToggle={toggleFlag}
        />
        <ChipGroup
          legend="분류"
          items={tagOptions(exceptions.map(e => e.scenarioKey)).map(key => ({ key, label: scenarioTag(key).label, count: byGroup.get(key) ?? 0 }))}
          isOn={key => groups.includes(key)}
          onToggle={key => setGroups(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))}
        />
        <ChipGroup
          legend="사유"
          items={(Object.keys(REASON_LABELS) as ExceptionReasonCategory[]).map(key => ({ key, label: REASON_LABELS[key], count: byReason.get(key) ?? 0 }))}
          isOn={key => reasonFilter === key}
          onToggle={key => setReasonFilter(reasonFilter === key ? 'all' : key)}
        />
      </div>

      {currentChecked.length > 0 && (
        <div className="lst-bulkbar">
          <span>선택 <b>{currentChecked.length}</b>건</span>
          {bulkNote === null ? (
            <button type="button" className="ex-btn danger" onClick={() => setBulkNote('')}>선택한 예외 취소</button>
          ) : (
            <RevokeForm
              onCancel={() => setBulkNote(null)}
              onConfirm={(actor, note) => {
                onRevoke(currentChecked, actor, note)
                setChecked([])
                setBulkNote(null)
              }}
              count={currentChecked.length}
            />
          )}
        </div>
      )}

      <section aria-label="예외 목록">
        {visible.length === 0 ? (
          <p className="lst-empty">
            {exceptions.length === 0
              ? '예외 처리한 위협 없음. Threat 목록이나 위협 상세의 예외 처리 버튼으로 등록'
              : '조건에 맞는 예외 없음'}
          </p>
        ) : (
          <>
            <div className="lst-head ex-grid" aria-hidden="true">
              <span />
              <span>대상</span>
              <span>위협</span>
              <span>범위</span>
              <span>사유</span>
              <span>처리자</span>
              <span>만료</span>
              <span>상태</span>
              <span />
            </div>
            <LiveCount count={visible.length} noun="예외" />
            <div className="lst-list">
              {decisionGroups.map(group => {
                if (group.items.length === 1) return renderRow(group.items[0])
                const open = expanded.includes(group.key)
                const first = group.items[0]
                const infos = group.items.map(exc => result.info.get(exc.id))
                const status = infos[0]?.status ?? 'unmatched'
                const reviewCount = infos.filter(i => (i?.reviewReasons.length ?? 0) > 0).length
                const isCurrent = tabOf(status) === 'current'
                const due = dueOf(first, isCurrent, now)
                // 목적지 전체는 한 위협이 두 목적지 예외에 함께 걸릴 수 있어 위협 ID 를 겹치지 않게 센다
                const masked = first.scope === 'destination'
                  ? new Set(group.items.flatMap((_, i) => (infos[i]?.status === 'active' ? infos[i]!.matchedSubjectKeys : []))).size
                  : group.items.reduce((sum, exc, i) => sum + (infos[i]?.status === 'active' && exc.scope !== 'finding' ? infos[i]!.matchedSubjectKeys.length : 0), 0)
                const currentIds = group.items.filter((_, i) => tabOf(infos[i]?.status ?? 'unmatched') === 'current').map(exc => exc.id)
                const allChecked = currentIds.length > 0 && currentIds.every(id => checked.includes(id))
                const subject = `${subjectOf(first)} 외 ${group.items.length - 1}${first.scope === 'destination' ? '곳' : '명'}`
                const toggle = () => setExpanded(prev => (prev.includes(group.key) ? prev.filter(k => k !== group.key) : [...prev, group.key]))
                return (
                  <Fragment key={group.key}>
                    <div
                      className="lst-row ex-grid ex-decision"
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      aria-label={`${subject}, 한 번에 등록한 예외 ${group.items.length}건 ${open ? '접기' : '펼치기'}`}
                      onClick={event => {
                        if ((event.target as HTMLElement).closest('input, label')) return
                        toggle()
                      }}
                      onKeyDown={event => {
                        if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
                          event.preventDefault()
                          toggle()
                        }
                      }}
                    >
                      <span className="ex-cell-check">
                        {currentIds.length > 0 && (
                          <input
                            type="checkbox"
                            aria-label={`${subject} 모두 선택`}
                            checked={allChecked}
                            onChange={() => setChecked(prev => (allChecked ? prev.filter(id => !currentIds.includes(id)) : [...new Set([...prev, ...currentIds])]))}
                          />
                        )}
                      </span>
                      <span className="lst-main">
                        <b>{subject}</b>
                        {first.decisionId && <code>{first.decisionId}</code>}
                      </span>
                      <span className="lst-main">
                        <span className="ti-tag-row">
                          <span className={`scenario-tag-badge ${tagClass(first.scenarioKey)}`}>{scenarioTag(first.scenarioKey).label}</span>
                        </span>
                        <b className="ex-title">{first.snapshot.title}</b>
                      </span>
                      <span className="lst-text">{SCOPE_LABELS[first.scope]}</span>
                      <span className="lst-main">
                        <b className="ex-reason-cat">{REASON_LABELS[first.reasonCategory]}</b>
                        <span className="lst-text lst-clip" title={first.reason}>{first.reason}</span>
                      </span>
                      <span className="lst-main">
                        <span className="lst-text">{first.actor}</span>
                        <span className="lst-text">{formatDate(first.createdAt)}</span>
                      </span>
                      <span className={`lst-due ${due.alert ? 'is-alert' : ''}`}>
                        <b>{due.big}</b>
                        {due.date && <span>{due.date}</span>}
                      </span>
                      <span className="lst-main">
                        <span className={`lst-status ${reviewCount > 0 ? 'is-alert' : ''}`}>{reviewCount > 0 ? `재검토 필요 ${reviewCount}명` : STATUS_LABELS[status]}</span>
                        {masked > 0 && <span className="lst-text">{maskedText(first, masked)}</span>}
                      </span>
                      <ChevronDown className={`lst-row-go ex-decision-chevron ${open ? 'is-open' : ''}`} size={16} strokeWidth={2} aria-hidden="true" />
                    </div>
                    {open && group.items.map(exc => renderRow(exc, true))}
                  </Fragment>
                )
              })}
            </div>
          </>
        )}
      </section>

      {fpByRule.length > 0 && (
        <section className="lst-section" aria-label="오탐 규칙">
          <h2 className="lst-h2">오탐 규칙</h2>
          <div className="lst-head ex-fp-grid" aria-hidden="true">
            <span>규칙</span>
            <span>오탐</span>
            <span>적용 중</span>
            <span>추정 근거 포함</span>
          </div>
          <div className="lst-list">
            {fpByRule.map(row => (
              <div key={row.ruleId} className="lst-row ex-fp-grid is-static">
                <span className="ex-fp-rule">
                  <span className={`scenario-tag-badge ${tagClass(row.scenarioKey)}`}>{scenarioTag(row.scenarioKey).label}</span>
                  <code>{row.ruleId}</code>
                </span>
                <span className="lst-num">{row.total}</span>
                <span className="lst-num">{row.current}</span>
                <span className="lst-num">{row.inferred} ({Math.round((row.inferred / row.total) * 100)}%)</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}

function ImportPanel({ preview, onClose, onConfirm }: { preview: ImportPreview; onClose: () => void; onConfirm: () => void }) {
  return (
    <section className="panel ex-import" aria-label="가져오기 미리보기">
      <div className="panel-head">
        <h3>가져오기 미리보기</h3>
        <button type="button" className="ex-icon-btn" aria-label="닫기" onClick={onClose}>
          <X size={14} strokeWidth={2} />
        </button>
      </div>
      <div className="ex-import-body">
        {preview.error ? (
          <p className="ex-errors-inline">{preview.error}</p>
        ) : (
          <>
            <p>
              가져올 예외 <b>{preview.accepted.length}</b>건, 제외 항목 <b>{preview.skipped.length}</b>건
            </p>
            {preview.skipped.length > 0 && (
              <ul className="ex-import-skipped">
                {preview.skipped.map((s, i) => (
                  <li key={`${s.id ?? 'unknown'}-${i}`}>
                    <code>{s.id ?? 'ID 없음'}</code> {s.reason}
                  </li>
                ))}
              </ul>
            )}
            <div className="ex-actions">
              <button type="button" className="ex-btn" onClick={onClose}>취소</button>
              <button type="button" className="ex-btn primary" disabled={preview.accepted.length === 0} onClick={onConfirm}>
                {preview.accepted.length}건 가져오기
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

export function RevokeForm({ count, onCancel, onConfirm }: { count: number; onCancel: () => void; onConfirm: (actor: string, note?: string) => void }) {
  const [note, setNote] = useState('')
  const [actor, setActor] = useState(loadActor)
  return (
    <div className="ex-inline-form">
      <input className="ex-input" value={note} placeholder="취소 사유, 생략 가능" aria-label="취소 사유" onChange={e => setNote(e.target.value)} />
      <input className="ex-input ex-actor" value={actor} placeholder="처리자" aria-label="처리자" onChange={e => setActor(e.target.value)} />
      <button type="button" className="ex-btn" onClick={onCancel}>취소</button>
      <button type="button" className="ex-btn danger" disabled={!actor.trim()} onClick={() => onConfirm(actor.trim(), note)}>
        {count > 1 ? `${count}건 예외 취소` : '예외 취소'}
      </button>
    </div>
  )
}

type Mode = null | 'revoke' | 'extend' | 'edit' | 'reapply'

const HISTORY_LABELS: Record<string, string> = { created: '등록', extended: '만료 변경', edited: '사유 수정', revoked: '취소', reapplied: '다시 적용' }

function ExceptionDetail({
  exc,
  status,
  review,
  result,
  now,
  decisionSize,
  onOpenFinding,
  onRevoke,
  onExtend,
  onEdit,
  onReapply,
}: {
  exc: ThreatException
  status: ExceptionStatus
  review: string[]
  result: ExceptionResult
  now: Date
  /** 같이 등록한 예외 수 (이 예외 포함) */
  decisionSize: number
  onOpenFinding: (findingId: string) => void
  onRevoke: ExceptionsPageProps['onRevoke']
  onExtend: ExceptionsPageProps['onExtend']
  onEdit: ExceptionsPageProps['onEdit']
  onReapply: ExceptionsPageProps['onReapply']
}) {
  const [mode, setMode] = useState<Mode>(null)
  const [actor, setActor] = useState(loadActor)
  const [choice, setChoice] = useState<ExpiryChoice>(String(DEFAULT_EXPIRY_DAYS) as ExpiryChoice)
  const [customDate, setCustomDate] = useState('')
  const [reason, setReason] = useState(exc.reason)
  const [category, setCategory] = useState<ExceptionReasonCategory>(exc.reasonCategory)
  const [reference, setReference] = useState(exc.reference ?? '')
  const [approver, setApprover] = useState(exc.approver ?? '')
  const info = result.info.get(exc.id)
  const findingId = info?.findingId
  const view = findingId ? result.viewsById.get(findingId) : undefined
  const current = view?.original
  const isCurrent = tabOf(status) === 'current'
  const restricted = expiryRestricted(exc.scope, mode === 'edit' ? category : exc.reasonCategory)
  const expiresAt = expiryFromChoice(choice, customDate, now)
  const expiryError = expiresAt === '' ? '만료일을 고르세요.' : validateExpiry(expiresAt, exc.scope, exc.reasonCategory, now)
  const due = dueOf(exc, isCurrent, now)
  const subject = subjectOf(exc)
  const masked = status === 'active' && info && exc.scope !== 'finding' ? info.matchedSubjectKeys.length : 0
  const approvalError = mode === 'reapply' && actor.trim() ? approverProblem(exc.scope, exc.reasonCategory, actor, approver) : null

  const currentStates = Object.fromEntries((current?.checks ?? []).map(c => [c.id, c.state]))
  /* 판정 근거 칸과 같은 이름. 위협이 지금 없으면 이름을 몰라 ID 를 그대로 쓴다 */
  const checkLabels = new Map((current?.checks ?? []).map(c => [c.id, c.label]))
  const checkIds = [...new Set([...Object.keys(exc.snapshot.checkStates), ...Object.keys(currentStates)])]
  const stateMark = (state?: string) =>
    state === 'confirmed' ? (
      <span className="ex-mark"><Check size={12} strokeWidth={3} /> 확인</span>
    ) : state === 'inferred' ? (
      '≈ 추정'
    ) : state === 'unknown' ? (
      '? 미확인'
    ) : (
      '—'
    )
  const alert = review.length > 0
  const facts: Array<[string, ReactNode]> = [
    ['범위', SCOPE_LABELS[exc.scope]],
    ['사유 분류', REASON_LABELS[exc.reasonCategory]],
    ['처리자', exc.actor],
    ['등록일', formatDate(exc.createdAt)],
    ['승인자', exc.approver ?? '없음'],
    ['만료', exc.expiresAt === null ? '무기한' : <><b className={due.alert ? 'is-alert' : ''}>{due.big}</b> {due.date}</>],
  ]
  if (decisionSize > 1) facts.push(['일괄 등록', `${decisionSize}건`])
  if (masked > 0) facts.push(['제외', maskedText(exc, masked).replace(/ 제외$/, '')])

  return (
    <div className="exd">
      <section className="exd-card">
        <div className="exd-head">
          <h2 className="exd-name">
            {subject} <span className={`exd-badge ${alert ? 'is-alert' : ''}`}>{review.length ? '재검토 필요' : STATUS_LABELS[status]}</span> <code>{exc.id}</code>
          </h2>
          {mode === null && (
            <div className="ex-actions exd-buttons">
              {isCurrent ? (
                <>
                  <button type="button" className="ex-btn danger" onClick={() => setMode('revoke')}>예외 취소</button>
                  <button type="button" className="ex-btn" onClick={() => setMode('extend')}>만료 연장</button>
                  <button type="button" className="ex-btn" onClick={() => setMode('edit')}>사유 수정</button>
                </>
              ) : (
                <button type="button" className="ex-btn primary" onClick={() => setMode('reapply')}>다시 적용</button>
              )}
            </div>
          )}
        </div>
        <dl className="exd-facts">
          {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
        <button type="button" className="exd-threat" title={`구성 지문 ${exc.fingerprint}`} onClick={() => onOpenFinding(findingId ?? exc.snapshot.findingId)}>
          <span className="exd-threat-label">위협</span>
          <span className={`scenario-tag-badge ${tagClass(exc.scenarioKey)}`}>{scenarioTag(exc.scenarioKey).label}</span>
          <b>{findingId ?? exc.snapshot.findingId}</b>
          <span className="exd-threat-title">{exc.snapshot.title}</span>
          <ChevronRight className="exd-icon" size={14} strokeWidth={2} aria-hidden="true" />
        </button>

        {mode !== null && (
          <div className="exd-form">
          {mode === 'revoke' && (
            <RevokeForm count={1} onCancel={() => setMode(null)} onConfirm={(who, note) => { onRevoke([exc.id], who, note); setMode(null) }} />
          )}
  
          {(mode === 'extend' || mode === 'reapply') && (
            <div className="ex-inline-block">
              {mode === 'reapply' && (
                <label className="ex-field">
                  <span className="ex-label">사유 다시 확인 <em>{MIN_REASON_LENGTH}자 이상</em></span>
                  <textarea className="ex-input" rows={2} value={reason} onChange={e => setReason(e.target.value)} />
                </label>
              )}
              {mode === 'reapply' && (
                <label className="ex-field">
                  <span className="ex-label">승인자 <em>{approverRequired(exc.scope, exc.reasonCategory) ? '필수, 처리자와 다른 사람' : '선택'}</em></span>
                  <input className="ex-input" value={approver} placeholder="이름" onChange={e => setApprover(e.target.value)} />
                </label>
              )}
              <span className="ex-label">새 만료</span>
              <ExpiryPicker choice={choice} customDate={customDate} restricted={restricted} now={now} onChange={(c, d) => { setChoice(c); setCustomDate(d) }} />
              <div className="ex-inline-form">
                <input className="ex-input ex-actor" value={actor} placeholder="처리자" aria-label="처리자" onChange={e => setActor(e.target.value)} />
                <button type="button" className="ex-btn" onClick={() => setMode(null)}>취소</button>
                <button
                  type="button"
                  className="ex-btn primary"
                  disabled={!!expiryError || !actor.trim() || (mode === 'reapply' && (reason.trim().length < MIN_REASON_LENGTH || !!approvalError))}
                  onClick={() => {
                    const at = expiresAt === '' ? null : expiresAt
                    if (mode === 'extend') onExtend(exc.id, at, actor.trim())
                    else onReapply(exc.id, reason, at, actor.trim(), approver)
                    setMode(null)
                  }}
                >
                  {mode === 'extend' ? '만료 변경' : '다시 적용'}
                </button>
              </div>
              {expiryError && <small className="ex-errors-inline">{expiryError}</small>}
              {approvalError && <small className="ex-errors-inline">{approvalError}</small>}
            </div>
          )}
  
          {mode === 'edit' && (
            <div className="ex-inline-block">
              <div className="ex-reason-grid">
                {(Object.keys(REASON_LABELS) as ExceptionReasonCategory[]).map(value => (
                  <label key={value} className={`ex-reason ${category === value ? 'on' : ''}`}>
                    <input type="radio" name={`ex-edit-${exc.id}`} checked={category === value} onChange={() => setCategory(value)} />
                    <span>{REASON_LABELS[value]}</span>
                  </label>
                ))}
              </div>
              <textarea className="ex-input" rows={2} value={reason} aria-label="사유" onChange={e => setReason(e.target.value)} />
              <input className="ex-input" value={reference} placeholder="참조 링크, 생략 가능" aria-label="참조 링크" onChange={e => setReference(e.target.value)} />
              {(() => {
                // 분류를 위험 수용으로 바꾸면 만료 규칙도 따라야 한다 (무기한 금지 · 최대 180일)
                const editExpiryError = validateExpiry(exc.expiresAt, exc.scope, category, now)
                return (
                  <>
                    <div className="ex-inline-form">
                      <input className="ex-input ex-actor" value={actor} placeholder="처리자" aria-label="처리자" onChange={e => setActor(e.target.value)} />
                      <button type="button" className="ex-btn" onClick={() => setMode(null)}>취소</button>
                      <button
                        type="button"
                        className="ex-btn primary"
                        disabled={reason.trim().length < MIN_REASON_LENGTH || !actor.trim() || !!editExpiryError}
                        onClick={() => {
                          onEdit(exc.id, { reasonCategory: category, reason, reference }, actor.trim())
                          setMode(null)
                        }}
                      >
                        저장
                      </button>
                    </div>
                    {editExpiryError && <small className="ex-errors-inline">{editExpiryError} 먼저 만료를 바꾸세요.</small>}
                  </>
                )
              })()}
            </div>
          )}
          </div>
        )}

        {review.length > 0 && (
          <div className="exd-pad">
            <ul className="lst-alert exd-alert">
              {review.map(r => <li key={r}><TriangleAlert size={14} strokeWidth={2} aria-hidden="true" /> {r}</li>)}
            </ul>
          </div>
        )}
      </section>

      <section className="exd-card exd-body">
        <div className="exd-grid">
          <section>
            <h3 className="exd-h3">내용</h3>
            <dl className="exd-dl">
              <dt>사유</dt><dd>{exc.reason}</dd>
              {exc.reference && (<><dt>참조</dt><dd><a href={exc.reference} target="_blank" rel="noreferrer">{exc.reference}</a></dd></>)}
              {/* 내부 키와 구성 지문은 커서를 올렸을 때만 (지문은 위협 단추에) */}
              {exc.subjectKey && (<><dt>대상</dt><dd title={exc.subjectKey}>{exc.subjectLabel ?? exc.subjectKey}{exc.subjectAccountKeys && exc.subjectAccountKeys.length > 1 ? `, 계정 ${exc.subjectAccountKeys.length}개` : ''}</dd></>)}
              {exc.observationIds && exc.observationIds.length > 0 && (<><dt>당시 증적</dt><dd title={exc.observationIds.join(', ')}>{exc.observationIds.length}건</dd></>)}
              {exc.revokedAt && (<><dt>취소</dt><dd>{formatDateTime(exc.revokedAt)}, {exc.revokedBy}{exc.revokeReason && `, ${exc.revokeReason}`}</dd></>)}
            </dl>
          </section>

          <section>
            <h3 className="exd-h3">등록 시점과 현재</h3>
            {/* 바뀐 현재 칸만 빨강 굵게 */}
            <table className="exd-table">
              <thead><tr><th scope="col" /><th scope="col">등록 시점</th><th scope="col">현재</th></tr></thead>
              <tbody>
                <tr>
                  <th scope="row">위협</th>
                  <td><span className="exd-nowrap">{exc.snapshot.findingId}</span></td>
                  <td>
                    {current ? (
                      <button type="button" className="lst-link" onClick={() => onOpenFinding(current.id)}>{current.id} 보기</button>
                    ) : <span className="exd-badge">탐지되지 않음</span>}
                  </td>
                </tr>
                <tr>
                  <th scope="row">심각도</th>
                  <td><span className="exd-sev"><SeverityDot severity={exc.snapshot.severity} /></span></td>
                  <td className={current && current.severity !== exc.snapshot.severity ? 'is-changed' : ''}>
                    {current ? (
                      <span className="exd-sev">
                        <SeverityDot severity={current.severity} />
                      </span>
                    ) : '—'}
                  </td>
                </tr>
                {checkIds.map(id => (
                  <tr key={id}>
                    <th scope="row" title={id}>{checkLabels.get(id) ?? id}</th>
                    <td>{stateMark(exc.snapshot.checkStates[id])}</td>
                    <td className={exc.snapshot.checkStates[id] !== currentStates[id] ? 'is-changed' : ''}>{current ? stateMark(currentStates[id]) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <section className="exd-hist">
          <h3 className="exd-h3">이력</h3>
          <ol className="exd-timeline">
            {exc.history.map((h, i) => (
              <li key={`${h.at}-${i}`}>
                <i aria-hidden="true" />
                <time title={utcTitle(h.at)}>{formatDateTime(h.at)}</time>
                <b>{HISTORY_LABELS[h.action] ?? h.action}</b>
                {h.actor && <span>{h.actor}</span>}
                {h.note && <span>{h.note}</span>}
              </li>
            ))}
          </ol>
        </section>
      </section>
    </div>
  )
}
