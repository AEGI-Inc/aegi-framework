import { hidesAccessGaps, hidesAdapters, isDemoMode } from './demoMode'
import type { ThreatView } from './findings/ThreatViewSwitch'

export type Page = 'Home' | 'Explorer' | 'Compliance' | 'Threat' | 'Gaps' | 'Credentials' | 'Graph' | 'Adapters' | 'Remediation' | 'Manual' | 'Orbs' | 'Timeline' | 'EventBoard' | 'ConfigFindings'

/* 화면과 주소를 짝지어 둔다. getInitialPage가 읽는 접두사와 같아야 한다. */
export const PAGE_HASH: Record<Page, string> = {
  Home: '#overview',
  Compliance: '#compliance',
  Graph: '#graph',
  Threat: '#threat',
  Gaps: '#access-gaps',
  Timeline: '#event-board',
  EventBoard: '#event-board',
  Explorer: '#explorer',
  Credentials: '#credentials',
  Adapters: '#adapters',
  Remediation: '#remediation',
  Manual: '#manual',
  Orbs: '#orbs',
  ConfigFindings: '#config-findings',
}

/**
 * 옛 주소를 새 주소로 바꾼다. Integrations와 수집 자격증명 대장은 Adapters 하나로 합쳤다.
 * #credentials 는 이제 그래프 자격증명의 피해범위 화면이다. 대장 상세(?id=CRED-… / ACCT-…)만 Adapters 로 보낸다.
 * 제거한 개발용 비교 화면의 옛 주소는 Overview로 보낸다.
 * Scenario Builder(#scenarios)는 Explorer 자리로 옮겼으므로 운영에서는 #explorer 로 보낸다.
 * Access Gaps 와 Config Findings 는 없앤 화면이라 운영에서도 Threat 로 보낸다. 공개 데모만 Access Gaps 를 연다(hidesAccessGaps, 메뉴에는 없음).
 * Exceptions 화면은 없앴다. #exceptions(?id=) 와 옛 승인 보기(view=approvals)는 Threat 의 예외 보기로 보낸다.
 * 조치 보기(#remediation)는 없앴다. 위협이 있으면(?finding=) 그 위협 상세로, 없으면 위협 목록으로 보낸다.
 * 데모 모드에서는 숨긴 화면(Overview, Explorer, Credentials, Manual, Scenario Builder)을 남은 화면으로 보낸다. 공개 데모는 Adapters 도 숨긴다(hidesAdapters).
 * 바꿨으면 새 주소, 아니면 null
 */
