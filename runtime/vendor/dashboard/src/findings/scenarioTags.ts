import { THREAT_TYPES, type ThreatTypeId } from '../ontology/generated'

/**
 * 위협 분류 태그.
 *
 * 담당자가 Finding 목록을 훑을 때 제목을 다 읽지 않고도 "어떤 종류의
 * 사고인지" 바로 판단할 수 있도록, 위협을 공격 유형 한 단어로 묶는다.
 *
 * 위협 판정 V2 는 유형(primaryType)을 큰 분류 키로 바꿔 붙인다. 같은 큰 분류이면 같은 이름을 쓴다.
 */
export interface ScenarioTag {
  /** 화면에 대괄호 안에 표시되는 짧은 분류명 */
  label: string
  /** 왜 이 분류인지 설명하는 툴팁 문구 */
  description: string
}

/** 탐지와 예외 저장에 쓰는 키는 유지한다. 화면의 큰 분류와 별개다. other 는 분류를 모르는 위협의 예외 키(「기타」) */
export type TagKey = ThreatGroupKey | 'other'
export type ThreatGroupKey = ThreatTypeId | 'credential_risk' | 'config_gap'

/** 위협 유형 하나의 분류. 이름과 뜻은 aegi-knowledge schema/ontology/threat_types.yaml(생성 코드 THREAT_TYPES) */
function typeGroup(id: ThreatTypeId): ScenarioTag {
  const t = THREAT_TYPES.find(x => x.id === id)!
  return { label: t.name, description: t.meaning }
}

/**
 * 화면의 큰 분류. 위협 유형 넷은 aegi-knowledge threat_types.yaml 의 이름과 뜻을 쓴다(2026-11-19 결정).
 * 자격증명 위험은 옛 피해범위 판정(blast_radius) 키라 저장된 예외를 읽으려고 남긴다. 화면 분류 순서(THREAT_GROUP_ORDER)에는 없다(2026-11-12 결정).
 * 설정 점검은 Config Findings 기준별 판정의 위반을 위협 목록에 올릴 때만 쓴다.
 */
export const THREAT_GROUPS: Record<ThreatGroupKey, ScenarioTag> = {
  privilege_escalation: typeGroup('privilege_escalation'),
  unauthorized_access: typeGroup('unauthorized_access'),
  data_exfiltration: typeGroup('data_exfiltration'),
  accountability_loss: typeGroup('accountability_loss'),
  credential_risk: {
    label: '자격증명 위험',
    description: '자격증명 탈취 시 다른 SaaS의 조직 관리 권한까지 접근 가능',
  },
  config_gap: {
    label: '설정 점검',
    description: '공개 보안 기준에 어긋난 SaaS 설정',
  },
}

const OTHER: ScenarioTag = { label: '기타', description: '분류되지 않은 위협' }

export const THREAT_GROUP_ORDER = (Object.keys(THREAT_GROUPS) as ThreatGroupKey[]).filter(key => key !== 'credential_risk')

/** 탭, 주소에 남은 옛 분류 키(authority_abuse 등)를 거르기에서 버릴 때 쓴다 */
export function isThreatGroupKey(key: string): key is ThreatGroupKey {
  return Object.prototype.hasOwnProperty.call(THREAT_GROUPS, key)
}

export function tagGroupKey(key: TagKey | ThreatGroupKey | undefined): ThreatGroupKey | undefined {
  if (!key) return undefined
  return Object.prototype.hasOwnProperty.call(THREAT_GROUPS, key) ? key as ThreatGroupKey : undefined
}

/** 지금 목록에 있는 큰 분류만, 정해진 순서로 표시한다. */
export function tagOptions(keys: Iterable<TagKey | ThreatGroupKey | undefined>): ThreatGroupKey[] {
  const present = new Set([...keys].map(tagGroupKey))
  return THREAT_GROUP_ORDER.filter(key => present.has(key))
}

const GROUP_OF_TYPE: Record<string, ThreatGroupKey> = Object.fromEntries(THREAT_TYPES.map(t => [t.name, t.id]))

/** Finding 의 태그 키: 위협 판정 V2 유형의 큰 분류 키 */
export function findingTagKey(finding: { primaryType?: string }): TagKey | undefined {
  return finding.primaryType ? GROUP_OF_TYPE[finding.primaryType] : undefined
}

export function findingGroupKey(finding: { primaryType?: string }): ThreatGroupKey | undefined {
  return tagGroupKey(findingTagKey(finding))
}

export function scenarioTag(key: TagKey | ThreatGroupKey | undefined): ScenarioTag {
  const groupKey = tagGroupKey(key)
  if (!groupKey) return OTHER
  const group = THREAT_GROUPS[groupKey]
  return { label: group.label, description: group.description }
}

/** 분류 배지의 색 클래스 */
export function tagClass(key: TagKey | ThreatGroupKey | undefined): string {
  return `sc-${tagGroupKey(key) ?? 'other'}`
}

/** 분류 이름으로 검색한다. */
export function classificationSearchTerms(key: TagKey | undefined): string[] {
  return [scenarioTag(key).label]
}

/** 배지에 그대로 넘길 수 있게 키를 달아 둔 분류. */
export interface ScenarioTagEntry extends ScenarioTag {
  key: ThreatGroupKey | 'other'
}

/**
 * 한 Finding에 붙는 분류 목록.
 *
 * 지금 데이터는 Finding 하나에 분류 하나지만, 한 사건이 권한 상승과
 * 비인가 접근을 동시에 갖는 식으로 여러 개가 붙는 경우가 생긴다. 화면은
 * 처음부터 여러 개를 그리도록 두고, 늘어나는 건 여기만 고치면 된다.
 */
export function scenarioTagsFor(keys: TagKey | ThreatGroupKey | undefined | Array<TagKey | ThreatGroupKey | undefined>): ScenarioTagEntry[] {
  const list = Array.isArray(keys) ? keys : [keys]
  const seen = new Set<ThreatGroupKey | 'other'>()
  return list.flatMap(key => {
    const group = tagGroupKey(key) ?? 'other'
    if (seen.has(group)) return []
    seen.add(group)
    return [{ key: group, ...scenarioTag(key) }]
  })
}
