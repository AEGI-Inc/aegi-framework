/**
 * D1 그래프 스냅샷에서 dataset-v2 번들을 재구성한다 (aegi-adapter-engine docs/spec/AEGI_D1_SNAPSHOT_STORE_V1.md).
 * 읽을 스냅샷 id(graph_head current, 고정 스냅샷이 있으면 그것. snapshotGraph.ts currentSnapshotId)로 snap_* 표와 snap_documents 에서 원본 번들을 조합한다.
 *
 * Workers 무료 플랜(요청당 CPU 10ms) 때문에 행마다 JSON 을 풀지 않는다. 저장된 JSON 문자열을 그대로 이어 붙인다.
 * `derived` 에는 적재 때 엔진이 계산한 판정 결과(위협, 자격증명 피해 범위, 화면 집계), 화면 설명 문구(display_text), 대상마다 접근 표(access_table)를 싣는다.
 * 위협마다 Access Gap 벤은 위협 detail 의 accessGap 에 있다. 옛 다리 단위 snap_access_gaps 는 읽지 않는다.
 * 화면은 이것을 읽고 브라우저에서 다시 판정하지 않는다.
 *
 * 스냅샷은 한번 적재되면 바뀌지 않으므로, 조합한 JSON 문자열을 snapshot_id 단위로 캐시한다.
 * 같은 isolate 안에서는 메모리에서, 다른 isolate는 같은 데이터센터의 Cache API에서 꺼낸다.
 * 캐시가 있으면 요청마다 D1은 스냅샷 id 한 번만 읽는다. published_at 은 그 문자열을 조합한 시각이다.
 */
import { BUNDLE_FORMAT } from './datasetBrotli'
import type { D1Like } from './exceptions'
import { currentSnapshotId } from './snapshotGraph'

export const REQUIRED_FILES = ['manifest', 'objects', 'relations', 'links', 'observations', 'evidence_links'] as const
/** 옛 스냅샷의 _files 에 남은 finding_rules, expected_findings, scenario_bindings 는 읽지 않는다(합성 데이터셋 전용이던 파일) */
export const OPTIONAL_FILES = ['effective_access', 'coverage', 'lineage_events', 'standard_results'] as const

const TABLE_FOR_FILE: Record<string, string> = {
  objects: 'snap_objects',
  relations: 'snap_relations',
  links: 'snap_links',
  observations: 'snap_observations',
  evidence_links: 'snap_evidence_links',
}

/** 스냅샷의 판정 결과 표. 번들의 derived 아래 같은 이름으로 싣는다 */
const DERIVED_TABLES = { findings: 'snap_findings', blast_radius: 'snap_blast_radius' } as const

/** Cache API 키. 밖으로 나가지 않는 내부 주소다 */
// 번들 형식 판(datasetBrotli.ts BUNDLE_FORMAT)을 열쇠에 넣어, 조립 코드를 바꿔 배포하면 옛 edge 캐시를 쓰지 않는다
const CACHE_URL = `https://aegi-internal.invalid/dataset-v2/f${BUNDLE_FORMAT}/`

let memory: { snapshotId: string; text: string } | null = null

/** 시험용: isolate 메모리 캐시를 비운다 */
export function clearSnapshotBundleCache(): void {
  memory = null
}

function edgeCache(): Cache | null {
  return typeof caches !== 'undefined' && 'default' in caches ? (caches as unknown as { default: Cache }).default : null
}

async function readEdge(snapshotId: string): Promise<string | null> {
  try {
    const hit = await edgeCache()?.match(CACHE_URL + encodeURIComponent(snapshotId))
    return hit ? await hit.text() : null
  } catch {
    return null
  }
}

async function writeEdge(snapshotId: string, text: string): Promise<void> {
  try {
    await edgeCache()?.put(CACHE_URL + encodeURIComponent(snapshotId), new Response(text, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'max-age=604800' } }))
  } catch {
    // 캐시 저장 실패는 응답에 영향을 주지 않는다
  }
}

async function details(db: D1Like, table: string, snapshotId: string): Promise<string> {
  const rows = await db.prepare(`SELECT detail FROM ${table} WHERE snapshot_id = ? ORDER BY ord`).bind(snapshotId).all<{ detail: string }>()
  return `[${rows.results.map(r => r.detail).join(',')}]`
}

/** 판정 결과 표를 읽지 못하면(표가 없는 옛 DB) null. 그러면 번들에 derived 를 싣지 않고 화면은 위협 없이 보인다 */
async function derivedText(db: D1Like, snapshotId: string, displayText?: string, accessTable?: string): Promise<string | null> {
  try {
    const tables = Object.entries(DERIVED_TABLES)
    const [values, aggregates] = await Promise.all([
      Promise.all(tables.map(([, table]) => details(db, table, snapshotId))),
      db.prepare('SELECT id, detail FROM snap_aggregates WHERE snapshot_id = ? ORDER BY ord').bind(snapshotId).all<{ id: string; detail: string }>(),
    ])
    const derived = [`"snapshot_id":${JSON.stringify(snapshotId)}`, ...tables.map(([name], i) => `${JSON.stringify(name)}:${values[i]}`)]
    derived.push(`"aggregates":{${aggregates.results.map(a => `${JSON.stringify(a.id)}:${a.detail}`).join(',')}}`)
    // 화면 설명 문구. 엔진이 snap_documents 의 display_text 로 싣는다(데이터셋 파일이 아니라 _files 에는 없다)
    if (displayText) derived.push(`"display_text":${displayText}`)
    // 대상마다 접근 표. Explorer 분석 칸과 AI access 도구가 읽는다(엔진 snap_documents 의 access_table, 1MB 넘으면 조각)
    if (accessTable) derived.push(`"access_table":${accessTable}`)
    return `{${derived.join(',')}}`
  } catch (err) {
    console.warn('bundleTextFromD1Snapshot derived:', err)
    return null
  }
}

