/**
 * AEGI 관계 점검 판정기 (source_tier 3)
 *
 * aegi-knowledge relation-rules.yaml 과 정규화 데이터셋(objects, relations, links)을 읽고
 * 범용 접근 엔진 EdgeIndex 를 생성하여 7가지 관계 점검 패턴 및 사람 확인 항목을 SaaS 마다 판정한다.
 *
 * 실행: node --import tsx scripts/standards/relation_checks.ts --dataset <폴더> --knowledge <폴더> --out <폴더> --raw-run <이름>
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import YAML from 'yaml'
import { readDatasetFiles, type DatasetFiles } from '../loader/engine.ts'
import { buildEvidenceStore, buildGraphStoreV2 } from '../../src/data/datasetStore.ts'
import { runAccessEngine, EVERYONE } from '../../src/detection/v2/engine/index.ts'
import type { CoverageFile, Edge } from '../../src/detection/v2/engine/types.ts'
import type { GraphStoreV2 } from '../../src/model/graph.ts'
import type { FixtureObject } from '../../src/model/object.ts'
import { principalKind } from '../../src/detection/v2/identity.ts'
import { outsideAccounts } from '../../src/detection/threat/boundary.ts'
import { roleCapability } from '../../src/detection/v2/engine/accessModel.ts'
import { scopeReach, scopesOf } from '../../src/detection/v2/engine/tokenScopes.ts'

export const SAAS_NAMES: Record<string, string> = {
  atlassian: 'Atlassian',
  github: 'GitHub',
  gws: 'Google Workspace',
  okta: 'Okta',
  salesforce: 'Salesforce',
  slack: 'Slack',
}

export const STATUS_RANK: Record<string, number> = {
  fail: 6,
  unknown: 5,
  org_policy: 4,
  manual: 3,
  not_collected: 2,
  pass: 1,
}

export interface CheckTarget {
  key: string
  in_graph: boolean
  name: string
  value: string
  status: string
}

export interface CheckItem {
  item_id: string
  title: string
  finding_id: string
  status: string
  threshold: string
  rule: {
    source: string
    field: string
    condition: string
    combine: string
  }
  targets: CheckTarget[]
  note: string
}

export interface StandardResult {
  standard: string
  tier: number
  provider: string
  raw_run: string
  items: CheckItem[]
}

export function targetName(obj: FixtureObject | undefined, key: string): string {
  if (!obj) return key
  const meta = obj.fixture_meta as Record<string, unknown> | undefined
  if (typeof meta?.display_name === 'string' && meta.display_name.trim()) {
    return meta.display_name.trim()
  }
  const props = obj.canonical?.properties as Record<string, unknown> | undefined
  if (props) {
    if (typeof props.name === 'string' && props.name.trim()) return props.name.trim()
    if (typeof props.login === 'string' && props.login.trim()) return props.login.trim()
    if (typeof props.email === 'string' && props.email.trim()) return props.email.trim()
  }
  return key
}

export function getProp(obj: FixtureObject | undefined, pathStr: string): unknown {
  if (!obj || !pathStr) return undefined
  return pathStr.split('.').reduce<any>((curr, part) => (curr == null ? undefined : curr[part]), obj.canonical?.properties)
}

export function getCanonicalProp(obj: FixtureObject | undefined, pathStr: string): unknown {
  if (!obj || !pathStr) return undefined
  return pathStr.split('.').reduce<any>((curr, part) => (curr == null ? undefined : curr[part]), obj.canonical)
}

export function formatValueTemplate(template: string | undefined, obj: FixtureObject | undefined): string {
  if (!template) return ''
  return template.replace(/\{([^}]+)\}/g, (_match, p) => {
    const val = getCanonicalProp(obj, p.trim())
    if (val === undefined || val === null) {
      return '없음'
    }
    return String(val)
  })
}

/** 조건 식에 판정기가 넘기는 값. orgDomains 는 R4 와 같은 조직 도메인 목록이다 */
export type ConditionContext = { orgDomains?: Set<string> }

/** 이메일이나 도메인 값이 조직 도메인(하위 도메인 포함)인가. 값이 없거나 조직 도메인을 모르면 undefined */
function isOrgDomainValue(val: unknown, orgDomains: Set<string> | undefined): boolean | undefined {
  if (typeof val !== 'string' || !orgDomains || orgDomains.size === 0) return undefined
  const v = val.trim().toLowerCase()
  const dom = v.includes('@') ? v.slice(v.lastIndexOf('@') + 1) : v
  if (!dom) return undefined
  for (const d of orgDomains) {
    if (dom === d || dom.endsWith(`.${d}`)) return true
  }
  return false
}

export function evaluateCondition(cond: any, obj: FixtureObject, graph: GraphStoreV2, ctx: ConditionContext = {}): boolean {
  if (!cond) return true

  if (Array.isArray(cond.all)) {
    if (!cond.all.every((c: any) => evaluateCondition(c, obj, graph, ctx))) return false
  }
  if (Array.isArray(cond.any)) {
    if (!cond.any.some((c: any) => evaluateCondition(c, obj, graph, ctx))) return false
  }

  if (Array.isArray(cond.count_positive)) {
    let count = 0
    for (const p of cond.count_positive) {
      const v = getCanonicalProp(obj, p)
      if (typeof v === 'number' && v > 0) {
        count++
      }
    }
    if (cond.gte !== undefined) {
      if (typeof cond.gte !== 'number' || count < cond.gte) return false
    }
    if (cond.eq !== undefined) {
      if (typeof cond.eq !== 'number' || count !== cond.eq) return false
    }
  }

  if (cond.path !== undefined) {
    const val = getCanonicalProp(obj, cond.path)

    if (cond.exists !== undefined) {
      const isPresent = val !== undefined && val !== null
      if (isPresent !== Boolean(cond.exists)) return false
    }

    if (cond.eq !== undefined) {
      if (val === undefined || val === null) return false
      if (typeof val !== typeof cond.eq || val !== cond.eq) return false
    }

    if (cond.ne !== undefined) {
      if (val !== undefined && val !== null && typeof val === typeof cond.ne && val === cond.ne) return false
    }

    if (cond.in !== undefined && Array.isArray(cond.in)) {
      if (val === undefined || val === null) return false
      if (!cond.in.some((item: any) => typeof item === typeof val && item === val)) return false
    }

    if (cond.not_in !== undefined && Array.isArray(cond.not_in)) {
      if (val !== undefined && val !== null && cond.not_in.some((item: any) => typeof item === typeof val && item === val)) return false
    }

    if (cond.gte !== undefined) {
      if (val === undefined || val === null) return false
      if (typeof val !== 'number' || typeof cond.gte !== 'number' || val < cond.gte) return false
    }

    if (cond.lt !== undefined) {
      if (val === undefined || val === null) return false
      if (typeof val !== 'number' || typeof cond.lt !== 'number' || val >= cond.lt) return false
    }

    if (cond.starts_with !== undefined) {
      if (typeof val !== 'string' || typeof cond.starts_with !== 'string' || !val.startsWith(cond.starts_with)) return false
    }

    if (cond.org_domain !== undefined) {
      const inOrg = isOrgDomainValue(val, ctx.orgDomains)
      if (inOrg === undefined || inOrg !== Boolean(cond.org_domain)) return false
    }

    if (cond.eq_ref !== undefined) {
      if (val === undefined || val === null) return false
      const refName = cond.eq_ref.reference
      const refPath = cond.eq_ref.path
      if (!refName || !refPath) return false
      const targetVal = obj.canonical?.references?.[refName]?.targets?.[0]?.value
      if (!targetVal) return false
      const refObj = graph.objectsByKey.get(String(targetVal))
      if (!refObj) return false
      const refPropVal = getCanonicalProp(refObj, refPath)
      if (refPropVal === undefined || refPropVal === null) return false
      if (typeof val !== typeof refPropVal || val !== refPropVal) return false
    }
  }

  return true
}

export function extractAccountEmails(obj: FixtureObject | undefined): string[] {
  if (!obj) return []
  const props = obj.canonical?.properties as Record<string, unknown> | undefined
  if (!props) return []
  const candidates = [props.email, props.primaryEmail, props.login, props.Email, props.Username]
  const mails: string[] = []
  for (const c of candidates) {
    if (typeof c === 'string' && c.includes('@')) {
      const m = c.trim().toLowerCase()
      if (m) mails.push(m)
    }
  }
  return mails
}

export function extractR4Emails(
  obj: FixtureObject | undefined,
  emailFields: string[] = ['email', 'primaryEmail', 'Email', 'emailAddress', 'profile.email']
): string[] {
  if (!obj) return []
  const emails: string[] = []
  for (const field of emailFields) {
    const val = getProp(obj, field)
    if (typeof val === 'string' && val.includes('@')) {
      const trimmed = val.trim().toLowerCase()
      if (trimmed) emails.push(trimmed)
    }
  }
  return emails
}

export function isNonHuman(obj: FixtureObject | undefined): boolean {
  if (!obj) return false
  if (principalKind(obj) === 'service') return true
  const ifaces = obj.canonical?.interfaces ?? []
  if (!ifaces.includes('Principal') && (ifaces.includes('Integration') || ifaces.includes('Automation') || ifaces.includes('Credential'))) {
    return true
  }
  return false
}

/** R5 만료 판정에서 빼는 다중 인증 수단(relation-rules.yaml tables.mfa_factors 종류)인가 */
export function isMfaFactor(obj: FixtureObject | undefined, rules: any): boolean {
  if (!obj) return false
  return (rules?.tables?.mfa_factors ?? []).some((mf: any) => obj.canonical?.provider === mf.provider && obj.canonical?.object_type === mf.object_type)
}

