/** 줄마다 칸을 쉼표로 잇는 CSV. 쉼표, 따옴표, 줄바꿈이 든 칸은 따옴표로 감싼다 */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  const cell = (value: string | number) => {
    const text = String(value)
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return rows.map(row => row.map(cell).join(',')).join('\n')
}

/**
 * 글을 파일로 내려받는다. CSV 는 엑셀이 한글을 깨뜨리지 않게 UTF-8 표시(BOM)를 앞에 붙인다.
 */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const body = type.startsWith('text/csv') ? `﻿${text}` : text
  const url = URL.createObjectURL(new Blob([body], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
