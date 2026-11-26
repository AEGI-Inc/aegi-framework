/**
 * 존재 확인(probe) — 수집하지 않는 위험 종류(연동, 엔드포인트, 자동화, 자격증명, 정책)가 이 테넌트에 있는지 목록 API 를 한 번씩 불러 본다.
 *
 * 내용을 해석하지 않고 「몇 개 있다」 또는 「무슨 권한이 없어 못 본다」만 남긴다. 받은 페이지는 원본으로 저장되어
 * 정규화가 그 종류의 객체를 만들 수 있다(범용 객체). 실패해도 호출 전체를 멈추지 않는다.
 * 결과는 호출 기록 reasons 에 `probe:<규격 종류>:<결과>` 로 남는다. 보고서(collect:coverage)가 읽는다.
 */
import type { CallApi } from '../lib/runner'

export interface ProbeTarget {
  /** 규격 종류 이름 (src/objectCatalog.ts 의 name) */
  catalogName: string
  /** 필요한 권한 (Okta scope, GitHub App 권한, Slack scope, Google OAuth 범위). 보고서에 그대로 적는다 */
  needs: string
  fetch: (api: CallApi) => Promise<unknown[] | null>
}

export async function runProbes(api: CallApi, targets: ProbeTarget[]): Promise<void> {
  for (const t of targets) {
    try {
      const items = await t.fetch(api)
      api.partial(`probe:${t.catalogName}:${items === null ? 'not_found' : `count=${items.length}`}`)
    } catch (err) {
      const e = err as { code?: string; kind?: string; message?: string }
      const msg = String(e.message ?? err)
      const code = e.code ?? (/invalid_scope|not granted|unauthorized_client|access_denied|consent/i.test(msg) ? 'scope_not_granted' : 'error')
      api.partial(`probe:${t.catalogName}:${code}`)
      api.partial(`probe-needs:${t.catalogName}=${t.needs}`)
      api.note(`존재 확인 ${t.catalogName}: ${code} (필요: ${t.needs})`)
    }
  }
}

/** 호출 기록의 reasons 에서 존재 확인 결과를 읽는다 */
export interface ProbeResult {
  catalogName: string
  /** found(목록을 받음, count 개), not_found(기능 없음), 그 밖은 못 본 사유 (scope_not_granted, http_403 …) */
  result: string
  count?: number
  needs?: string
}

export function readProbeReasons(reasons: string[]): ProbeResult[] {
  const needs = new Map(reasons.filter(r => r.startsWith('probe-needs:')).map(r => {
    const body = r.slice('probe-needs:'.length)
    const i = body.indexOf('=')
    return [body.slice(0, i), body.slice(i + 1)] as const
  }))
  return reasons
    .filter(r => r.startsWith('probe:'))
    .map(r => {
      const body = r.slice('probe:'.length)
      const i = body.lastIndexOf(':')
      const name = body.slice(0, i)
      const result = body.slice(i + 1)
      const m = /^count=(\d+)$/.exec(result)
      return { catalogName: name, result: m ? 'found' : result, count: m ? Number(m[1]) : undefined, needs: needs.get(name) }
    })
}
