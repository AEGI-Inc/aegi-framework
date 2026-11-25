import type { Page } from '../appRouting'

export const DASHBOARD_GUIDES = [
  { page: 'Compliance', title: 'Compliance', detail: 'ISMS-P 또는 PIPA의 공식 항목과 세부 질문을 선택하고 대상과 회사 기준 초안을 작성합니다. 원문과 적용 조건, 범위 밖을 확인하고 이 브라우저에 초안을 저장하거나 내보낼 수 있습니다. 분석 API와 검사 기록은 연결 전이며 실행 결과나 준수 판정을 제공하지 않습니다. 새로 생기거나 바뀐 기준(예: 강화 인증기준(안))으로 검사하려면 AI에게 기준 문장을 알려 주면 검사 데이터, 필드, 요구값, 결합 방식을 정해 판정하고 인증기준 상세에 초안으로 붙입니다. 요구값은 기준 문장에 있을 때만 넣고, 없으면 관측값만 보이며 판정 불가로 둡니다. 초안은 사람이 확인해 저장합니다.' },
  { page: 'Home', title: 'Overview', detail: '수집된 SaaS 현황, 위협과 예외 요약을 확인합니다. 위험 조사부터 시작하려면 Threat, 연결 구조를 보려면 Cross-SaaS Graph를 엽니다.' },
  { page: 'Graph', title: 'Cross-SaaS Graph', detail: 'SaaS, 조직, 보안 범위, 객체 보기 단위와 SaaS 필터를 선택합니다. 우측 하단 AEGI AI로 조사합니다. 객체나 선을 선택한 뒤 AEGI AI를 누르면 선택 대상을 전달합니다. 동일인 연결과 구조 경로는 실제 접근 권한과 다릅니다. Effective Access는 계산된 Effective Access 결과를 보여줍니다.' },
  { page: 'Explorer', title: 'Explorer', detail: 'SaaS 연결 탭에서 SaaS가 어떤 연결 방식(OAuth 앱, AI 에이전트/자동화, API 토큰/키, SSO나 계정 연결)으로 다른 SaaS와 이어지는지 고르고 검색합니다. 경로 만들기 탭에서 진입점부터 홉을 이어 경로를 만들고, 자산 탭에서 자산에 닿는 다른 SaaS 연결을 찾습니다. 검색 결과에서 위협 상세와 Event Board로 넘어갑니다.' },
  { page: 'Threat', title: 'Threat', detail: '현재 표시 범위의 탐지를 심각도와 확인 상태로 검토합니다. 상세에서 탐지 이유, 관측, 관련 객체, 추정 부분과 조치 권고를 확인합니다. 예외 적용 탐지는 기본 목록에서 제외될 수 있습니다. 제목 줄의 예외 보기에서 예외의 사유, 범위, 만료와 재검토 상태를 확인합니다. 범위 중 목적지 전체는 한 조직 밖 목적지로 가는 데이터 반출 위협을 모두 제외합니다. 예외 등록과 해제는 화면에서 사람이 수행하며, 예외 처리는 실제 SaaS 권한을 제거하거나 위협을 해결하지 않습니다.' },
  { page: 'Gaps', title: 'Access Gaps', detail: '위협마다 대상에 직접 권한이 있는 사람과 연동 지점으로 닿는 사람을 두 원으로 비교합니다. 직접 권한 없이 새로 권한이 생긴 권한 없는 접근자와 직접 권한보다 높은 권한이 생긴 권한 초과 접근자를 세고, 미확정과 수에서 뺀 관리자, 승인된 사람을 구분합니다. 인원은 사람 단위이며 계정 개수와 다릅니다.' },

  { page: 'EventBoard', title: 'Event Board', detail: '세로는 SaaS, 가로는 시간인 조사 보드입니다. 기간 조회, 위협 객체 조회, AI 검색 결과의 이벤트가 모두 보드에 올라가고, 긴 빈 구간은 물결 칸으로 접힙니다. 같은 행위자, 대상이 다음 행위자 같은 연결선은 키가 같다는 사실이고, 분석가 연결은 분석가의 판단입니다. 이벤트를 표시하고 메모를 남깁니다. AI 검색은 집계하지 않은 원본 이벤트로 받아야 보드에 올라갑니다. 0건은 그 범위에서 찾지 못했다는 뜻이며 활동이 없었다는 뜻이 아닙니다. 조사 상태와 담당자는 팀 공용 저장소에 남깁니다.' },
  { page: 'Adapters', title: 'Adapters', detail: 'Slack, GitHub, Okta, Google Workspace 연결과 수집 상태를 확인하고 수집 자격증명 대장을 관리합니다. 대장 항목과 그래프의 분석용 자격증명은 별도 데이터이며 대장 상세는 AI 조회 대상이 아닙니다. AI는 마지막 수집 시각과 게시된 API 수집 범위를 조회하며, API 범위와 감사 이벤트 범위를 구분합니다. 현재 데이터는 수집 시점의 스냅샷입니다. 새 SaaS 연결이나 수집 설정 변경은 사람이 수행합니다.' },
  { page: 'Manual', title: 'Manual', detail: '화면과 버튼 사용법, 보안 그래프와 권한 결론의 해석, 수집 범위와 제한을 확인합니다.' },
] as const satisfies readonly { page: Page; title: string; detail: string }[]

