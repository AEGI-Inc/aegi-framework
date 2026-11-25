/** Splunk 연결 정보. 값은 Vault(pull-env)로 받은 환경변수에서만 읽는다 */
import { APPROVED, type SplunkConnection } from './types'

export function connectionFromEnv(env: NodeJS.ProcessEnv = process.env): SplunkConnection {
  const searchBase = env.SPLUNK_URL
  const token = env.SPLUNK_TOKEN
  if (!searchBase || !token) throw new Error('SPLUNK_URL, SPLUNK_TOKEN 이 없다 (npm run secret -- pull-env 로 받는다)')
  // Okta 이벤트 origin_key 는 okta:<tenant>:<uuid> 다. 기본값('okta')으로 받으면 같은 이벤트가 다른 키로 쌓인다 (2026-10-21 사고)
  if (!env.SPLUNK_OKTA_TENANT) throw new Error('SPLUNK_OKTA_TENANT 가 없다 (Okta 조직 이름, 예: trial-0000003). 이벤트 키에 들어가므로 기본값을 쓰지 않는다')
  const url = new URL(searchBase)
  if (url.protocol !== 'https:') throw new Error('SPLUNK_URL 은 https 여야 한다')
  return {
    searchBase: url.origin,
    token,
    hecBase: env.SPLUNK_HEC_URL ?? `https://${url.hostname}:8088`,
    hecToken: env.SPLUNK_HEC_TOKEN,
    tlsSha256: env.SPLUNK_TLS_SHA256,
    approved: APPROVED,
    tenants: { aegi_okta: env.SPLUNK_OKTA_TENANT, aegi_gws: env.SPLUNK_GWS_TENANT ?? 'gws' },
  }
}
