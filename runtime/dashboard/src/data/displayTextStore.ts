import { isDisplayTextDocument, type DisplayTextDocument, type ProviderText } from '../model/displayText'

/**
 * 화면 설명 문구(display_text 문서). aegi-adapter-engine 이 게시 때 만든다(display-text/ 정본 + AI 생성 캐시).
 * 배포본은 스냅샷 번들의 derived.display_text, 로컬 개발은 데이터셋 폴더의 display_text.json 이다.
 * 객체 상세처럼 데이터셋을 직접 받지 않는 화면도 읽도록 모듈 저장소에 둔다. 문서가 없으면 화면은 기계적 대체 문구를 쓴다.
 */
let current: DisplayTextDocument | undefined

/** 데이터셋을 읽을 때 부른다. 모양이 맞지 않으면 없는 것으로 본다 */
export function setDisplayText(raw: unknown): void {
  current = isDisplayTextDocument(raw) ? raw : undefined
}

export function displayText(): DisplayTextDocument | undefined {
  return current
}

/** `provider:object_type`(소문자)의 뜻 */
export function typeText(provider: string, objectType: string): string | undefined {
  return current?.types[`${provider}:${objectType.toLowerCase()}`]?.meaning
}

/** SaaS 의 역할과 특징. 역할이 없으면(이름만 있으면) undefined */
export function providerText(provider: string): (ProviderText & { role: string; points: string[] }) | undefined {
  const p = current?.providers[provider]
  return p?.role ? { ...p, role: p.role, points: p.points ?? [] } : undefined
}