async function resolveDoc(docs: Map<string, string>, name: string): Promise<string | undefined> {
  const detail = docs.get(name)
  if (detail === undefined) return undefined
  if (!detail.startsWith('{"$parts":')) return detail
  const marker = JSON.parse(detail) as { $parts: number; sha256: string }
  const chunks: string[] = []
  for (let seq = 0; seq < marker.$parts; seq++) {
    const part = docs.get(`${name}#${seq}`)
    if (part === undefined) {
      throw new Error(`스냅샷 문서 조각 누락: ${name}#${seq}`)
    }
    chunks.push(part)
  }
  const full = chunks.join('')
  const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(full))
  const hashHex = Array.from(new Uint8Array(hashBuf), n => n.toString(16).padStart(2, '0')).join('')
  if (hashHex !== marker.sha256) {
    throw new Error(`스냅샷 문서 지문 불일치: ${name}`)
  }
  return full
}

async function buildBundleText(db: D1Like, snapshotId: string, publishedAt: string): Promise<string> {
  const docs = new Map((await db.prepare('SELECT id, detail FROM snap_documents WHERE snapshot_id = ? ORDER BY ord').bind(snapshotId).all<{ id: string; detail: string }>()).results.map(r => [r.id, r.detail]))
  const filesText = await resolveDoc(docs, '_files')
  const present = new Set<string>(JSON.parse(filesText ?? '[]') as string[])

  // snap_* 표는 서로 기대지 않으므로 한꺼번에 묻는다. 키 순서는 파일 목록 순서를 지킨다
  const names = [...REQUIRED_FILES, ...OPTIONAL_FILES].filter(name => present.has(name))
  const [values, derived] = await Promise.all([
    Promise.all(names.map(async name => {
      const table = TABLE_FOR_FILE[name]
      if (table) return details(db, table, snapshotId)
      let docText = await resolveDoc(docs, name)
      if (name === 'effective_access' && docText) {
        const needle = '"rows":{"$rows_table":"snap_effective_access"}'
        if (docText.includes(needle)) {
          const eaRows = await details(db, 'snap_effective_access', snapshotId)
          // 함수로 바꿔 넣어야 행 값의 $& 같은 글자를 치환 패턴으로 읽지 않는다
          docText = docText.replace(needle, () => `"rows":${eaRows}`)
        }
      }
      return docText
    })),
    Promise.all([resolveDoc(docs, 'display_text'), resolveDoc(docs, 'access_table')]).then(([dt, at]) => derivedText(db, snapshotId, dt, at)),
  ])

  const parts = ['"format":"aegi-measured-bundle/v1"', '"variant":"v2"', `"published_at":${JSON.stringify(publishedAt)}`]
  names.forEach((name, i) => { if (values[i] !== undefined) parts.push(`${JSON.stringify(name)}:${values[i]}`) })
  if (derived) parts.push(`"derived":${derived}`)
  return `{${parts.join(',')}}`
}

/** 화면에 보낼 번들 문자열. 스냅샷이 없으면 null */
export async function bundleTextFromD1Snapshot(db: D1Like, publishedAt = new Date().toISOString()): Promise<string | null> {
  try {
    const snapshotId = await currentSnapshotId(db)
    return snapshotId ? await bundleTextForSnapshot(db, snapshotId, publishedAt) : null
  } catch (err) {
    // 스냅샷 표가 아직 없는 DB (adapter-engine publish 전)
    console.warn('bundleTextFromD1Snapshot:', err)
    return null
  }
}

/** 스냅샷 id 를 이미 읽은 경우의 번들 문자열. 표를 읽지 못하면 null */
export async function bundleTextForSnapshot(db: D1Like, snapshotId: string, publishedAt = new Date().toISOString()): Promise<string | null> {
  try {
    if (memory?.snapshotId === snapshotId) return memory.text
    const cached = await readEdge(snapshotId)
    if (cached) {
      memory = { snapshotId, text: cached }
      return cached
    }

    const text = await buildBundleText(db, snapshotId, publishedAt)
    memory = { snapshotId, text }
    await writeEdge(snapshotId, text)
    return text
  } catch (err) {
    // 스냅샷 표가 아직 없는 DB (adapter-engine publish 전)
    console.warn('bundleTextFromD1Snapshot:', err)
    return null
  }
}

/** 시험과 호환용. 화면 응답은 bundleTextFromD1Snapshot 의 문자열을 그대로 보낸다 */
export async function bundleFromD1Snapshot(db: D1Like, publishedAt = new Date().toISOString()): Promise<Record<string, unknown> | null> {
  const text = await bundleTextFromD1Snapshot(db, publishedAt)
  return text ? JSON.parse(text) as Record<string, unknown> : null
}
