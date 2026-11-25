/**
 * Okta 시스템 로그(OK-12) 한 번 읽기.
 *
 * 동일인 연결(identity.ts)과 관측(observations.ts)이 쓰는 행을 raw.pages('okta', 'OK-12') 를 한 번만 돌며 모은다.
 * 원본 내용은 읽을 때마다 파일에서 다시 불러오므로(runner/input.mjs), 쓰는 곳마다 따로 돌면 로그 전체를 그만큼 다시 읽는다.
 * 여기서는 데이터셋 없이 원본만으로 정할 수 있는 조건으로 먼저 거르고, 쓰는 쪽이 자기 조건으로 다시 거른다.
 */
import type { Envelope } from '../lib/store'
import type { RawSet } from './raw'
import { itemsOf } from './raw'
import { observedActivityTypes } from './activities'

export const TOKEN_EVENTS = /^app\.oauth2\.(token\.grant\.(refresh_token|access_token)|token\.revoke)/

export interface OktaLogScan {
  /** 그룹 연결용(identity.ts buildGroupLinks). target 에 id 있는 AppGroup 과 AppInstance 가 함께 있는 행. uuid 로 한 번씩(처음 나온 행), 원본 순서 */
  appGroupRows: any[]
  /** 봇 요청 맞추기용(observations.ts). target id 가 봇 요청(SL-12)의 대상 id 인 행. uuid 로 한 번씩(처음 나온 행), 원본 순서 */
  slashTargetRows: any[]
  /** 감사 사건 관측용. 사건 사전(activity_types.yaml)의 observation: audit_event 종류. 중복 제거 없음, 원본 순서 */
  auditEvents: Array<{ env: Envelope; event: any }>
  /** 토큰 발급, 사용, 폐기 관측용(TOKEN_EVENTS). 중복 제거 없음, 원본 순서 */
  tokenEvents: Array<{ env: Envelope; event: any }>
}

// 결과는 RawSet 객체에 붙여 둔다. 정규화는 identity.ts 와 observations.ts 를 tsImport 로 따로 불러 이 모듈도 둘로 실린다.
// 모듈 안 변수(WeakMap)에 두면 둘이 서로의 결과를 못 봐 로그를 두 번 읽는다. Symbol.for 는 모듈이 여러 번 실려도 같은 키다
const SCAN = Symbol.for('aegi.oktaLogScan')

/** 모아 둔 행을 놓는다. 마지막으로 쓰는 쪽(buildObservations)이 부른다. 안 놓으면 RawSet 이 사는 동안 행이 메모리에 남는다 */
export function releaseOktaLogScan(raw: RawSet): void {
  delete (raw as any)[SCAN]
}

export function scanOktaLog(raw: RawSet): OktaLogScan {
  const cached = (raw as any)[SCAN] as OktaLogScan | undefined
  if (cached) return cached

  // 봇 요청 대상 id 집합 (SL-12)
  const botTargetIds = new Set<string>()
  for (const env of raw.pages('worker', 'SL-12')) {
    for (const row of itemsOf(env, 'results')) {
      const tid = row.result_data?.target_id ?? row.result_data?.okta_target_id
      if (tid !== undefined && tid !== null && tid !== '') {
        botTargetIds.add(String(tid))
      }
    }
  }

  const AUDIT = observedActivityTypes('OK-12', 'audit_event')
  const appGroupRows: any[] = []
  const slashTargetRows: any[] = []
  const auditEvents: Array<{ env: Envelope; event: any }> = []
  const tokenEvents: Array<{ env: Envelope; event: any }> = []
  // 조건과 상관없이 본 uuid 를 모두 적는다. 처음 나온 행이 조건에 안 맞으면 뒤의 같은 uuid 행도 넣지 않는다(streamRows 와 같은 규칙)
  const seenUuids = new Set<string>()

  for (const env of raw.pages('okta', 'OK-12')) {
    for (const row of itemsOf(env)) {
      if (row?.eventType) {
        if (AUDIT.has(row.eventType)) {
          auditEvents.push({ env, event: row })
        }
        if (TOKEN_EVENTS.test(row.eventType)) {
          tokenEvents.push({ env, event: row })
        }
      }

      if (row?.uuid !== undefined) {
        const uuidKey = String(row.uuid)
        if (!seenUuids.has(uuidKey)) {
          seenUuids.add(uuidKey)

          const targets: any[] = Array.isArray(row?.target) ? row.target : []
          if (targets.some((t: any) => t?.type === 'AppGroup' && t?.id) && targets.some((t: any) => t?.type === 'AppInstance')) {
            appGroupRows.push(row)
          }

          if (botTargetIds.size > 0 && targets.some((t: any) => t?.id !== undefined && botTargetIds.has(String(t.id)))) {
            slashTargetRows.push(row)
          }
        }
      }
    }
  }

  const scan: OktaLogScan = { appGroupRows, slashTargetRows, auditEvents, tokenEvents }
  Object.defineProperty(raw, SCAN, { value: scan, configurable: true, enumerable: false })
  return scan
}
