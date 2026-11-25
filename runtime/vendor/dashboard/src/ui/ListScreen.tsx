import { DetailCrumb, DetailPager } from './DetailBar'
import { useEffect, useState, type ReactNode } from 'react'

/*
 * 목록 → 상세 화면의 공용 부품 (Exceptions, Credentials).
 * 모양은 Access Gaps 목록 · 상세와 같다: 위 줄 왼쪽 보기 전환, 오른쪽 핵심 숫자,
 * 머리글 + 흰 줄 칸, 누르면 상세, 돌아오면 보던 자리.
 */

/** 주소의 `?id=` 값. 목록 주소(`#threat?view=exceptions`)에서는 빈 문자열. */
export function detailIdFromHash(prefix: string): string {
  if (typeof window === 'undefined') return ''
  const hash = window.location.hash
  if (!hash.toLowerCase().startsWith(prefix)) return ''
  const match = hash.match(/[?&]id=([^&]+)/i)
  if (!match) return ''
  try {
    return decodeURIComponent(match[1]).toUpperCase()
  } catch {
    return ''
  }
}

/** 거르기 결과 수를 화면 읽기 프로그램에 알린다. 화면에는 보이지 않는다 */
export function LiveCount({ count, noun, unit = '건' }: { count: number; noun: string; unit?: string }) {
  return <p className="sr-only" role="status" aria-live="polite">{noun} {count}{unit}</p>
}

export const detailHash = (prefix: string, id: string) => `${prefix}?id=${encodeURIComponent(id)}`

/** 뒤로 가기 · 앞으로 가기 · 다른 화면의 링크로 주소가 바뀌면 열린 id 를 따라간다. */
export function useDetailId(prefix: string): [string, (id: string) => void] {
  const [id, setId] = useState(() => detailIdFromHash(prefix))
  useEffect(() => {
    const onHash = () => setId(detailIdFromHash(prefix))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [prefix])
  return [id, setId]
}

/* 목록에서 보던 자리(스크롤 · 보기 · 마지막으로 연 줄). 상세에 다녀오거나 다른 화면에 갔다 와도
   그대로 돌아오게 탭(세션) 안에 적어 둔다. 저장소를 못 쓰는 브라우저에서는 처음 자리로 뜬다. */
export function readListMemory<T extends object>(key: string): Partial<T> {
  try {
    return JSON.parse(window.sessionStorage.getItem(key) ?? '{}') as Partial<T>
  } catch {
    return {}
  }
}

export function writeListMemory<T extends object>(key: string, patch: Partial<T>) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ ...readListMemory<T>(key), ...patch }))
  } catch {
    /* 기억하지 못해도 화면은 그대로 쓴다 */
  }
}

/** 이 화면을 굴리는 상자. 창 크기에 따라 문서 전체이기도, 본문 칸(.app-content)이기도 하다. */
export function scrollBox(el: HTMLElement | null): HTMLElement {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement
}

/** 보기 전환. 두세 칸 버튼으로 무엇을 보고 있는지와 각각 몇 개인지를 함께 보인다. */
export function Segmented<K extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string
  items: Array<{ key: K; label: string; count: number }>
  value: K
  onChange: (key: K) => void
}) {
  return (
    <div className="lst-seg" role="group" aria-label={label}>
      {items.map(item => (
        <button
          type="button"
          key={item.key}
          className={value === item.key ? 'is-on' : ''}
          aria-pressed={value === item.key}
          onClick={() => onChange(item.key)}
        >
          {item.label} <b>{item.count}</b>
        </button>
      ))}
    </div>
  )
}

/** 위 줄 오른쪽의 핵심 숫자. 0 이 아니면 빨강. */
/** 큰 숫자 하나. 0이면 큰 「0건」 대신 none 글 한 줄 (0을 크게 두면 경고처럼 읽힌다) */
export function Hero({ label, count, unit, onClick, none }: { label: string; count: number; unit: string; onClick?: () => void; none?: string }) {
  if (count === 0 && none) return <p className="lst-hero-none">{none}</p>
  const body = (
    <>
      <span>{label}</span>
      <strong>
        {count}
        <small>{unit}</small>
      </strong>
    </>
  )
  return onClick && count > 0 ? (
    <button type="button" className="lst-hero is-alert" onClick={onClick}>
      {body}
    </button>
  ) : (
    <p className={`lst-hero ${count > 0 ? 'is-alert' : ''}`}>{body}</p>
  )
}

/** 거르기 칩 한 줄. 이름 + 개수, 문제인 값은 개수를 빨강으로. */
export function ChipGroup<K extends string>({
  legend,
  items,
  isOn,
  onToggle,
}: {
  legend: string
  items: Array<{ key: K; label: ReactNode; count: number; alert?: boolean; title?: string; ariaLabel?: string; logo?: boolean }>
  isOn: (key: K) => boolean
  onToggle: (key: K) => void
}) {
  return (
    <div className="ti-filter-group" role="group" aria-label={`${legend} 필터`}>
      <span className="ti-filter-legend">{legend}</span>
      {items.map(item => {
        const on = isOn(item.key)
        return (
          <button
            type="button"
            key={item.key}
            className={`ti-filter-chip ${item.logo ? 'ti-saas-chip' : ''} ${on ? 'on' : ''} ${item.alert && item.count ? 'lst-chip-alert' : ''}`}
            aria-pressed={on}
            aria-label={item.ariaLabel}
            title={item.title}
            disabled={item.count === 0 && !on}
            onClick={() => onToggle(item.key)}
          >
            {item.logo ? <i aria-hidden="true">{item.label}</i> : item.label}
            <em>{item.count}</em>
          </button>
        )
      })}
    </div>
  )
}

/** 상세 머리: 「목록 › X 상세」 경로와 이전, 다음 화살표, N / M. 이전 · 다음은 방문 기록을 쌓지 않는다. */
export function DetailHead({
  title,
  index,
  total,
  back,
  unit,
  onBack,
  onPrev,
  onNext,
}: {
  title: string
  index: number
  total: number
  back: string
  unit: string
  onBack: () => void
  onPrev?: () => void
  onNext?: () => void
}) {
  return (
    <header className="page-title-bar page-title-bar-inset">
      <DetailCrumb back={back} onBack={onBack} title={title} />
      <div className="page-head-actions">
        {index > 0 && <DetailPager index={index} total={total} unit={unit} onPrev={onPrev} onNext={onNext} />}
      </div>
    </header>
  )
}

/** 머리 오른쪽의 작은 상태 표시(저장 위치 등). 설명은 커서를 올리면 뜬다. */
export function HeadBadge({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <span className="lst-badge" title={title}>
      {icon}
      {children}
    </span>
  )
}
