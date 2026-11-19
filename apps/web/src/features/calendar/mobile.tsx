import { tr } from '@/lib/tr'
import { Calendar1, Check, ChevronDown, Columns3, LayoutGrid, List, Menu, RefreshCw, type LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent } from 'react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { EventLink } from '@/features/calendar/event-link'
import { addDays, dayTitle, daysBetween, inMonth, monthRange, WEEKDAYS, type CalendarView } from '@/features/calendar/dates'
import { KINDS } from '@/features/calendar/kinds'
import type { CalendarEvent, KindId } from '@/features/calendar/types'
import { currentLocale } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Календарь на телефоне — как календарь в самом телефоне: месяц во весь экран с цветными плашками,
 * листание свайпом влево/вправо, меню (гамбургер) с видами «Расписание · День · 3 дня · Месяц», «Обновить» и типами событий.
 */

export type MobileView = 'month' | '3day' | 'day' | 'agenda'
export const toMobileView = (v: CalendarView): MobileView => (v === 'week' ? '3day' : v)

const VIEWS: [MobileView, string, LucideIcon][] = [
  ['agenda', tr('Расписание'), List],
  ['day', tr('День'), Calendar1],
  ['3day', tr('3 дня'), Columns3],
  ['month', tr('Месяц'), LayoutGrid],
]

