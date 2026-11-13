/**
 * Запасные форматы дат для грузинского языка.
 *
 * Не в каждой среде у `Intl` есть данные грузинской локали (так в приложениях на урезанном Chromium, например во
 * встроенном браузере Claude: `Intl.DateTimeFormat('ka-GE')` молча отвечает по-русски, и даты выглядят как «1 янв. 25 г.»).
 * Если локали нет, подменяем `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat` и `Date.prototype.toLocale*String`
 * для `ka`: порядок и числа берём у английского формата, названия месяцев и дней подставляем грузинские.
 * Там, где грузинская локаль есть, ничего не меняется.
 */

const MONTHS_LONG = ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი']
const MONTHS_SHORT = ['იან', 'თებ', 'მარ', 'აპრ', 'მაი', 'ივნ', 'ივლ', 'აგვ', 'სექ', 'ოქტ', 'ნოე', 'დეკ']
/** С воскресенья, как `Date.getDay()`. */
const WEEKDAYS_LONG = ['კვირა', 'ორშაბათი', 'სამშაბათი', 'ოთხშაბათი', 'ხუთშაბათი', 'პარასკევი', 'შაბათი']
const WEEKDAYS_SHORT = ['კვი', 'ორშ', 'სამ', 'ოთხ', 'ხუთ', 'პარ', 'შაბ']
const EN_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const isKa = (locales: unknown): boolean => /^ka(-|$)/i.test(String(Array.isArray(locales) ? (locales[0] ?? '') : (locales ?? '')))

const DATE_FIELDS = ['weekday', 'era', 'year', 'month', 'day', 'dateStyle']
const TIME_FIELDS = ['hour', 'minute', 'second', 'fractionalSecondDigits', 'dayPeriod', 'timeStyle']
const has = (o: Intl.DateTimeFormatOptions, keys: string[]) => keys.some((k) => (o as Record<string, unknown>)[k] !== undefined)

