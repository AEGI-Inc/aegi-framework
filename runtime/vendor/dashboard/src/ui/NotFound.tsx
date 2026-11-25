/**
 * 주소로 연 항목을 지금 데이터에서 찾지 못했을 때 보이는 안내.
 *
 * 전에는 없는 위협 주소(#threat?finding=FND-…)를 열면 열린 위협 중 첫 번째를 안내 없이 보였다.
 * 링크를 받은 동료가 다른 위협을 예외 처리하거나 조치할 수 있어, 찾지 못했다는 것을 먼저 알린다.
 */
export default function NotFound({ title, heading, id, backLabel, onBack }: {
  /** 제목 줄 이름 (화면 이름) */
  title: string
  /** 안내 제목 (「위협을 찾을 수 없음」) */
  heading: string
  id: string
  backLabel: string
  onBack: () => void
}) {
  return (
    <main className="not-found-page">
      <header className="page-title-bar page-title-bar-inset">
        <h1>{title}</h1>
      </header>
      <section className="not-found-box" role="status">
        <h2>{heading}</h2>
        <p>
          지금 데이터에 없는 주소 <code>{id}</code>. 다음 수집에서 사라졌거나 주소가 잘못되었을 수 있음.
        </p>
        <button type="button" className="not-found-back" onClick={onBack}>{backLabel}</button>
      </section>
    </main>
  )
}