type ByDay = Map<string, CalendarEvent[]>

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`)
// в грузинском заглавных нет: toUpperCase превращает букву в мтаврули
const cap = (s: string) => (currentLocale().startsWith('ka') ? s : s.charAt(0).toUpperCase() + s.slice(1))
const monthName = (iso: string, today: string) =>
  cap(new Intl.DateTimeFormat(currentLocale(), { month: 'long', timeZone: 'UTC', ...(iso.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) }).format(utc(iso)))
const weekdayShort = (iso: string) => new Intl.DateTimeFormat(currentLocale(), { weekday: 'short', timeZone: 'UTC' }).format(utc(iso)).replace('.', '')

/** Сплошная плашка цвета типа события; просроченное — красным, завершённое — бледным и зачёркнутым. */
const pill = (e: CalendarEvent) =>
  cn('text-white', e.tone === 'overdue' ? 'bg-red-600' : KINDS[e.kind].dot, e.tone === 'done' && 'line-through opacity-50')

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Свайп влево/вправо: содержимое едет за пальцем, после порога уезжает и въезжает следующий период с другой стороны. */
function useSwipe(onShift: (dir: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number } | null>(null)
  const axis = useRef<'x' | 'y' | null>(null)
  const width = useRef(0)
  const [dx, setDx] = useState(0)
  const [animate, setAnimate] = useState(false)

  const end = () => {
    const moved = dx
    const horizontal = axis.current === 'x'
    start.current = null
    axis.current = null
    if (!horizontal) return
    if (Math.abs(moved) < Math.min(80, width.current / 4)) {
      setAnimate(true)
      setDx(0)
      return
    }
    const dir: 1 | -1 = moved < 0 ? 1 : -1
    if (prefersReducedMotion()) {
      setDx(0)
      onShift(dir)
      return
    }
    setAnimate(true)
    setDx(-dir * width.current)
    window.setTimeout(() => {
      onShift(dir)
      setAnimate(false)
      setDx(dir * width.current)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setAnimate(true)
          setDx(0)
        }),
      )
    }, 170)
  }

  return {
    handlers: {
      onTouchStart: (e: TouchEvent<HTMLElement>) => {
        const t = e.touches[0]
        start.current = { x: t.clientX, y: t.clientY }
        axis.current = null
        width.current = e.currentTarget.clientWidth
        setAnimate(false)
      },
      onTouchMove: (e: TouchEvent<HTMLElement>) => {
        if (!start.current) return
        const t = e.touches[0]
        const mx = t.clientX - start.current.x
        const my = t.clientY - start.current.y
        if (!axis.current && Math.hypot(mx, my) > 10) axis.current = Math.abs(mx) > Math.abs(my) ? 'x' : 'y'
        if (axis.current === 'x') setDx(mx)
      },
      onTouchEnd: end,
      onTouchCancel: end,
    },
    style: { transform: dx ? `translateX(${dx}px)` : undefined, transition: animate ? 'transform 170ms ease-out' : 'none' },
  }
}

/** Высота от верха элемента до нижнего меню телефона — календарь занимает весь экран. */
function useFillHeight() {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()
  useLayoutEffect(() => {
    const calc = () => {
      const el = ref.current
      if (!el) return
      const top = el.getBoundingClientRect().top + window.scrollY
      const nav = document.querySelector('[data-bottom-nav]')?.getBoundingClientRect().height ?? 0
      setHeight(Math.max(380, Math.round(window.innerHeight - top - nav - 8)))
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])
  return [ref, height] as const
}

function useElementHeight() {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    setHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [])
  return [ref, height] as const
}

interface Props {
  view: MobileView
  anchor: string
  today: string
  byDay: ByDay
  code: string
  loading: boolean
  /** ошибки загрузки, «фильтры всё скрыли» и т.п. — над сеткой */
  notice?: ReactNode
  /** плавающая кнопка «+» */
  fab?: ReactNode
  kinds: KindId[]
  enabled: Set<KindId>
  toggleKind: (k: KindId) => void
  kindLabels?: Partial<Record<KindId, string>>
  /** переключатель «Только мои» (календарь проекта) */
  mine?: { on: boolean; set: (on: boolean) => void }
  setView: (v: MobileView) => void
  setAnchor: (iso: string | undefined) => void
  shift: (dir: 1 | -1) => void
  onRefresh: () => void
}

export function MobileCalendar(p: Props) {
  const { view, anchor, today } = p
  const [menuOpen, setMenuOpen] = useState(false)
  const [rootRef, height] = useFillHeight()
  const [bodyRef, bodyHeight] = useElementHeight()
  const swipe = useSwipe(p.shift)
  const monthInput = useRef<HTMLInputElement>(null)

  const openMonthPicker = () => {
    const el = monthInput.current
    if (!el) return
    try {
      el.showPicker()
    } catch {
      el.focus()
      el.click()
    }
  }

  return (
    <div ref={rootRef} className="-mx-4 flex flex-col px-2 sm:-mx-6 sm:px-4" style={{ height }}>
      <div className="flex h-12 shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label={tr('Меню календаря')}
          aria-haspopup="dialog"
          className="flex size-11 items-center justify-center rounded-full outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Menu className="size-6" />
        </button>
        <button
          type="button"
          onClick={openMonthPicker}
          aria-label={tr('Выбрать месяц')}
          className="flex min-h-11 min-w-0 items-center gap-1 rounded-md px-1.5 text-xl font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-live="polite"
        >
          <span className="truncate">{monthName(anchor, today)}</span>
          <ChevronDown className="size-5 shrink-0" aria-hidden />
        </button>
        <input
          ref={monthInput}
          type="month"
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute size-px opacity-0"
          value={anchor.slice(0, 7)}
          onChange={(e) => e.target.value && p.setAnchor(`${e.target.value}-01`)}
        />
        {p.loading && <RefreshCw className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label={tr('Загружаем события…')} />}
        <button
          type="button"
          onClick={() => p.setAnchor(undefined)}
          aria-label={tr('Сегодня')}
          title={tr('Сегодня')}
          className="ml-auto flex size-11 items-center justify-center rounded-full outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-7 items-center justify-center rounded-md border-2 border-current text-[12px] font-bold tabular-nums">{Number(today.slice(8))}</span>
        </button>
      </div>

      {p.notice}

      <div ref={bodyRef} className="relative min-h-0 flex-1 overflow-hidden touch-pan-y" {...swipe.handlers}>
        <div className="h-full" style={swipe.style}>
          {view === 'month' && <MonthGrid anchor={anchor} today={today} byDay={p.byDay} height={bodyHeight} onOpenDay={(iso) => { p.setAnchor(iso); p.setView('day') }} />}
          {view === '3day' && <TimeGrid days={[anchor, addDays(anchor, 1), addDays(anchor, 2)]} today={today} byDay={p.byDay} code={p.code} onOpenDay={(iso) => { p.setAnchor(iso); p.setView('day') }} />}
          {view === 'day' && <TimeGrid days={[anchor]} today={today} byDay={p.byDay} code={p.code} />}
          {view === 'agenda' && <Schedule anchor={anchor} today={today} byDay={p.byDay} code={p.code} onOpenDay={(iso) => { p.setAnchor(iso); p.setView('day') }} />}
        </div>
      </div>

      {p.fab}

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 max-w-[85vw] gap-0 p-0">
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle className="text-base">{tr('Календарь')}</SheetTitle>
            <SheetDescription className="sr-only">{tr('Вид календаря и какие события показывать')}</SheetDescription>
          </SheetHeader>
          <CalendarMenu {...p} close={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  )
}

/** Свои названия задают и порядок в меню (личный календарь: задачи, встречи, напоминания). */
function orderKinds(kinds: KindId[], labels?: Partial<Record<KindId, string>>): KindId[] {
  if (!labels) return kinds
  const order = Object.keys(labels)
  const at = (k: KindId) => (order.includes(k) ? order.indexOf(k) : order.length)
  return [...kinds].sort((a, b) => at(a) - at(b))
}

const menuItem =
  'flex min-h-12 w-full items-center gap-4 rounded-r-full pl-5 pr-4 text-left text-[15px] outline-none hover:bg-muted focus-visible:bg-muted'

function CalendarMenu({ view, setView, onRefresh, kinds, enabled, toggleKind, kindLabels, mine, close }: Props & { close: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-2 pr-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      {VIEWS.map(([v, label, Icon]) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => {
            setView(v)
            close()
          }}
          className={cn(menuItem, view === v && 'bg-primary/10 font-semibold')}
        >
          <Icon className="size-5 text-muted-foreground" aria-hidden />
          {label}
        </button>
      ))}
      <div role="separator" className="my-2 ml-5 h-px bg-border" />
      <button
        type="button"
        onClick={() => {
          onRefresh()
          close()
        }}
        className={menuItem}
      >
        <RefreshCw className="size-5 text-muted-foreground" aria-hidden />
        {tr('Обновить')}
      </button>
      <div role="separator" className="my-2 ml-5 h-px bg-border" />
      <p className="px-5 pb-1 text-xs font-medium text-muted-foreground">{tr('Показывать')}</p>
      {orderKinds(kinds, kindLabels).map((k) => {
        const on = enabled.has(k)
        return (
          <label key={k} className={cn(menuItem, 'cursor-pointer has-[:focus-visible]:bg-muted')}>
            <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleKind(k)} />
            <span
              className={cn('flex size-5 shrink-0 items-center justify-center rounded-[4px] border-2', on ? `${KINDS[k].dot} border-transparent text-white` : 'border-muted-foreground/50')}
              aria-hidden
            >
              {on && <Check className="size-3.5" strokeWidth={3} />}
            </span>
            {kindLabels?.[k] ?? KINDS[k].label}
          </label>
        )
      })}
      {mine && (
        <label className={cn(menuItem, 'cursor-pointer has-[:focus-visible]:bg-muted')}>
          <input type="checkbox" className="sr-only" checked={mine.on} onChange={(e) => mine.set(e.target.checked)} />
          <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-[4px] border-2', mine.on ? 'border-transparent bg-primary text-primary-foreground' : 'border-muted-foreground/50')} aria-hidden>
            {mine.on && <Check className="size-3.5" strokeWidth={3} />}
          </span>
          {tr('Только мои')}
        </label>
      )}
    </div>
  )
}

/** Месяц во весь экран: ячейки-карточки, в каждой число и цветные плашки; нажатие на день открывает его. */
function MonthGrid({ anchor, today, byDay, height, onOpenDay }: { anchor: string; today: string; byDay: ByDay; height: number; onOpenDay: (iso: string) => void }) {
  const { from, to } = monthRange(anchor)
  const days = daysBetween(from, to)
  const weeks = days.length / 7
  const head = 26
  const cell = height ? (height - head) / weeks : 90
  const fit = Math.max(1, Math.floor((cell - 32) / 19))
  const todayCol = days.indexOf(today) >= 0 ? days.indexOf(today) % 7 : -1

  return (
    <div className="flex h-full flex-col">
      <div className="grid shrink-0 grid-cols-7 text-center text-[13px] lowercase text-muted-foreground" style={{ height: head }}>
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={cn('pt-0.5', i === todayCol && 'font-semibold text-primary')}>
            {w}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 gap-[3px]" style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}>
        {days.map((iso) => {
          const list = byDay.get(iso) ?? []
          const shown = list.length > fit ? list.slice(0, fit - 1) : list
          const more = list.length - shown.length
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onOpenDay(iso)}
              aria-label={`${dayTitle(iso)}${list.length ? tr(', событий: {{length}}', { length: list.length }) : ''}`}
              className="flex min-w-0 flex-col gap-[2px] overflow-hidden rounded-lg bg-card px-[2px] pt-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:brightness-95"
            >
              <span
                className={cn(
                  'mx-auto mb-0.5 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1 text-[13px] font-medium tabular-nums',
                  iso === today ? 'bg-primary text-primary-foreground' : !inMonth(iso, anchor) && 'text-muted-foreground/60',
                )}
              >
                {Number(iso.slice(8))}
              </span>
              {shown.map((e) => (
                <span key={e.id} className={cn('block shrink-0 truncate rounded-[4px] px-1 text-[11px] leading-[17px]', pill(e))}>
                  {e.title}
                </span>
              ))}
              {more > 0 && <span className="shrink-0 px-1 text-[11px] leading-[17px] text-muted-foreground">+{more}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const HOUR = 52
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

interface Placed {
  e: CalendarEvent
  start: number
  end: number
  lane: number
  lanes: number
}

/** Пересекающиеся по времени события делят ширину колонки. */
function layoutDay(list: CalendarEvent[]): Placed[] {
  const items = list
    .filter((e) => e.time)
    .map((e) => {
      const start = minutes(e.time!)
      const end = e.endTime ? Math.max(minutes(e.endTime), start + 20) : start + 60
      return { e, start, end }
    })
    .sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Placed[] = []
  let cluster: typeof items = []
  let clusterEnd = -1
  const flush = () => {
    const lanes: number[] = []
    const placed = cluster.map((it) => {
      let lane = lanes.findIndex((end) => end <= it.start)
      if (lane < 0) {
        lane = lanes.length
        lanes.push(it.end)
      } else lanes[lane] = it.end
      return { ...it, lane }
    })
    for (const pl of placed) out.push({ ...pl, lanes: lanes.length })
    cluster = []
  }
  for (const it of items) {
    if (cluster.length && it.start >= clusterEnd) {
      flush()
      clusterEnd = -1
    }
    cluster.push(it)
    clusterEnd = Math.max(clusterEnd, it.end)
  }
  if (cluster.length) flush()
  return out
}

function useNowMinutes() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  return now.getHours() * 60 + now.getMinutes()
}

/** День и «3 дня»: часовая шкала, события по времени, без времени — строкой сверху, красная линия «сейчас». */
function TimeGrid({ days, today, byDay, code, onOpenDay }: { days: string[]; today: string; byDay: ByDay; code: string; onOpenDay?: (iso: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  const now = useNowMinutes()
  const key = days.join()
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const hour = days.includes(today) ? Math.max(0, new Date().getHours() - 1) : 8
    el.scrollTop = hour * HOUR
    // только при смене дней, а не каждую минуту
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const allDay = days.map((iso) => (byDay.get(iso) ?? []).filter((e) => !e.time))
  const placed = useMemo(() => days.map((iso) => layoutDay(byDay.get(iso) ?? [])), [key, byDay]) // eslint-disable-line react-hooks/exhaustive-deps
  const cols = { gridTemplateColumns: `2.75rem repeat(${days.length}, minmax(0, 1fr))` }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-card">
      <div className="grid shrink-0 border-b" style={cols}>
        <span />
        {days.map((iso) => {
          const label = (
            <>
              <span className={cn('text-[11px] uppercase', iso === today ? 'text-primary' : 'text-muted-foreground')}>{weekdayShort(iso)}</span>
              <span className={cn('flex size-8 items-center justify-center rounded-full text-lg font-medium tabular-nums', iso === today && 'bg-primary text-primary-foreground')}>
                {Number(iso.slice(8))}
              </span>
            </>
          )
          return onOpenDay ? (
            <button key={iso} type="button" onClick={() => onOpenDay(iso)} aria-label={dayTitle(iso)} className="flex flex-col items-center py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              {label}
            </button>
          ) : (
            <div key={iso} className="flex flex-col items-center py-1.5" aria-label={dayTitle(iso)}>
              {label}
            </div>
          )
        })}
      </div>
      {allDay.some((l) => l.length > 0) && (
        <div className="grid max-h-28 shrink-0 overflow-y-auto border-b py-1" style={cols}>
          <span className="pr-1 pt-0.5 text-right text-[10px] text-muted-foreground">{tr('весь день')}</span>
          {allDay.map((list, i) => (
            <div key={days[i]} className="flex min-w-0 flex-col gap-[2px] px-[2px]">
              {list.map((e) => (
                <EventLink key={e.id} event={e} code={code} className={cn('block truncate rounded-[4px] px-1.5 text-[12px] leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring', pill(e))}>
                  {e.title}
                </EventLink>
              ))}
            </div>
          ))}
        </div>
      )}
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="grid" style={{ ...cols, height: 24 * HOUR }}>
          <div className="relative">
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <span key={h} className="absolute right-1.5 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground" style={{ top: h * HOUR }}>
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {days.map((iso, i) => (
            <div
              key={iso}
              className="relative border-l"
              style={{ backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px ${HOUR}px)` }}
            >
              {placed[i].map(({ e, start, end, lane, lanes }) => (
                <EventLink
                  key={e.id}
                  event={e}
                  code={code}
                  className={cn('absolute overflow-hidden rounded-md px-1.5 py-0.5 text-[12px] leading-tight outline-none ring-1 ring-card focus-visible:ring-2 focus-visible:ring-ring', pill(e))}
                  style={{
                    top: (start / 60) * HOUR,
                    height: Math.max(22, ((end - start) / 60) * HOUR - 2),
                    left: `calc(${(lane / lanes) * 100}% + 1px)`,
                    width: `calc(${100 / lanes}% - 2px)`,
                  }}
                >
                  <span className="block truncate font-medium">{e.title}</span>
                  <span className="block truncate opacity-90">
                    {e.time}
                    {e.endTime ? `–${e.endTime}` : ''}
                  </span>
                </EventLink>
              ))}
              {iso === today && (
                <div className="pointer-events-none absolute inset-x-0 z-10 h-[2px] bg-red-500" style={{ top: (now / 60) * HOUR }} aria-hidden>
                  <span className="absolute -left-1 -top-[4px] size-2.5 rounded-full bg-red-500" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Расписание: дни месяца с событиями (и сегодня), слева число, справа плашки событий. */
function Schedule({ anchor, today, byDay, code, onOpenDay }: { anchor: string; today: string; byDay: ByDay; code: string; onOpenDay: (iso: string) => void }) {
  const { from, to } = monthRange(anchor)
  const days = daysBetween(from, to).filter((iso) => inMonth(iso, anchor) && ((byDay.get(iso)?.length ?? 0) > 0 || iso === today))
  const todayRow = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const row = todayRow.current
    const box = scroller.current
    if (row && box) box.scrollTop = row.offsetTop - 8
  }, [anchor])

  return (
    <div ref={scroller} className="h-full overflow-y-auto overscroll-contain rounded-xl bg-card px-2 py-2">
      {days.length === 0 && <p className="p-4 text-sm text-muted-foreground">{tr('В этом месяце событий нет.')}</p>}
      {days.map((iso) => {
        const list = byDay.get(iso) ?? []
        return (
          <div key={iso} ref={iso === today ? todayRow : undefined} className="flex gap-2 py-1.5">
            <button
              type="button"
              onClick={() => onOpenDay(iso)}
              aria-label={dayTitle(iso)}
              className="flex w-11 shrink-0 flex-col items-center self-start rounded-md pt-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className={cn('text-[11px] lowercase', iso === today ? 'text-primary' : 'text-muted-foreground')}>{weekdayShort(iso)}</span>
              <span className={cn('flex size-8 items-center justify-center rounded-full text-lg font-medium tabular-nums', iso === today && 'bg-primary text-primary-foreground')}>
                {Number(iso.slice(8))}
              </span>
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {list.length === 0 && <p className="py-2 text-sm text-muted-foreground">{tr('Сегодня событий нет')}</p>}
              {list.map((e) => (
                <EventLink key={e.id} event={e} code={code} className={cn('block rounded-lg px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring', pill(e))}>
                  <span className="block truncate text-sm font-medium">{e.title}</span>
                  <span className="block truncate text-xs opacity-90">
                    {e.time ? `${e.time}${e.endTime ? `–${e.endTime}` : ''}` : tr('весь день')}
                    {e.meta ? ` · ${e.meta}` : ''}
                  </span>
                </EventLink>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
