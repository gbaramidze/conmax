const MAX_SIDE = 1600
const SKIP_BELOW_BYTES = 400 * 1024

/**
 * Сжимает фото перед загрузкой: до 1600 px по длинной стороне, JPEG ~82%.
 * На площадке связь слабая, а снимок с телефона весит 4–8 МБ. Маленькие файлы, не-картинки и
 * случаи, когда сжатие не уменьшает размер, возвращаются как есть.
 */
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < SKIP_BELOW_BYTES) return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return file // формат не поддерживается браузером (например HEIC) — отправляем оригинал
  }
}
