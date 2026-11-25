/**
 * 손으로 만든 원본(testFixture)을 운영 정규화(IM Profile 실행기, normalizeProfiles --check)로 돌린 데이터셋.
 * 키와 객체 종류는 옛 이름(legacy_keys, runtime-config.json aliases)으로 돌려준다. 옛 정규화기 시험의 기대값을 그대로 쓰기 위해서다.
 * 절차는 scripts/groundtruth/connections.test.ts 의 normalizeOnce 와 같다.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Envelope } from '../lib/store'
import { fixturePages, run, T0 } from './testFixture'
import type { FixtureObject } from '../../../src/model/object'
import type { FixtureRelation } from '../../../src/model/relation'
import type { IdentityLink } from '../../../src/model/link'
import type { EvidenceObservation, FindingEvidenceLink } from '../../../src/model/evidence'

export interface ImTestDataset {
  objects: FixtureObject[]
  relations: FixtureRelation[]
  links: IdentityLink[]
  observations: EvidenceObservation[]
  evidenceLinks: FindingEvidenceLink[]
  notes: string[]
}

/** 뺄 원본 페이지: provider, call_id 가 같고 endpoint 에 이 글이 들어 있는 페이지 */
export interface DropPage { provider: string; call_id: string; endpoint_includes: string }

interface NormalizeImOptions {
  /** 더할 원본 페이지 */
  extra?: Envelope[]
  /** `provider|call_id` 가 같은 원본 페이지를 바꿔 끼움 */
  replace?: Record<string, Envelope>
  drop?: DropPage[]
}

const runtimeConfig = JSON.parse(fs.readFileSync(new URL('../profile-binding/runtime-config.json', import.meta.url), 'utf8'))

/** 같은 원본은 한 번만 정규화한다 (한 번에 십여 초 걸린다). 시험은 결과를 읽기만 한다 */
const cache = new Map<string, Promise<ImTestDataset>>()

export function normalizeIm(opts: NormalizeImOptions = {}): Promise<ImTestDataset> {
  const key = JSON.stringify([opts.extra ?? [], opts.replace ?? {}, opts.drop ?? []])
  if (!cache.has(key)) cache.set(key, normalizeOnce(opts))
  return cache.get(key)!
}

async function normalizeOnce({ extra = [], replace = {}, drop = [] }: NormalizeImOptions): Promise<ImTestDataset> {
  const { parseOptions } = await import('../profile-binding/runner/options.mjs' as string)
  const { normalizeProfiles } = await import('../profile-binding/runner/normalize.mjs' as string)
  const dropped = (p: Envelope) => drop.some(d => p.provider === d.provider && p.call_id === d.call_id && p.endpoint.includes(d.endpoint_includes))
  const pages = fixturePages().filter(p => !dropped(p)).map(p => replace[`${p.provider}|${p.call_id}`] ?? p)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegi-relation-'))
  try {
    const runId = '20261021T000000Z-0001'
    const cohort = run(runId, [...pages, ...extra])
    const write = (file: string, value: unknown) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)) }
    write(path.join(tmp, 'raw/runs', `${runId}.json`), { ...cohort.record, finished_at: T0 })
    cohort.pages.forEach((page, i) => write(path.join(tmp, 'raw/raw', runId, page.provider, `page-${i}.json`), page))
    // IM 모델은 최소 합성본을 쓴다 (connections.test.ts, pipeline.test.mjs 와 같다)
    const model = path.join(tmp, 'model')
    for (const [file, value] of Object.entries({ 'FREEZE.json': JSON.stringify({ version: 'test-v3.2' }), 'objects/object-types.jsonl': '', 'relations/vocabulary.json': JSON.stringify({ relation_types: [] }), 'relations/relation-bindings.jsonl': '', 'evidence/observation-operation-links.jsonl': '' })) {
      fs.mkdirSync(path.dirname(path.join(model, file)), { recursive: true })
      fs.writeFileSync(path.join(model, file), value)
    }
    const { files, report } = await normalizeProfiles(parseOptions(['--raw', path.join(tmp, 'raw'), '--run', runId, '--out', path.join(tmp, 'dataset'), '--model', model, '--check']))
    const legacy = new Map<string, string>((files.objects as FixtureObject[]).map(o => [o.fixture_key, (o.fixture_meta as any)?.im_profile?.legacy_keys?.[0] ?? o.fixture_key]))
    const toLegacy = <T>(v: T): T => JSON.parse(JSON.stringify(v), (_k, x) => (typeof x === 'string' && legacy.has(x) ? legacy.get(x) : x))
    const legacyType = new Map(Object.entries(runtimeConfig.aliases as Record<string, string>).map(([k, v]) => [`${k.slice(0, k.indexOf(':'))}:${v}`, k.slice(k.indexOf(':') + 1)]))
    const objects = (toLegacy(files.objects) as FixtureObject[]).map(o => {
      o.canonical.object_type = legacyType.get(`${o.canonical.provider}:${o.canonical.object_type}`) ?? o.canonical.object_type
      return o
    }).sort((a, b) => a.fixture_key.localeCompare(b.fixture_key))
    return {
      objects,
      relations: toLegacy(files.relations) as FixtureRelation[],
      links: toLegacy(files.links) as IdentityLink[],
      observations: toLegacy(files.observations ?? []) as EvidenceObservation[],
      evidenceLinks: toLegacy(files.evidence_links ?? []) as FindingEvidenceLink[],
      notes: toLegacy(report.enrich_notes ?? []) as string[],
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
