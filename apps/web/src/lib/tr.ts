import i18next from '@/lib/i18n'

/**
 * Перевод по русскому тексту: ключ — сам русский текст (как в gettext), словари — `locales/<язык>/src.json`.
 * Нет перевода — показывается русский, поэтому непереведённое ничего не ломает.
 * Подстановки — `{{имя}}`: tr('Задач: {{n}}', { n }). Язык меняется перезагрузкой страницы, поэтому вызов можно делать и вне компонентов.
 */
export function tr(text: string, vars?: Record<string, unknown>): string {
  if (i18next.language === 'ru' && !vars) return text
  return i18next.t(text, { ns: 'src', defaultValue: text, keySeparator: false, nsSeparator: false, ...vars }) as string
}

type Pattern = { re: RegExp; key: string; count: number }
let patterns: Pattern[] | null = null
const cache = new Map<string, string>()

function dictionary(): Record<string, string> {
  return (i18next.getResourceBundle(i18next.language, 'src') ?? {}) as Record<string, string>
}

function compile(): Pattern[] {
  const out: Pattern[] = []
  for (const key of Object.keys(dictionary())) {
    if (!/\{\{p\d+\}\}/.test(key)) continue
    const parts = key.split(/\{\{p\d+\}\}/)
    const count = parts.length - 1
    const source = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)')
    out.push({ re: new RegExp(`^${source}$`, 's'), key, count })
  }
  // сначала самые определённые шаблоны (с наибольшим постоянным текстом)
  return out.sort((a, b) => b.key.replace(/\{\{p\d+\}\}/g, '').length - a.key.replace(/\{\{p\d+\}\}/g, '').length)
}

/**
 * Перевод текста, пришедшего из базы или сервера: названия ролей, статусов, направлений, места по умолчанию,
 * тексты сигналов и уведомлений. Совпадение — целиком, по шаблону с {{p1}}… (части переводятся тоже) или по частям через «, ».
 * Не нашлось — текст возвращается как есть, поэтому пользовательские данные не страдают.
 */
export function trData(text: string | null | undefined): string {
  if (!text) return text ?? ''
  if (i18next.language === 'ru') return text
  const hit = cache.get(text)
  if (hit !== undefined) return hit
  const dict = dictionary()
  let result = text
  if (dict[text] !== undefined) result = tr(text)
  else {
    patterns ??= compile()
    let matched = false
    for (const p of patterns) {
      const m = p.re.exec(text)
      if (!m) continue
      const vars: Record<string, string> = {}
      for (let i = 1; i <= p.count; i++) vars[`p${i}`] = trData(m[i])
      result = tr(p.key, vars)
      matched = true
      break
    }
    if (!matched && text.includes(', ')) {
      const parts = text.split(', ')
      const translated = parts.map((x) => trData(x))
      if (translated.some((x, i) => x !== parts[i])) result = translated.join(', ')
    }
  }
  if (cache.size > 5000) cache.clear()
  cache.set(text, result)
  return result
}
