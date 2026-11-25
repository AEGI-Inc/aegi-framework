import type { GraphStore, GraphStoreV2 } from '../model/graph'
import type { EaAffects, EaComputationReason, EaLevel, EaRuleId, EaUndecomposed, EaVia, EffectiveAccessRow } from '../detection/v2/effectiveAccess/types'
import { relationLabel } from '../semantic-graph/edgeExplain'
import { providerName } from './providers'
import { REASON_LABELS } from '../ontology/generated'
import type { Provider } from '../model/object'

/**
 * Effective Access 한 줄을 사람이 읽는 말로 푼다. Cross-SaaS Graph 의 EA 선 상세와
 * Finding 상세의 EA 요약 · 상세 화면이 같이 쓴다.
 *
 * - 누가(source) 무엇에(target) 닿는가 · 판정(성립 / 판정 보류)
 * - 어떻게: 경로 그림(칸과 이음). SaaS 가 바뀌는 자리, 연동, 저장되지 않은 구간, 확인하지 못한 곳, 차단 지점을 그 자리에 붙인다
 */

type Graph = GraphStore | GraphStoreV2

export const EA_LEVEL_LABEL: Record<EaLevel, string> = {
  indeterminate: '미확정',
  computed: '접근 가능',
  computed_cross: 'Cross-SaaS 접근 가능',
  denied: '접근 불가',
}

export const EA_LEVEL_HINT: Record<EaLevel, string> = {
  indeterminate: '경로는 있으나 실제 접근 미확인',
  computed: '한 SaaS 안의 권한으로 접근',
  computed_cross: '다른 SaaS를 거친 접근',
  denied: '접근 경로 없음',
}

export const EA_REASON_TEXT: Record<EaComputationReason, string> = {
  enforcement_unknown: '이 단계 연결 해제 시 차단 여부 미확인',
  public_channel: '공개 채널이라 제거해도 재참여 후 열람 가능',
  channel_visibility_unknown: '채널 공개 여부 미확인',
  runs_as_computed: '자동화가 이 계정 권한으로 실행되는지 확정할 수 없음',
  resource_set_not_expanded: 'Okta 리소스 세트 범위를 펼치지 않아 접근 범위 미확인',
  invoker_gate_not_stored: '봇의 호출자 검사 여부 미확인',
  script_webhook_by_url_fingerprint: '스크립트 코드 속 웹훅 주소로만 이어짐',
  dynamic_holder_unresolved: '보고자, 담당자처럼 이슈마다 정해지거나 제품 접근으로 정해지는 보유자라 확정할 수 없음',
  identity_link_weak: '로그 상관 같은 약한 근거로만 봇과 다른 서비스 계정을 같은 자동화로 판정',
  identity_weak: '이메일 일치 같은 약한 근거로만 두 계정을 동일인으로 판정',
}

export const EA_RULE_LABEL: Record<EaRuleId, string> = {
  runs_as_inherits: '실행 계정 권한 상속',
  x_member_grant: '그룹을 거친 권한',
  x_dynamic_holder: '프로젝트 리드 등 역할로 받은 권한',
  x_acts_as_inherits: '앱이 봇 계정으로 받은 권한',
  x_token_inherits: '토큰이 만든 사람에게서 받은 권한',
}

/** 규칙마다 "어떤 식으로 닿는가"를 한 마디로 */
export const EA_RULE_MEANING: Record<EaRuleId, string> = {
  runs_as_inherits: '실행 계정 권한을 그대로 쓰는 자동화',
  x_member_grant: '그룹, 팀 멤버십으로 상속되는 그룹 권한',
  x_dynamic_holder: 'Jira 권한 설정에서 프로젝트 리드 등 역할로 상속되는 권한',
  x_acts_as_inherits: '앱이 자기 봇 계정의 채널, 권한을 그대로 씀',
  x_token_inherits: '조직 API 토큰이 만든 사람의 관리 권한을 그대로 씀',
}

export const EA_AFFECTS_LABEL = { source_only: '해당 주체만 영향', group: '부수 영향 있음', all_callers: '전체 호출자 영향' } as const

/** 물은 질문. 규칙이 만든 문장은 영문 이름 뒤 조사를 띄워 두어(Role 을) 화면에서만 붙인다 */
export function eaQuestion(row: EffectiveAccessRow): string {
  return row.effect_query.replace(/([A-Za-z0-9)\]]) (을|를|이|가|은|는|에서|에게|에|의|와|과|으로|로)(?=\s|$)/g, '$1$2')
}

/** 판정 보류 · 없음일 때 덧붙이는 한 줄. 누가 · 무엇은 경로 그림에 있으니 되풀이하지 않는다 */
function verdictOf(row: EffectiveAccessRow, unknownCount: number): string {
  if (row.level === 'indeterminate') {
    return unknownCount
      ? `확인하지 못한 단계 ${unknownCount}곳`
      : '경로는 있으나 실제 접근 미확인'
  }
  if (row.level === 'denied') return '접근 경로 없음'
  return ''
}

