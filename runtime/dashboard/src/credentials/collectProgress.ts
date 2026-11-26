/** 수집기 출력에서 마지막 호출 줄(「✓ [okta] call-id — 제목: full, 3건 / 1쪽」, 계획 줄 「• [okta] …」). 앞 기호는 결과마다 다르다(✓ ◐ ✗ – •) */
export function lastCollectCall(lines: string[] | undefined): string | undefined {
  return [...(lines ?? [])].reverse().find(line => /^\s*\S?\s*\[[a-z0-9_-]+\]/.test(line))?.trim()
}
