export const IMAGE_LIMIT = 2
export const IMAGE_DATA_LIMIT = 900_000
export interface AssistantImage { name: string; dataUrl: string }

/** Local decode and re-encoding strips metadata and bounds image size before upload. */
export async function prepareAssistantImage(file: File): Promise<AssistantImage> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('PNG, JPEG, WebP 이미지 10MB 이하를 선택해 주세요.')
  const bitmap = await createImageBitmap(file)
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) throw new Error('이미지 해상도가 너무 큽니다.')
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('이미지를 읽을 수 없습니다.')
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    let dataUrl = canvas.toDataURL('image/jpeg', .82)
    if (dataUrl.length > IMAGE_DATA_LIMIT) dataUrl = canvas.toDataURL('image/jpeg', .5)
    if (dataUrl.length > IMAGE_DATA_LIMIT) throw new Error('이미지를 더 작게 잘라서 첨부해 주세요.')
    return { name: file.name.slice(0, 100) || '첨부 이미지', dataUrl }
  } finally { bitmap.close() }
}

export function parseImages(value: unknown): AssistantImage[] | null {
  if (!Array.isArray(value) || value.length > IMAGE_LIMIT) return null
  for (const image of value) {
    if (!image || typeof image !== 'object' || Array.isArray(image) || Object.keys(image).some(k => !['name', 'dataUrl'].includes(k))) return null
    if (typeof image.name !== 'string' || !image.name.trim() || image.name.length > 100 || typeof image.dataUrl !== 'string' || image.dataUrl.length > IMAGE_DATA_LIMIT) return null
    // Only locally encoded JPEGs. Remote URLs, SVG, and mismatched signatures are rejected.
    if (!/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(image.dataUrl) || (image.dataUrl.length - 23) % 4 !== 0) return null
  }
  return value as AssistantImage[]
}
