/**
 * 엔진의 F(데이터 흐름) 간선과 관찰을 OpenLineage 이벤트로 바꾼다. 설계: docs/spec/AEGI_LINEAGE_V1.md
 *
 * - 데이터(Dataset)와 데이터를 옮기는 것(Job)만 남긴다. 계정, 인증 요소, 조직은 계보가 아니라서 버린다.
 * - 관찰로 뒷받침된 이동은 RunEvent, 설정으로만 흐를 수 있는 것은 JobEvent(정적 계보)다.
 * - Run 하나는 관찰 하나(관찰이 없으면 결과물 하나)다. Apps Script 와 webhook 처럼 이어진 자동화는 Job 하나로 묶는다.
 * - Run 의 입력과 근거 수준은 그 Run 의 관찰만 보고 정한다. 엔진은 같은 간선을 여러 관찰에서 합치므로 간선의 불확실 사유는 쓰지 않는다.
 * - 정규화 단계(scripts/lineage)가 돌려 데이터셋 폴더의 lineage_events.json 에 쓴다. 화면은 계산하지 않고 읽기만 한다.
 */
import { buildEvidenceStore, buildGraphStoreV2 } from '../data/datasetStore'
import { runAccessEngine } from '../detection/v2/engine'
import { OBS_PREFIX } from '../detection/v2/engine/edges'
import type { Edge } from '../detection/v2/engine/types'
import type { EvidenceObservation, FindingEvidenceLink } from '../model/evidence'
import type { FixtureObject } from '../model/object'
import {
  LINEAGE_FORMAT,
  LINEAGE_PRODUCER,
  OPENLINEAGE_SCHEMA,
  isRunEvent,
  weakest,
  type AegiEvidenceFacet,
  type ColumnLineageFacet,
  type EvidenceLevel,
  type FieldBasis,
  type LineageDataset,
  type LineageEvent,
  type LineageFile,
  type LineageJob,
  type LineageJobEvent,
  type LineageRunEvent,
} from './types'

/** 계보에서 데이터로 보는 객체 종류 (provider|object_type). 채널은 메시지를 담는 데이터로 본다 */
export const DATASET_TYPES: ReadonlySet<string> = new Set([
  'gws|File',
  'gws|Form',
  'slack|Message',
  'slack|conversation',
  'slack|File',
  'github|Repository',
  'github|Commit',
  'github|Pull Request',
  'github|Artifact',
])

/** 데이터를 읽거나 옮기는 것. 관찰의 실행(obs: 로 시작하는 가상 노드)도 여기에 든다 */
export const JOB_TYPES: ReadonlySet<string> = new Set([
  'gws|Project',
  'slack|incoming-webhook',
  'slack|Slash Command Request Endpoint',
  'github|Workflow',
  'github|Webhook',
])

/**
 * Apps Script 가 받은 권한 범위로 읽을 수 있는 데이터. 객체가 없어 가상 Dataset 으로 둔다.
 * 사용자 디렉터리는 계정 정보지만, 통째로 읽어 내보내면 개인정보 목록이 옮겨진 것이라 데이터로 본다
 */
const SCOPE_DATASETS: Array<{ scope: RegExp; name: string }> = [
  { scope: /\/auth\/admin\.directory\.user(\.readonly)?$/, name: 'Directory/users' },
  { scope: /\/auth\/admin\.directory\.group(\.readonly)?$/, name: 'Directory/groups' },
]

/** Drive 의 Apps Script 파일은 Job 의 코드라 데이터로 보지 않는다 */
const SCRIPT_MIME = 'application/vnd.google-apps.script'

const AEGI_FACET_SCHEMA = 'https://github.com/AEGI-Inc/aegi-adapter-engine/blob/main/scripts/lineage/schema/AegiFacets.json'
const aegiFacetURL = (def: string) => `${AEGI_FACET_SCHEMA}#/$defs/${def}`
const OL_FACET = {
  symlinks: 'https://openlineage.io/spec/facets/1-0-1/SymlinksDatasetFacet.json#/$defs/SymlinksDatasetFacet',
  columnLineage: 'https://openlineage.io/spec/facets/1-2-0/ColumnLineageDatasetFacet.json#/$defs/ColumnLineageDatasetFacet',
}
const facet = (schemaURL: string) => ({ _producer: LINEAGE_PRODUCER, _schemaURL: schemaURL })

