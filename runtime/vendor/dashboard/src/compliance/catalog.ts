import snapshot from './catalog.snapshot.json'
export type Standard = 'ISMS-P' | 'PIPA'
export interface Question {
  id: string; positionId: string; location: string; sourceText: string; question: string; scope: string; outside: string
  subject: string; applicability: string; inputs: string[]; output: string; mode: string; featureIds: string[]; sourceNodeId: string
}
export interface OfficialItem {
  id: string; standard: Standard; number: string; title: string; group: string; document: string; edition: string
  text: string; sourceUrl: string; notes: string[]; issuedDate:string; effectiveDate:string; questions: Question[]; exclusions: { location: string; text: string; reason: string }[]
}
export const catalog = snapshot.items as OfficialItem[]
export const catalogRevision = snapshot.revision
export const catalogDate = snapshot.scopeAsOf
// Display research requirements only. This is not an execution plan or capability claim.
export function researchAreas(questions: Question[]): string[] {
  const features = new Set(questions.flatMap(q => q.featureIds))
  const areas: [string[], string][] = [
    [['F07','F08','F09','F10'], '권한 분석'], [['F11','F12','F13'], '설정과 정책 분석'],
    [['F06'], '데이터 분류 근거'], [['F14','F15'], '공유와 연결, 분리 분석'],
  ]
  return areas.filter(([ids]) => ids.some(id => features.has(id))).map(([, label]) => label)
}