function patchDateTimeFormat(): void {
  const Native = Intl.DateTimeFormat

  const make = (args: ConstructorParameters<typeof Intl.DateTimeFormat>, newTarget?: Function): Intl.DateTimeFormat => {
    const [locales, options = {}] = args
    if (!isKa(locales)) return newTarget ? Reflect.construct(Native, args, newTarget) : Native(...args)
    const base = new Native('en-GB', options)
    const timeZone = base.resolvedOptions().timeZone
    const monthOf = new Native('en-US', { month: 'numeric', timeZone })
    const weekdayOf = new Native('en-US', { weekday: 'short', timeZone })
    const longMonth = options.month === 'long' || options.dateStyle === 'long' || options.dateStyle === 'full'
    const longWeekday = options.weekday === 'long' || options.dateStyle === 'full'

    const parts = (date?: Date | number): Intl.DateTimeFormatPart[] => {
      const d = date === undefined ? new Date() : new Date(date)
      const src = base.formatToParts(d)
      const hasYear = src.some((p) => p.type === 'year')
      const out: Intl.DateTimeFormatPart[] = []
      src.forEach((p, i) => {
        if (p.type === 'month' && /\D/.test(p.value)) {
          const m = Number(monthOf.format(d)) - 1
          out.push({ type: 'month', value: longMonth ? MONTHS_LONG[m] : MONTHS_SHORT[m] + (hasYear ? '.' : '') })
        } else if (p.type === 'weekday') {
          const w = EN_WEEKDAYS.indexOf(weekdayOf.format(d))
          out.push({ type: 'weekday', value: longWeekday ? WEEKDAYS_LONG[w] : WEEKDAYS_SHORT[w] })
        } else if (p.type === 'literal') {
          const prev = src[i - 1]?.type
          const next = src[i + 1]?.type
          let v = p.value.replace(/\//g, '.')
          if (/\bat\b/.test(v)) v = ', '
          else if (v.trim() === '' && (prev === 'weekday' || (prev === 'month' && longMonth && next === 'year'))) v = ', '
          out.push({ type: 'literal', value: v })
        } else out.push(p)
      })
      return out
    }

    const instance = new Native('en-GB', options)
    Object.defineProperties(instance, {
      format: { value: (d?: Date | number) => parts(d).map((p) => p.value).join(''), configurable: true },
      formatToParts: { value: (d?: Date | number) => parts(d), configurable: true },
      resolvedOptions: { value: () => ({ ...base.resolvedOptions(), locale: 'ka-GE' }), configurable: true },
    })
    return instance
  }

  const proxy = new Proxy(Native, {
    construct: (_t, args, newTarget) => make(args as ConstructorParameters<typeof Intl.DateTimeFormat>, newTarget),
    apply: (_t, _this, args) => make(args as ConstructorParameters<typeof Intl.DateTimeFormat>),
  })
  Object.defineProperty(Intl, 'DateTimeFormat', { value: proxy, writable: true, configurable: true })

  // toLocaleDateString / toLocaleTimeString / toLocaleString работают мимо Intl.DateTimeFormat, их подменяем отдельно
  const wrap = (name: 'toLocaleDateString' | 'toLocaleTimeString' | 'toLocaleString', defaults: Intl.DateTimeFormatOptions, skip: (o: Intl.DateTimeFormatOptions) => boolean) => {
    const orig = Date.prototype[name] as (this: Date, l?: Intl.LocalesArgument, o?: Intl.DateTimeFormatOptions) => string
    Object.defineProperty(Date.prototype, name, {
      configurable: true,
      writable: true,
      value: function (this: Date, locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
        if (!isKa(locales)) return orig.call(this, locales, options)
        if (Number.isNaN(this.getTime())) return 'Invalid Date'
        const o = options ?? {}
        return new proxy(locales as string, skip(o) ? o : { ...defaults, ...o }).format(this)
      },
    })
  }
  const dateDefaults = { year: 'numeric', month: 'numeric', day: 'numeric' } as const
  const timeDefaults = { hour: 'numeric', minute: 'numeric', second: 'numeric' } as const
  wrap('toLocaleDateString', dateDefaults, (o) => has(o, DATE_FIELDS))
  wrap('toLocaleTimeString', timeDefaults, (o) => has(o, TIME_FIELDS))
  wrap('toLocaleString', { ...dateDefaults, ...timeDefaults }, (o) => has(o, DATE_FIELDS) || has(o, TIME_FIELDS))
}

/** Единицы: «5 წუთის წინ» (прошлое) и «5 წუთში» (будущее). */
const REL: Record<string, { past: string; future: string }> = {
  second: { past: 'წამის', future: 'წამში' },
  minute: { past: 'წუთის', future: 'წუთში' },
  hour: { past: 'საათის', future: 'საათში' },
  day: { past: 'დღის', future: 'დღეში' },
  week: { past: 'კვირის', future: 'კვირაში' },
  month: { past: 'თვის', future: 'თვეში' },
  year: { past: 'წლის', future: 'წელიწადში' },
}
const REL_AUTO: Record<string, Record<number, string>> = {
  second: { 0: 'ახლა' },
  minute: { 0: 'ამ წუთში' },
  hour: { 0: 'ამ საათში' },
  day: { '-1': 'გუშინ', 0: 'დღეს', 1: 'ხვალ' },
  week: { '-1': 'გასულ კვირას', 0: 'ამ კვირას', 1: 'მომავალ კვირას' },
  month: { '-1': 'გასულ თვეს', 0: 'ამ თვეს', 1: 'მომავალ თვეს' },
  year: { '-1': 'გასულ წელს', 0: 'ამ წელს', 1: 'მომავალ წელს' },
}

function patchRelativeTimeFormat(): void {
  const Native = Intl.RelativeTimeFormat
  const make = (args: ConstructorParameters<typeof Intl.RelativeTimeFormat>, newTarget?: Function): Intl.RelativeTimeFormat => {
    const [locales, options] = args
    if (!isKa(locales)) return Reflect.construct(Native, args, newTarget ?? Native)
    const instance = new Native('en-GB', options)
    const auto = options?.numeric === 'auto'
    Object.defineProperty(instance, 'format', {
      configurable: true,
      value: (value: number, unit: Intl.RelativeTimeFormatUnit) => {
        const u = unit.replace(/s$/, '')
        if (auto) {
          const word = REL_AUTO[u]?.[Object.is(value, -0) ? 0 : value]
          if (word) return word
        }
        const n = Math.abs(value)
        const forms = REL[u]
        if (!forms) return String(value)
        return value < 0 || Object.is(value, -0) ? `${n} ${forms.past} წინ` : `${n} ${forms.future}`
      },
    })
    return instance
  }
  const proxy = new Proxy(Native, {
    construct: (_t, args, newTarget) => make(args as ConstructorParameters<typeof Intl.RelativeTimeFormat>, newTarget),
  })
  Object.defineProperty(Intl, 'RelativeTimeFormat', { value: proxy, writable: true, configurable: true })
}

try {
  if (Intl.DateTimeFormat.supportedLocalesOf(['ka-GE']).length === 0) patchDateTimeFormat()
  if (Intl.RelativeTimeFormat.supportedLocalesOf(['ka-GE']).length === 0) patchRelativeTimeFormat()
} catch {
  // подмена не удалась — остаются русские даты, остальное работает
}
