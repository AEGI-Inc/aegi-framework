// 승인 목록과 공개 의도 (docs/spec/AEGI_THREAT_JUDGMENT_V2.md 규칙 5, 7)
//
// 대시보드 Threat 「승인」 보기가 D1 destination_approvals 표에 남긴 행을 게시 때 읽어 판정 그래프 노드에 붙인다.
// 승인은 조직 밖 수신자의 승인 범위(읽기)만 가리고, 그 범위를 넘는 쓰기 이상은 권한 상승으로 남긴다(사례 N20). 판정은 judge.ts 가 한다.
//   승인 목적지: 주소는 그 주소 수신자, 도메인은 그 도메인과 하위 도메인 주소 수신자와 조직 밖 계정, 객체는 그 계정
//   공개 의도: 그 내용 객체(메일함은 mail:계정)
// 취소한 행(revoked_at)은 읽지 않는다.
import type { GraphStoreV2 } from '../../model/graph'
import type { JudgeGraph } from './judge'

export interface ApprovalRow {
  list: 'destination' | 'public'
  kind: 'domain' | 'address' | 'object'
  target: string
  source: 'graph' | 'customer' | 'saas'
}

const EMAIL_FIELDS = ['email', 'primaryEmail', 'emailAddress', 'Email', 'login', 'mail']

function emailOf(graph: GraphStoreV2, key: string): string | undefined {
  const p = graph.objectsByKey.get(key)?.canonical.properties as Record<string, unknown> | undefined
  for (const f of EMAIL_FIELDS) {
    const v = p?.[f]
    if (typeof v === 'string' && v.includes('@')) return v.toLowerCase()
  }
  return undefined
}

const hostMatches = (address: string, domain: string) => {
  const host = address.split('@')[1] ?? ''
  return host === domain || host.endsWith(`.${domain}`)
}

/** 판정 그래프에 승인과 공개 의도를 붙인다. 붙인 노드 수를 돌려준다 */
export function applyApprovals(g: JudgeGraph, rows: ApprovalRow[], graph: GraphStoreV2): { approved: number; publicByDesign: number } {
  let approved = 0
  let publicByDesign = 0
  const people = Object.entries(g.nodes).filter(([, n]) => n.kind === 'person')
  const addressOf = (key: string) => (key.startsWith('outside:') ? key.slice('outside:'.length).toLowerCase() : emailOf(graph, key))
  for (const r of rows) {
    const target = r.kind === 'object' ? r.target.trim() : r.target.trim().toLowerCase()
    if (r.list === 'public') {
      // 주소로 등록한 공개 의도는 그 주소를 가진 계정의 메일함(mail:계정 키)
      const owners = r.kind === 'address' ? Object.keys(g.nodes).filter(k => k.startsWith('mail:') && emailOf(graph, k.slice('mail:'.length)) === target) : []
      for (const k of [target, `mail:${target}`, ...owners]) {
        if (g.nodes[k] && !g.nodes[k].public_by_design) { g.nodes[k] = { ...g.nodes[k], public_by_design: true }; publicByDesign++ }
      }
      continue
    }
    const source = r.source === 'saas' ? 'saas' : 'customer'
    for (const [k, n] of people) {
      // 조직 안 계정은 승인 대상이 아니다
      if (n.org === 'in' || n.org === undefined && !k.startsWith('outside:')) continue
      const address = addressOf(k)
      const hit = r.kind === 'object' ? k === target
        : r.kind === 'address' ? address === target
        : !!address && hostMatches(address, target)
      if (!hit) continue
      const prev = g.nodes[k].approved
      g.nodes[k] = { ...g.nodes[k], approved: prev && prev !== source ? 'both' : source }
      approved++
    }
  }
  return { approved, publicByDesign }
}
