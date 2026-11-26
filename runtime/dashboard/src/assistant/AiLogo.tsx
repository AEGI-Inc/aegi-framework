import { useId } from 'react'

/** 호버와 AI 창 열기에 눈 표정과 깜빡임으로 반응하는 모노크롬 베이비 코파일럿. */
export default function AiLogo({ size = 32 }: { size?: number }) {
  const visorMaskId = useId()
  return (
    <span className="assistant-ai-logo" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="5 1 38 42" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        <defs>
          <mask id={visorMaskId} maskUnits="userSpaceOnUse" x="14" y="23.5" width="20" height="9.5" style={{ maskType: 'luminance' }}>
            <rect x="14" y="23.5" width="20" height="9.5" fill="white" stroke="none" />
            {/* 눈은 바이저에 뚫린 구멍이라 어떤 배경에서도 투명하게 보인다. */}
            <g fill="black" stroke="none">
              <ellipse className="assistant-ai-eye" cx="19.25" cy="28.25" rx="2.25" ry="2.25" />
              <ellipse className="assistant-ai-eye" cx="28.75" cy="28.25" rx="2.25" ry="2.25" />
            </g>
          </mask>
        </defs>
        {/* 참고 디자인처럼 안쪽으로 한 번 감기는 나선형 배냇머리. */}
        <path d="M24 15.5 C20.5 13.8 19.6 10.4 20.2 7.4 C20.7 4.9 23.3 3.6 25.5 4.6 C27.7 5.6 28.1 8.3 26.7 10 C25.6 11.4 23.3 11.1 22.9 9.5 C22.6 8.4 23.3 7.7 24.2 8" strokeWidth="1.9" />
        {/* 양쪽 이어 라인 */}
        <path d="M10.8 24 C8.7 24 7.8 26 7.8 28.5 C7.8 31 8.7 33 10.8 33" />
        <path d="M37.2 24 C39.3 24 40.2 26 40.2 28.5 C40.2 31 39.3 33 37.2 33" />
        {/* 참고 디자인의 살짝 넓은 둥근 헤드. */}
        <ellipse cx="24" cy="28" rx="13.5" ry="12.5" />
        <rect x="14" y="23.5" width="20" height="9.5" rx="4.75" fill="currentColor" stroke="none" mask={`url(#${visorMaskId})`} />
      </svg>
    </span>
  )
}
