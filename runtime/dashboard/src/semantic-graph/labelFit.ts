/* SVG 라벨도 화면 나머지와 같은 글꼴을 쓴다. CSS 변수는 SVG 속성에서
   쓸 수 없어 토큰과 같은 값을 직접 적는다. */
export const GRAPH_FONT_FAMILY = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Malgun Gothic", sans-serif'

/**
 * 칸 폭에 맞춰 이름을 자른다.
 *
 * 글자 수로 자르면 한글 12자와 영문 12자의 폭이 두 배 가까이 달라,
 * L4에서는 174칸 중 166칸의 이름이 옆 칸을 밀고 나갔다. 글자 폭을
 * 어림잡으면 이번에는 반대로 들어갈 자리가 남는데도 잘라 내므로,
 * 실제 글꼴로 재서 들어가는 만큼만 남긴다.
 */
const labelFitCache = new Map<string, string>()
let measureContext: CanvasRenderingContext2D | null | undefined

export function measureLabel(text: string, fontSize: number): number {
  if (measureContext === undefined) {
    measureContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  }
  if (!measureContext) return text.length * fontSize * 0.62
  measureContext.font = `600 ${fontSize}px ${GRAPH_FONT_FAMILY}`
  return measureContext.measureText(text).width
}

export function fitLabel(label: string, maxWidth: number, fontSize: number): string {
  const key = `${fontSize}|${maxWidth}|${label}`
  const cached = labelFitCache.get(key)
  if (cached !== undefined) return cached

  let result = label
  if (measureLabel(label, fontSize) > maxWidth) {
    let low = 1
    let high = label.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (measureLabel(label.slice(0, mid) + '…', fontSize) <= maxWidth) low = mid
      else high = mid - 1
    }
    result = label.slice(0, low) + '…'
  }

  labelFitCache.set(key, result)
  return result
}

/**
 * 이름 가운데를 줄인다. 칸 이름은 앞이 같고 끝이 다른 것이 많아(Slack User Normal 1 ~ 12,
 * normal.user1 ~ 9@aegi.site) 뒤를 자르면 전부 「Slack …」로 똑같아진다. 앞과 끝을 남겨
 * 「Slack U…ormal 12」로 적는다. 메일 주소는 모두 같은 도메인이라 도메인부터 「@…」로 줄인다.
 */
export function fitLabelMiddle(label: string, maxWidth: number, fontSize: number): string {
  const key = `m|${fontSize}|${maxWidth}|${label}`
  const cached = labelFitCache.get(key)
  if (cached !== undefined) return cached

  let result = label
  if (measureLabel(label, fontSize) > maxWidth) {
    const at = label.lastIndexOf('@')
    const email = at > 0 && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(label)
    const body = email ? label.slice(0, at) : label
    const suffix = email ? '@…' : ''
    if (email && measureLabel(body + suffix, fontSize) <= maxWidth) {
      result = body + suffix
    } else {
      // 남길 글자 수 n 을 앞 55% · 끝 45% 로 나눈다.
      const cut = (n: number) => {
        const head = Math.max(1, Math.ceil(n * 0.55))
        const tail = n - head
        return body.slice(0, head).trimEnd() + '…' + (tail > 0 ? body.slice(body.length - tail).trimStart() : '') + suffix
      }
      let low = 1
      let high = body.length - 1
      while (low < high) {
        const mid = Math.ceil((low + high) / 2)
        if (measureLabel(cut(mid), fontSize) <= maxWidth) low = mid
        else high = mid - 1
      }
      result = cut(low)
    }
  }

  labelFitCache.set(key, result)
  return result
}
