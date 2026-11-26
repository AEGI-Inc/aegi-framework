/**
 * dataset-v2 번들을 brotli 최고 압축(quality 11)으로 미리 줄여 둔 것. Workers 무료 플랜은 요청당 CPU 10ms 라 Worker 안에서
 * 최고 압축을 못 한다(11MB 번들에 수 초). 그래서 스냅샷을 게시한 뒤 scripts/precompressDataset.mjs 가 압축해 KV 에
 * `dataset-v2-br/<snapshot_id>` 로 올리고, Worker 는 지금 읽는 스냅샷의 압축본이 있으면 그대로 보낸다. 없으면 전처럼 문자열을 보낸다.
 * Cloudflare 가 응답을 압축할 때(466KB)보다 30% 작다(327KB, 2026-11-09 데모 스냅샷).
 */
export const BROTLI_KEY_PREFIX = 'dataset-v2-br/'

/**
 * 번들 형식 판. 번들 조립(snapshotBundle.ts)이 내는 모양을 바꾸면 하나 올린다.
 * edge 캐시 열쇠와 KV 압축본 metadata(`format`)에 들어가, 판이 다른 옛 캐시 · 압축본을 쓰지 않는다
 * (전에는 열쇠가 스냅샷 id 하나라 코드를 고쳐 배포해도 edge 는 7일, 압축본은 기한 없이 옛 모양이 나갔다. 2026-11-18).
 * metadata 에 판이 없는 압축본은 1판으로 본다. scripts/precompressDataset.mjs 의 BUNDLE_FORMAT 과 같아야 한다(시험이 본다)
 * 1: 판을 적기 전. 2: derived.access_table(대상마다 접근 표, aegi-dashboard-new#461, 2026-11-18).
 * 판을 올린 배포 뒤에는 precompress 를 다시 돌린다. 그 전까지는 새 스냅샷을 게시한 직후처럼 조립한 문자열이 나간다
 */
export const BUNDLE_FORMAT = 2

interface KvBinary {
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>
  getWithMetadata?(key: string, type: 'arrayBuffer'): Promise<{ value: ArrayBuffer | null; metadata: unknown }>
}

/** 압축본과 원본 번들 글자 수(KV metadata `chars`). 글자 수는 화면이 받기 진행률을 셀 때 쓴다(X-Dataset-Chars) */
export interface DatasetBrotli { bytes: ArrayBuffer; chars: number | null }

let memory: { snapshotId: string; entry: DatasetBrotli } | null = null

/** 시험용: isolate 메모리 캐시를 비운다 */
export function clearDatasetBrotliCache(): void {
  memory = null
}

/** 브라우저가 brotli 응답을 받는지 */
export function acceptsBrotli(request: Request): boolean {
  return /(?:^|[\s,])br(?:\s*(?:;|,|$))/i.test(request.headers.get('Accept-Encoding') ?? '')
}

/** 스냅샷의 압축본. 없거나 읽지 못하면 null */
export async function readDatasetBrotli(kv: unknown, snapshotId: string): Promise<DatasetBrotli | null> {
  if (memory?.snapshotId === snapshotId) return memory.entry
  try {
    const store = kv as KvBinary, key = BROTLI_KEY_PREFIX + snapshotId
    const got = store.getWithMetadata ? await store.getWithMetadata(key, 'arrayBuffer') : { value: await store.get(key, 'arrayBuffer'), metadata: null }
    const bytes = got.value
    if (!bytes || !bytes.byteLength) return null
    const meta = got.metadata as { chars?: unknown; format?: unknown } | null
    // 다른 번들 형식 판으로 만든 압축본은 쓰지 않는다(없으면 1판)
    if ((typeof meta?.format === 'number' ? meta.format : 1) !== BUNDLE_FORMAT) return null
    const chars = meta?.chars
    const entry = { bytes, chars: typeof chars === 'number' && chars > 0 ? chars : null }
    memory = { snapshotId, entry }
    return entry
  } catch {
    return null
  }
}