export function legacyHash(hash: string): string | null {
  const lower = hash.toLowerCase()
  if (/^#analysis-packs(?:\?|$)/.test(lower)) return PAGE_HASH.Home
  if (/^#ux-lab(?:\?|$)/.test(lower)) return PAGE_HASH.Home
  if (hidesAdapters() && (/^#(adapters|integrations)(?:\?|$)/.test(lower) || (lower.startsWith('#credentials') && /[?&]id=(cred|acct)-/.test(lower)))) return PAGE_HASH.Graph
  if (lower.startsWith('#integrations')) return PAGE_HASH.Adapters
  if (lower.startsWith('#credentials') && /[?&]id=(cred|acct)-/.test(lower)) return PAGE_HASH.Adapters + hash.slice('#credentials'.length)
  if (!isDemoMode() && /^#scenarios(?:\?|$)/.test(lower)) return PAGE_HASH.Explorer + hash.slice('#scenarios'.length)
  /* Access Gaps 상세(?gap=<위협 번호>)는 App 의 redirectGapHash 가 그 위협 상세로 바꾼다. 여기서 목록으로 먼저 보내지 않는다 */
  if (hidesAccessGaps() && /^#access-gaps(?:\?|$)/.test(lower) && !/[?&]gap=/.test(lower)) return PAGE_HASH.Threat
  /* Config Findings 는 없앤 화면이다. SaaS 와 finding 이 있으면 Threat 의 설정 위반 상세로,
     finding 만 있으면 설정 행을 거른 목록에 검색어로 넘긴다 */
  if (/^#config-findings(?:\?|$)/.test(lower)) {
    const params = new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '')
    const finding = params.get('finding')
    const saas = params.get('saas')
    if (finding && saas) return configThreatHash(saas, finding)
    const out = new URLSearchParams({ src: 'config' })
    if (finding) out.set('q', finding)
    return `${PAGE_HASH.Threat}?${out}`
  }
  /* Exceptions 화면은 없앴다. 예외 목록과 상세(?id=)는 Threat 의 예외 보기로, 옛 승인 보기도 같은 곳으로 */
  if (/^#exceptions(?:\?|$)/.test(lower)) {
    const query = hash.slice('#exceptions'.length)
    return query.startsWith('?') ? `${PAGE_HASH.Threat}?view=exceptions&${query.slice(1)}` : `${PAGE_HASH.Threat}?view=exceptions`
  }
  if (/^#threat\?(?:.*&)?view=approvals(?:&|$)/.test(lower)) return `${PAGE_HASH.Threat}?view=exceptions`
  /* 조치 보기와 조치 상세는 없앴다. 위협 판정 V2 의 권장 조치는 위협 상세의 차단 지점이다 */
  if (/^#remediation(?:\?|$)/.test(lower)) {
    const finding = new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '').get('finding')
    return finding ? `${PAGE_HASH.Threat}?finding=${encodeURIComponent(finding)}` : PAGE_HASH.Threat
  }
  if (isDemoMode()) {
    if (/^#(overview|explorer|credentials|manual)(?:\?|$)/.test(lower)) return PAGE_HASH.Graph
    if (/^#scenarios(?:\?|$)/.test(lower)) return PAGE_HASH.Threat
  }
  if (lower.startsWith('#timeline')) {
    const rawQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
    const q = new URLSearchParams(rawQuery)
    const event = q.get('event')
    const objects = q.get('objects') || q.get('object')
    const at = q.get('at')
    const pins = [...q.getAll('object'), ...q.getAll('actor'), ...q.getAll('target')].filter(Boolean)
    const combinedObjects = objects ? objects.split(',').concat(pins) : pins
    const uniqueObjects = [...new Set(combinedObjects.map(s => s.trim()).filter(Boolean))]

    if (event) {
      const out = new URLSearchParams()
      out.set('event', event)
      if (uniqueObjects.length > 0 && at) {
        out.set('objects', uniqueObjects.join(','))
        out.set('at', at)
      }
      return `${PAGE_HASH.EventBoard}?${out.toString()}`
    }
    if (uniqueObjects.length > 0) {
      return `${PAGE_HASH.EventBoard}?objects=${encodeURIComponent(uniqueObjects.join(','))}&days=7`
    }
    return PAGE_HASH.EventBoard
  }
  return null
}

function redirectLegacyHash(): void {
  const next = legacyHash(window.location.hash)
  if (next !== null) window.history.replaceState(window.history.state, '', next)
}
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', redirectLegacyHash)
}

export function getInitialPage(rawHash?: string): Page {
  if (typeof window === 'undefined' && rawHash === undefined) return isDemoMode() ? 'Graph' : 'Home'
  if (typeof window !== 'undefined' && rawHash === undefined) redirectLegacyHash()
  const raw = rawHash !== undefined ? rawHash : (typeof window !== 'undefined' ? window.location.hash : '')
  const redirected = legacyHash(raw) ?? raw
  const hash = redirected.toLowerCase()
  if (isDemoMode()) {
    if (!hash || hash === '#' || /^#(overview|explorer|credentials|manual)(?:\?|$)/.test(hash)) return 'Graph'
    if (/^#scenarios(?:\?|$)/.test(hash)) return 'Threat'
  }
  if (hidesAccessGaps() && /^#access-gaps(?:\?|$)/.test(hash)) return 'Threat'
  if (/^#config-findings(?:\?|$)/.test(hash)) return 'Threat'
  if (/^#compliance(?:\?|$)/.test(hash)) return 'Compliance'
  if (hash.startsWith('#orbs')) return 'Orbs'
  if (hash.startsWith('#graph') || hash.startsWith('#fullgraph')) return 'Graph'
  if (hash.startsWith('#threat')) return 'Threat'
  if (hash.startsWith('#access-gaps')) return 'Gaps'
  if (hash.startsWith('#timeline')) return 'EventBoard'
  if (hash.startsWith('#event-board')) return 'EventBoard'
  if (hash.startsWith('#explorer')) return 'Explorer'
  if (hash.startsWith('#adapters')) return 'Adapters'
  if (hash.startsWith('#credentials')) return 'Credentials'
  if (hash.startsWith('#manual')) return 'Manual'
  return isDemoMode() ? 'Graph' : 'Home'
}


export function getInitialThreatView(rawHash?: string): ThreatView {
  const raw = rawHash !== undefined ? rawHash : (typeof window !== 'undefined' ? window.location.hash : '')
  const redirected = legacyHash(raw) ?? raw
  const lower = redirected.toLowerCase()
  if (lower.startsWith('#threat') && /[?&]view=exceptions(?:\b|&)/.test(lower)) return 'exceptions'
  return 'threats'
}

/** 주소가 가리키는 위협 id(`#threat?finding=<id>`). 없으면 빈 문자열이고, 화면은 열린 위협 중 첫 번째를 쓴다 */
export function getInitialFindingId(): string {
  if (typeof window === 'undefined') return ''
  const match = window.location.hash.match(/[?&]finding=([^&]+)/i)
  if (!match) return ''
  const value = decodeURIComponent(match[1])
  // 위협 id(FND-THR-…)는 대문자다. 손으로 적은 소문자 주소도 같은 위협을 연다
  return /^fnd-/i.test(value) ? value.toUpperCase() : value
}

/**
 * Threat Analysis를 상세로 열지 목록으로 열지 결정한다.
 *
 * 해시에 특정 Finding이 지목돼 있을 때만 상세로 들어간다. 메뉴에서
 * 그냥 #threat으로 들어오면 목록이 첫 화면이다.
 */
export function getInitialThreatDetail(): boolean {
  if (typeof window === 'undefined') return false
  const hash = window.location.hash.toLowerCase()
  if (!hash.startsWith('#threat')) return false
  if (getInitialConfigThreat(hash)) return false
  return /[?&]finding=/.test(hash)
}

/** Threat 안에서 여는 설정 위반 상세(기준별 판정의 finding 하나). SaaS 와 finding id 로 찾는다 */
export interface ConfigThreatRef { provider: string; findingId: string }

/** 설정 위반 상세 주소 `#threat?config=<SaaS>:<finding id>` */
export function configThreatHash(provider: string, findingId: string): string {
  return `${PAGE_HASH.Threat}?${new URLSearchParams({ config: `${provider}:${findingId}` })}`
}

/** 주소가 설정 위반 상세면 그 SaaS 와 finding id. 아니면 null */
export function getInitialConfigThreat(rawHash?: string): ConfigThreatRef | null {
  const raw = rawHash !== undefined ? rawHash : (typeof window !== 'undefined' ? window.location.hash : '')
  const hash = legacyHash(raw) ?? raw
  if (!/^#threat\?/i.test(hash)) return null
  const value = new URLSearchParams(hash.slice(hash.indexOf('?') + 1)).get('config') ?? ''
  const at = value.indexOf(':')
  if (at <= 0 || at === value.length - 1) return null
  return { provider: value.slice(0, at), findingId: value.slice(at + 1) }
}

/** 예외 보기에서 펼쳐 둘 예외 (`#threat?view=exceptions&id=EXC-…`). 옛 `#exceptions?id=` 는 legacyHash 가 바꾼다. 없으면 빈 문자열 */
export function getInitialExceptionId(rawHash?: string): string {
  const hash = rawHash !== undefined ? rawHash : (typeof window !== 'undefined' ? window.location.hash : '')
  const redirected = legacyHash(hash) ?? hash
  const lower = redirected.toLowerCase()
  if (!(lower.startsWith('#threat') && lower.includes('view=exceptions'))) return ''
  const match = redirected.match(/[?&]id=([^&]+)/i)
  return match ? decodeURIComponent(match[1]).toUpperCase() : ''
}

const GRAPH_LEVELS = ['ecosystem', 'tenant', 'scope', 'object'] as const

/**
 * 그래프 주소(`#graph?object=<객체 키>&level=<표시 수준>`)가 가리키는 조사 대상.
 * 그래프 화면이 보던 객체와 표시 수준을 주소에 남겨, 링크를 받은 동료도 같은 객체를 연다.
 */
export function getInitialGraphTarget(): { objectKey?: string; level?: (typeof GRAPH_LEVELS)[number] } {
  if (typeof window === 'undefined') return {}
  const hash = window.location.hash
  if (!/^#graph\?/i.test(hash)) return {}
  const params = new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
  const level = params.get('level') ?? undefined
  return {
    objectKey: params.get('object') ?? undefined,
    level: GRAPH_LEVELS.find(l => l === level),
  }
}

/** 브라우저 탭 제목에 쓰는 화면 이름. 메뉴 이름과 같다 */
export const PAGE_TITLE: Record<Page, string> = {
  Compliance: 'Compliance',
  Home: 'Overview',
  Graph: 'Cross-SaaS Graph',
  Threat: 'Threat',
  Gaps: 'Access Gaps',
  Explorer: 'Explorer',
  Timeline: 'Event Board',
  EventBoard: 'Event Board',
  Credentials: 'Credentials',
  Adapters: 'Adapters',
  Remediation: 'Threat 조치',
  Manual: 'Manual',
  Orbs: 'Orbs',
  ConfigFindings: 'Config Findings',
}

/** Credentials 상세 주소. 화면(CredentialRiskPage)도 이 함수를 쓴다 */
export function credentialDetailHash(key: string, mode: 'token' | 'account' = 'token'): string {
  return `${PAGE_HASH.Credentials}?cred=${encodeURIComponent(key)}&mode=${mode}`
}
