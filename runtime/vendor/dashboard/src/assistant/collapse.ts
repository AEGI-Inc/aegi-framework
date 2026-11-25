/**
 * 코드 블록이나 SPL 쿼리가 5줄을 넘거나 400자를 넘으면 접힌 상태로 시작한다.
 */
export function shouldCollapseCode(text: string): boolean {
  if (!text) return false
  const normalized = text.replace(/\r?\n$/, '')
  const lines = normalized.split(/\r?\n/).length
  return lines > 5 || text.length > 400
}
