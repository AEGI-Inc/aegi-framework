// 대시보드 Threat 「승인」 보기의 승인 목록을 D1 에서 읽는다. 게시(publish.ts)와 정합성 검증(verifyParity.ts)이 같은 입력을 쓰게 한 곳에 둔다
import type { SqlExecutor } from './sql.ts'
import type { ApprovalRow } from '../../src/detection/threat/approvals.ts'

/**
 * 취소 안 한 행만 읽는다. 표가 아직 없으면(마이그레이션 0010 전) 빈 목록.
 * 대시보드 데이터셋 이름은 AEGI_APPROVALS_DATASET(기본 measured-v2). D1 은 환경마다 따로라 환경 안에서는 이 이름 하나다
 */
export async function readApprovals(exec: SqlExecutor): Promise<ApprovalRow[]> {
  const dataset = process.env.AEGI_APPROVALS_DATASET ?? 'measured-v2'
  try {
    const rows = await exec.query<ApprovalRow>('SELECT list, kind, target, source FROM destination_approvals WHERE dataset = ? AND revoked_at IS NULL', [dataset])
    console.log(`승인 목록: ${dataset} ${rows.length}행`)
    return rows
  } catch (e) {
    if (/no such table/i.test(String(e))) return []
    throw e
  }
}
