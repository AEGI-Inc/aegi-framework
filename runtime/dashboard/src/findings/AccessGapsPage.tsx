import { DetailButton, DetailCrumb, DetailGroup, DetailPager } from '../ui/DetailBar'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Activity, ChevronRight, ShieldAlert } from 'lucide-react'
import type { GraphStoreV2 } from '../model/graph'
import type { FindingV2 } from '../model/findingV2'
import type { Provider } from '../model/object'
import { PROVIDER_COLOR, keyName, objectName, realKey } from './accessGapNames'
import { isGapPerson } from './AccessGapVenn'
import ThreatAccessGapPanel from './ThreatAccessGapPanel'
import SeverityDot from './SeverityDot'
import type { Severity } from './severity'
import { providerName, PROVIDERS_WITH_LOGO } from './providers'
import ProviderLogo from '../ProviderLogo'
import type { ProviderId } from '../providerOverviewData'
import { backOr, isListHash } from '../ui/backNav'
import { LiveCount } from '../ui/ListScreen'

const LOGO_PROVIDERS = PROVIDERS_WITH_LOGO

export interface AccessGapsPageProps {
  /** 그 위협을 조사 대상으로 Event Board 를 연다 */
  onOpenEvents?: (findingId: string) => void
  graph: GraphStoreV2
  /** 위협 판정 V2 위협. 엔진이 Access Gap 벤(threatAccessGap)을 붙인 위협만 나온다 */
  findings: FindingV2[]
  onOpenFinding: (findingId: string) => void
}

/* 목록에서 이게 어느 SaaS 자원인지 — 이름 앞에 SaaS 로고. 로고가 없는 SaaS 는 전처럼 색 점. */
function providerMark(key: string, graph: GraphStoreV2) {
  const provider = graph.objectsByKey.get(key)?.canonical.provider as Provider | undefined
  if (provider && LOGO_PROVIDERS.has(provider)) {
    return (
      <span className="agl-logo" title={providerName(provider)}>
        <ProviderLogo provider={provider === 'gws' ? 'google-workspace' : (provider as ProviderId)} />
      </span>
    )
  }
  return <i className="agl-dot" style={{ background: (provider && PROVIDER_COLOR[provider]) || '#94a3b8' }} aria-hidden="true" />
}

/* 목록에 적을 이름. GitHub 저장소는 「조직/저장소」의 조직이 모든 저장소에 똑같이 붙어 폭만
   차지하므로 저장소 이름만 적는다. 전체 이름은 커서를 올리면 뜨고, 상세에는 그대로 있다. */
function listName(key: string, graph: GraphStoreV2): string {
  const name = objectName(key, graph)
  if (graph.objectsByKey.get(key)?.canonical.provider === 'github' && /^[^/\s]+\/[^/\s]+$/.test(name)) return name.split('/')[1]
  return name
}

function itemEnd(key: string, graph: GraphStoreV2, severity?: Severity) {
  const real = realKey(key)
  return (
    <span className="agl-item-ends">
      {severity && <SeverityDot severity={severity} />}
      {real ? providerMark(real, graph) : <i className="agl-dot" style={{ background: '#94a3b8' }} aria-hidden="true" />}
      <span className="agl-item-name" title={keyName(key, graph)}>{key === real ? listName(key, graph) : keyName(key, graph)}</span>
    </span>
  )
}

/* 주소: 목록은 #access-gaps, 상세는 #access-gaps?gap=<위협 id>. 뒤로 가기가 목록으로 돌아오고,
   상세 주소를 그대로 공유할 수 있다. */
const LIST_HASH = '#access-gaps'
const detailHash = (id: string) => `${LIST_HASH}?gap=${encodeURIComponent(id)}`