export interface AssistantSelection {
  objectKeys: string[]
  relationKeys: string[]
  linkIds: string[]
  findingIds: string[]
  eaRowIds: string[]
}

export interface BoardWorkspace {
  title: string
  threats: Array<{
    source: 'finding' | 'gap' | 'config'
    refId: string
    title: string
    objectKeys: string[]
    relationKeys: string[]
    outsidePeople: string[]
  }>
  queries: Array<{
    from: string
    to: string
    objectKeys: string[]
    providers: string[]
  }>
  pinnedEvents: string[]
  pinnedObjects: string[]
  links: Array<{
    from: string
    to: string
    note: string
  }>
  notes: string[]
  candidates: Array<{
    kind: string
    objectKeys: string[]
  }>
}

export interface WorkspaceContext {
  page: Page
  selection: AssistantSelection
  timeline?: { eventKey?: string }
  board?: BoardWorkspace
}

export interface AssistantNavigation { page: Page; label: string; objectKey?: string; findingId?: string; gapId?: string; eventKey?: string; criterion?: string }
/** submit 이면 질문을 입력칸에 넣지 않고 바로 보낸다(공개 데모 단계 안내의 추천 질문). 선택이 비었으면 지금 대화의 대상을 그대로 둔다 */
export interface AssistantSeed { eventKey?: string; id: number; selection: AssistantSelection; question: string; submit?: boolean }
/** 자산(파일, 채널 등) 답변 아래 질문 도구와 공개 데모 단계 안내가 같은 질문을 쓴다 */
export const ASSET_ACCESS_QUESTION = '이 자산에 접근 가능한 사람 모두 보여줘'
export const emptySelection = (): AssistantSelection => ({ objectKeys: [], relationKeys: [], linkIds: [], findingIds: [], eaRowIds: [] })
export const SELECTION_LIMIT = 40
/** 데모 화면(Orbs)처럼 안내가 없는 화면은 서버가 거절한다. 그런 화면에서는 현재 화면을 보내지 않는다 (#172). */
export const hasGuide = (page: unknown): page is Page => DASHBOARD_GUIDES.some(g => g.page === page)