/** 우리가 못 푼 이유 중 끊어 보기 시험으로 풀 수 있는 것 (EA 검증 §7 과 같은 시험) */
const TESTABLE = new Set<EaComputationReason>(['enforcement_unknown', 'invoker_gate_not_stored'])

/** 못 정한 곳마다 누가 풀 수 있나 */
export function unknownHint(u: EaUndecomposed): string {
  if (u.from === 'relation') return 'SaaS 미구분'
  return TESTABLE.has(u.reason) ? '연결 해제로 확인 가능' : '추가 수집으로 확인할 수 있음'
}

function unknownText(u: EaUndecomposed): string {
  // 엔진이 이 화면보다 먼저 새 사유를 내도 빈칸이 되지 않게, 개념 사전의 사유 이름, 그다음 사유 코드로 대신한다
  return u.from === 'relation'
    ? `SaaS가 합친 값이라 권한 출처 미확인: ${u.vendor_paths.join(', ')}`
    : EA_REASON_TEXT[u.reason] ?? REASON_LABELS[u.reason]?.label ?? String(u.reason)
}

/** 못 정한 단계 수. 한 단계(같은 via, 같은 저장되지 않은 구간)에 이유가 여럿이어도 한 번 센다 */
export function eaUnknownSteps(row: EffectiveAccessRow): number {
  return new Set(row.undecomposed.map(u => (u.at === 'x_gap' ? `x_gap ${u.x_between.join('-')}` : u.at))).size
}

/* 경로 그림: 시작 주체에서 대상까지 칸(항목)과 이음(관계 · 동일인 연결)을 번갈아 늘어놓는다.
   관계는 방향이 제각각이라(웹훅 → 채널 전달 등) 앞 칸에서 본 방향으로 이름을 붙인다. */

/** [앞 칸 → 뒤 칸이 관계 방향과 같을 때, 거꾸로일 때] */
const STEP_LABEL: Record<string, [string, string]> = {
  member_of: ['소속', '멤버'],
  has_role_on: ['역할 부여', '역할 부여'],
  permits: ['접근 허용', '접근을 허용받음'],
  runs_as: ['이 계정 권한으로 실행', '이 계정으로 실행되는 자동화'],
  acts_as: ['대리 실행', '대리 실행 앱'],
  receives_into: ['받은 내용을 전달', '내용을 전달받음'],
  contained_in: ['상위 항목', '하위 항목'],
  owned_by: ['소유자', '소유함'],
  registered_in: ['설치 위치', '설치된 앱'],
  registered_by: ['등록자', '등록함'],
  authenticates_with: ['이 수단으로 로그인', '이 수단을 쓰는 계정'],
  triggered_by: ['트리거', '트리거 대상'],
  shared_with: ['공유됨', '공유됨'],
  applies_to: ['적용 대상', '적용되는 정책'],
}

export interface EaPathWarning {
  text: string
  hint: string
}

export type EaPathItem =
  | { kind: 'node'; obj: EaObj; end: boolean }
  | {
      kind: 'link'
      /** via 인덱스. 저장되지 않은 구간이면 null */
      via: number | null
      label: string
      /** 약한 이음: 추정 동일인 연결, 벤더 합산값 */
      weak?: string
      warnings: EaPathWarning[]
      cut?: { affects: EaAffects; note: string }
      /** 마우스를 올리면 보이는 원래 값 (관계 종류 · 연결 수준) */
      title?: string
    }
  | { kind: 'cross'; from: string; to: string }

function viaEnds(via: EaVia): [string, string] {
  return via.kind === 'link' ? [via.a, via.b] : [via.source, via.target]
}