export interface LineageInput {
  objects: FixtureObject[]
  observations: EvidenceObservation[]
  evidenceLinks: FindingEvidenceLink[]
  /** 엔진 간선. F 만 쓴다 */
  edges: Iterable<Edge>
  /** manifest.environment_id. namespace 에 쓴다 */
  environment: string
  /** manifest.created_at. 시각이 없는 이벤트의 eventTime */
  createdAt: string | null
}

type Role = 'dataset' | 'job'

/** 같은 입력이면 같은 값이 나오게 FNV-1a 로 32자리 16진수를 만든다 */
function stableHex(seed: string): string {
  let hex = ''
  for (let round = 0; round < 4; round++) {
    let h = 0x811c9dc5 ^ round
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0
    hex += h.toString(16).padStart(8, '0')
  }
  return hex
}
function stableUuid(seed: string): string {
  const hex = stableHex(seed)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort()

/**
 * 관찰 하나가 이동을 얼마나 직접 남겼나.
 * - 전달: 웹훅 지문이 맞으면 확정, 실행과 메시지의 시각 대조면 정황. 합성 픽스처는 이동을 직접 적으므로 확정
 * - 에이전트 실행, 슬래시 요청: 실행은 기록에 있지만 결과물 내용이 입력에서 왔는지는 모르므로 정황
 */
function observationLevel(o: EvidenceObservation): { level: EvidenceLevel; reason?: string } {
  const a = o.attributes
  if (o.kind === 'delivery') {
    if (a.webhook_fingerprint_match === true || a.matching === 'webhook_fingerprint') return { level: 'run_record' }
    if (a.matching === 'execution_message_time' || a.matched_execution) return { level: 'correlation', reason: 'matched_by_time' }
    return o.provenance.record === 'synthetic' ? { level: 'run_record' } : { level: 'correlation', reason: 'delivery_basis_unknown' }
  }
  if (o.kind === 'slash_request' || o.kind === 'request_log') return { level: 'correlation', reason: 'request_content_unverified' }
  return { level: 'correlation', reason: 'derived_content_unverified' }
}

export function buildLineage(input: LineageInput): LineageFile {
  const env = input.environment.toLowerCase()
  const fallbackTime = input.createdAt ?? '1970-01-01T00:00:00.000Z'
  const objects = new Map(input.objects.map(o => [o.fixture_key, o]))
  const observations = new Map(input.observations.map(o => [o.id, o]))
  const links = new Map(input.evidenceLinks.map(l => [l.id, l]))
  const linkObservation = (l: FindingEvidenceLink) => (l.from.kind === 'observation' ? l.from.id : l.to.kind === 'observation' ? l.to.id : undefined)

  const typeKey = (o: FixtureObject) => `${o.canonical.provider}|${o.canonical.object_type}`
  const roleOf = (key: string | undefined): Role | undefined => {
    if (!key) return undefined
    if (key.startsWith(OBS_PREFIX)) return observations.has(key.slice(OBS_PREFIX.length)) ? 'job' : undefined
    const o = objects.get(key)
    if (!o) return undefined
    const t = typeKey(o)
    if (DATASET_TYPES.has(t)) return o.canonical.properties.mimeType === SCRIPT_MIME ? undefined : 'dataset'
    return JOB_TYPES.has(t) ? 'job' : undefined
  }
  const nameOf = (key: string): string => {
    const o = objects.get(key)
    const p = o?.canonical.properties ?? {}
    return String(p.name ?? p.title ?? p.documentTitle ?? o?.fixture_meta?.display_name ?? key)
  }
  const parentOf = (key: string) => str(objects.get(key)?.canonical.references?.parent?.targets?.[0]?.value)

  const symlinks = (key: string) => ({ ...facet(OL_FACET.symlinks), identifiers: [{ namespace: 'aegi://objects', name: key, type: 'AEGI_OBJECT' }] })
  const dataset = (key: string): LineageDataset => {
    const o = objects.get(key)!
    return { namespace: `${o.canonical.provider}://${env}`, name: `${o.canonical.object_type}/${key}`, facets: { symlinks: symlinks(key) } }
  }
  /** 객체가 없는 데이터 (사용자 디렉터리, 메일함, 외부 메일 주소). linkKey 가 있으면 그 객체에 symlinks 로 잇는다 */
  const virtualDataset = (namespace: string, name: string, linkKey?: string): LineageDataset => ({ namespace, name, ...(linkKey && objects.has(linkKey) ? { facets: { symlinks: symlinks(linkKey) } } : {}) })
  const jobRef = (key: string): { namespace: string; name: string; type: string } => {
    if (key.startsWith(OBS_PREFIX)) {
      const obs = observations.get(key.slice(OBS_PREFIX.length))!
      return { namespace: `aegi://${env}`, name: `${obs.kind}/${obs.id}`, type: obs.kind }
    }
    const o = objects.get(key)!
    return { namespace: `${o.canonical.provider}://${env}`, name: `${o.canonical.object_type}/${key}`, type: o.canonical.object_type }
  }
  const evidenceFacet = (level: EvidenceLevel, obs: Iterable<string>, reasons: Iterable<string>, fields: FieldBasis, gaps: Iterable<string>): AegiEvidenceFacet => ({
    ...facet(aegiFacetURL('AegiEvidenceFacet')),
    level,
    observations: sorted(obs),
    reasons: sorted(reasons),
    fields,
    gaps: sorted(gaps),
  })
  const tenantKey = input.objects.find(o => typeKey(o) === 'gws|Customer')?.fixture_key

  // 데이터와 Job 사이의 F 간선만
  const flows = [...input.edges].filter(e => e.kind === 'F' && roleOf(e.from) && roleOf(e.to))
  const observedIn = new Map<string, Edge[]>()
  for (const e of flows) if (e.observed) observedIn.set(e.to, [...(observedIn.get(e.to) ?? []), e])
  const observationsOf = (e: Edge): string[] =>
    e.refs.flatMap(r => {
      if (r.type === 'observation') return [r.id]
      const l = r.type === 'evidence' ? links.get(r.id) : undefined
      const o = l ? linkObservation(l) : undefined
      return o ? [o] : []
    })
  /** 정규화가 추정으로 남긴 입력 (트리거 종류와 소유 관계로 이은 것) */
  const inferredRef = (e: Edge) => e.refs.some(r => r.type === 'evidence' && (links.get(r.id)?.attributes as { basis?: string } | undefined)?.basis === 'inferred')

  /**
   * 결과물을 낸 Job 에서 거슬러 올라가 이어진 Job 들과 그 입력 데이터를 모은다. depth 가 클수록 상류.
   * 관찰이 있는 Run 은 그 관찰이 남긴 간선만 따라간다 (같은 자동화의 다른 실행이 읽은 데이터가 섞이지 않게)
   */
  const upstream = (jobs: string[], obs: Set<string>) => {
    const depth = new Map<string, number>(jobs.map(j => [j, 0]))
    const edges: Edge[] = []
    const inputs = new Set<string>()
    const queue = [...jobs]
    while (queue.length) {
      const j = queue.shift()!
      for (const e of observedIn.get(j) ?? []) {
        const own = observationsOf(e)
        if (obs.size ? !own.some(o => obs.has(o)) : own.length > 0) continue
        edges.push(e)
        if (roleOf(e.from) === 'dataset') inputs.add(e.from)
        else if (!depth.has(e.from)) {
          depth.set(e.from, depth.get(j)! + 1)
          queue.push(e.from)
        }
      }
    }
    const chain = [...depth.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k)
    return { chain, inputs, edges }
  }

  // ---------------------------------------------------------------- Run: 관찰로 뒷받침된 이동
  interface RunDraft {
    key: string
    /** 결과물을 직접 낸 Job (없으면 데이터에서 데이터로 바로 이어진 것) */
    producers: Set<string>
    /** 관찰에서 바로 읽은 Job 단계와 입력 (엔진이 간선을 만들지 않는 전달, 슬래시 요청) */
    extraChain: string[]
    inputs: Set<string>
    outputs: Set<string>
    obs: Set<string>
    derivedFrom: Set<string>
    levels: EvidenceLevel[]
    reasons: string[]
  }
  const runs = new Map<string, RunDraft>()
  const draft = (key: string): RunDraft => {
    const r = runs.get(key) ?? { key, producers: new Set(), extraChain: [], inputs: new Set(), outputs: new Set(), obs: new Set(), derivedFrom: new Set(), levels: [], reasons: [] }
    runs.set(key, r)
    return r
  }
  const runKeyOf = (obs: string[]) => `obs:${sorted(obs).join('+')}`

  for (const e of flows) {
    if (!e.observed || roleOf(e.to) !== 'dataset') continue
    const obs = observationsOf(e)
    const fromJob = roleOf(e.from) === 'job'
    const run = draft(obs.length ? runKeyOf(obs) : `${fromJob ? e.from : `derivation:${e.from}`}>${e.to}`)
    run.outputs.add(e.to)
    for (const o of obs) run.obs.add(o)
    if (fromJob) run.producers.add(e.from)
    else run.derivedFrom.add(e.from)
  }

  // 엔진이 F 간선을 만들지 않는 전달: 웹훅 없이 봇 토큰으로 올린 메시지 (예: 웹앱이 채널에 올린 글)
  const covered = new Set([...runs.values()].flatMap(r => [...r.obs]))
  for (const o of input.observations) {
    if (o.kind !== 'delivery' || covered.has(o.id)) continue
    const msg = str(o.attributes.destination_message)
    const automation = str(o.attributes.automation)
    if (roleOf(msg) !== 'dataset' || roleOf(automation) !== 'job') continue
    const run = draft(runKeyOf([o.id]))
    run.obs.add(o.id)
    run.outputs.add(msg!)
    run.extraChain.push(automation!)
    const endpoint = str(o.attributes.destination_endpoint)
    if (roleOf(endpoint) === 'job') run.extraChain.push(endpoint!)
    const src = str(o.attributes.source_file)
    if (roleOf(src) === 'dataset') run.inputs.add(src!)
  }

  // 슬래시 명령이 만든 결과물: 요청한 채널 → 명령 주소 → 커밋. 엔진은 효과(E)로만 본다
  for (const o of input.observations) {
    if ((o.kind !== 'slash_request' && o.kind !== 'request_log') || covered.has(o.id)) continue
    if (o.attributes.result !== undefined && o.attributes.result !== 'success') continue
    const results = [str(o.attributes.correlated_commit), str(o.attributes.target_object)].filter(k => roleOf(k) === 'dataset') as string[]
    const endpoint = o.objectKeys.find(k => objects.get(k) && typeKey(objects.get(k)!) === 'slack|Slash Command Request Endpoint')
    if (!results.length || !endpoint) continue
    const run = draft(runKeyOf([o.id]))
    run.obs.add(o.id)
    for (const r of results) run.outputs.add(r)
    run.extraChain.push(endpoint)
    const channel = str(o.attributes.request_channel) ?? str(o.attributes.request_channel_id)
    if (roleOf(channel) === 'dataset') run.inputs.add(channel!)
  }

  const scopeInputs = (job: string) => {
    const o = objects.get(job)
    if (!o || typeKey(o) !== 'gws|Project') return []
    const manifest = o.canonical.properties.manifest as { oauthScopes?: unknown } | undefined
    const scopes = Array.isArray(manifest?.oauthScopes) ? manifest.oauthScopes.filter((s): s is string => typeof s === 'string') : []
    return SCOPE_DATASETS.filter(d => scopes.some(s => d.scope.test(s))).map(d => virtualDataset(`gws://${env}`, d.name, tenantKey))
  }

  const events: LineageEvent[] = []
  const runChains: Array<{ chain: string[]; outputs: Set<string> }> = []
  /** 기록된 입력이 있는 Run 의 Job 이 권한 범위로 더 읽을 수 있는 데이터 */
  const scopeStatic = new Map<string, LineageDataset[]>()
  for (const run of runs.values()) {
    const up = upstream([...run.producers], run.obs)
    const chain = [...up.chain, ...run.extraChain.filter(k => !up.chain.includes(k))]
    const inputs = new Set([...run.inputs, ...up.inputs, ...run.derivedFrom])
    const levels: EvidenceLevel[] = [...run.levels]
    const reasons: string[] = [...run.reasons]
    const gaps: string[] = []
    let fields: FieldBasis = 'unknown'
    const columnLineage = new Map<string, ColumnLineageFacet>()
    const delivered: Array<{ src: string; msg: string; fields: string[] }> = []
    if (up.edges.some(inferredRef)) {
      levels.push('correlation')
      reasons.push('input_inferred')
    }
    const runObs = [...run.obs].map(id => observations.get(id)).filter((o): o is EvidenceObservation => !!o)
    if (!runObs.length) {
      // 관찰 없이 증거 링크로만 이은 이동은 확정으로 올리지 않는다
      levels.push('correlation')
      reasons.push('no_observation')
    }
    for (const o of runObs) {
      const a = o.attributes
      if (o.kind === 'delivery' && a.contains_source_data === false) {
        // 이 전달에 원본 데이터가 담겼는지 모른다. 입력을 잇지 않는다
        inputs.clear()
        gaps.push('source_not_confirmed')
        continue
      }
      const ol = observationLevel(o)
      levels.push(ol.level)
      if (ol.reason) reasons.push(ol.reason)
      const src = str(a.source_file)
      const msg = str(a.destination_message)
      const list = Array.isArray(a.delivered_fields) ? a.delivered_fields.filter((f): f is string => typeof f === 'string') : []
      if (o.kind === 'delivery' && src && msg && list.length) delivered.push({ src, msg, fields: list })
    }
    // 필드 계보는 모든 관찰을 본 뒤 남은 입력에만 붙인다 (다른 관찰이 입력을 지웠으면 붙이지 않는다)
    for (const d of delivered) {
      if (!inputs.has(d.src) || !run.outputs.has(d.msg)) continue
      const from = dataset(d.src)
      columnLineage.set(d.msg, {
        ...facet(OL_FACET.columnLineage),
        fields: Object.fromEntries(d.fields.map(f => [f, { inputFields: [{ namespace: from.namespace, name: from.name, field: f, transformations: [{ type: 'DIRECT', subtype: 'IDENTITY', masking: false }] }] }])),
      })
      fields = 'confirmed'
    }
    // 권한 범위로만 아는 입력 (예: 디렉터리 읽기 권한을 받은 웹앱). 기록된 입력이 있으면 Run 의 근거를 끌어내리지 않게 정적 계보로 따로 낸다
    const allScoped = gaps.includes('source_not_confirmed') ? [] : chain.flatMap(k => scopeInputs(k).map(d => ({ job: k, d })))
    const scoped = inputs.size ? [] : allScoped.map(x => x.d)
    if (inputs.size) for (const x of allScoped) scopeStatic.set(x.job, [...(scopeStatic.get(x.job) ?? []), x.d])
    if (scoped.length) {
      levels.push('structural')
      reasons.push('input_from_scope')
    }
    if (!inputs.size && !scoped.length) {
      if (!gaps.includes('source_not_confirmed')) gaps.push('source_unknown')
      levels.push('unverified')
    }
    runChains.push({ chain, outputs: run.outputs })

    const times = runObs.map(o => o.occurredAt).filter((t): t is string => !!t).sort()
    const actor = runObs.map(o => o.attributes).find(a => str(a.caller) || str(a.initiated_by_object) || str(a.requester_slack_user) || str(a.requester_object))
    const head = chain[0]
    const job: LineageJob = head
      ? {
          namespace: jobRef(head).namespace,
          name: jobRef(head).name,
          facets: { aegi_jobSteps: { ...facet(aegiFacetURL('AegiJobStepsFacet')), steps: chain.map(k => ({ key: k, type: jobRef(k).type, name: k.startsWith(OBS_PREFIX) ? jobRef(k).name : nameOf(k) })) } },
        }
      : { namespace: `aegi://${env}`, name: `derivation/${sorted(run.outputs).join('+')}` }
    const datasetInputs = [...sorted(inputs).map(dataset), ...scoped].filter((d, i, all) => all.findIndex(x => x.namespace === d.namespace && x.name === d.name) === i)
    events.push({
      eventType: 'COMPLETE',
      eventTime: times[times.length - 1] ?? fallbackTime,
      producer: LINEAGE_PRODUCER,
      schemaURL: `${OPENLINEAGE_SCHEMA}#/$defs/RunEvent`,
      run: {
        runId: stableUuid(`run|${run.key}`),
        facets: {
          aegi_evidence: evidenceFacet(weakest(levels), run.obs, reasons, fields, gaps),
          ...(actor
            ? { aegi_actor: { ...facet(aegiFacetURL('AegiActorFacet')), ...(str(actor.caller) ? { account: str(actor.caller) } : {}), ...(str(actor.initiated_by_object) ?? str(actor.requester_object) ?? str(actor.requester_slack_user) ? { initiatedBy: str(actor.initiated_by_object) ?? str(actor.requester_object) ?? str(actor.requester_slack_user) } : {}) } }
            : {}),
        },
      },
      job,
      inputs: datasetInputs,
      outputs: sorted(run.outputs).map(k => {
        const d = dataset(k)
        const cl = columnLineage.get(k)
        return cl ? { ...d, facets: { ...d.facets, columnLineage: cl } } : d
      }),
    } satisfies LineageRunEvent)
  }

  // ---------------------------------------------------------------- JobEvent: 설정으로만 흐를 수 있는 것
  /** Run 이 이미 이 Job 으로 그 안의 항목(채널 안 메시지)을 냈으면, 같은 곳으로 가는 정적 간선은 중복이다 */
  const shownByRun = (job: string, target: string) => runChains.some(r => r.chain.includes(job) && [...r.outputs].some(o => o === target || parentOf(o) === target))
  const staticJobs = new Map<string, { inputs: Set<string>; outputs: Set<string> }>()
  const staticOf = (job: string) => staticJobs.get(job) ?? staticJobs.set(job, { inputs: new Set(), outputs: new Set() }).get(job)!
  for (const e of flows) {
    if (e.observed) continue
    if (roleOf(e.from) === 'dataset' && roleOf(e.to) === 'job') staticOf(e.to).inputs.add(e.from)
    else if (roleOf(e.from) === 'job' && roleOf(e.to) === 'dataset' && !shownByRun(e.from, e.to)) staticOf(e.from).outputs.add(e.to)
  }
  for (const key of scopeStatic.keys()) staticOf(key)
  for (const [key, s] of staticJobs) {
    const scopedInputs = (scopeStatic.get(key) ?? []).filter((d, i, all) => all.findIndex(x => x.name === d.name) === i)
    if (!s.inputs.size && !s.outputs.size && !scopedInputs.length) continue
    const ref = jobRef(key)
    events.push({
      eventTime: fallbackTime,
      producer: LINEAGE_PRODUCER,
      schemaURL: `${OPENLINEAGE_SCHEMA}#/$defs/JobEvent`,
      job: { namespace: ref.namespace, name: ref.name, facets: { aegi_evidence: evidenceFacet('structural', [], [...(s.inputs.size || s.outputs.size ? ['flow_not_observed'] : []), ...(scopedInputs.length ? ['input_from_scope'] : [])], 'unknown', []) } },
      inputs: [...sorted(s.inputs).map(dataset), ...scopedInputs],
      outputs: sorted(s.outputs).map(dataset),
    } satisfies LineageJobEvent)
  }

  // ---------------------------------------------------------------- 폼 응답 → 연결된 시트 (Google Forms 설정)
  const formSheets = new Map<string, string>()
  for (const o of input.objects) {
    if (typeKey(o) !== 'gws|Form') continue
    const sheetId = str(o.canonical.properties.linkedSheetId)
    if (sheetId && roleOf(`GWS-FILE-${sheetId}`) === 'dataset') formSheets.set(o.fixture_key, `GWS-FILE-${sheetId}`)
  }
  for (const o of input.observations) {
    const form = str(o.attributes.source_form)
    const sheet = str(o.attributes.source_file)
    if (form && sheet && roleOf(form) === 'dataset' && roleOf(sheet) === 'dataset' && !formSheets.has(form)) formSheets.set(form, sheet)
  }
  for (const [form, sheet] of [...formSheets].sort()) {
    const from = dataset(form)
    const questions = objects.get(form)?.canonical.properties.question_titles
    const titles = Array.isArray(questions) ? questions.filter((q): q is string => typeof q === 'string') : []
    const to = dataset(sheet)
    // 응답 시트의 열은 질문 제목과 같다고 본다 (시트 머리줄을 수집하지 않아 추정)
    const columnLineage: ColumnLineageFacet | undefined = titles.length
      ? { ...facet(OL_FACET.columnLineage), fields: Object.fromEntries(titles.map(t => [t, { inputFields: [{ namespace: from.namespace, name: from.name, field: t, transformations: [{ type: 'DIRECT', subtype: 'IDENTITY', masking: false }] }] }])) }
      : undefined
    events.push({
      eventTime: fallbackTime,
      producer: LINEAGE_PRODUCER,
      schemaURL: `${OPENLINEAGE_SCHEMA}#/$defs/JobEvent`,
      job: { namespace: from.namespace, name: `FormResponses/${form}`, facets: { aegi_evidence: evidenceFacet('structural', [], ['form_link_setting'], titles.length ? 'inferred' : 'unknown', []) } },
      inputs: [from],
      outputs: [columnLineage ? { ...to, facets: { ...to.facets, columnLineage } } : to],
    } satisfies LineageJobEvent)
  }

  // ---------------------------------------------------------------- Gmail 자동 전달 → 전달 주소 (설정)
  for (const o of input.objects) {
    if (typeKey(o) !== 'gws|User') continue
    const fw = o.canonical.properties.gmail_forwarding as { enabled?: boolean; emailAddress?: string; verificationStatus?: string } | undefined
    if (!fw?.enabled || !fw.emailAddress) continue
    const domain = fw.emailAddress.split('@')[1]?.toLowerCase() ?? 'unknown'
    const snapshots = input.observations.filter(x => x.kind === 'access_snapshot' && x.objectKeys.includes(o.fixture_key) && x.attributes.enabled === true && x.attributes.emailAddress === fw.emailAddress).map(x => x.id)
    events.push({
      eventTime: fallbackTime,
      producer: LINEAGE_PRODUCER,
      schemaURL: `${OPENLINEAGE_SCHEMA}#/$defs/JobEvent`,
      job: {
        namespace: `gws://${env}`,
        name: `MailForwarding/${o.fixture_key}`,
        facets: { aegi_evidence: evidenceFacet('structural', snapshots, ['forwarding_setting', ...(fw.verificationStatus === 'accepted' ? [] : ['forwarding_not_accepted'])], 'unknown', []) },
      },
      inputs: [virtualDataset(`gws://${env}`, `Mailbox/${o.fixture_key}`, o.fixture_key)],
      // 주소 원문은 데이터셋에 이미 있으므로 계보에는 도메인과 주소 지문만 둔다
      outputs: [virtualDataset(`email://${domain}`, `address/${stableHex(fw.emailAddress.toLowerCase()).slice(0, 12)}`)],
    } satisfies LineageJobEvent)
  }

  events.sort((a, b) => a.eventTime.localeCompare(b.eventTime) || a.job.name.localeCompare(b.job.name) || (isRunEvent(a) ? a.run.runId : '').localeCompare(isRunEvent(b) ? b.run.runId : ''))

  const datasets = new Set<string>()
  const byLevel: Partial<Record<EvidenceLevel, number>> = {}
  for (const e of events) {
    for (const d of [...e.inputs, ...e.outputs]) datasets.add(`${d.namespace}|${d.name}`)
    const level = isRunEvent(e) ? e.run.facets.aegi_evidence.level : e.job.facets!.aegi_evidence!.level
    byLevel[level] = (byLevel[level] ?? 0) + 1
  }
  return {
    format: LINEAGE_FORMAT,
    spec: OPENLINEAGE_SCHEMA,
    created_at: input.createdAt,
    counts: { runs: events.filter(isRunEvent).length, jobs: events.filter(e => !isRunEvent(e)).length, datasets: datasets.size, byLevel },
    events,
  }
}

/** 데이터셋 파일 그대로 받아 엔진을 돌리고 계보를 만든다 */
export function lineageFromDataset(raw: {
  manifest: { environment_id?: string; created_at?: string | null }
  objects: FixtureObject[]
  relations: Parameters<typeof buildGraphStoreV2>[1]
  links: Parameters<typeof buildGraphStoreV2>[2]
  observations: EvidenceObservation[]
  evidence_links: FindingEvidenceLink[]
}): LineageFile {
  const graph = buildGraphStoreV2(raw.objects, raw.relations, raw.links)
  const evidence = buildEvidenceStore(raw.observations, raw.evidence_links)
  const { engine } = runAccessEngine({ graph, evidence })
  return buildLineage({
    objects: raw.objects,
    observations: raw.observations,
    evidenceLinks: raw.evidence_links,
    edges: engine.ix.edges.values(),
    environment: raw.manifest.environment_id ?? 'aegi',
    createdAt: raw.manifest.created_at ?? null,
  })
}
