import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
// Число, дата и текст так, как их показал бы Excel по формату ячейки (библиотека SSF), с русскими разделителями.
import SSF from 'ssf'

type Value = string | number | boolean | Date | null | undefined

const MONTHS_NOM: Record<string, string> = {
  January: tr('январь'), February: tr('февраль'), March: tr('март'), April: tr('апрель'), May: tr('май'), June: tr('июнь'),
  July: tr('июль'), August: tr('август'), September: tr('сентябрь'), October: tr('октябрь'), November: tr('ноябрь'), December: tr('декабрь'),
}
const MONTHS_GEN: Record<string, string> = {
  January: tr('января'), February: tr('февраля'), March: tr('марта'), April: tr('апреля'), May: tr('мая'), June: tr('июня'),
  July: tr('июля'), August: tr('августа'), September: tr('сентября'), October: tr('октября'), November: tr('ноября'), December: tr('декабря'),
}
const MONTHS_SHORT: Record<string, string> = { Jan: tr('янв'), Feb: tr('фев'), Mar: tr('мар'), Apr: tr('апр'), Jun: tr('июн'), Jul: tr('июл'), Aug: tr('авг'), Sep: tr('сен'), Oct: tr('окт'), Nov: tr('ноя'), Dec: tr('дек') }
const DAYS: Record<string, string> = {
  Monday: tr('понедельник'), Tuesday: tr('вторник'), Wednesday: tr('среда'), Thursday: tr('четверг'), Friday: tr('пятница'), Saturday: tr('суббота'), Sunday: tr('воскресенье'),
  Mon: tr('пн'), Tue: tr('вт'), Wed: tr('ср'), Thu: tr('чт'), Fri: tr('пт'), Sat: tr('сб'), Sun: tr('вс'),
}

const EXCEL_EPOCH = 25569
const serial = (d: Date) => d.getTime() / 86_400_000 + EXCEL_EPOCH

const generalFmt = new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 10 })
const pad = (n: number) => String(n).padStart(2, '0')

/** Формат с датой или временем: d, m, y, h, s вне кавычек и скобок */
const isDateFormat = (fmt: string) => /[dmyhs]/i.test(fmt.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''))

function ruDate(text: string, fmt: string): string {
  let out = text
  const genitive = /d[^m]*m{4}/i.test(fmt)
  out = out.replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/g, (m) => (genitive ? MONTHS_GEN : MONTHS_NOM)[m])
  out = out.replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/g, (m) => DAYS[m])
  out = out.replace(/\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, (m) => MONTHS_SHORT[m])
  out = out.replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/g, (m) => DAYS[m])
  return out
}

function format(fmt: string, n: number): string {
  try {
    return SSF.format(fmt, n)
  } catch {
    // SSF спотыкается о точку-разделитель в датах (dd.mm.yyyy): берём её в кавычки и пробуем ещё раз
    return SSF.format(fmt.replace(/(?<![0#?"])\.(?![0#?"])/g, '"."'), n)
  }
}

/** Как значение ячейки выглядит на экране; fmt — формат ячейки из файла */
export function formatValue(v: Value, fmt?: string): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'boolean') return v ? tr('ИСТИНА') : tr('ЛОЖЬ')
  const general = !fmt || fmt === 'General' || fmt === '@'
  if (v instanceof Date) {
    if (general) return `${pad(v.getUTCDate())}.${pad(v.getUTCMonth() + 1)}.${v.getUTCFullYear()}`
    try {
      return ruDate(format(fmt, serial(v)), fmt)
    } catch {
      return `${pad(v.getUTCDate())}.${pad(v.getUTCMonth() + 1)}.${v.getUTCFullYear()}`
    }
  }
  if (typeof v === 'string') return v
  if (general) return generalFmt.format(v)
  try {
    const text = format(fmt, v)
    if (isDateFormat(fmt)) return ruDate(text, fmt)
    // разделители по-русски: 1,234.50 → 1 234,50
    return text.replace(/[.,]/g, (m) => (m === ',' ? ' ' : ','))
  } catch {
    return generalFmt.format(v)
  }
}
