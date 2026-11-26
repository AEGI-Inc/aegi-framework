// JSON.stringify(v, null, 1) + '\n' 과 같은 바이트를 조각으로 낸다. 배열은 원소마다 나눠 큰 출력도 한 문자열로 만들지 않는다
// (V8 문자열 한도가 약 512MB 라 10,000명 objects.json 을 한 번에 만들 수 없다)
export function* jsonChunks(v, size = 1 << 20) {
  if (!Array.isArray(v) || !v.length) { yield JSON.stringify(v, null, 1) + '\n'; return }
  let buf = '[\n'
  for (let i = 0; i < v.length; i++) {
    // 배열 안 원소는 한 칸 들여 쓴다. 문자열 안 줄바꿈은 \n 으로 이스케이프되므로 실제 줄바꿈은 서식뿐이다
    const s = JSON.stringify(v[i], null, 1)
    buf += ' ' + (s === undefined ? 'null' : s.replaceAll('\n', '\n ')) + (i < v.length - 1 ? ',\n' : '\n')
    if (buf.length >= size) { yield buf; buf = '' }
  }
  yield buf + ']\n'
}

import fs from 'node:fs'
export function writeJson(file, v) {
  const fd = fs.openSync(file, 'w')
  try { for (const chunk of jsonChunks(v)) fs.writeSync(fd, chunk) } finally { fs.closeSync(fd) }
}
