// 벤더 속성에서 판정 간선을 만드는 표 (2026-11-11 결정: 정규화와 relation 규칙은 고치지 않고 엔진 어휘 쪽 표로 둔다)
//
// 관계 행이 없는 두 구성을 표의 속성 경로로 읽어 간선으로 바꾼다. 판정(judge.ts)은 SaaS 이름 없이 간선만 읽는다.
// 표는 aegi-knowledge ontology 로 옮길 대상이다(문서 단계).
// 회수 가능(revocable): 표가 읽은 값이 관리자가 바꾸는 설정이면 그 간선만 붙인다(전달 설정, 실행 방식).
// 본인 메일함, 받는 쪽 메일함, 작성자처럼 소유에서 나온 간선은 설정으로 회수하지 못해 붙이지 않는다
//   조직 밖 자동 전달: 계정 속성의 전달 주소가 조직 도메인 밖이면 내용에서 조직 밖 수신자로 데이터 흐름
//   접속자 권한 실행: 접속자 권한으로 도는 자동화에 관리 범위가 있으면 작성자가 호출자의 관리 권한을 빌림.
//     작성자 관리 권한은 정규화 owned_by 관계가 내고, 표는 그 관계가 없는 옛 데이터셋에만 덧붙인다. scope 표는 aegi-knowledge#306 결정 뒤 개념 사전으로 옮긴다
import type { GraphStoreV2 } from '../../model/graph'
import type { FixtureObject } from '../../model/object'
import type { BorrowCap, JudgeGraph } from './judge'

type Props = Record<string, unknown>

export const VENDOR_EDGES = {
  orgDomains: [
    { provider: 'gws', objectType: 'Customer', path: 'customerDomain', emailDomain: false },
    { provider: 'gws', objectType: 'User', path: 'primaryEmail', emailDomain: true },
  ],
  outsideForward: [
    // mailboxType: 수집기가 메일함을 객체로 만들고 전달을 관계로 이었으면 그 흐름을 쓰고 표는 덧붙이지 않는다
    { provider: 'gws', objectType: 'User', path: 'gmail_forwarding', enabled: 'enabled', address: 'emailAddress', mailboxType: 'mailbox' },
  ],
  callerRunAs: [
    {
      provider: 'gws', objectType: 'Project',
      deployments: { path: 'deployments', field: 'executeAs', value: 'USER_ACCESSING', kindField: 'entryPointType', kind: 'WEB_APP' },
      manifest: { path: 'manifest.webapp.executeAs', value: 'USER_ACCESSING' },
      // 호출자 토큰은 매니페스트 scope 안에서만 쓰인다. scope 마다 빌릴 수 있는 객체 종류와 수준(.readonly 면 읽기, 아니면 관리)을 정한다.
      // types 가 없으면 같은 SaaS 의 객체 전부. 표에 없는 scope 는 관리 범위가 아니라 차용 간선을 만들지 않는다.
      // 근거: Google OAuth 2.0 Scopes for Google APIs (https://developers.google.com/identity/protocols/oauth2/scopes)
      scopes: {
        path: 'manifest.oauthScopes', prefix: 'https://www.googleapis.com/auth/', readonlySuffix: '.readonly',
        rules: [
          { scope: 'admin.directory.user', types: ['User'] },
          { scope: 'admin.directory.group', types: ['Group', 'Member'] },
          { scope: 'admin.directory.orgunit', types: ['OrgUnit'] },
          { scope: 'admin.directory.rolemanagement', types: ['Role', 'RoleAssignment'] },
          { scope: 'admin.directory.domain', types: ['Domains'] },
          { scope: 'admin.directory.customer', types: ['Customer'] },
          { scope: 'admin.directory.device', types: ['GoogleAppsCloudidentityDevicesV1Device', 'GoogleAppsCloudidentityDevicesV1DeviceUser'] },
          { scope: 'admin.' },
          { scope: 'cloud-platform' },
          { scope: 'apps.groups', types: ['Group', 'Member'] },
          { scope: 'apps.licensing' },
          { scope: 'ediscovery' },
          { scope: 'gmail.settings.sharing', types: ['User', 'SendAs'] },
        ],
      },
      author: { path: 'creator', userObjectType: 'User', userEmail: 'primaryEmail' },
    },
  ],
} as const

function at(o: unknown, path: string): unknown {
  let x = o
  for (const k of path.split('.')) x = x && typeof x === 'object' ? (x as Props)[k] : undefined
  return x
}

const objectsOf = (graph: GraphStoreV2, provider: string, type: string): FixtureObject[] =>
  (graph.objectsByProvider.get(provider) ?? []).filter(o => o.canonical.object_type === type)

const props = (o: FixtureObject) => o.canonical.properties as Props

/**
 * 매니페스트 scope 를 차용 상한으로 바꾼다. scope 하나는 표의 가장 앞에 맞는 규칙 하나로 정한다.
 * `.readonly` 로 끝나면 읽기, 아니면 관리. 표에 없는 scope 는 버린다
 */
export function callerScopeCap(
  scopes: readonly string[],
  table: { prefix: string; readonlySuffix: string; rules: readonly { scope: string; types?: readonly string[] }[] },
): BorrowCap[] {
  const out: BorrowCap[] = []
  for (const s of scopes) {
    if (!s.startsWith(table.prefix)) continue
    const name = s.slice(table.prefix.length)
    const rule = table.rules.find(r => (r.scope.endsWith('.') ? name.startsWith(r.scope) : name === r.scope || name.startsWith(`${r.scope}.`)))
    if (!rule) continue
    out.push({ level: name.endsWith(table.readonlySuffix) ? 'read' : 'admin', ...(rule.types ? { types: rule.types.map(t => t.toLowerCase()) } : {}) })
  }
  return out
}

