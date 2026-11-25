// 종류 태그 확정본(2026-11-09).
// 1) 관측 종류: 옛 종류 규칙(새 이름, 이름 조건 규칙 태그 포함 = 「있을 수 있음」) ∪ Jev v2 ≥ 0.7 (아래 REJECT 는 뺌)
// 2) profile 없는 관측 종류: 옛 규칙만
// 3) 나머지 카탈로그 종류: Jev 초안(type-tags.draft.jsonl)
// 4) tenant_policy 우산: Policy 인터페이스이면서 설정 태그가 하나라도 있는 종류에 더한다
const fs = require('fs')
const path = require('path')
const B = path.join(__dirname, '..')
const rd = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
const kind = JSON.parse(fs.readFileSync(path.join(B, 'items-clean/prev/kind-tags.json'), 'utf8'))
const O2N = { access_policy: 'access_role', privileged_role: 'admin_access', admin_grant: 'admin_access', admin_credential: 'credential', auth_policy: 'authentication', auth_factor: 'authentication', encryption_setting: 'encryption', crypto_key: 'encryption', oauth_grant: 'integration', app_identity: 'integration', external_endpoint: 'data_flow', inbound_endpoint: 'data_flow', org_structure: null, record: null, misc: null, capacity: null }
const nt = t => (t in O2N ? O2N[t] : t)

// 관측 종류에서 Jev 가 더 붙였지만 받지 않는 것(Claude 검토 11-09)
const REJECT = {
  'github:code-security-configuration': ['monitoring'],
  'github:runner-groups-org': ['sharing'],
  'github:webhook-config': ['monitoring'],
  'gws:File': ['dlp', 'encryption'],
  'gws:Project': ['data_resource'],
  'gws:User': ['network_policy', 'encryption'],
  'okta:BrandWithEmbedded': ['tenant_policy'],
  'okta:PerClientRateLimitSettings': ['tenant_policy'],
  'salesforce:FieldSecurityClassification': ['dlp'],
  'salesforce:ManagedContentChannel': ['sharing'],
  'salesforce:PermissionSetGroupComponent': ['access_grant'],
  'salesforce:UserRole': ['admin_access'],
  'github:organization-full': ['group'],
  'slack:200.team': ['group'],
  'slack:200.team_2': ['group'],
}
// 옛 규칙을 고친 것(Jev 비교에서 옛 규칙이 틀린 것)
const FIX = {
  'gws:OrgUnit': { add: ['group'] },
  'atlassian:Domain': { add: ['tenant'] },
  'gws:Domains': { add: ['tenant'] },
  'salesforce:Domain': { add: ['tenant'] },
  'okta:DomainResponse': { add: ['tenant'] },
  'okta:CustomRole': { add: ['access_role'], remove: ['access_grant'] },
  'okta:GroupRule': { add: ['provisioning'], remove: ['access_grant'] },
  'github:branches': { add: ['code_repo'] },
  'github:branch-with-protection': { add: ['code_repo'] },
  'salesforce:OauthToken': { add: ['credential'] },
  'okta:OAuth2ScopeConsentGrant': { add: ['access_grant'] },
}
const SETTING = new Set(['authentication', 'password_policy', 'session_policy', 'network_policy', 'dlp', 'data_region', 'malware', 'retention_backup', 'monitoring', 'encryption', 'sharing', 'change_control', 'data_classification', 'device'])

const draft = new Map(rd(path.join(__dirname, 'type-tags.draft.jsonl')).map(r => [r.type_key, r]))
const v2 = new Map(rd(path.join(__dirname, 'type-tag-scores-v2.jsonl')).map(r => [r.type_key, r.p]))
const obsRows = rd(path.join(B, 'items-clean/observed-types.jsonl'))
const obsIf = new Map()
for (const t of obsRows) obsIf.set(`${t.provider}:${t.object_type}`, t.interfaces || [])

const out = new Map()
for (const [tk, r] of draft) out.set(tk, { type_key: tk, provider: r.provider, object_type: r.object_type, interfaces: r.interfaces, profile: r.profile, research_type: r.research_type, observed: false, tags: Object.fromEntries(Object.entries(r.tags).map(([t, v]) => [t, { src: v.src }])) })
for (const [tk, ifs] of obsIf) {
  const [prov, ...rest] = tk.split(':'); const typ = rest.join(':')
  const g = `O|${prov}|${typ}`
  const tags = {}
  for (const [gre, nre, ts] of kind.objects) if (new RegExp(gre).test(g)) for (const t of ts) { const n = nt(t); if (n) tags[n] = { src: nre ? 'rule-name' : 'rule' } }
  const fx = FIX[tk] || {}
  for (const t of fx.remove || []) delete tags[t]
  for (const t of fx.add || []) tags[t] = { src: 'rule-fix' }
  const p = v2.get(tk)
  if (p) for (const [t, s] of Object.entries(p)) if (s >= 0.7 && !tags[t] && !(REJECT[tk] || []).includes(t)) tags[t] = { src: 'jev-v2' }
  const base = draft.get(tk)
  out.set(tk, { type_key: tk, provider: prov, object_type: typ, interfaces: base?.interfaces || ifs, profile: base?.profile || null, research_type: base?.research_type || null, observed: true, tags })
}
let umb = 0
for (const r of out.values()) {
  if ((r.interfaces || []).includes('Policy') && !r.tags.tenant_policy && Object.keys(r.tags).some(t => SETTING.has(t))) { r.tags.tenant_policy = { src: 'umbrella' }; umb++ }
}
const rows = [...out.values()].sort((a, b) => a.type_key.localeCompare(b.type_key))
fs.writeFileSync(path.join(__dirname, 'type-tags.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n')
const src = {}
for (const r of rows) for (const v of Object.values(r.tags)) src[v.src] = (src[v.src] || 0) + 1
console.log({ types: rows.length, observed: rows.filter(r => r.observed).length, no_profile_observed: rows.filter(r => r.observed && !r.profile).length, untagged: rows.filter(r => !Object.keys(r.tags).length).length, umbrella_added: umb, by_source: src })
