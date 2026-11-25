import type { ThreatHeadcountV2 } from '../model/findingV2'

/** 화면 인원 글자(2026-11-20 결정). 누구나는 숫자에 넣지 않고 「8명과 누구나」처럼 붙인다. 값은 엔진 headcount 그대로 */
export function headcountText(h: ThreatHeadcountV2): string {
  return h.everyone ? (h.people ? `${h.people}명과 누구나` : '누구나') : `${h.people}명`
}

/** 인원 글자 뒤 주격 조사. 「8명이」, 「8명과 누구나가」 */
export const subjectParticle = (text: string): string => (text.endsWith('누구나') ? '가' : '이')
