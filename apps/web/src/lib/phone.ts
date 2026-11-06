/** Только цифры номера в международном виде (для ссылок wa.me). Номера без «+» достраиваются: 8… и 10 цифр — Россия, 9 цифр на 5 — Грузия. */
export function internationalDigits(phone: string): string {
  const raw = phone.trim()
  const digits = raw.replace(/\D/g, '')
  if (raw.startsWith('+')) return digits
  if (raw.startsWith('00')) return digits.slice(2)
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`
  if (digits.length === 10) return `7${digits}`
  if (digits.length === 9 && digits.startsWith('5')) return `995${digits}`
  return digits
}

/** Ссылка «позвонить». */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

/** Ссылка «написать в WhatsApp»: открывает приложение на телефоне или WhatsApp Web на компьютере. */
export const whatsappHref = (phone: string) => `https://wa.me/${internationalDigits(phone)}`
