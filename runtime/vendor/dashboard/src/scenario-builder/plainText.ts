import type { Hop, ScenarioGraph } from './scenarioGraph'

/**
 * 엔진 간선을 사람이 읽는 한 문장으로 바꾼다 (SaaS 연결, 자산, 경로 만들기 공용).
 * 간선 종류마다 문장 틀이 하나다. 이름은 「」로 묶고, 뒤 조사는 이름 마지막 글자가 한글이면 받침으로 고르고 아니면 「이(가)」처럼 둘 다 적는다.
 */
function hasBatchim(word: string): boolean | undefined {
  const c = word.trim().slice(-1).charCodeAt(0)
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 !== 0
  return undefined
}
/** 낱말에 붙일 조사. withBatchim 은 받침 있을 때(이, 을, 은), without 은 없을 때(가, 를, 는) */
function particle(word: string, withBatchim: string, without: string): string {
  const b = hasBatchim(word)
  return b === undefined ? `${withBatchim}(${without})` : b ? withBatchim : without
}
/** 낱말 + 조사 */
export const withJosa = (word: string, withBatchim: string, without: string) => `${word}${particle(word, withBatchim, without)}`
/** 「이름」 + 조사 (조사를 안 주면 「이름」만) */
export function named(word: string, withBatchim = '', without = ''): string {
  return `「${word}」${withBatchim ? particle(word, withBatchim, without) : ''}`
}

/** 간선 종류별 문장. a 는 시작 객체 이름, b 는 끝 객체 이름 */
const SENTENCE: Record<string, (a: string, b: string) => string> = {
  T: (a, b) => `${named(a, '이', '가')} ${named(b, '을', '를')} 실행시킨다`,
  A: (a, b) => `${named(a, '은', '는')} ${named(b)} 권한으로 돈다`,
  F: (a, b) => `${named(a)} 내용이 ${named(b)}에 복사된다`,
  E: (a, b) => `${named(a, '이', '가')} ${named(b, '을', '를')} 바꾼다`,
  G: (a, b) => `${named(a, '은', '는')} ${named(b)}에 권한이 있다`,
  M: (a, b) => `${named(a, '은', '는')} ${named(b)}에 속한다`,
  U: (a, b) => `${named(a, '은', '는')} ${named(b)}에 등록돼 있다`,
}
/** 한 홉에 종류가 여럿이면 이 순서로 고른다: 바꾸기, 실행 신원, 복사, 실행, 권한, 등록, 소속 */
const PRIMARY = ['E', 'A', 'F', 'T', 'G', 'U', 'M']

/** 홉의 대표 간선 종류 */
const primaryKind = (h: Hop) => PRIMARY.find(k => h.kinds.includes(k)) ?? h.kinds[0]

/** 간선 종류별 짧은 이름 (흐름 화살표에 붙인다) */
const WORD: Record<string, string> = { T: '실행', A: '실행 신원', F: '복사', E: '변경', G: '권한', M: '소속', U: '등록' }
export const hopWord = (h: Hop) => WORD[primaryKind(h)] ?? h.rels.join(', ')

/** 홉의 대표 문장 하나 */
export function hopSentence(sg: ScenarioGraph, h: Hop): string {
  const make = SENTENCE[primaryKind(h)]
  const a = sg.name(h.from), b = sg.name(h.to)
  return make ? make(a, b) : `${named(a)} → ${named(b)}`
}
