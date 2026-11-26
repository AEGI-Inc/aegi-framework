/**
 * 데모 모드 판정.
 *
 * 운영(Cloudflare Pages)과 로컬 데모 서버(aegi-demo)가 같은 대시보드 코드를 쓴다.
 * 데모 빌드는 VITE_AEGI_DEMO=on 환경 변수를 준다.
 * 단위 시험에서 모드를 바꿔 검증할 수 있게 override 함수를 제공한다.
 */

import { isPublicDemo } from './publicDemo'

let demoOverride: boolean | null = null

export function isDemoMode(): boolean {
  if (demoOverride !== null) return demoOverride
  return typeof import.meta !== 'undefined' && import.meta.env?.VITE_AEGI_DEMO === 'on'
}

/**
 * Access Gaps 화면을 숨기는지. 운영과 기업 데모는 숨기고(위협마다 벤은 Threat 상세의 Access Gap 칸으로 본다),
 * 공개 데모(demo.aegi.site)는 UC1 의 「차집합 보기」가 이 화면을 열어 둔다.
 */
export function hidesAccessGaps(): boolean {
  return !isPublicDemo()
}

/** 공개 데모(demo.aegi.site)는 Adapters(SaaS 연결 설정) 화면을 메뉴와 주소 모두에서 숨긴다. 기업 데모는 연결에 쓰므로 둔다. */
export function hidesAdapters(): boolean {
  return isDemoMode() && isPublicDemo()
}

/**
 * 로컬 설치판(aegi-solution) 빌드인지. VITE_AEGI_LOCAL=on 을 준다.
 * 운영과 같은 화면(메뉴, ISO 27001 포함)을 그리고, 로컬 서버가 있어야 하는 기능만 켠다.
 */
export function isLocalInstall(): boolean {
  return typeof import.meta !== 'undefined' && import.meta.env?.VITE_AEGI_LOCAL === 'on'
}

/** 로컬 서버(aegi-solution)가 화면 뒤에 있는지: Splunk·AI 설정 카드, 위협 다시 확인, 빈 데이터셋, 샘플 올리기 */
export function hasLocalServer(): boolean {
  return isDemoMode() || isLocalInstall()
}

export function setDemoModeForTest(override: boolean | null): void {
  demoOverride = override
}
