import type { Standard } from './catalog'
export interface ComplianceDraft {
  schemaVersion: 1; standard: Standard; catalogRevision: string; questionIds: string[]; targetKeys: string[]
  company: string; tenantKey: string; asOf: string; snapshotId: string; companyInputs: Record<string, string>
}
/** Replace only after the analysis service contract is agreed. No simulated result fallback. */
export interface ComplianceClient {
  connection: 'not_connected' | 'connected'
  listRuns(): Promise<{ state: 'not_connected'; message: string } | { state: 'available'; runs: { id: string; standard: Standard; createdAt: string }[] }>
}
export const complianceClient: ComplianceClient = {
  connection: 'not_connected',
  async listRuns() { return { state: 'not_connected', message: '검사 서버 연결 전입니다. 저장한 초안은 실행 기록이 아닙니다.' } },
}
