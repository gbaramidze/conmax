import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { supabase } from '@/lib/supabase'

export const LANGUAGES = [
  { code: 'ru', label: 'Русский', locale: 'ru-RU' },
  { code: 'ka', label: 'ქართული', locale: 'ka-GE' },
  { code: 'en', label: 'English', locale: 'en-GB' },
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']

const STORAGE_KEY = 'lang'

function initialLanguage(): LanguageCode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'ru' || v === 'ka' || v === 'en') return v
  } catch {
    // хранилище недоступно — остаётся русский
  }
  return 'ru'
}

/** Словари лежат в `locales/<язык>/<пространство>.json`; русский — основной язык и запасной для ненайденных ключей. */
const files = import.meta.glob<Record<string, string>>('../locales/*/*.json', { eager: true, import: 'default' })
const resources: Record<string, Record<string, Record<string, string>>> = {}
for (const [path, dict] of Object.entries(files)) {
  const m = /locales\/([^/]+)\/([^/]+)\.json$/.exec(path)
  if (m) (resources[m[1]] ??= {})[m[2]] = dict
}

void i18next.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: 'ru',
  defaultNS: 'shell',
  ns: Object.keys(resources.ru ?? {}),
  initAsync: false,
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
})

function stored(): LanguageCode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'ru' || v === 'ka' || v === 'en' ? v : null
  } catch {
    return null
  }
}

export async function setLanguage(code: LanguageCode): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, code)
  } catch {
    // язык применится только на эту сессию
  }
  // Язык хранится и в профиле, чтобы совпадать на других устройствах; без входа сохранится только в браузере
  await supabase.rpc('set_my_locale', { p_locale: code }).then(
    () => undefined,
    () => undefined,
  )
  // Форматы дат и чисел создаются при загрузке модулей, поэтому после смены языка страницу перезагружаем
  location.reload()
}

/** После входа: язык из профиля, если в этом браузере выбор ещё не делался; иначе выбор браузера уходит в профиль. */
export async function syncLanguageWithProfile(userId: string): Promise<void> {
  const { data } = await supabase.from('users').select('locale').eq('id', userId).maybeSingle()
  const remote = data?.locale
  const local = stored()
  if (!local && (remote === 'ka' || remote === 'en') && remote !== i18next.language) {
    try {
      localStorage.setItem(STORAGE_KEY, remote)
    } catch {
      return
    }
    location.reload()
  } else if (local && remote && remote !== local) {
    await supabase.rpc('set_my_locale', { p_locale: local })
  }
}

/** Локаль для `Intl` и `toLocaleString` по текущему языку интерфейса. */
export function currentLocale(): string {
  return LANGUAGES.find((l) => l.code === i18next.language)?.locale ?? 'ru-RU'
}

document.documentElement.lang = i18next.language

export default i18next
