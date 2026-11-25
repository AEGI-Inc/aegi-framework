/**
 * 공개 데모(demo.aegi.site) 판정.
 *
 * 기업 데모(VITE_AEGI_DEMO)와 따로 둔다. 공개 데모 빌드만 VITE_AEGI_PUBLIC_DEMO=on 을 주고,
 * 이 값이 켜졌을 때만 데모 선택 화면과 단계 안내를 그린다. 운영과 기업 데모 빌드에는 나오지 않는다.
 */

let publicDemoOverride: boolean | null = null

export function isPublicDemo(): boolean {
  if (publicDemoOverride !== null) return publicDemoOverride
  return typeof import.meta !== 'undefined' && import.meta.env?.VITE_AEGI_PUBLIC_DEMO === 'on'
}

export function setPublicDemoForTest(override: boolean | null): void {
  publicDemoOverride = override
}
