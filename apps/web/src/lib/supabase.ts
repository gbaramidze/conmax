import { tr, trData } from '@/lib/tr'
import i18next from '@/lib/i18n'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

const configuredUrl = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!configuredUrl || !key) {
  throw new Error(tr('Не заданы VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY (см. .env.example)'))
}

// Путь вида «/supabase» превращаем в адрес текущего сайта: через него (прокси Vite) приложение работает
// с любого устройства, а не только с компьютера, где запущен Supabase
const url = configuredUrl.startsWith('/') ? `${window.location.origin}${configuredUrl}` : configuredUrl

/** Справочные тексты базы (роли, статусы, направления, названия мест по умолчанию, сигналы, уведомления), переводимые при показе. */
const TABLE_FIELDS: Record<string, string[]> = {
  roles: ['name'],
  workflow_statuses: ['name'],
  workflow_transitions: ['name'],
  reason_codes: ['name'],
  disciplines: ['name'],
  locations: ['name'],
  notifications: ['title', 'body'],
  signals: ['title', 'rule_text'],
  project_health: [],
  task_templates: ['name', 'description'],
}
/** Вложенные связи, у которых переводится `name`. */
const RELATIONS = new Set(['status', 'from_status', 'to_status', 'role', 'discipline', 'location', 'reason', 'reason_code'])
const LABELLED = new Set(['facts', 'components'])

function localize(node: unknown, fields: string[], inRelation: boolean): unknown {
  if (Array.isArray(node)) return node.map((x) => localize(x, fields, inRelation))
  if (!node || typeof node !== 'object') return node
  const obj = { ...(node as Record<string, unknown>) }
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && (fields.includes(k) || (inRelation && k === 'name'))) obj[k] = trData(v)
    else if (LABELLED.has(k) && Array.isArray(v)) {
      obj[k] = v.map((x) => (x && typeof x === 'object' ? { ...x, label: typeof x.label === 'string' ? trData(x.label) : x.label, ...(typeof x.value === 'string' ? { value: trData(x.value) } : {}) } : x))
    } else if (k === 'actions' && Array.isArray(v)) {
      obj[k] = v.map((x) => (x && typeof x === 'object' && typeof x.title === 'string' ? { ...x, title: trData(x.title) } : x))
    } else if (v && typeof v === 'object') obj[k] = localize(v, [], RELATIONS.has(k))
  }
  return obj
}

/** Переводит справочные тексты в ответах REST; на русском ничего не меняет. */
const localizingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init)
  if (i18next.language === 'ru') return res
  const address = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const m = /\/rest\/v1\/([a-z_]+)/.exec(address)
  const type = res.headers.get('content-type') ?? ''
  if (!m || !type.includes('json') || !res.ok) return res
  try {
    const fields = TABLE_FIELDS[m[1]] ?? []
    const json = await res.clone().json()
    const body = JSON.stringify(localize(json, fields, false))
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
  } catch {
    return res
  }
}

export const supabase = createClient<Database>(url, key, { global: { fetch: localizingFetch } })
