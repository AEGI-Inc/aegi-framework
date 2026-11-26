import type { GraphStoreV2 } from '../model/graph'
import type { Provider } from '../model/object'
import type { EffectiveAccessFile } from '../detection/v2/effectiveAccess/types'
import { EA_LEVEL_LABEL, EA_RULE_LABEL, explainEaRow } from '../findings/eaExplain'
import { providerName } from '../findings/providers'
import { objectName, typeNoun } from '../utils/objectPhrase'
import { toCsv } from '../utils/csv'

/**
 * 사람 한 명의 접근 가능 리소스 표.
 *
 * 침해 대응의 첫 질문은 「이 사람 계정이 탈취되면 어디까지 닿나」다. 전에는 그 사람의 Slack, Okta, GitHub
 * 계정 상세를 하나씩 열어 머릿속으로 합쳐야 했다. 동일인 연결로 묶인 계정들의 수집한 권한 관계(역할, 소속,
 * 소유, 공유)와 계산한 접근(Effective Access)을 리소스 하나에 한 줄로 모아 SaaS별로 나눈다.
 */
export interface PersonAccessRow {
  provider: Provider | string
  providerLabel: string
  /** 이 권한을 가진 그 사람의 계정 */
  account: string
  resourceKey: string
  resource: string
  resourceType: string
  /** 유효 권한: 역할 이름, 구성원, 소유, 공유받음, 계산한 접근 규칙 */
  grant: string
  /** 경유. 직접 받은 권한이면 「직접」 */
  via: string
  /** 근거: 수집한 관계, 계산한 접근과 판정 */
  basis: string
}

/** 계정에서 나가는 관계 중 리소스 권한인 것 */
const OUTGOING: Record<string, (role: string) => string> = {
  has_role_on: role => (role ? `${role} 역할` : '역할 보유'),
  member_of: () => '구성원',
}
/** 리소스에서 계정으로 들어오는 관계 중 권한인 것 */
const INCOMING: Record<string, () => string> = {
  owned_by: () => '소유',
  shared_with: () => '공유 대상',
}

export function personAccessRows(graph: GraphStoreV2, accountKeys: string[], effectiveAccess?: EffectiveAccessFile): PersonAccessRow[] {
  const accounts = new Set(accountKeys)
  const rows: PersonAccessRow[] = []
  const add = (accountKey: string, resourceKey: string, grant: string, via: string, basis: string) => {
    const resource = graph.objectsByKey.get(resourceKey)
    const provider = resource?.canonical.provider ?? ''
    rows.push({
      provider,
      providerLabel: provider ? providerName(provider as Provider) : '',
      account: objectName(graph, accountKey),
      resourceKey,
      resource: objectName(graph, resourceKey),
      resourceType: typeNoun(resource) || String(resource?.catalog_ref?.provider_term ?? resource?.canonical.object_type ?? ''),
      grant,
      via,
      basis,
    })
  }
  const basisOf = (basis: string) => (basis === 'computed' ? '계산한 관계' : '수집한 관계')

  for (const accountKey of accountKeys) {
    for (const relation of graph.outgoingRelationsByObject.get(accountKey) ?? []) {
      const grant = OUTGOING[relation.relationType]
      if (!grant || accounts.has(relation.targetKey)) continue
      const role = relation.roleName ?? (relation.roleKey ? objectName(graph, relation.roleKey) : '')
      add(accountKey, relation.targetKey, grant(role), '직접', basisOf(relation.properties.basis))
    }
    for (const relation of graph.incomingRelationsByObject.get(accountKey) ?? []) {
      const grant = INCOMING[relation.relationType]
      if (!grant || accounts.has(relation.sourceKey)) continue
      add(accountKey, relation.sourceKey, grant(), '직접', basisOf(relation.properties.basis))
    }
  }

  for (const row of effectiveAccess?.rows ?? []) {
    if (row.level === 'denied' || !accounts.has(row.references.source)) continue
    const explained = explainEaRow(graph, row)
    const middle = explained.chain.filter(step => !step.end).map(step => step.name)
    add(row.references.source, row.references.target, EA_RULE_LABEL[row.source.rule], middle.length ? middle.join(', ') : '직접', `계산한 접근, ${EA_LEVEL_LABEL[row.level]}`)
  }

  return rows.sort((a, b) => a.providerLabel.localeCompare(b.providerLabel) || a.resource.localeCompare(b.resource) || a.grant.localeCompare(b.grant))
}

const CSV_HEAD = ['SaaS', '리소스', '유형', '유효 권한', '경유', '근거', '계정']

/** 표를 CSV 글로 */
export function personAccessCsv(rows: PersonAccessRow[]): string {
  return toCsv([CSV_HEAD, ...rows.map(r => [r.providerLabel, r.resource, r.resourceType, r.grant, r.via, r.basis, r.account])])
}
