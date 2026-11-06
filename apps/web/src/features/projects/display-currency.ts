import { useSyncExternalStore } from 'react'
import { otherCurrency, symbolOf } from './currency'

/**
 * Валюта показа сумм на экране: лари или доллар. Все суммы в базе лежат в основной валюте проекта; для показа в другой они
 * пересчитываются по курсу проекта (лари за 1 доллар). Выбор — личный, хранится в браузере и действует на все проекты;
 * если у проекта нет курса, суммы показываются в его основной валюте.
 */
const KEY = 'buildos.displayCurrency'

interface State {
  /** Страница умеет показывать суммы в двух валютах; на остальных (например, мебель) суммы остаются в основной. */
  enabled: boolean
  wanted: 'GEL' | 'USD' | null
  base: string
  rate: number | null
}

let state: State = { enabled: true, wanted: null, base: 'GEL', rate: null }
try {
  const saved = localStorage.getItem(KEY)
  if (saved === 'GEL' || saved === 'USD') state = { ...state, wanted: saved }
} catch {
  /* хранилище недоступно: покажем основную валюту */
}
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Валюта, в которой сейчас показываются суммы. */
export function displayCode(s: State = state): string {
  if (!s.enabled || !s.wanted || s.wanted === s.base || !s.rate) return s.base
  return s.wanted
}

/** Сообщает о текущем проекте: его основная валюта и курс. Вызывается при открытии проекта и после правки курса. */
export function setProjectMoney(base: string, rate: number | null) {
  if (state.base === base && state.rate === rate) return
  state = { ...state, base, rate }
  emit()
}

/** Включает или выключает пересчёт для текущей страницы. Вызывается при отрисовке страницы, до её суммами, поэтому не уведомляет подписчиков. */
export function setMoneyDisplayEnabled(enabled: boolean) {
  if (state.enabled === enabled) return
  state = { ...state, enabled }
}

export function setDisplayCurrency(code: 'GEL' | 'USD') {
  state = { ...state, wanted: code }
  try {
    localStorage.setItem(KEY, code)
  } catch {
    /* не сохранится: выбор действует до перезагрузки */
  }
  emit()
}

/** Сумма из основной валюты проекта в валюту показа. */
export function toDisplay(n: number): number {
  const code = displayCode()
  if (code === state.base || !state.rate) return n
  // курс: лари за 1 доллар
  return state.base === 'GEL' ? n / state.rate : n * state.rate
}

/** Сумма, введённая в валюте показа, обратно в основную валюту проекта. */
export function fromDisplay(n: number): number {
  const code = displayCode()
  if (code === state.base || !state.rate) return n
  return state.base === 'GEL' ? n * state.rate : n / state.rate
}

export const displaySymbol = () => symbolOf(displayCode())

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Реактивное состояние для экрана: что показываем, можно ли переключать и на что. */
export function useDisplayCurrency(): { code: string; symbol: string; base: string; rate: number | null; canSwitch: boolean; other: string } {
  const s = useSyncExternalStore(subscribe, () => state)
  const code = displayCode(s)
  return { code, symbol: symbolOf(code), base: s.base, rate: s.rate, canSwitch: !!s.rate && s.enabled, other: otherCurrency(code) }
}
