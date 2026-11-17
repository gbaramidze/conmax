// Язык получателя для писем и push. Тексты уведомлений хранятся в базе по-русски; перед отправкой их переводят так же,
// как сайт в колокольчике (trData в apps/web/src/lib/tr.ts): точное совпадение, шаблон с {{p1}}… или перевод по частям через «, ».
// Словари dict-<язык>.json — выжимка из словарей сайта (node scripts/i18n/server-dict.cjs); нет перевода — остаётся русский.
import ka from './dict-ka.json' with { type: 'json' }
import en from './dict-en.json' with { type: 'json' }

export type Lang = 'ru' | 'ka' | 'en'

/** Язык из users.locale; всё незнакомое — русский (основной язык). */
export const asLang = (l: string | null | undefined): Lang => (l === 'ka' || l === 'en' ? l : 'ru')

const DICT: Record<'ka' | 'en', Record<string, string>> = { ka, en }

type Pattern = { re: RegExp; key: string; count: number }
const patterns: Partial<Record<Lang, Pattern[]>> = {}

function compile(lang: 'ka' | 'en'): Pattern[] {
  const out: Pattern[] = []
  for (const key of Object.keys(DICT[lang])) {
    if (!/\{\{p\d+\}\}/.test(key)) continue
    const parts = key.split(/\{\{p\d+\}\}/)
    const source = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)')
    out.push({ re: new RegExp(`^${source}$`, 's'), key, count: parts.length - 1 })
  }
  // сначала самые определённые шаблоны (с наибольшим постоянным текстом)
  return out.sort((a, b) => b.key.replace(/\{\{p\d+\}\}/g, '').length - a.key.replace(/\{\{p\d+\}\}/g, '').length)
}

/** Подставляет {{имя}} в переведённый шаблон. */
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '')
}

/** Перевод текста из базы (уведомление, название статуса…). Не нашлось — возвращается как есть, поэтому пользовательские данные не страдают. */
export function trData(text: string | null | undefined, lang: Lang): string {
  if (!text) return text ?? ''
  if (lang === 'ru') return text
  const dict = DICT[lang]
  if (dict[text] !== undefined) return dict[text]

  patterns[lang] ??= compile(lang)
  for (const p of patterns[lang]!) {
    const m = p.re.exec(text)
    if (!m) continue
    const vars: Record<string, string> = {}
    for (let i = 1; i <= p.count; i++) vars[`p${i}`] = trData(m[i], lang)
    return fill(dict[p.key], vars)
  }
  if (text.includes(', ')) {
    const parts = text.split(', ')
    const translated = parts.map((x) => trData(x, lang))
    if (translated.some((x, i) => x !== parts[i])) return translated.join(', ')
  }
  return text
}

/** Ключи объектов в заголовке уведомления («Заметка «текст»», «Документ «название»»): тип переводим, текст человека — нет. */
const KINDS: Record<string, Record<'ka' | 'en', string>> = {
  Заметка: { ka: 'ჩანაწერი', en: 'Note' },
  Документ: { ka: 'დოკუმენტი', en: 'Document' },
  Сигнал: { ka: 'სიგნალი', en: 'Signal' },
}

/** Заголовок уведомления: «Вам адресована заметка · CODE» — по шаблону, «Заметка «…»» — тип объекта отдельно от названия. */
export function trTitle(title: string, lang: Lang): string {
  if (lang === 'ru') return title
  const whole = trData(title, lang)
  if (whole !== title) return whole
  const m = /^([^«]+?) («.*»)$/s.exec(title)
  if (m) {
    const kind = KINDS[m[1]]?.[lang] ?? trData(m[1], lang)
    if (kind !== m[1]) return `${kind} ${m[2]}`
  }
  return title
}