/** 표가 읽은 속성을 간선 근거로. 엔진 EdgeRef model 과 같은 모양(provider.objectType.property) */
const model = (provider: string, objectType: string, ...paths: string[]) => paths.map(p => ({ type: 'model', id: `${provider}.${objectType}.${p}` }))

export function addVendorEdges(graph: GraphStoreV2, g: JudgeGraph): void {
  const node = (k: string, n: JudgeGraph['nodes'][string]) => { if (!g.nodes[k]) g.nodes[k] = n }

  const domains = new Set<string>()
  for (const d of VENDOR_EDGES.orgDomains) {
    for (const o of objectsOf(graph, d.provider, d.objectType)) {
      const v = String(at(props(o), d.path) ?? '').toLowerCase()
      const domain = d.emailDomain ? v.split('@')[1] : v
      if (domain) domains.add(domain)
    }
  }

  // 정규화가 이미 메일함 객체에서 조직 밖 노드까지 닿는 데이터 흐름을 만들었으면 표는 덧붙이지 않는다(같은 전달을 두 번 판정하지 않는다).
  // 메일함에서 아무 자동화로나 흐르는 것만으로는 빼지 않는다. 그 흐름이 밖에 닿는지 모르면 표 간선을 둔다
  const flowNext = new Map<string, string[]>()
  for (const e of g.edges) if (e.kind === '데이터 흐름') flowNext.set(e.from, [...(flowNext.get(e.from) ?? []), e.to])
  const reachesOutside = (start: string) => {
    const seen = new Set([start])
    const st = [start]
    while (st.length) for (const y of flowNext.get(st.pop()!) ?? []) {
      if (g.nodes[y]?.org === 'out') return true
      if (!seen.has(y)) { seen.add(y); st.push(y) }
    }
    return false
  }
  const modeledFlow = (account: string, mailboxType: string) =>
    g.edges.some(e => e.kind === '권한' && e.from === account && g.nodes[e.to]?.type === mailboxType && reachesOutside(e.to))

  for (const f of VENDOR_EDGES.outsideForward) {
    for (const o of objectsOf(graph, f.provider, f.objectType)) {
      if (modeledFlow(o.fixture_key, f.mailboxType)) continue
      const fw = at(props(o), f.path) as Props | undefined
      const address = String(fw?.[f.address] ?? '').toLowerCase()
      if (!fw?.[f.enabled] || !address) continue
      const domain = address.split('@')[1] ?? ''
      if (domains.has(domain)) continue
      const content = `mail:${o.fixture_key}`
      const receiver = `outside:${address}`
      const box = `outside-box:${address}`
      // 메일 내용은 그 계정의 SaaS 안에 있다(침입 탐지가 감사 로그 수집을 SaaS 로 본다)
      node(content, { kind: 'res', cls: 'content', org: 'in', provider: f.provider, holds: true })
      // 메일 도메인만으로 조직 밖이라 정하지 않는다(규칙 6). 조직 경계 입력이 생기기 전에는 모름
      node(receiver, { kind: 'person', org: 'unknown' })
      node(box, { kind: 'res', cls: 'content', org: 'out' })
      const refs = model(f.provider, f.objectType, f.path)
      g.edges.push({ kind: '권한', from: o.fixture_key, to: content, level: 'admin', refs })
      g.edges.push({ kind: '권한', from: receiver, to: box, level: 'admin', refs })
      g.edges.push({ kind: '데이터 흐름', from: content, to: box, refs, revocable: true })
    }
  }

  for (const c of VENDOR_EDGES.callerRunAs) {
    const users = objectsOf(graph, c.provider, c.author.userObjectType)
    for (const o of objectsOf(graph, c.provider, c.objectType)) {
      const p = props(o)
      const deployments = ((at(p, c.deployments.path) as Props[] | undefined) ?? [])
        .filter(d => d[c.deployments.kindField] === c.deployments.kind && d[c.deployments.field] === c.deployments.value)
      if (!deployments.length && at(p, c.manifest.path) !== c.manifest.value) continue
      const scopes = (at(p, c.scopes.path) as string[] | undefined) ?? []
      const borrowCap = callerScopeCap(scopes, c.scopes)
      if (!borrowCap.length) continue
      const creator = String(at(p, c.author.path) ?? '').toLowerCase()
      const author = users.find(u => String(at(props(u), c.author.userEmail) ?? '').toLowerCase() === creator)
      if (!author) continue
      if (g.nodes[o.fixture_key]) g.nodes[o.fixture_key] = { ...g.nodes[o.fixture_key], kind: 'auto', cls: undefined }
      // 작성자 관리 권한은 정규화가 owned_by 관계로 낸다(2026-11-15). 그 관계가 없는 옛 데이터셋(measured_v2, model_v1)에만 표가 덧붙인다
      const ownerEdge = g.edges.some(e => e.kind === '권한' && e.from === author.fixture_key && e.to === o.fixture_key && e.level === 'admin')
      if (!ownerEdge) g.edges.push({ kind: '권한', from: author.fixture_key, to: o.fixture_key, level: 'admin', refs: model(c.provider, c.objectType, c.author.path) })
      g.edges.push({ kind: '실행 신원', from: o.fixture_key, to: o.fixture_key, mode: 'caller', borrowAdminOnly: true, borrowCap,
        refs: model(c.provider, c.objectType, deployments.length ? c.deployments.path : c.manifest.path, c.scopes.path), revocable: true })
    }
  }
}
