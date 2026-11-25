import { peopleAt, type PathStep, type PeopleAnswer, type PersonAccess, type ScenarioGraph } from './scenarioGraph'
import { THREAT_TYPES, THREAT_TYPE_ORDER, type ThreatTypeName } from '../ontology/generated'
import { personOf } from '../data/accessTableStore'

/**
 * 경로 위험 점수 (PoC). 만든 경로의 진입점이 영향 노드에 「직접 권한으로는 못 하는데 경로로는 할 수 있는 것」이 있으면 과다로 보고,
 * 종류 점수 × 자산 점수로 High, Medium, Low 를 낸다. 멘토 피드백(2026-11-01) 「위협 유형 점수 × 자산 점수, 느낌만」을 따른 제안값이다.
 * 과다 판정은 분석 칸과 같은 접근 표 줄(peopleAt)을 진입점 한 사람에게 적용한 것이다.
 * 자산 점수는 내용을 보지 않고 객체 종류와 공개 범위 속성만 본다. 순서는 Cerebro asset-risk-v1(종류로 기본값, 속성으로 올림)을 따른다.
 */

/** 종류 점수. 읽기로 생기는 것 4, 쓰기로 생기는 것 5 */
const KIND_SCORE = { read: 4, write: 5 } as const

/** 유형 이름 순서(aegi-knowledge threat_types.yaml order) */
export const TYPE_ORDER: ThreatTypeName[] = THREAT_TYPE_ORDER.map(id => THREAT_TYPES.find(t => t.id === id)!.name)

/**
 * 그 사람에게 생기는 위협 유형 이름(aegi-knowledge threat_types.yaml, 2026-11-19 결정). 접근 표의 직접 권한이 없으면 비인가 접근,
 * 있으면 권한 상승. 조직 밖 직접 공유로 선 권한(share)은 기준선이 아니라 비인가 접근
 */
export const kindOf = (p: Pick<PersonAccess, 'direct' | 'share'>): ThreatTypeName => (p.direct && !p.share ? '권한 상승' : '비인가 접근')

/** 기본값 2인 자원 종류 (레코드, 파일, 저장소). 나머지 자원(채널, 페이지, 이슈, 스페이스, 프로젝트)은 1 */
const RECORD_TYPES = new Set(['Repository', 'File', 'Message', 'Mailbox'])
/** 고객 개인정보 묶음으로 보는 종류. 지금 데이터셋에는 레코드가 수집되지 않아 없다 */
const PERSONAL_TYPES = new Set(['Lead', 'Contact'])

export interface AssetScore { score: 1 | 2 | 3; reason: string; note?: string }

const isRestricted = (p: Record<string, unknown>) => p.private === true || p.visibility === 'private' || p.is_private === true || p.isPrivate === true || p.is_private_project === true

/** 담긴 곳(contained_in)을 위로 따라가며 비공개인 곳이 있는가. 커밋이 비공개 저장소 안에 있는 것처럼 */
function inRestricted(sg: ScenarioGraph, key: string, depth = 0): string | undefined {
  if (depth > 3) return undefined
  for (const r of sg.graph.outgoingRelationsByObject.get(key) ?? []) {
    if (r.relationType !== 'contained_in') continue
    if (isRestricted(sg.graph.objectsByKey.get(r.targetKey)?.canonical.properties ?? {})) return r.targetKey
    const up = inRestricted(sg, r.targetKey, depth + 1)
    if (up) return up
  }
  return undefined
}

export function assetScore(sg: ScenarioGraph, key: string): AssetScore {
  const ix = sg.engine.ix
  const type = sg.objectType(key)
  const p = sg.graph.objectsByKey.get(key)?.canonical.properties ?? {}
  if (ix.has(key, 'Credential')) return { score: 3, reason: '자격증명' }
  if (ix.isTenant(key) || ix.has(key, 'Policy') || ix.has(key, 'Assignment')) return { score: 3, reason: '권한, 설정' }
  if (ix.isPerson(key)) return { score: 3, reason: '계정, 인증 수단' }
  if (PERSONAL_TYPES.has(type)) return { score: 3, reason: '고객 개인정보 묶음' }
  const parent = isRestricted(p) ? undefined : inRestricted(sg, key)
  const restricted = isRestricted(p) ? '비공개' : parent ? `비공개 ${sg.name(parent)} 안` : ''
  const base: 1 | 2 = RECORD_TYPES.has(type) ? 2 : 1
  const note = p.is_general === true ? '전원 채널. 쓰기를 3점으로 올릴지 미정' : undefined
  return { score: restricted ? 2 : base, reason: `${sg.typeLabel(key)}${restricted ? `, ${restricted}` : ''}`, note }
}

export const grade = (s: number) => (s >= 12 ? 'High' : s >= 8 ? 'Medium' : 'Low')

export interface PathScore {
  /** 진입점이 이 경로로 영향에 대해 받는 판정 (읽기, 쓰기 각각) */
  checks: Array<{ need: 'read' | 'write'; side: string; gapPeople: number }>
  kind?: { label: string; score: number }
  asset: AssetScore
  total: number
  grade: 'High' | 'Medium' | 'Low' | '-'
  /** 엔진이 진입점의 새 권한을 미확정으로 본 경우 */
  inferred: boolean
  /** 미확정일 때 그 이유(접근 표 gained 의 이유) */
  doubt?: string
  /** 과다가 아닐 때 이유 */
  why?: string
}

/** 진입점 계정이 엔진 답의 어느 쪽인가. 그룹, 누구나 진입점이면 차집합 인원으로 본다 */
function entrySide(sg: ScenarioGraph, entry: string, a: PeopleAnswer): { side: string; gapPeople: number; doubt?: string; people: PersonAccess[] } {
  const gap = a.people.filter(p => p.side === 'gap' || p.side === 'gap_inferred')
  if (!sg.engine.ix.isPerson(entry)) return { side: gap.length || a.everyone ? 'gap_group' : 'none', gapPeople: gap.length, people: gap }
  // 진입 계정이 어느 사람인지는 엔진 접근 표의 같은 사람 묶음(accounts)으로만 찾는다
  const person = personOf(entry)
  const me = a.people.find(p => p.key === person)
  const doubt = me?.side !== 'gap_inferred' ? undefined : `엔진 추정 이유 ${me.reasons.join(', ') || '기록 없음'}`
  return { side: me?.side ?? 'none', gapPeople: gap.length, doubt, people: me ? [me] : [] }
}

export function scorePath(sg: ScenarioGraph, path: PathStep[]): PathScore {
  const entry = path[0].key
  const asset = assetScore(sg, path[path.length - 1].key)
  const sides = (['write', 'read'] as const).map(need => ({ need, ...entrySide(sg, entry, peopleAt(sg, path, need)) }))
  const checks = sides.map(({ people: _people, ...c }) => c)
  const over = sides.find(c => c.side === 'gap' || c.side === 'gap_inferred' || c.side === 'gap_group')
  if (!over) {
    const why = checks.some(c => c.side === 'both' || c.side === 'native_only') ? '진입점이 직접 권한으로도 할 수 있음' : '이 경로로 진입점이 영향 노드에 접근 가능하다는 엔진 판정 없음'
    return { checks, asset, total: 0, grade: '-', why, inferred: false }
  }
  const names = new Set(over.people.map(kindOf))
  const kind = { label: TYPE_ORDER.filter(n => names.has(n)).join(', ') || '비인가 접근', score: KIND_SCORE[over.need] }
  const total = kind.score * asset.score
  return { checks, kind, asset, total, grade: grade(total), inferred: over.side === 'gap_inferred', doubt: over.doubt }
}
