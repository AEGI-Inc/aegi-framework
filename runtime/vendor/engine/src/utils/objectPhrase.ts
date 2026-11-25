/** 화면 문장에 붙이는 조사. 앞 단어의 받침에 맞춘다 */

const DIGIT_BATCHIM: Record<string, boolean> = { '0': true, '1': true, '2': false, '3': true, '4': false, '5': false, '6': true, '7': true, '8': true, '9': false }

/** 마지막 글자의 받침. ㄹ 받침은 'rieul' */
function batchim(word: string): 'none' | 'rieul' | 'other' {
  const text = word.replace(/[)\]}'"」』\s]+$/, '')
  const ch = text[text.length - 1] ?? ''
  const code = ch.charCodeAt(0)
  if (code >= 0xac00 && code <= 0xd7a3) {
    const final = (code - 0xac00) % 28
    return final === 0 ? 'none' : final === 8 ? 'rieul' : 'other'
  }
  if (ch in DIGIT_BATCHIM) return ch === '1' || ch === '7' || ch === '8' ? 'rieul' : DIGIT_BATCHIM[ch] ? 'other' : 'none'
  const lower = text.toLowerCase()
  if (lower.endsWith('l')) return 'rieul'
  // 영어 끝소리: m, n, ng 와 받침으로 읽는 k, t, p, c (Slack → 슬랙, bot → 봇)
  if (/(m|n|ng|k|t|p|c)$/.test(lower)) return 'other'
  return 'none'
}

export type JosaPair = '을/를' | '이/가' | '은/는' | '과/와' | '으로/로'

/** 단어 뒤에 맞는 조사를 붙인다. josa('채널', '을/를') → '채널을' */
export function josa(word: string, pair: JosaPair): string {
  const b = batchim(word)
  const [withFinal, withoutFinal] = pair.split('/')
  if (pair === '으로/로') return word + (b === 'other' ? '으로' : '로')
  return word + (b === 'none' ? withoutFinal : withFinal)
}
