/** 연결 대기에서 이전 서버와 현재 서버가 모두 기동 식별자를 줄 때만 재시작으로 본다. */
export function serverRestarted(initialServerBootId: string | undefined, currentServerBootId: string | undefined): boolean {
  return Boolean(initialServerBootId && currentServerBootId && initialServerBootId !== currentServerBootId)
}

/** 서버가 저장한 Okta scope가 응답에 없으면 비교 결과도 만들지 않는다. */
export function missingOktaScopes(requestedScopes: string[], storedScopes: string[] | null): string[] | null {
  if (storedScopes === null) return null
  const stored = new Set(storedScopes)
  return [...new Set(requestedScopes)].filter(scope => !stored.has(scope))
}

/** aegi-demo가 hints로 보내는 저장된 Okta scope 문자열을 목록으로 읽는다. */
export function storedOktaScopesFromHints(hints: Record<string, string> | undefined): string[] | null {
  const value = hints?.OKTA_SCOPES?.trim()
  return value ? value.split(/[\s,]+/) : null
}

export function hasOktaManualCredentials(configured: Record<string, boolean>): boolean {
  return Boolean(
    configured.OKTA_ORG_URL && (
      configured.OKTA_API_TOKEN ||
      (configured.OKTA_COLLECTOR_CLIENT_ID && configured.OKTA_COLLECTOR_KEY_ID && configured.OKTA_COLLECTOR_PRIVATE_KEY)
    )
  )
}