function gapIdFromHash(): string {
  if (typeof window === 'undefined') return ''
  const match = window.location.hash.match(/^#access-gaps\?(?:.*&)?gap=([^&]+)/i)
  if (!match) return ''
  try {
    return decodeURIComponent(match[1])
  } catch {
    return ''
  }
}

/* 목록에서 보던 자리(스크롤 · 마지막으로 연 위협). 상세에 다녀오거나 다른 화면에 갔다
   와도 그대로 돌아오게 탭(세션) 안에 적어 둔다. 저장소를 못 쓰는 브라우저에서는 처음 자리로 뜬다. */
const MEMORY_KEY = 'aegi.accessGaps.list'
type ListMemory = { scrollTop?: number; lastId?: string }

function readMemory(): ListMemory {
  try {
    return JSON.parse(window.sessionStorage.getItem(MEMORY_KEY) ?? '{}') as ListMemory
  } catch {
    return {}
  }
}

function writeMemory(patch: ListMemory) {
  try {
    window.sessionStorage.setItem(MEMORY_KEY, JSON.stringify({ ...readMemory(), ...patch }))
  } catch {
    /* 기억하지 못해도 화면은 그대로 쓴다 */
  }
}

/* 이 화면을 굴리는 상자. 창 크기에 따라 문서 전체이기도, 본문 칸(.app-content)이기도 하다. */
function scrollBox(el: HTMLElement | null): HTMLElement {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement
}

/** 사람 수 칸. 0명은 검정, 1명 이상은 빨강 */
function Count({ n, label }: { n: number; label: string }) {
  return <span className={`agl-c-num ${n ? 'agl-c-gap' : ''}`} data-label={label}>{n ? <b>{n}</b> : 0}명</span>
}

/**
 * Access Gaps: 위협 하나(연동 지점과 대상)에 벤 하나(2026-11-17 결정, 엔진 계약 accessGap).
 *
 * 원천은 위협 판정 값이라 위협의 사람과 Access Gap 사람이 같다. 비인가 접근, 권한 상승, 데이터 반출 위협만 나온다.
 * 권한 없는 접근자는 직접 권한 없이 새 권한을 얻은 사람, 권한 초과 접근자는 직접 권한보다 높은 수준을 얻은 사람이다.
 * 관리자와 승인된 사람은 벤 안에 검정 테두리로 두고 수에서 뺀다.
 *
 * Threat Analysis 처럼 목록과 상세가 나뉜다. 목록에서 위협을 누르면 상세가 화면 폭을 다 쓰고,
 * 목록으로 돌아오면 보던 자리와 방금 본 위협이 그대로다.
 */
export default function AccessGapsPage({ onOpenEvents, graph, findings, onOpenFinding }: AccessGapsPageProps) {
  const [openId, setOpenId] = useState<string>(gapIdFromHash)
  const [lastId, setLastId] = useState<string>(() => readMemory().lastId ?? '')
  const pageRef = useRef<HTMLElement>(null)
  const visible = useMemo(() => findings.filter(f => f.threatAccessGap && f.threatPath), [findings])
  const opened = openId ? visible.find(f => f.id === openId) : undefined
  // 상단 합계는 숫자마다 따로 센다. 한 사람이 두 합계에 다 들어갈 수 있다
  const total = useMemo(() => {
    const none = new Set<string>()
    const over = new Set<string>()
    for (const f of visible) for (const p of f.threatAccessGap!.people) if (isGapPerson(p)) (p.direct ? over : none).add(p.person)
    return { none: none.size, over: over.size }
  }, [visible])

  // 뒤로 가기 · 앞으로 가기 · 메뉴로 주소가 바뀌면 따라간다.
  useEffect(() => {
    const onHash = () => setOpenId(gapIdFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // 목록이 보일 때: 보던 자리로 되돌리고, 굴릴 때마다 적어 둔다.
  useLayoutEffect(() => {
    if (opened) return
    const box = scrollBox(pageRef.current)
    box.scrollTop = readMemory().scrollTop ?? 0
    // 창 크기가 달라져 방금 본 위협이 화면 밖이면 보이는 데까지만 굴린다.
    const recent = lastId ? pageRef.current?.querySelector<HTMLElement>(`[data-gap-id="${CSS.escape(lastId)}"]`) : null
    recent?.scrollIntoView({ block: 'nearest' })
    let frame = 0
    const target: HTMLElement | Window = box === document.scrollingElement ? window : box
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => writeMemory({ scrollTop: box.scrollTop }))
    }
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      target.removeEventListener('scroll', onScroll)
    }
    // lastId 는 상세를 열 때 바뀐다. 그때 목록은 이미 내려가 있으므로 여기서 다시 돌 필요가 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(opened)])

  // 상세는 맨 위부터.
  useLayoutEffect(() => {
    if (opened) scrollBox(pageRef.current).scrollTop = 0
  }, [opened])

  const openGap = (id: string, replace = false) => {
    if (!opened) writeMemory({ scrollTop: scrollBox(pageRef.current).scrollTop })
    writeMemory({ lastId: id })
    setLastId(id)
    setOpenId(id)
    // 이전 · 다음은 방문 기록을 쌓지 않는다. 뒤로 가기 한 번이면 목록이다.
    if (replace) window.history.replaceState(window.history.state, '', detailHash(id))
    else window.location.hash = detailHash(id)
  }

  /* 목록에서 열었으면 브라우저 뒤로 가기로 돌아가 기록을 쌓지 않는다 */
  const backToList = () => {
    backOr(isListHash(LIST_HASH, 'gap'), () => {
      setOpenId('')
      window.location.hash = LIST_HASH
    })
  }

  if (opened) {
    const index = visible.findIndex(f => f.id === opened.id)
    const prev = visible[index - 1]
    const next = visible[index + 1]
    return (
      <main className="access-gaps-page is-detail" ref={pageRef}>
        <header className="page-title-bar page-title-bar-inset agl-topbar">
          <DetailCrumb back="Access Gaps" onBack={backToList} title="Access Gaps 상세" />
          <div className="page-head-actions">
            <DetailPager index={index + 1} total={visible.length} unit="위협" onPrev={prev ? () => openGap(prev.id, true) : undefined} onNext={next ? () => openGap(next.id, true) : undefined} />
            <DetailGroup label="위협 작업">
              <DetailButton label="Threat 상세" icon={<ShieldAlert size={15} strokeWidth={2} aria-hidden="true" />} onClick={() => onOpenFinding(opened.id)} />
              {onOpenEvents && <DetailButton label="Event Board" icon={<Activity size={15} strokeWidth={2} aria-hidden="true" />} onClick={() => onOpenEvents(opened.id)} />}
            </DetailGroup>
          </div>
        </header>

        <ThreatAccessGapPanel finding={opened} graph={graph} />
      </main>
    )
  }

  return (
    <main className="access-gaps-page" ref={pageRef}>
      <header className="page-title-bar page-title-bar-inset agl-topbar">
        <h1>Access Gaps</h1>
      </header>

      {visible.length === 0 ? (
        <p className="agl-empty">Access Gap 이 있는 위협 없음</p>
      ) : (
        <section className="agl-list" aria-label="위협 목록">
          {/* 왼쪽 위협 수, 오른쪽 두 숫자. 숫자마다 따로 센다 */}
          <div className="agl-toolbar">
            <div className="agl-filter" role="group" aria-label="목록 보기">
              <button type="button" className="is-on" aria-pressed>위협 <b>{visible.length}</b></button>
            </div>
            <p className={`agl-hero ${total.none ? 'has-gap' : ''}`}><span>권한 없는 접근자</span><strong>{total.none}<small>명</small></strong></p>
            <p className={`agl-hero ${total.over ? 'has-gap' : ''}`}><span>권한 초과 접근자</span><strong>{total.over}<small>명</small></strong></p>
          </div>
          <LiveCount count={visible.length} noun="위협" unit="건" />
          <div className="agl-head agl-cols-threat" aria-hidden="true">
            <span>연동 지점</span>
            <span>대상</span>
            <span>유형</span>
            <span>직접 권한</span>
            <span>파생 접근</span>
            <span>권한 없는 접근자</span>
            <span>권한 초과 접근자</span>
            <span />
          </div>
          {visible.map(f => {
            const g = f.threatAccessGap!
            const path = f.threatPath!
            return (
              <button
                type="button"
                key={f.id}
                data-gap-id={f.id}
                className={`agl-row agl-cols-threat ${g.unauthorized + g.excess ? 'has-gap' : ''} ${f.id === lastId ? 'is-recent' : ''}`}
                // 머리글이 화면 읽기 프로그램에 읽히지 않으므로 줄 이름에 칸 이름을 같이 적는다
                aria-label={`연동 지점 ${keyName(path.point, graph)}, 대상 ${keyName(path.target, graph)}, 유형 ${f.primaryType}, 직접 권한 ${g.directCount}명, 파생 접근 ${g.derivedCount}명, 권한 없는 접근자 ${g.unauthorized}명, 권한 초과 접근자 ${g.excess}명`}
                onClick={() => openGap(f.id)}
              >
                {itemEnd(path.point, graph)}
                {itemEnd(path.target, graph, f.severity as Severity)}
                <span className="agl-c-finding" data-label="유형">{f.primaryType}</span>
                <span className="agl-c-num" data-label="직접 권한">{g.directCount}명</span>
                <span className="agl-c-num" data-label="파생 접근">{g.derivedCount}명</span>
                <Count n={g.unauthorized} label="권한 없는 접근자" />
                <Count n={g.excess} label="권한 초과 접근자" />
                <ChevronRight className="agl-row-go" size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            )
          })}
        </section>
      )}
    </main>
  )
}
