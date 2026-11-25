/**
 * 조치 동사 (4층): 끊는 곳에 동사를 짝짓고 EA 회수 지점 설명 문장틀을 채운다. 동사와 문장틀은 knowledge 조치 동사 사전이고
 * (사본 ontology/cut_actions.yaml, 생성 src/ontology/generated.ts 의 CUT_ACTIONS, CUT_PHRASES), 여기서는 틀의 {이름} 자리만 채운다.
 * EA 회수 지점 설명(운영 EA scripts/accessRules/production.ts 와 손코드 effectiveAccess/rules 의 x_scope.note)이 부른다.
 * 틀을 바꾸거나 동사를 닫으려면 aegi-knowledge 를 고친 뒤 npm run ontology:sync 한다.
 *
 * 동사 짝짓기는 knowledge Cut_Action_Schema_v1 「잰 것」과 같다: 관계의 SaaS(양 끝이 다르면 「출발>도착」), 관계 이름,
 * 양 끝 interface 가 SaaS 빈칸 한 줄의 cut 과 맞는가. 역할 이름이 적힌 줄이 먼저다. 배포 접근 간선(T, 객체 참조)은 사전 규칙 deployments 줄이다.
 * 정규화 그림자(scripts/cutActions/shadow.ts)는 닫은 동사와 열린 동사를 함께 센다.
 */
import type { GraphStoreV2 } from '../model/graph'
import type { ResolvedRelation } from '../model/relation'
import type { CutOption } from './v2/engine/types'
import { CUT_ACTIONS, CUT_PHRASES, type CutActionRow, type CutActionVerb } from '../ontology/generated'
import { josa, type JosaPair } from '../utils/objectPhrase'

export { CUT_ACTIONS, CUT_PHRASES }
export type { CutActionRow, CutActionVerb }
/** 끊는 곳 하나에 고른 동사(SaaS 빈칸 줄로) */
export interface VerbMatch { verb: string; name: string; adopted: boolean; checked?: string; row?: CutActionRow }

const pairFits = (pair: string | undefined, src: readonly string[], tgt: readonly string[]) => {
  const [a, b] = String(pair).split('>')
  return src.includes(a) && tgt.includes(b)
}
const match = (v: CutActionVerb, row: CutActionRow): VerbMatch => ({ verb: v.id, name: v.name, adopted: v.status === 'adopted', checked: row.checked, row })

/**
 * 틀의 {이름}, {이름|조사} 자리를 채운다. 값이 빠진 자리가 있으면 문장이 깨지므로 예외.
 * allowEmpty 면 빈 글은 그대로 넣는다(EA 회수 지점 설명은 객체 이름이 비어도 옛 문구처럼 낸다)
 */
export function fillPhrase(template: string, values: Readonly<Record<string, string | number | undefined>>, where: string, allowEmpty = false): string {
  return template.replace(/\{([^{}|]+)(?:\|([^{}]+))?\}/g, (_, name: string, pair?: string) => {
    const value = values[name]
    if (value === undefined || (value === '' && !allowEmpty)) throw new Error(`조치 문장틀 ${where} 의 {${name}} 값이 없다`)
    return pair ? josa(String(value), pair as JosaPair) : String(value)
  })
}

/** 관계 하나를 끊는 동사. SaaS 빈칸 줄이 맞는 동사가 없으면 undefined */
export function verbForRelation(rel: ResolvedRelation, graph: GraphStoreV2, verbs: ReadonlyArray<CutActionVerb> = CUT_ACTIONS): VerbMatch | undefined {
  const src = graph.objectsByKey.get(rel.sourceKey)?.canonical
  const tgt = graph.objectsByKey.get(rel.targetKey)?.canonical
  if (!src || !tgt) return undefined
  const provider = src.provider === tgt.provider ? src.provider : `${src.provider}>${tgt.provider}`
  // 역할 이름: 이름 자리, 없으면 역할 객체의 properties.role_name (knowledge capabilities.yaml role_name_from)
  const roleObj = rel.roleKey ? graph.objectsByKey.get(rel.roleKey)?.canonical : undefined
  const role = rel.roleName ?? (roleObj?.properties?.role_name !== undefined ? String(roleObj.properties.role_name) : undefined)
  for (const withRole of [true, false]) {
    for (const v of verbs) {
      const row = v.saas.find(s => s.provider === provider && s.relation === rel.relationType
        && pairFits(s.pair, src.interfaces, tgt.interfaces) && (withRole ? !!s.role && s.role === role : !s.role))
      if (row) return match(v, row)
    }
  }
  return undefined
}

/** 사전 규칙(relation_semantics.yaml rules)이 만든 간선을 끊는 동사 */
export function verbForRule(provider: string, rule: string, verbs: ReadonlyArray<CutActionVerb> = CUT_ACTIONS): VerbMatch | undefined {
  for (const v of verbs) {
    const row = v.saas.find(s => s.provider === provider && s.rule === rule)
    if (row) return match(v, row)
  }
  return undefined
}

/** 회수 후보 간선 하나를 끊는 동사(SaaS 빈칸 줄로). 관계에서 온 간선은 그 관계로, 배포 접근 간선은 deployments 규칙으로 */
export function verbForCut(cut: CutOption, graph: GraphStoreV2, verbs: ReadonlyArray<CutActionVerb> = CUT_ACTIONS): VerbMatch | undefined {
  const rel = cut.edge.refs.find(r => r.type === 'relation')
  if (rel) {
    const r = graph.relationsByKey.get(rel.id)
    return r ? verbForRelation(r, graph, verbs) : undefined
  }
  if (cut.edge.kind === 'T' && cut.edge.refs.some(r => r.type === 'reference') && cut.edge.label.startsWith('배포 ')) {
    const provider = graph.objectsByKey.get(cut.edge.to)?.canonical.provider
    return provider ? verbForRule(provider, 'deployments', verbs) : undefined
  }
  return undefined
}

/** EA 회수 지점(access_rules.yaml 의 <규칙 id>.<홉 이름>) */
export type EaCutHop = keyof typeof CUT_PHRASES.ea_cut

/** EA 회수 지점 설명(cut 의 x_scope.note): 그 회수 지점에서 끊으면 누가 영향을 받나. 사전 phrases.ea_cut 의 틀을 채운다 */
export function eaCutNote(hop: EaCutHop, values: Readonly<Record<string, string | number | undefined>> = {}): string {
  return fillPhrase(CUT_PHRASES.ea_cut[hop], values, `phrases.ea_cut.${hop}`, true)
}