export function eaPath(graph: Graph, row: EffectiveAccessRow): EaPathItem[] {
  const items: EaPathItem[] = []
  const warnAt = new Map<number, EaPathWarning[]>()
  const gapWarn = new Map<number, EaPathWarning[]>()
  for (const u of row.undecomposed) {
    const w = { text: unknownText(u), hint: unknownHint(u) }
    const bucket = u.at === 'x_gap' ? gapWarn : warnAt
    const at = u.at === 'x_gap' ? u.x_between[1] : Number(u.at.slice(4, -1))
    bucket.set(at, [...(bucket.get(at) ?? []), w])
  }
  const cutAt = new Map(row.cut.map(c => [c.via, c.x_scope]))
  let last = eaObj(graph, row.references.source)
  const pushNode = (obj: EaObj) => {
    if (obj.providerLabel && last.providerLabel && obj.providerLabel !== last.providerLabel) {
      items.push({ kind: 'cross', from: last.providerLabel, to: obj.providerLabel })
    }
    items.push({ kind: 'node', obj, end: obj.key === row.references.source || obj.key === row.references.target })
    last = obj
  }
  items.push({ kind: 'node', obj: last, end: true })

  row.via.forEach((via, i) => {
    const [a, b] = viaEnds(via)
    let forward = a === last.key
    if (!forward && b !== last.key) {
      // 앞 칸과 이어지지 않는다: 저장되지 않은 구간을 점선으로 두고 이 단계의 시작 칸부터 잇는다
      forward = b === row.references.target || via.kind === 'link'
      items.push({ kind: 'link', via: null, label: '연결 없음', warnings: gapWarn.get(i) ?? [] })
      gapWarn.delete(i)
      pushNode(eaObj(graph, forward ? a : b))
    }
    const next = eaObj(graph, forward ? b : a)
    const scope = cutAt.get(i)
    const warnings = [...(gapWarn.get(i) ?? []), ...(warnAt.get(i) ?? [])]
    if (via.kind === 'link') {
      const weak = !LINK_STRONG.has(via.level)
      items.push({
        kind: 'link', via: i, warnings,
        label: weak ? '동일인 연결 추정' : '동일인 연결',
        weak: weak ? '추정 연결' : undefined,
        cut: scope && { affects: scope.affects, note: scope.note },
        title: `동일인 연결 ${via.level}, ${via.rule}`,
      })
    } else {
      const role = via.role ? eaObj(graph, via.role).name : undefined
      const [fwd, rev] = STEP_LABEL[via.relation_type] ?? [relationLabel(via.relation_type), relationLabel(via.relation_type)]
      items.push({
        kind: 'link', via: i, warnings,
        label: role ? `${forward ? fwd : rev}: ${role}` : forward ? fwd : rev,
        weak: via.basis !== 'stated' ? 'SaaS 합산값' : undefined,
        cut: scope && { affects: scope.affects, note: scope.note },
        title: `${via.relation_type}, ${via.ref}`,
      })
    }
    pushNode(next)
  })
  return items
}

const INTEGRATION_INTERFACES = new Set(['Integration', 'Automation', 'Endpoint', 'Credential'])

export interface EaObj {
  key: string
  name: string
  provider: string
  providerLabel: string
  type: string
  /** 연동 · 자동화 · 웹훅 · 자격증명 */
  integration: boolean
}

export interface EaExplanation {
  row: EffectiveAccessRow
  source: EaObj
  target: EaObj
  levelLabel: string
  /** 규칙이 말하는 닿는 방식 */
  how: string
  /** 경로가 지나간 SaaS 순서 (연속 중복 제거) */
  saasTrail: string[]
  /** 저장되지 않은 구간 · 못 정한 이유 */
  unknowns: string[]
  /** 못 정한 단계 수. 한 단계에 이유가 여럿이어도 한 번 센다 */
  unknownSteps: number
  /** 물은 질문 (조사 붙임) */
  question: string
  /** 판정 보류 · 없음일 때 덧붙이는 한 줄 (성립이면 빈 문자열) */
  verdict: string
  /** 경로 그림 */
  path: EaPathItem[]
  /** 경로의 칸 이름을 이은 한 줄. 두 끝은 굵게, 저장되지 않은 구간 뒤 칸은 gap */
  chain: Array<{ name: string; end: boolean; gap: boolean }>
}

export function eaObj(graph: Graph, key: string): EaObj {
  const obj = graph.objectsByKey.get(key)
  const provider = obj?.canonical.provider ?? ''
  return {
    key,
    name: String(obj?.fixture_meta?.display_name ?? obj?.canonical.properties?.name ?? key),
    provider,
    providerLabel: provider ? providerName(provider as Provider) : '',
    type: String(obj?.catalog_ref?.provider_term ?? obj?.canonical.object_type ?? ''),
    integration: !!obj?.canonical.interfaces.some(i => INTEGRATION_INTERFACES.has(i)),
  }
}

const LINK_STRONG = new Set(['resolved', 'disclosed_relation'])

export function explainEaRow(graph: Graph, row: EffectiveAccessRow): EaExplanation {
  const path = eaPath(graph, row)
  const saasTrail: string[] = []
  const chain: EaExplanation['chain'] = []
  let afterGap = false
  for (const item of path) {
    if (item.kind === 'link') afterGap = item.via === null
    if (item.kind !== 'node') continue
    chain.push({ name: item.obj.name, end: item.end, gap: afterGap })
    if (item.obj.providerLabel && saasTrail[saasTrail.length - 1] !== item.obj.providerLabel) saasTrail.push(item.obj.providerLabel)
  }
  const unknowns = row.undecomposed.map(unknownText)
  const unknownSteps = eaUnknownSteps(row)
  return {
    row, saasTrail, unknowns, unknownSteps, path, chain,
    source: eaObj(graph, row.references.source),
    target: eaObj(graph, row.references.target),
    levelLabel: EA_LEVEL_LABEL[row.level],
    how: EA_RULE_MEANING[row.source.rule],
    question: eaQuestion(row),
    verdict: verdictOf(row, unknownSteps),
  }
}
