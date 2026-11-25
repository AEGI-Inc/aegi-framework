import type { RawDataset } from './datasetStore'
import { hasLocalServer } from '../demoMode'

export type LoginOutcome = { ok: true } | { ok: false; message: string }
export type BootstrapResult = 'ready' | 'password'
const REQUIRED = ['manifest', 'objects', 'relations', 'links', 'observations', 'evidence_links'] as const
const UNAVAILABLE = '최신 실측 데이터가 아직 올라가 있지 않습니다.'
const CONNECTION = '실측 데이터를 받지 못했습니다. 잠시 뒤 다시 시도해 주세요.'

/** 최신 실측만 등록한다. 로그인이나 로딩 실패 시 다른 데이터로 대체하지 않는다. */
export function createDatasetSession(local: RawDataset | null, register: (data: RawDataset) => void, request: typeof fetch) {
  let problem: string | undefined
  async function receive(): Promise<boolean> {
    try {
      const res = await request('/api/measured/dataset-v2', { credentials: 'same-origin', cache: 'no-store' })
      if (res.status === 401) { problem = undefined; return false }
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) { problem = UNAVAILABLE; return false }
      const data = await res.json() as Record<string, unknown>
      if (data.variant !== 'v2' || REQUIRED.some(key => data[key] === undefined) || !Array.isArray(data.objects) || (!data.objects.length && !hasLocalServer())) { problem = UNAVAILABLE; return false }
      register(data as unknown as RawDataset)
      problem = undefined
      return true
    } catch { problem = CONNECTION; return false }
  }
  return {
    get problem() { return problem },
    async bootstrap(): Promise<BootstrapResult> {
      if (local) { register(local); return 'ready' }
      return await receive() ? 'ready' : 'password'
    },
    async login(password: string): Promise<LoginOutcome> {
      let res: Response
      try {
        res = await request('/api/measured/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      } catch { return { ok: false, message: '서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' } }
      if (res.status === 401) return { ok: false, message: '비밀번호가 맞지 않습니다.' }
      if (res.status === 503 || !(res.headers.get('content-type') ?? '').includes('application/json')) return { ok: false, message: '실측 데이터 서버 설정이 아직 끝나지 않았습니다.' }
      if (!res.ok) return { ok: false, message: `로그인하지 못했습니다 (${res.status}).` }
      return await receive() ? { ok: true } : { ok: false, message: problem ?? CONNECTION }
    },
  }
}