/** Only exact local IDs and allowlisted pages cross the model boundary. */
export function parseWorkspace(value: unknown): WorkspaceContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>; const page = v.page === 'Timeline' ? 'EventBoard' : v.page
  if (Object.keys(v).some(k => !['page', 'selection', 'timeline', 'board'].includes(k)) || !hasGuide(page) || !v.selection || typeof v.selection !== 'object' || Array.isArray(v.selection)) return null
  if (v.timeline !== undefined) {
    if (page !== 'EventBoard' || !v.timeline || typeof v.timeline !== 'object' || Array.isArray(v.timeline)) return null
    const t = v.timeline as Record<string, unknown>
    if (Object.keys(t).some(k => k !== 'eventKey') || (t.eventKey !== undefined && (typeof t.eventKey !== 'string' || !t.eventKey.trim() || t.eventKey.length > 512))) return null
  }
  const s = v.selection as Record<string, unknown>, keys = Object.keys(emptySelection())
  if (Object.keys(s).length !== keys.length || keys.some(k => !Array.isArray(s[k]) || (s[k] as unknown[]).length > SELECTION_LIMIT || (s[k] as unknown[]).some(x => typeof x !== 'string' || !x.trim() || x.length > 512))) return null

  if (v.board !== undefined) {
    if (v.page !== 'EventBoard' || !v.board || typeof v.board !== 'object' || Array.isArray(v.board)) return null
    const b = v.board as Record<string, unknown>
    const expectedKeys = ['title', 'threats', 'queries', 'pinnedEvents', 'pinnedObjects', 'links', 'notes', 'candidates']
    if (Object.keys(b).length !== expectedKeys.length || expectedKeys.some(k => !Object.prototype.hasOwnProperty.call(b, k))) return null
    if (typeof b.title !== 'string' || b.title.length > 120) return null

    const validNonEmptyKey = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= 512
    const validKeyList = (arr: unknown, max: number): arr is string[] =>
      Array.isArray(arr) && arr.length <= max && arr.every(validNonEmptyKey)

    // threats <= 6
    if (!Array.isArray(b.threats) || b.threats.length > 6) return null
    for (const t of b.threats) {
      if (!t || typeof t !== 'object' || Array.isArray(t)) return null
      const rec = t as Record<string, unknown>
      const tKeys = ['source', 'refId', 'title', 'objectKeys', 'relationKeys', 'outsidePeople']
      if (Object.keys(rec).length !== tKeys.length || tKeys.some(k => !Object.prototype.hasOwnProperty.call(rec, k))) return null
      if (!['finding', 'gap', 'config'].includes(rec.source as string)) return null
      if (!validNonEmptyKey(rec.refId)) return null
      if (typeof rec.title !== 'string' || rec.title.length > 120) return null
      if (!validKeyList(rec.objectKeys, 20) || !validKeyList(rec.relationKeys, 20) || !validKeyList(rec.outsidePeople, 20)) return null
    }

    // queries <= 8
    if (!Array.isArray(b.queries) || b.queries.length > 8) return null
    for (const q of b.queries) {
      if (!q || typeof q !== 'object' || Array.isArray(q)) return null
      const rec = q as Record<string, unknown>
      const qKeys = ['from', 'to', 'objectKeys', 'providers']
      if (Object.keys(rec).length !== qKeys.length || qKeys.some(k => !Object.prototype.hasOwnProperty.call(rec, k))) return null
      if (typeof rec.from !== 'string' || rec.from.length > 512 || typeof rec.to !== 'string' || rec.to.length > 512) return null
      if (!validKeyList(rec.objectKeys, 20)) return null
      if (!Array.isArray(rec.providers) || rec.providers.length > 20 || rec.providers.some(p => typeof p !== 'string' || p.length > 512)) return null
    }

    // pinnedEvents <= 40, pinnedObjects <= 40
    if (!validKeyList(b.pinnedEvents, 40) || !validKeyList(b.pinnedObjects, 40)) return null

    // links <= 30
    if (!Array.isArray(b.links) || b.links.length > 30) return null
    for (const l of b.links) {
      if (!l || typeof l !== 'object' || Array.isArray(l)) return null
      const rec = l as Record<string, unknown>
      const lKeys = ['from', 'to', 'note']
      if (Object.keys(rec).length !== lKeys.length || lKeys.some(k => !Object.prototype.hasOwnProperty.call(rec, k))) return null
      if (!validNonEmptyKey(rec.from) || !validNonEmptyKey(rec.to)) return null
      if (typeof rec.note !== 'string' || rec.note.length > 300) return null
    }

    // notes <= 10 (each <= 500 chars)
    if (!Array.isArray(b.notes) || b.notes.length > 10 || b.notes.some(n => typeof n !== 'string' || n.length > 500)) return null

    // candidates <= 12
    if (!Array.isArray(b.candidates) || b.candidates.length > 12) return null
    for (const c of b.candidates) {
      if (!c || typeof c !== 'object' || Array.isArray(c)) return null
      const rec = c as Record<string, unknown>
      const cKeys = ['kind', 'objectKeys']
      if (Object.keys(rec).length !== cKeys.length || cKeys.some(k => !Object.prototype.hasOwnProperty.call(rec, k))) return null
      if (!validNonEmptyKey(rec.kind)) return null
      if (!validKeyList(rec.objectKeys, 20)) return null
    }

    // whole JSON.stringify(board) <= 30_000
    if (JSON.stringify(b).length > 30_000) return null
  }

  return {
    page: page as Page,
    selection: s as unknown as AssistantSelection,
    ...(v.timeline ? { timeline: v.timeline as WorkspaceContext['timeline'] } : {}),
    ...(v.board ? { board: v.board as BoardWorkspace } : {}),
  }
}