/** R5 자격증명 만료 값. expiry_from 의 「judged.」, 「properties.」 점 경로를 차례로 보고 처음 있는 값을 돌려준다 */
export function credentialExpiry(obj: FixtureObject | undefined, expiryFrom: string[] | undefined): unknown {
  if (!obj) return undefined
  for (const p of expiryFrom ?? ['judged.expires_at']) {
    const [root, ...rest] = p.split('.')
    const base = root === 'judged' ? (obj.canonical as any)?.judged : root === 'properties' ? obj.canonical?.properties : undefined
    const v = rest.reduce<any>((cur, k) => (cur == null ? undefined : cur[k]), base)
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

export function edgeProvider(edge: Edge, graph: GraphStoreV2): string | undefined {
  if (edge.from && edge.from !== EVERYONE) {
    const fromObj = graph.objectsByKey.get(edge.from)
    if (fromObj?.canonical?.provider) return fromObj.canonical.provider
  }
  if (edge.to) {
    const toObj = graph.objectsByKey.get(edge.to)
    if (toObj?.canonical?.provider) return toObj.canonical.provider
  }
  return undefined
}

export function getEdgeTargetKeys(edge: Edge, graph: GraphStoreV2): string[] {
  const keys: string[] = []
  if (edge.from && edge.from !== EVERYONE) keys.push(edge.from)
  if (edge.to) keys.push(edge.to)
  if (edge.roleKey) keys.push(edge.roleKey)
  for (const ref of edge.refs ?? []) {
    if (ref.type === 'relation') {
      const rel = graph.relationsByKey.get(ref.id)
      if (rel) {
        const roleVal = rel.raw?.canonical?.references?.role?.value
        if (typeof roleVal === 'string' && roleVal) keys.push(roleVal)
        const viaAssn = rel.properties?.via_assignment
        if (typeof viaAssn === 'string' && viaAssn) keys.push(viaAssn)
        else if (Array.isArray(viaAssn)) for (const v of viaAssn) if (typeof v === 'string') keys.push(v)
        const viaScheme = rel.properties?.via_scheme
        if (typeof viaScheme === 'string' && viaScheme.startsWith('im:')) keys.push(viaScheme)
        else if (Array.isArray(viaScheme)) for (const v of viaScheme) if (typeof v === 'string') keys.push(v)
      }
    }
  }
  return [...new Set(keys)].filter(k => graph.objectsByKey.has(k))
}

export function deduplicateTargets(targets: CheckTarget[]): CheckTarget[] {
  const byKey = new Map<string, CheckTarget>()
  for (const t of targets) {
    const prev = byKey.get(t.key)
    if (!prev) {
      byKey.set(t.key, t)
    } else {
      const prevRank = STATUS_RANK[prev.status] ?? 0
      const currRank = STATUS_RANK[t.status] ?? 0
      if (currRank > prevRank) {
        byKey.set(t.key, t)
      }
    }
  }
  return [...byKey.values()]
}

export function computeItemStatus(targets: CheckTarget[]): { status: string; note: string } {
  if (!targets.length) {
    return { status: 'pass', note: '대상 없음' }
  }
  const worst = targets.reduce((best, t) => {
    return (STATUS_RANK[t.status] ?? 0) > (STATUS_RANK[best] ?? 0) ? t.status : best
  }, 'pass')
  return { status: worst, note: '' }
}

const PROFILE_BINDING_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../collect/profile-binding')
const foldProvider = (p: string) => (p === 'jira' || p === 'confluence' ? 'atlassian' : p)
const PROBE_CALL = /-90$/ // 존재 확인 호출: 목록 전체를 받지 않아 「0개 = 정말 없음」 근거가 못 된다

/**
 * 객체 종류(`provider|object_type`, 판정이 쓰는 Profile 종류 이름) → 그 객체를 받는 수집 호출.
 * - bindings.jsonl: status 가 collected_* 이고 call 이 있는 줄. jira·confluence 는 atlassian 으로 접고, 존재 확인 호출(*-90)은 뺀다
 * - bindings 줄의 file 에 overlay(overlays/<file>)가 있으면 그 runtime_rules 의 object 규칙이 읽는 원본 호출도 더한다.
 *   bindings 는 documented_not_collected 인데 overlay 로 수집하는 종류가 있다(gws Policy → GW-24)
 * - overlays/<provider>/new-*.yaml: bindings 에 없는 새 종류. 같은 방식으로 원본 호출
 */
export function loadProfileTypeCalls(dir: string = PROFILE_BINDING_DIR): Record<string, string[]> {
  const out = new Map<string, Set<string>>()
  const add = (provider: string, type: string, call: unknown) => {
    if (typeof call !== 'string' || !call || PROBE_CALL.test(call)) return
    const k = `${foldProvider(provider)}|${type}`
    out.set(k, (out.get(k) ?? new Set()).add(call))
  }
  const overlayCalls = (provider: string, type: string, doc: any) => {
    for (const rule of doc?.runtime_rules ?? []) {
      if (rule?.kind !== 'object') continue
      for (const s of rule.sources ?? []) {
        if (!s?.provider || foldProvider(s.provider) === foldProvider(provider)) add(provider, type, s?.call)
      }
    }
  }
  const overlays = path.join(dir, 'overlays')
  const readOverlay = (file: string) => YAML.parse(fs.readFileSync(file, 'utf8')) ?? {}
  for (const line of fs.readFileSync(path.join(dir, 'bindings.jsonl'), 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    const row = JSON.parse(line)
    if (String(row.status ?? '').startsWith('collected_')) add(row.provider, row.object_type, row.call)
    const ov = typeof row.file === 'string' ? path.join(overlays, row.file) : ''
    if (ov && fs.existsSync(ov)) overlayCalls(row.provider, row.object_type, readOverlay(ov))
  }
  for (const prov of fs.existsSync(overlays) ? fs.readdirSync(overlays) : []) {
    const pdir = path.join(overlays, prov)
    if (!fs.statSync(pdir).isDirectory()) continue
    for (const f of fs.readdirSync(pdir).filter(n => n.startsWith('new-') && n.endsWith('.yaml'))) {
      const doc = readOverlay(path.join(pdir, f))
      if (doc.provider && doc.object_type) overlayCalls(doc.provider, doc.object_type, doc)
    }
  }
  return Object.fromEntries([...out].map(([k, v]) => [k, [...v].sort()]))
}

let profileTypeCalls: Record<string, string[]> | undefined

/**
 * 대상 0개(pass '대상 없음')가 「정말 없음」인지 「못 읽음」인지 수집 완결성(coverage.json)으로 가른다.
 * 못 읽었을 수 있으면 그 까닭을, 정말 없다고 말할 수 있으면 undefined 를 낸다.
 * - types: 이 항목이 훑는 객체 종류. [] 는 볼 종류가 정해지지 않은 항목(그대로 둔다), null 은 종류를 하나로 못 박을 수 없는 패턴(R1~R7)
 * - 종류마다 그 객체를 받는 호출(loadProfileTypeCalls, profile-binding 의 bindings.jsonl·new-* overlay)이 모두 full 이어야 정말 없음.
 *   표에 없는 종류(수집하지 않는 종류, 존재 확인으로만 보는 종류)는 가를 수 없어 못 읽음으로 본다
 * - null 이면 그 SaaS 의 호출이 모두 full 일 때만 정말 없음
 */
export function emptyTargetsReason(
  provider: string,
  types: string[] | null,
  coverage: CoverageFile | undefined,
  typeCalls: Record<string, string[]> = (profileTypeCalls ??= loadProfileTypeCalls())
): string | undefined {
  if (types && types.length === 0) return undefined
  if (!coverage) return '수집 완결성 기록(coverage.json)이 없다'
  const calls = (coverage.calls ?? []).filter(c => c.provider === provider)
  if (!calls.length) return `이 SaaS(${provider}) 의 수집 기록이 없다`
  const state = new Map(calls.map(c => [c.call_id, c.completeness]))
  if (types === null) {
    const open = calls.filter(c => c.completeness !== 'full').map(c => `${c.call_id} ${c.completeness}`)
    return open.length ? `대상 종류를 하나로 정할 수 없는 점검인데 이 SaaS 호출 중 full 이 아닌 것이 있다(${open.join(', ')})` : undefined
  }
  const byLower = new Map(Object.entries(typeCalls).map(([k, v]) => [k.toLowerCase(), v]))
  const open: string[] = []
  for (const t of types) {
    const ids = byLower.get(`${provider}|${t}`.toLowerCase())
    if (!ids?.length) { open.push(`${t}: 받는 수집 호출을 모름`); continue }
    for (const id of ids) {
      const s = state.get(id)
      if (s !== 'full') open.push(`${t}: ${id} ${s ?? '기록 없음'}`)
    }
  }
  return open.length ? open.join(', ') : undefined
}

export function buildAccountInactiveChecker(
  graph: GraphStoreV2,
  links: any[],
  inactiveStatesList: string[],
  idpProvidersList: string[]
): (accountKey: string) => boolean {
  const inactiveStates = new Set((inactiveStatesList || ['suspended', 'deprovisioned', 'deleted']).map(s => s.toLowerCase()))
  const idpProviders = new Set((idpProvidersList || ['okta', 'gws']).map(p => p.toLowerCase()))

  const inactiveIdpAccounts = new Set<string>()
  const inactiveIdpEmails = new Set<string>()

  for (const obj of graph.objectsByKey.values()) {
    const prov = obj.canonical?.provider?.toLowerCase()
    if (prov && idpProviders.has(prov)) {
      const state = String(obj.canonical?.properties?.account_state ?? '').toLowerCase()
      if (inactiveStates.has(state)) {
        inactiveIdpAccounts.add(obj.fixture_key)
        for (const mail of extractAccountEmails(obj)) {
          inactiveIdpEmails.add(mail)
        }
      }
    }
  }

  const linksMap = new Map<string, Set<string>>()
  for (const link of links || []) {
    if (!Array.isArray(link.set)) continue
    const memberKeys = link.set.map((m: any) => m.object_key).filter(Boolean)
    for (const k of memberKeys) {
      if (!linksMap.has(k)) linksMap.set(k, new Set())
      const set = linksMap.get(k)!
      for (const other of memberKeys) {
        if (other !== k) set.add(other)
      }
    }
  }

  return function isInactive(key: string): boolean {
    const obj = graph.objectsByKey.get(key)
    if (!obj) return false
    const selfState = String(obj.canonical?.properties?.account_state ?? '').toLowerCase()
    if (inactiveStates.has(selfState)) return true

    const linkedMembers = linksMap.get(key)
    if (linkedMembers) {
      for (const mKey of linkedMembers) {
        if (inactiveIdpAccounts.has(mKey)) return true
      }
    }

    for (const mail of extractAccountEmails(obj)) {
      if (inactiveIdpEmails.has(mail)) return true
    }

    return false
  }
}

export function evaluateRelationChecks(
  files: DatasetFiles,
  rules: any,
  scopeLines: any[],
  rawRun: string,
  datasetName: string
): Record<string, StandardResult> {
  const graph = buildGraphStoreV2(files.objects, files.relations, files.links)
  const evidence = buildEvidenceStore(files.observations, files.evidence_links)
  const { engine } = runAccessEngine({ graph, evidence, coverage: files.coverage })
  const ix = engine.ix

  const providers = (rules.standard?.providers ?? ['atlassian', 'github', 'gws', 'okta', 'salesforce', 'slack']) as string[]
  const inactiveChecker = buildAccountInactiveChecker(
    graph,
    files.links,
    rules.common?.inactive_states ?? ['suspended', 'deprovisioned', 'deleted'],
    rules.tables?.idp_providers ?? ['okta', 'gws']
  )

  // Pre-collect org domains (R4): tables.org_domains + IdP person accounts email_fields domains
  const orgDomains = new Set<string>()
  for (const entry of rules.tables?.org_domains ?? []) {
    for (const obj of graph.objectsByKey.values()) {
      if (obj.canonical?.provider === entry.provider && obj.canonical?.object_type === entry.object_type) {
        const val = getProp(obj, entry.path)
        if (typeof val === 'string') {
          const trimmed = val.trim().toLowerCase()
          if (trimmed && !trimmed.includes('@') && trimmed.includes('.')) {
            orgDomains.add(trimmed)
          }
        }
      }
    }
  }

  const idpProviders = new Set((rules.tables?.idp_providers ?? ['okta', 'gws']).map((p: string) => p.toLowerCase()))
  const r4EmailFields = (rules.tables?.email_fields ?? ['email', 'primaryEmail', 'Email', 'emailAddress', 'profile.email']) as string[]
  for (const obj of graph.objectsByKey.values()) {
    const prov = obj.canonical?.provider?.toLowerCase()
    if (prov && idpProviders.has(prov) && ix.isPerson(obj.fixture_key)) {
      for (const mail of extractR4Emails(obj, r4EmailFields)) {
        const domain = mail.split('@')[1]
        if (domain && domain.includes('.')) {
          orgDomains.add(domain)
        }
      }
    }
  }

  // Pre-collect outside accounts (R4)
  const outsideMap = outsideAccounts(graph)

  // Pre-collect email -> providers count (R7)
  const emailToProviders = new Map<string, Set<string>>()
  for (const obj of graph.objectsByKey.values()) {
    const prov = obj.canonical?.provider
    if (prov && ix.isPerson(obj.fixture_key)) {
      for (const mail of extractAccountEmails(obj)) {
        if (!emailToProviders.has(mail)) emailToProviders.set(mail, new Set())
        emailToProviders.get(mail)!.add(prov)
      }
    }
  }

  // Pre-collect links membership count (R7)
  const accountLinkCounts = new Map<string, number>()
  for (const link of files.links ?? []) {
    if (!Array.isArray(link.set)) continue
    const count = link.set.length
    for (const m of link.set) {
      if (m.object_key) {
        accountLinkCounts.set(m.object_key, Math.max(accountLinkCounts.get(m.object_key) ?? 0, count))
      }
    }
  }

  // Pre-collect shared credentials (R7)
  const credentialHolders = new Map<string, Set<string>>()
  for (const obj of graph.objectsByKey.values()) {
    if (obj.canonical?.interfaces?.includes('Credential')) {
      const holders = new Set<string>()
      for (const rel of graph.incomingRelationsByObject.get(obj.fixture_key) ?? []) {
        if (['holds', 'authenticates_with'].includes(rel.relationType)) {
          holders.add(rel.sourceKey)
        }
      }
      if (holders.size > 1) {
        credentialHolders.set(obj.fixture_key, holders)
      }
    }
  }

  // Pre-collect role definition types (R1)
  const roleTypes = new Set<string>()
  for (const rel of files.relations ?? []) {
    const roleVal = rel.canonical?.references?.role?.value
    if (typeof roleVal === 'string' && roleVal) {
      const roleObj = graph.objectsByKey.get(roleVal)
      if (roleObj) {
        roleTypes.add(`${roleObj.canonical?.provider}:${roleObj.canonical?.object_type}`)
      }
    }
  }

  // 관계 행이 role 로 가리키지 않는 역할 정의 종류(relation-rules.yaml R1.role_types_extra)
  for (const t of rules.patterns?.R1?.role_types_extra ?? []) roleTypes.add(String(t))

  // Confirmed type keys for manual_items (MANUAL)
  const manualItemsList = new Set<string>(rules.manual_items?.items ?? [])
  const confirmedTypeKeys = new Set<string>()
  for (const row of scopeLines ?? []) {
    if (manualItemsList.has(row.item_key) && row.status === 'confirmed' && typeof row.type_key === 'string') {
      confirmedTypeKeys.add(row.type_key.toLowerCase())
    }
  }

  const results: Record<string, StandardResult> = {}

  for (const provider of providers) {
    const saasName = SAAS_NAMES[provider] ?? provider
    const standardName = `AEGI 관계 점검: ${saasName}`
    const items: CheckItem[] = []
    // 항목마다 훑는 객체 종류(대상 0개를 가를 때 쓴다). 적지 않은 항목(R1~R7)은 종류를 하나로 못 박지 않는다
    const scanTypes = new Map<string, string[]>()

    // ----------------------------------------------------
    // R1: 관리자 권한 집중 (951)
    // ----------------------------------------------------
    {
      const r1Conf = rules.patterns?.R1 ?? {}
      const maxAdmins = r1Conf.params?.max_human_admins ?? 3
      const ruleSource = `정규화 그래프 ${datasetName} + 범용 접근 엔진 간선`
      const ruleField = 'G 간선 rank, 도착 Tenant'
      const ruleCondition = r1Conf.threshold ?? '테넌트 관리자(세기 5) 사람 3명 이하, 비인간 신원 0'
      const ruleCombine = r1Conf.question ?? '테넌트 전체를 관리할 수 있는 신원이 몇이고 누구인가'

      // Pre-calculate human admins for this provider
      const humanAdminHolders = new Set<string>()
      for (const edge of ix.edges.values()) {
        if (edge.kind === 'G' && ix.isTenant(edge.to) && (edge.rank ?? 0) >= 5) {
          const prov = edgeProvider(edge, graph)
          if (prov === provider && ix.isPerson(edge.from)) {
            humanAdminHolders.add(edge.from)
          }
        }
      }
      const humanAdminsOverMax = humanAdminHolders.size > maxAdmins

      const r1CandidateEdges: Edge[] = []
      const r1RawTargets: CheckTarget[] = []

      for (const edge of ix.edges.values()) {
        if (edge.kind === 'G' && ix.isTenant(edge.to)) {
          if ((edge.rank ?? 0) >= 5 || edge.rank === undefined) {
            const prov = edgeProvider(edge, graph)
            if (prov === provider) {
              r1CandidateEdges.push(edge)

              let edgeStatus: string
              let edgeValue: string
              if (edge.rank === undefined) {
                edgeStatus = 'unknown'
                edgeValue = '권한 세기 모름'
              } else {
                const holderObj = graph.objectsByKey.get(edge.from)
                if (isNonHuman(holderObj)) {
                  edgeStatus = 'fail'
                  edgeValue = '비인간 신원이 테넌트 관리 권한을 가짐'
                } else if (ix.isPerson(edge.from)) {
                  if (humanAdminsOverMax) {
                    edgeStatus = 'fail'
                    edgeValue = '사람 관리자 수가 문턱을 넘음(그 SaaS 의 사람 관리자 전원을 fail target 으로)'
                  } else {
                    edgeStatus = 'pass'
                    edgeValue = '테넌트 관리자'
                  }
                } else {
                  edgeStatus = 'pass'
                  edgeValue = '테넌트 관리 권한'
                }
              }

              for (const k of getEdgeTargetKeys(edge, graph)) {
                const obj = graph.objectsByKey.get(k)
                r1RawTargets.push({
                  key: k,
                  in_graph: true,
                  name: targetName(obj, k),
                  value: edgeValue,
                  status: edgeStatus,
                })
              }
            }
          }
        }
      }

      // role_definitions: true
      if (r1Conf.role_definitions !== false) {
        for (const obj of graph.objectsByKey.values()) {
          if (obj.canonical?.provider === provider && roleTypes.has(`${obj.canonical?.provider}:${obj.canonical?.object_type}`)) {
            const roleKey = obj.fixture_key
            const cap = roleCapability(provider, undefined, roleKey, obj)
            const rankStr = cap.rank !== undefined ? `세기 ${cap.rank}` : '세기 모름'

            // Check if this role definition is used in any R1 candidate edge
            const matchingEdges = r1CandidateEdges.filter(e => {
              if (e.roleKey === roleKey) return true
              for (const ref of e.refs ?? []) {
                if (ref.type === 'relation') {
                  const rel = graph.relationsByKey.get(ref.id)
                  if (rel?.raw?.canonical?.references?.role?.value === roleKey) return true
                }
              }
              return false
            })

            if (matchingEdges.length > 0) {
              const worstRoleStatus = matchingEdges.reduce((worst, e) => {
                let st = 'pass'
                if (e.rank === undefined) st = 'unknown'
                else if (isNonHuman(graph.objectsByKey.get(e.from))) st = 'fail'
                else if (ix.isPerson(e.from) && humanAdminsOverMax) st = 'fail'
                return (STATUS_RANK[st] ?? 0) > (STATUS_RANK[worst] ?? 0) ? st : worst
              }, 'pass')

              r1RawTargets.push({
                key: roleKey,
                in_graph: true,
                name: targetName(obj, roleKey),
                value: rankStr,
                status: worstRoleStatus,
              })
            } else {
              r1RawTargets.push({
                key: roleKey,
                in_graph: true,
                name: targetName(obj, roleKey),
                value: '배정 없음',
                status: 'pass',
              })
            }
          }
        }
      }

      // 관리자 권한 간선이 없는 비그룹 Principal 도 확인된 대상으로 pass target 을 낸다
      for (const obj of graph.objectsByKey.values()) {
        if (obj.canonical?.provider !== provider) continue
        const ifaces = obj.canonical?.interfaces ?? []
        if (!ifaces.includes('Principal')) continue
        if (obj.canonical?.judged?.principal_kind === 'group') continue
        if (obj.canonical?.judged?.account_kind === 'system') continue
        if (obj.fixture_meta?.demo_role === 'measurement_principal') continue
        r1RawTargets.push({
          key: obj.fixture_key,
          in_graph: true,
          name: targetName(obj, obj.fixture_key),
          value: '관리자 권한 없음',
          status: 'pass',
        })
      }

      const targets = deduplicateTargets(r1RawTargets)
      const { status, note } = computeItemStatus(targets)
      items.push({
        item_id: 'AEGI-REL-R1',
        title: r1Conf.finding ?? '테넌트 관리자 권한이 필요 이상으로 많거나 비인간 신원에 있음',
        finding_id: `${provider}-951`,
        status,
        threshold: ruleCondition,
        rule: {
          source: ruleSource,
          field: ruleField,
          condition: ruleCondition,
          combine: ruleCombine,
        },
        targets,
        note,
      })
    }

    // ----------------------------------------------------
    // R2: 권한 부여 범위 (952)
    // ----------------------------------------------------
    {
      const r2Conf = rules.patterns?.R2 ?? {}
      const ruleSource = `정규화 그래프 ${datasetName} + 범용 접근 엔진 간선`
      const ruleField = 'G 간선 from, to, rank'
      const ruleCondition = r2Conf.threshold ?? '누구나 대상 부여 0, 조직 전체 대상은 읽기까지'
      const ruleCombine = r2Conf.question ?? '각 권한 부여가 사람이나 그룹 단위로 좁게 걸렸나, 조직 전체나 누구나에게 열렸나'

      const r2RawTargets: CheckTarget[] = []

      // G edges to Resource or Tenant
      for (const edge of ix.edges.values()) {
        if (edge.kind === 'G') {
          const toObj = graph.objectsByKey.get(edge.to)
          const ifaces = toObj?.canonical?.interfaces ?? []
          if (ifaces.includes('Resource') || ifaces.includes('Tenant')) {
            const prov = edgeProvider(edge, graph)
            if (prov === provider) {
              let edgeStatus: string
              let edgeValue: string
              if (edge.from === EVERYONE) {
                edgeStatus = 'fail'
                edgeValue = '누구나(@everyone, 익명, 공개 링크)에게 부여'
              } else if (ix.isTenant(edge.from) && (edge.rank ?? 0) >= 3) {
                edgeStatus = 'fail'
                edgeValue = '조직 전체에 쓰기 이상'
              } else if (edge.rank === undefined) {
                edgeStatus = 'unknown'
                edgeValue = '권한 세기를 모름'
              } else {
                edgeStatus = 'pass'
                edgeValue = '사람 또는 그룹 단위 권한'
              }

              for (const k of getEdgeTargetKeys(edge, graph)) {
                const obj = graph.objectsByKey.get(k)
                r2RawTargets.push({
                  key: k,
                  in_graph: true,
                  name: targetName(obj, k),
                  value: edgeValue,
                  status: edgeStatus,
                })
              }
            }
          }
        }
      }

      // assignment_references R2
      for (const entry of rules.assignment_references ?? []) {
        if (entry.patterns?.includes('R2') && entry.provider === provider) {
          for (const obj of graph.objectsByKey.values()) {
            if (obj.canonical?.provider === provider && obj.canonical?.object_type === entry.object_type) {
              const scopeVal = String(getProp(obj, entry.scope_path) ?? '')
              const mappedScope = entry.scope_values?.[scopeVal]
              const roleVal = String(getProp(obj, entry.role_path) ?? '')
              const rank = entry.rank_by_role?.[roleVal]

              let status = 'pass'
              let value = '사람 또는 그룹 대상 권한'
              if (mappedScope === 'everyone') {
                status = 'fail'
                value = '누구나(@everyone, 익명, 공개 링크)에게 부여'
              } else if (mappedScope === 'tenant') {
                if (rank === undefined) {
                  status = 'unknown'
                  value = '권한 세기를 모름'
                } else if (rank >= 3) {
                  status = 'fail'
                  value = '조직 전체에 쓰기 이상'
                } else {
                  status = 'pass'
                  value = '조직 전체 읽기 권한'
                }
              }

              r2RawTargets.push({
                key: obj.fixture_key,
                in_graph: true,
                name: targetName(obj, obj.fixture_key),
                value,
                status,
              })

              const holderRef = obj.canonical?.references?.[entry.holder]
              const holderTargets = Array.isArray(holderRef?.targets) ? holderRef.targets : []
              for (const t of holderTargets) {
                const hKey = String(t.value)
                if (graph.objectsByKey.has(hKey)) {
                  const hObj = graph.objectsByKey.get(hKey)
                  r2RawTargets.push({
                    key: hKey,
                    in_graph: true,
                    name: targetName(hObj, hKey),
                    value,
                    status,
                  })
                }
              }
            }
          }
        }
      }

      const targets = deduplicateTargets(r2RawTargets)
      const { status, note } = computeItemStatus(targets)
      items.push({
        item_id: 'AEGI-REL-R2',
        title: r2Conf.finding ?? '조직 전체나 누구나에게 쓰기 이상 권한이 열려 있음',
        finding_id: `${provider}-952`,
        status,
        threshold: ruleCondition,
        rule: {
          source: ruleSource,
          field: ruleField,
          condition: ruleCondition,
          combine: ruleCombine,
        },
        targets,
        note,
      })
    }

    // ----------------------------------------------------
    // R3: 비활성 계정에 남은 접근 (953)
    // ----------------------------------------------------
    {
      const r3Conf = rules.patterns?.R3 ?? {}
      const ruleSource = `정규화 그래프 ${datasetName} + 범용 접근 엔진 간선`
      const ruleField = '계정 상태, 관계 행'
      const ruleCondition = r3Conf.threshold ?? '비활성 계정의 남은 권한, 소속, 자격증명 0'
      const ruleCombine = r3Conf.question ?? '각 사람 계정이 비활성인데(자기 SaaS 상태 또는 같은 사람의 IdP 계정 상태) 권한 관계가 남아 있나'

      const r3RawTargets: CheckTarget[] = []

      // Pre-map assignment_references for R3
      const r3AssignmentObjectsByHolder = new Map<string, string[]>()
      for (const entry of rules.assignment_references ?? []) {
        if (entry.patterns?.includes('R3')) {
          for (const obj of graph.objectsByKey.values()) {
            if (obj.canonical?.provider === entry.provider && obj.canonical?.object_type === entry.object_type) {
              const holderRef = obj.canonical?.references?.[entry.holder]
              const holderTargets = Array.isArray(holderRef?.targets) ? holderRef.targets : []
              for (const ht of holderTargets) {
                const hKey = String(ht.value)
                if (!r3AssignmentObjectsByHolder.has(hKey)) r3AssignmentObjectsByHolder.set(hKey, [])
                r3AssignmentObjectsByHolder.get(hKey)!.push(obj.fixture_key)
              }
            }
          }
        }
      }

      for (const obj of graph.objectsByKey.values()) {
        if (obj.canonical?.provider === provider) {
          const ifaces = obj.canonical?.interfaces ?? []
          if (ifaces.includes('Principal') && principalKind(obj) !== 'service' && obj.canonical?.judged?.principal_kind !== 'group') {
            const isInactive = inactiveChecker(obj.fixture_key)

            // Collect remaining relations
            const remainingKeys = new Set<string>()

            for (const rel of graph.outgoingRelationsByObject.get(obj.fixture_key) ?? []) {
              if (['has_role_on', 'member_of', 'authenticates_with', 'acts_as'].includes(rel.relationType)) {
                const tgtObj = graph.objectsByKey.get(rel.targetKey)
                if (rel.relationType === 'member_of' && tgtObj?.canonical?.interfaces?.includes('Tenant')) {
                  // exclude member_of Tenant
                  continue
                }
                if (tgtObj) remainingKeys.add(rel.targetKey)
                const via = rel.properties?.via_assignment
                if (typeof via === 'string' && graph.objectsByKey.has(via)) remainingKeys.add(via)
              }
            }

            for (const rel of graph.incomingRelationsByObject.get(obj.fixture_key) ?? []) {
              if (rel.relationType === 'owned_by') {
                if (graph.objectsByKey.has(rel.sourceKey)) remainingKeys.add(rel.sourceKey)
                const via = rel.properties?.via_assignment
                if (typeof via === 'string' && graph.objectsByKey.has(via)) remainingKeys.add(via)
              }
            }

            // Also assignment_references held by this account
            const assnKeys = r3AssignmentObjectsByHolder.get(obj.fixture_key) ?? []
            for (const ak of assnKeys) {
              if (graph.objectsByKey.has(ak)) remainingKeys.add(ak)
            }

            if (isInactive) {
              if (remainingKeys.size > 0) {
                r3RawTargets.push({
                  key: obj.fixture_key,
                  in_graph: true,
                  name: targetName(obj, obj.fixture_key),
                  value: '비활성인데 남은 관계 있음',
                  status: 'fail',
                })
                for (const rk of remainingKeys) {
                  const rObj = graph.objectsByKey.get(rk)
                  r3RawTargets.push({
                    key: rk,
                    in_graph: true,
                    name: targetName(rObj, rk),
                    value: '비활성 계정에 연결된 대상',
                    status: 'fail',
                  })
                }
              } else {
                r3RawTargets.push({
                  key: obj.fixture_key,
                  in_graph: true,
                  name: targetName(obj, obj.fixture_key),
                  value: '비활성 계정(남은 관계 없음)',
                  status: 'pass',
                })
              }
            } else {
              // active
              r3RawTargets.push({
                key: obj.fixture_key,
                in_graph: true,
                name: targetName(obj, obj.fixture_key),
                value: '활성 계정',
                status: 'pass',
              })
              for (const rk of remainingKeys) {
                const rObj = graph.objectsByKey.get(rk)
                r3RawTargets.push({
                  key: rk,
                  in_graph: true,
                  name: targetName(rObj, rk),
                  value: '활성 계정 관계 대상',
                  status: 'pass',
                })
              }
            }
          }
        }
      }

      const targets = deduplicateTargets(r3RawTargets)
      const { status, note } = computeItemStatus(targets)
      items.push({
        item_id: 'AEGI-REL-R3',
        title: r3Conf.finding ?? '정지, 삭제된 계정이나 IdP 에서 정지된 사람의 계정에 권한, 소속, 자격증명이 남아 있음',
        finding_id: `${provider}-953`,
        status,
        threshold: ruleCondition,
        rule: {
          source: ruleSource,
          field: ruleField,
          condition: ruleCondition,
          combine: ruleCombine,
        },
        targets,
        note,
      })
    }

    // ----------------------------------------------------
    // R4: 조직 밖 주체의 접근 (954)
    // ----------------------------------------------------
    {
      const r4Conf = rules.patterns?.R4 ?? {}
      const ruleSource = `정규화 그래프 ${datasetName} + 범용 접근 엔진 간선`
      const ruleField = 'G 간선 from, rank, 외부 계정'
      const ruleCondition = r4Conf.threshold ?? '조직 밖 주체의 쓰기 이상 권한 0, 읽기는 허용 목록 대조'
      const ruleCombine = r4Conf.question ?? '권한을 받은 주체가 조직 밖(게스트, 외부 워크스페이스, 조직 도메인 밖 이메일)인가'

      const r4RawTargets: CheckTarget[] = []

      for (const edge of ix.edges.values()) {
        if (edge.kind === 'G' && ix.has(edge.from, 'Principal')) {
          const prov = edgeProvider(edge, graph)
          if (prov === provider) {
            let isOutside = outsideMap.has(edge.from)
            // 2차 지시: 이메일 도메인 판정은 ix.isPerson(from) 인 주체에만 한다. 비인간 주체는 outsideAccounts 만 본다.
            if (!isOutside && ix.isPerson(edge.from) && orgDomains.size > 0) {
              const fromObj = graph.objectsByKey.get(edge.from)
              const emails = extractR4Emails(fromObj, r4EmailFields)
              if (emails.length > 0) {
                isOutside = emails.some(m => {
                  const dom = m.split('@')[1]
                  return dom && !orgDomains.has(dom)
                })
              }
            }

            let edgeStatus: string
            let edgeValue: string
            if (isOutside) {
              if (edge.rank === undefined) {
                edgeStatus = 'unknown'
                edgeValue = '조직 밖 주체의 권한 세기 모름'
              } else if (edge.rank >= 3) {
                edgeStatus = 'fail'
                edgeValue = '조직 밖 주체에 쓰기 이상'
              } else {
                edgeStatus = 'org_policy'
                edgeValue = '조직 밖 주체의 읽기. 허용 목록이 있어야 위반이 정해짐(2026-11-13 결정)'
              }
            } else {
              edgeStatus = 'pass'
              edgeValue = '조직 안 주체'
            }

            for (const k of getEdgeTargetKeys(edge, graph)) {
              const obj = graph.objectsByKey.get(k)
              r4RawTargets.push({
                key: k,
                in_graph: true,
                name: targetName(obj, k),
                value: edgeValue,
                status: edgeStatus,
              })
            }
          }
        }
      }

      const targets = deduplicateTargets(r4RawTargets)
      const { status, note } = computeItemStatus(targets)
      items.push({
        item_id: 'AEGI-REL-R4',
        title: r4Conf.finding ?? '조직 밖 계정이 조직 자원에 쓰기 이상 권한을 가짐',
        finding_id: `${provider}-954`,
        status,
        threshold: ruleCondition,
        rule: {
          source: ruleSource,
          field: ruleField,
          condition: ruleCondition,
          combine: ruleCombine,
        },
        targets,
        note,
      })
    }

    // ----------------------------------------------------
    // R5: 비인간 신원과 연동 앱의 권한 (955)
    // ----------------------------------------------------
    {
      const r5Conf = rules.patterns?.R5 ?? {}
      const ruleSource = `정규화 그래프 ${datasetName} + 범용 접근 엔진 간선`
      const ruleField = '비인간 신원의 G, A 간선 rank, 소유자 상태'
      const ruleCondition = r5Conf.threshold ?? '비인간 신원의 관리 권한 0, 비활성 소유자의 쓰기 신원 0'
      const ruleCombine = r5Conf.question ?? '각 비인간 신원이 직접 또는 대신 동작하는 신원을 통해 닿는 가장 센 권한과, 그 소유자, 실행 신원의 상태'

      const r5RawTargets: CheckTarget[] = []
      const r5SkipCaps = new Set<string>(['authenticate'])

      // Non-human graph objects
      for (const obj of graph.objectsByKey.values()) {
        if (obj.canonical?.provider === provider && isNonHuman(obj)) {
          const holderKey = obj.fixture_key

          // Direct outgoing G edges (not rank-capped)
          const ownGEdges = ix.outOf(holderKey, 'G')

          // Borrowed G edges via A edges (rank-capped by scopeReach if scopes present)
          const rawScopes = scopesOf(obj)
          const hasScopeArray = Array.isArray(rawScopes)
          let maxScopeRank: number | undefined
          if (hasScopeArray) {
            const reach = scopeReach(provider, rawScopes.map(String))
            if (reach && reach.grants.length > 0) {
              maxScopeRank = Math.max(...reach.grants.map(g => g.rank))
            } else if (reach && reach.unmapped.length === 0) {
              maxScopeRank = 0
            } else {
              maxScopeRank = undefined
            }
          }

          const reachableGEdges: Edge[] = [...ownGEdges]
          const ranks: Array<number | undefined> = []
          for (const e of ownGEdges) {
            ranks.push(e.rank)
          }

          for (const aEdge of ix.outOf(holderKey, 'A')) {
            for (const edge of ix.outOf(aEdge.to, 'G')) {
              // 대신 동작하는 사용자의 승인(로그인 · 동의만 주는 부여)은 물려받지 않는다. 앱이 그 승인으로 다른 앱에 무엇을 하는 길이 아니다
              // (access_rules acts_as 홉의 skip_caps_only 와 같은 결정, 2026-11-16). 능력 이름이 없는 간선은 그대로 따라간다
              const caps = edge.caps
              if (caps?.length && caps.every(c => r5SkipCaps.has(c))) continue
              reachableGEdges.push(edge)
              if (hasScopeArray) {
                if (maxScopeRank !== undefined) {
                  ranks.push(edge.rank !== undefined ? Math.min(edge.rank, maxScopeRank) : undefined)
                } else {
                  // scope 가 있는데 scopeReach 가 grants 를 못 내면 빌린 세기는 undefined(모름)
                  ranks.push(undefined)
                }
              } else {
                ranks.push(edge.rank)
              }
            }
          }

          const hasEdges = reachableGEdges.length > 0
          const definedRanks = ranks.filter((r): r is number => r !== undefined)
          const maxRank = definedRanks.length > 0 ? Math.max(...definedRanks) : (hasEdges ? undefined : 0)

          let status = 'pass'
          let value = '정상 연동 권한'

          // 2차 지시 verdict: 최대 세기 5 이고 holder 가 Principal interface 이며 principalKind 가 service 면 org_policy, 그 밖 최대 세기 5 는 fail
          if (maxRank === 5) {
            const isServicePrincipal = obj.canonical?.interfaces?.includes('Principal') && principalKind(obj) === 'service'
            if (isServicePrincipal) {
              status = 'org_policy'
              value = '봇, 앱 계정의 관리 권한. 허용 목록이 있어야 위반이 정해짐'
            } else {
              status = 'fail'
              value = '연동 앱, 자동화, 자격증명이 관리 권한에 닿음'
            }
          } else if (maxRank !== undefined && maxRank >= 3 && maxRank < 5) {
            // Check connected human accounts via runs_as, acts_as, owned_by
            let ownerInactive = false
            for (const rel of graph.outgoingRelationsByObject.get(holderKey) ?? []) {
              if (['runs_as', 'acts_as'].includes(rel.relationType)) {
                if (ix.isPerson(rel.targetKey) && inactiveChecker(rel.targetKey)) ownerInactive = true
              }
            }
            for (const rel of graph.incomingRelationsByObject.get(holderKey) ?? []) {
              if (rel.relationType === 'owned_by') {
                if (ix.isPerson(rel.sourceKey) && inactiveChecker(rel.sourceKey)) ownerInactive = true
              }
            }
            if (ownerInactive) {
              status = 'fail'
              value = '쓰기 권한인데 소유자나 실행 신원이 비활성'
            }
          }

          if (status !== 'fail' && status !== 'org_policy') {
            const ifaces = obj.canonical?.interfaces ?? []
            if (ifaces.includes('Credential') && !isMfaFactor(obj, rules) && !credentialExpiry(obj, r5Conf.expiry_from)) {
              status = 'org_policy'
              value = '만료 없는 자격증명. 허용 목록이 있어야 위반이 정해짐(2026-11-13 결정)'
            } else if (maxRank === undefined) {
              status = 'unknown'
              value = '권한 세기를 모름'
            }
          }

          r5RawTargets.push({
            key: holderKey,
            in_graph: true,
            name: targetName(obj, holderKey),
            value,
            status,
          })

          for (const edge of reachableGEdges) {
            for (const k of getEdgeTargetKeys(edge, graph)) {
              const tObj = graph.objectsByKey.get(k)
              r5RawTargets.push({
                key: k,
                in_graph: true,
                name: targetName(tObj, k),
                value,
                status,
              })
            }
          }
        }
      }

      // assignment_references R5
      for (const entry of rules.assignment_references ?? []) {
        if (entry.patterns?.includes('R5') && entry.client && entry.provider === provider) {
          for (const obj of graph.objectsByKey.values()) {
            if (obj.canonical?.provider === provider && obj.canonical?.object_type === entry.object_type) {
              const tokenKey = obj.fixture_key
              const holderRef = obj.canonical?.references?.[entry.holder]
              const holderKey = holderRef?.targets?.[0]?.value ? String(holderRef.targets[0].value) : undefined
              const clientRef = obj.canonical?.references?.[entry.client]
              const clientKey = clientRef?.targets?.[0]?.value ? String(clientRef.targets[0].value) : undefined

              const rawScopes = scopesOf(obj) ?? (entry.scopes_path ? getProp(obj, entry.scopes_path) : undefined)
              const scopesList = Array.isArray(rawScopes) ? rawScopes.map(String)
                : typeof rawScopes === 'string' ? rawScopes.split(/[\s,]+/).filter(Boolean)
                : []

              const reach = scopesList.length > 0 ? scopeReach(provider, scopesList) : undefined
              let tokenRank: number | undefined
              if (reach && reach.grants.length > 0) {
                tokenRank = Math.max(...reach.grants.map(g => g.rank))
              } else if (scopesList.length === 0 || (reach && reach.unmapped.length === 0)) {
                tokenRank = 0
              } else {
                tokenRank = undefined
              }

              const holderInactive = holderKey ? inactiveChecker(holderKey) : false

              let status = 'pass'
              let value = '정상 토큰'
              if (holderInactive && (tokenRank ?? 0) >= 3) {
                status = 'fail'
                value = '쓰기 권한인데 소유자나 실행 신원이 비활성'
              } else if (tokenRank === 5) {
                status = 'fail'
                value = '연동 앱, 자동화, 자격증명이 관리 권한에 닿음'
              } else if (tokenRank === undefined && scopesList.length > 0) {
                status = 'unknown'
                value = '권한 세기를 모름'
              }

              r5RawTargets.push({
                key: tokenKey,
                in_graph: true,
                name: targetName(obj, tokenKey),
                value,
                status,
              })

              if (holderKey && graph.objectsByKey.has(holderKey)) {
                const hObj = graph.objectsByKey.get(holderKey)
                r5RawTargets.push({
                  key: holderKey,
                  in_graph: true,
                  name: targetName(hObj, holderKey),
                  value,
                  status,
                })
              }

              if (clientKey && graph.objectsByKey.has(clientKey)) {
                const cObj = graph.objectsByKey.get(clientKey)
                r5RawTargets.push({
                  key: clientKey,
                  in_graph: true,
                  name: targetName(cObj, clientKey),
                  value,
                  status,
                })
              }
            }
          }
        }
      }

      const targets = deduplicateTargets(r5RawTargets)
      const { status, note } = computeItemStatus(targets)
      items.push({
        item_id: 'AEGI-REL-R5',
        title: r5Conf.finding ?? '연동 앱, 봇, 자격증명이 관리 권한을 갖거나 비활성 소유자에 묶여 있음',
        finding_id: `${provider}-955`,
        status,
        threshold: ruleCondition,
        rule: {
          source: ruleSource,
          field: ruleField,
          condition: ruleCondition,
          combine: ruleCombine,
        },
        targets,
        note,
      })
    }

    // ----------------------------------------------------
    // R6: 사람 계정의 다중 인증 (956)
    // ----------------------------------------------------
    {
      const r6Conf = rules.patterns?.R6 ?? {}
      const ruleSource = `정규화 그래프 ${datasetName} + 범용 접근 엔진 간선`
      const ruleField = '다중 인증 수단, 속성, 정책'
      const ruleCondition = r6Conf.threshold ?? '활성 사람 계정 전원 다중 인증'
      const ruleCombine = r6Conf.question ?? '각 활성 사람 계정이 강한 인증 수단을 가졌거나 다중 인증 정책 아래 있나'

      const r6RawTargets: CheckTarget[] = []
      const noMfaData = (rules.tables?.no_mfa_data ?? ['slack', 'atlassian', 'github']) as string[]
      const inactiveStates = new Set<string>((rules.common?.inactive_states ?? ['suspended', 'deprovisioned', 'deleted']).map((s: string) => s.toLowerCase()))

      for (const obj of graph.objectsByKey.values()) {
        if (obj.canonical?.provider === provider && ix.isPerson(obj.fixture_key)) {
          const selfState = String(obj.canonical?.properties?.account_state ?? '').toLowerCase()
          if (inactiveStates.has(selfState)) continue // active_only

          // R6 verdict 순서: factor_or_property → mfa_policy_only → sso_delegate_pass → provider_has_no_mfa_data → else
          // factor_relation
          let factorFoundKey: string | undefined
          for (const rel of graph.outgoingRelationsByObject.get(obj.fixture_key) ?? []) {
            if (rel.relationType === 'authenticates_with') {
              const tgt = graph.objectsByKey.get(rel.targetKey)
              if (tgt) {
                for (const mf of rules.tables?.mfa_factors ?? []) {
                  if (tgt.canonical?.provider === mf.provider && tgt.canonical?.object_type === mf.object_type) {
                    const st = String(getProp(tgt, mf.status_path) ?? '')
                    if (Array.isArray(mf.status_ok) && mf.status_ok.includes(st)) {
                      factorFoundKey = tgt.fixture_key
                      break
                    }
                  }
                }
              }
            }
            if (factorFoundKey) break
          }

          // factor_property
          let propertyFound = false
          for (const mp of rules.tables?.mfa_properties ?? []) {
            if (obj.canonical?.provider === mp.provider && obj.canonical?.object_type === mp.object_type) {
              const val = getProp(obj, mp.path)
              if (Array.isArray(mp.values) && mp.values.includes(val)) {
                propertyFound = true
                break
              }
            }
          }

          if (factorFoundKey || propertyFound) {
            r6RawTargets.push({
              key: obj.fixture_key,
              in_graph: true,
              name: targetName(obj, obj.fixture_key),
              value: '다중 인증 수단 등록됨',
              status: 'pass',
            })
            if (factorFoundKey) {
              const fObj = graph.objectsByKey.get(factorFoundKey)
              r6RawTargets.push({
                key: factorFoundKey,
                in_graph: true,
                name: targetName(fObj, factorFoundKey),
                value: '다중 인증 수단',
                status: 'pass',
              })
            }
            continue
          }

          // mfa_policy_only
          let policyFoundKey: string | undefined
          for (const pol of graph.objectsByKey.values()) {
            for (const mpol of rules.tables?.mfa_policies ?? []) {
              if (pol.canonical?.provider === mpol.provider && pol.canonical?.object_type === mpol.object_type) {
                const val = String(getProp(pol, mpol.path) ?? '')
                if (Array.isArray(mpol.values) && mpol.values.includes(val)) {
                  // Check applies_to
                  for (const rel of graph.outgoingRelationsByObject.get(pol.fixture_key) ?? []) {
                    if (rel.relationType === 'applies_to') {
                      if (rel.targetKey === obj.fixture_key || ix.isTenant(rel.targetKey)) {
                        policyFoundKey = pol.fixture_key
                        break
                      }
                      // or member of group
                      for (const mRel of graph.outgoingRelationsByObject.get(obj.fixture_key) ?? []) {
                        if (mRel.relationType === 'member_of' && mRel.targetKey === rel.targetKey) {
                          policyFoundKey = pol.fixture_key
                          break
                        }
                      }
                    }
                    if (policyFoundKey) break
                  }
                }
              }
              if (policyFoundKey) break
            }
            if (policyFoundKey) break
          }

          if (policyFoundKey) {
            r6RawTargets.push({
              key: obj.fixture_key,
              in_graph: true,
              name: targetName(obj, obj.fixture_key),
              value: '정책은 요구하나 등록 수단을 확인 못 함',
              status: 'unknown',
            })
            const pObj = graph.objectsByKey.get(policyFoundKey)
            r6RawTargets.push({
              key: policyFoundKey,
              in_graph: true,
              name: targetName(pObj, policyFoundKey),
              value: '다중 인증 요구 정책',
              status: 'unknown',
            })
            continue
          }

          // sso_delegate_pass
          let ssoPass = false
          for (const sso of rules.tables?.sso_delegation ?? []) {
            if (sso.provider === provider) {
              const hasSsoObject = [...graph.objectsByKey.values()].some(
                o => o.canonical?.provider === provider && o.canonical?.object_type === sso.sso_object
              )
              if (hasSsoObject) {
                // Find same person in idp
                const emails = new Set(extractAccountEmails(obj))
                for (const idpObj of graph.objectsByKey.values()) {
                  if (idpObj.canonical?.provider === sso.idp && ix.isPerson(idpObj.fixture_key)) {
                    const idpEmails = extractAccountEmails(idpObj)
                    const emailMatch = idpEmails.some(m => emails.has(m))
                    let linkMatch = false
                    for (const link of files.links ?? []) {
                      if (link.set?.some((m: any) => m.object_key === obj.fixture_key) &&
                          link.set?.some((m: any) => m.object_key === idpObj.fixture_key)) {
                        linkMatch = true
                        break
                      }
                    }
                    if (emailMatch || linkMatch) {
                      // Check idp factor/property
                      for (const rel of graph.outgoingRelationsByObject.get(idpObj.fixture_key) ?? []) {
                        if (rel.relationType === 'authenticates_with') {
                          const tgt = graph.objectsByKey.get(rel.targetKey)
                          if (tgt) {
                            for (const mf of rules.tables?.mfa_factors ?? []) {
                              if (tgt.canonical?.provider === mf.provider && tgt.canonical?.object_type === mf.object_type) {
                                const st = String(getProp(tgt, mf.status_path) ?? '')
                                if (Array.isArray(mf.status_ok) && mf.status_ok.includes(st)) {
                                  ssoPass = true
                                  break
                                }
                              }
                            }
                          }
                        }
                        if (ssoPass) break
                      }
                    }
                  }
                  if (ssoPass) break
                }
              }
            }
            if (ssoPass) break
          }

          if (ssoPass) {
            r6RawTargets.push({
              key: obj.fixture_key,
              in_graph: true,
              name: targetName(obj, obj.fixture_key),
              value: 'SSO 로 연동된 IdP 다중 인증 적용',
              status: 'pass',
            })
          } else if (noMfaData.includes(provider)) {
            r6RawTargets.push({
              key: obj.fixture_key,
              in_graph: true,
              name: targetName(obj, obj.fixture_key),
              value: '그 SaaS 수집본에 다중 인증 값이 없음',
              status: 'not_collected',
            })
          } else {
            r6RawTargets.push({
              key: obj.fixture_key,
              in_graph: true,
              name: targetName(obj, obj.fixture_key),
              value: '다중 인증 수단과 정책이 모두 없음',
              status: 'fail',
            })
          }
        }
      }

      const targets = deduplicateTargets(r6RawTargets)
      const { status, note } = computeItemStatus(targets)
      items.push({
        item_id: 'AEGI-REL-R6',
        title: r6Conf.finding ?? '활성 사람 계정에 등록된 다중 인증 수단도, 다중 인증을 요구하는 정책도 없음',
        finding_id: `${provider}-956`,
        status,
        threshold: ruleCondition,
        rule: {
          source: ruleSource,
          field: ruleField,
          condition: ruleCondition,
          combine: ruleCombine,
        },
        targets,
        note,
      })
    }

    // ----------------------------------------------------
    // R7: 공용 계정 (957)
    // ----------------------------------------------------
    {
      const r7Conf = rules.patterns?.R7 ?? {}
      const ruleSource = `정규화 그래프 ${datasetName} + 범용 접근 엔진 간선`
      const ruleField = '계정 이름, 자격증명 공유'
      const ruleCondition = r7Conf.threshold ?? '공용 계정 0 또는 승인과 이력 있음'
      const ruleCombine = r7Conf.question ?? '사람 계정 중 같은 사람 연결이 없고 이름이 공용 표지인 것, 여러 주체가 쥔 자격증명이 있나'

      const r7RawTargets: CheckTarget[] = []
      const markers = (rules.tables?.shared_markers ?? ['admin', 'administrator', 'test', 'shared', 'common', 'team', 'ops', 'service', 'support', 'info', 'root', 'master', 'guest', 'temp']) as string[]
      const markerRegexes = markers.map(m => new RegExp(`\\b${m}\\b`, 'i'))

      for (const obj of graph.objectsByKey.values()) {
        if (obj.canonical?.provider === provider && ix.isPerson(obj.fixture_key)) {
          const key = obj.fixture_key

          // 1. Shared credential?
          let holdingSharedCred: string | undefined
          for (const [credKey, holders] of credentialHolders.entries()) {
            if (holders.has(key)) {
              holdingSharedCred = credKey
              break
            }
          }

          if (holdingSharedCred) {
            r7RawTargets.push({
              key,
              in_graph: true,
              name: targetName(obj, key),
              value: '자격증명 하나를 여러 주체가 씀',
              status: 'manual',
            })
            const cObj = graph.objectsByKey.get(holdingSharedCred)
            r7RawTargets.push({
              key: holdingSharedCred,
              in_graph: true,
              name: targetName(cObj, holdingSharedCred),
              value: '자격증명 하나를 여러 주체가 씀',
              status: 'manual',
            })
            continue
          }

          // 2. Shared marker & no link
          const linkCount = accountLinkCounts.get(key) ?? 0
          const emails = extractAccountEmails(obj)
          const hasOverlappingEmail = emails.some(m => (emailToProviders.get(m)?.size ?? 0) > 1)
          const hasConnection = linkCount > 1 || hasOverlappingEmail

          let isMarkerMatched = false
          if (!hasConnection) {
            const props = obj.canonical?.properties as Record<string, unknown> | undefined
            const meta = obj.fixture_meta as Record<string, unknown> | undefined
            const texts = [
              typeof props?.login === 'string' ? props.login : '',
              emails.length > 0 ? emails[0].split('@')[0] : '',
              typeof meta?.display_name === 'string' ? meta.display_name : '',
              typeof props?.name === 'string' ? props.name : '',
            ].filter(Boolean).join(' ').toLowerCase()

            if (markerRegexes.some(rx => rx.test(texts))) {
              isMarkerMatched = true
            }
          }

          if (isMarkerMatched) {
            r7RawTargets.push({
              key,
              in_graph: true,
              name: targetName(obj, key),
              value: '공용 계정으로 보임. 책임자 승인과 사용 이력은 사람이 확인',
              status: 'manual',
            })
          } else {
            r7RawTargets.push({
              key,
              in_graph: true,
              name: targetName(obj, key),
              value: '개인 계정',
              status: 'pass',
            })
          }
        }
      }

      // Also if a shared credential belongs to this provider
      for (const [credKey] of credentialHolders.entries()) {
        const cObj = graph.objectsByKey.get(credKey)
        if (cObj?.canonical?.provider === provider) {
          r7RawTargets.push({
            key: credKey,
            in_graph: true,
            name: targetName(cObj, credKey),
            value: '자격증명 하나를 여러 주체가 씀',
            status: 'manual',
          })
        }
      }

      const targets = deduplicateTargets(r7RawTargets)
      const { status, note } = computeItemStatus(targets)
      items.push({
        item_id: 'AEGI-REL-R7',
        title: r7Conf.finding ?? '공용으로 보이는 사람 계정이나 여러 신원이 함께 쥔 자격증명이 있음',
        finding_id: `${provider}-957`,
        status,
        threshold: ruleCondition,
        rule: {
          source: ruleSource,
          field: ruleField,
          condition: ruleCondition,
          combine: ruleCombine,
        },
        targets,
        note,
      })
    }

    // ----------------------------------------------------
    // 사람 확인 (manual_items) (958)
    // ----------------------------------------------------
    {
      const manualConf = rules.manual_items ?? {}
      const ruleSource = `정규화 그래프 ${datasetName} + 범용 접근 엔진 간선`
      const ruleField = 'typeScope 확인 객체'
      const ruleCondition = '사람 확인 항목의 대상 객체'
      const ruleCombine = '사람 확인 항목에 해당하는 종류의 객체 전원'

      const manualTargets: CheckTarget[] = []
      for (const obj of graph.objectsByKey.values()) {
        if (obj.canonical?.provider === provider) {
          const typeKey = `${obj.canonical.provider}:${obj.canonical.object_type}`.toLowerCase()
          if (confirmedTypeKeys.has(typeKey)) {
            manualTargets.push({
              key: obj.fixture_key,
              in_graph: true,
              name: targetName(obj, obj.fixture_key),
              value: '사람 확인 대상 객체',
              status: 'manual',
            })
          }
        }
      }

      const targets = deduplicateTargets(manualTargets)
      const { status, note } = computeItemStatus(targets)
      scanTypes.set('AEGI-REL-MANUAL', [...confirmedTypeKeys].filter(k => k.startsWith(`${provider}:`)).map(k => k.slice(provider.length + 1)))
      items.push({
        item_id: 'AEGI-REL-MANUAL',
        title: manualConf.name ?? '사람 확인 항목의 대상',
        finding_id: `${provider}-958`,
        status,
        threshold: '',
        rule: {
          source: ruleSource,
          field: ruleField,
          condition: ruleCondition,
          combine: ruleCombine,
        },
        targets,
        note,
      })
    }

    // ----------------------------------------------------
    // SaaS별 설정 규칙 (setting_rules, 961~969)
    // ----------------------------------------------------
    if (Array.isArray(rules.setting_rules)) {
      for (const rule of rules.setting_rules) {
        const providerTargetSpecs = (rule.targets ?? []).filter((t: any) => t.provider === provider)
        if (providerTargetSpecs.length === 0) continue

        // follow 대상 종류가 먼저 판정되도록 정렬한다 (순환이면 적힌 순서 유지)
        const specTypes = new Set<string>(providerTargetSpecs.map((ts: any) => String(ts.object_type)))
        const depsBySpec = new Map<any, Set<string>>()
        for (const ts of providerTargetSpecs) {
          const deps = new Set<string>()
          for (const c of ts.cases ?? []) {
            if (!c.follow) continue
            if (c.follow.object_type && specTypes.has(c.follow.object_type) && c.follow.object_type !== ts.object_type) {
              deps.add(String(c.follow.object_type))
            }
            if (c.follow.reference) {
              for (const obj of graph.objectsByKey.values()) {
                if (obj.canonical?.provider === provider && obj.canonical?.object_type === ts.object_type) {
                  for (const t of obj.canonical?.references?.[c.follow.reference]?.targets ?? []) {
                    const refType = t?.value ? graph.objectsByKey.get(String(t.value))?.canonical?.object_type : undefined
                    if (refType && specTypes.has(refType) && refType !== ts.object_type) {
                      deps.add(refType)
                    }
                  }
                }
              }
            }
          }
          depsBySpec.set(ts, deps)
        }
        const orderedSpecs: any[] = []
        const remainingSpecs = [...providerTargetSpecs]
        const doneTypes = new Set<string>()
        while (remainingSpecs.length > 0) {
          const idx = remainingSpecs.findIndex(ts => [...(depsBySpec.get(ts) ?? [])].every(d => doneTypes.has(d)))
          if (idx === -1) {
            orderedSpecs.push(...remainingSpecs)
            break
          }
          const [picked] = remainingSpecs.splice(idx, 1)
          orderedSpecs.push(picked)
          if (!remainingSpecs.some(ts => ts.object_type === picked.object_type)) {
            doneTypes.add(String(picked.object_type))
          }
        }

        const rawTargets: CheckTarget[] = []
        const evaluatedStatuses = new Map<string, string>()

        for (const targetSpec of orderedSpecs) {
          const matchingObjs: FixtureObject[] = []
          for (const obj of graph.objectsByKey.values()) {
            if (obj.canonical?.provider === provider && obj.canonical?.object_type === targetSpec.object_type) {
              matchingObjs.push(obj)
            }
          }

          for (const obj of matchingObjs) {
            let matchedStatus: string | undefined
            let matchedValue: string | undefined

            for (const c of targetSpec.cases ?? []) {
              if (c.follow) {
                if (c.when && !evaluateCondition(c.when, obj, graph, { orgDomains })) {
                  continue
                }

                let followStatus: string | undefined

                if (c.follow.children_by) {
                  const childStatuses: string[] = []
                  for (const childObj of graph.objectsByKey.values()) {
                    if (childObj.canonical?.provider === provider && childObj.canonical?.object_type === c.follow.object_type) {
                      const tgts = childObj.canonical?.references?.[c.follow.children_by]?.targets ?? []
                      if (tgts.some((t: any) => String(t.value) === obj.fixture_key)) {
                        const st = evaluatedStatuses.get(childObj.fixture_key)
                        if (st) {
                          childStatuses.push(st)
                        }
                      }
                    }
                  }
                  if (childStatuses.length > 0) {
                    followStatus = childStatuses.reduce((best, s) => {
                      return (STATUS_RANK[s] ?? 0) > (STATUS_RANK[best] ?? 0) ? s : best
                    }, childStatuses[0])
                  }
                } else if (c.follow.reference) {
                  const refStatuses: string[] = []
                  const tgts = obj.canonical?.references?.[c.follow.reference]?.targets ?? []
                  for (const t of tgts) {
                    if (t?.value) {
                      const st = evaluatedStatuses.get(String(t.value))
                      if (st) {
                        refStatuses.push(st)
                      }
                    }
                  }
                  if (refStatuses.length > 0) {
                    followStatus = refStatuses.reduce((best, s) => {
                      return (STATUS_RANK[s] ?? 0) > (STATUS_RANK[best] ?? 0) ? s : best
                    }, refStatuses[0])
                  }
                } else if (c.follow.sibling_by) {
                  const myRefVal = obj.canonical?.references?.[c.follow.sibling_by]?.targets?.[0]?.value
                  if (myRefVal !== undefined && myRefVal !== null) {
                    const sibStatuses: string[] = []
                    for (const sibObj of graph.objectsByKey.values()) {
                      if (sibObj.canonical?.provider === provider && sibObj.canonical?.object_type === c.follow.object_type) {
                        const sibRefVal = sibObj.canonical?.references?.[c.follow.sibling_by]?.targets?.[0]?.value
                        if (sibRefVal !== undefined && sibRefVal !== null && String(sibRefVal) === String(myRefVal)) {
                          const st = evaluatedStatuses.get(sibObj.fixture_key)
                          if (st) {
                            sibStatuses.push(st)
                          }
                        }
                      }
                    }
                    if (sibStatuses.length > 0) {
                      followStatus = sibStatuses.reduce((best, s) => {
                        return (STATUS_RANK[s] ?? 0) > (STATUS_RANK[best] ?? 0) ? s : best
                      }, sibStatuses[0])
                    }
                  }
                }

                if (followStatus !== undefined) {
                  matchedStatus = followStatus
                  matchedValue = formatValueTemplate(c.value, obj)
                  break
                }
                // 가져올 상태가 하나도 없으면 그 줄은 안 맞고 다음 줄로 간다
                continue
              } else {
                if (evaluateCondition(c.when, obj, graph, { orgDomains })) {
                  matchedStatus = c.status
                  matchedValue = formatValueTemplate(c.value, obj)
                  break
                }
              }
            }

            if (matchedStatus === undefined) {
              matchedStatus = 'unknown'
              matchedValue = '규칙에 없는 값'
            }

            if (matchedStatus === '_skip') {
              continue
            }

            if (targetSpec.emit !== false) {
              rawTargets.push({
                key: obj.fixture_key,
                in_graph: true,
                name: targetName(obj, obj.fixture_key),
                value: matchedValue,
                status: matchedStatus,
              })
            }

            const prev = evaluatedStatuses.get(obj.fixture_key)
            if (!prev || (STATUS_RANK[matchedStatus] ?? 0) > (STATUS_RANK[prev] ?? 0)) {
              evaluatedStatuses.set(obj.fixture_key, matchedStatus)
            }
          }
        }

        const targets = deduplicateTargets(rawTargets)
        const { status, note } = computeItemStatus(targets)
        const field = providerTargetSpecs.filter((ts: any) => ts.emit !== false).map((ts: any) => ts.object_type).join(', ')
        scanTypes.set(`AEGI-SET-${rule.id}`, providerTargetSpecs.filter((ts: any) => ts.emit !== false).map((ts: any) => String(ts.object_type)))

        items.push({
          item_id: `AEGI-SET-${rule.id}`,
          title: rule.finding,
          finding_id: `${provider}-${rule.number}`,
          status,
          threshold: rule.finding,
          rule: {
            source: `정규화 그래프 ${datasetName} 객체 속성`,
            field,
            condition: rule.finding,
            combine: rule.name,
          },
          targets,
          note,
        })
      }
    }

    // 대상 0개라 pass 인 항목: 수집이 끝까지 되지 않았으면 「충족」이 아니라 미수집이다
    for (const it of items) {
      if (it.status !== 'pass' || it.targets.length) continue
      const reason = emptyTargetsReason(provider, scanTypes.has(it.item_id) ? scanTypes.get(it.item_id)! : null, files.coverage)
      if (reason) {
        it.status = 'not_collected'
        it.note = `대상 0개지만 정말 없는지 알 수 없음: ${reason}`
      }
    }

    results[provider] = {
      standard: standardName,
      tier: 3,
      provider,
      raw_run: rawRun,
      items,
    }
  }

  return results
}

export function parseArgs(argv: string[] = process.argv.slice(2)): { dataset: string; knowledge: string; out: string; rawRun: string } {
  const options = new Map<string, string>()
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      options.set(argv[i], argv[i + 1])
    }
  }
  const dataset = options.get('--dataset')
  const knowledge = options.get('--knowledge')
  const out = options.get('--out')
  const rawRun = options.get('--raw-run')
  if (!dataset || !knowledge || !out || !rawRun) {
    throw new Error('사용법: node --import tsx scripts/standards/relation_checks.ts --dataset <폴더> --knowledge <폴더> --out <폴더> --raw-run <이름>')
  }
  return { dataset, knowledge, out, rawRun }
}

export function main(): void {
  const { dataset, knowledge, out, rawRun } = parseArgs()
  fs.mkdirSync(out, { recursive: true })

  const files = readDatasetFiles(dataset)
  const rulesPath = path.join(knowledge, 'checks', 'relation-rules.yaml')
  const rulesText = fs.readFileSync(rulesPath, 'utf8')
  const rules = YAML.parse(rulesText)

  const scopePath = path.join(knowledge, 'items-clean', 'item-type-scope.jsonl')
  const scopeLines: any[] = []
  if (fs.existsSync(scopePath)) {
    const lines = fs.readFileSync(scopePath, 'utf8').split(/\r?\n/).filter(Boolean)
    for (const line of lines) {
      scopeLines.push(JSON.parse(line))
    }
  }

  const datasetName = path.basename(path.resolve(dataset))
  const results = evaluateRelationChecks(files, rules, scopeLines, rawRun, datasetName)

  for (const [provider, result] of Object.entries(results)) {
    const outFile = path.join(out, `aegi_relations_${provider}.json`)
    fs.writeFileSync(outFile, JSON.stringify(result, null, 1), 'utf8')
    const statusCounts = result.items.reduce<Record<string, number>>((acc, it) => {
      acc[it.status] = (acc[it.status] ?? 0) + 1
      return acc
    }, {})
    console.log(`aegi_relations_${provider} ${result.items.length} items`, statusCounts)
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isDirectRun) {
  main()
}
