import AiLogo from './AiLogo'

/**
 * 선택한 조사 대상을 AI 입력창에 전달하는 공통 진입 버튼.
 * 보조 기능이라 상세 머리 오른쪽에 닫기 단추와 나란히 작은 아이콘 단추로 둔다. 이름은 커서를 올리면 뜨고 화면 읽기 프로그램이 읽는다.
 */
export default function AiAskButton({ subject, onClick }: {
  subject: '항목' | '연결' | '접근'
  onClick: () => void
}) {
  const label = `AEGI AI에게 이 ${subject} 질문`
  return <button type="button" className="assistant-inspector-ask szi-ai-btn" onClick={onClick}
    aria-controls="aegi-ai-panel" aria-label={label} title={label}>
    <AiLogo size={18} />
  </button>
}
