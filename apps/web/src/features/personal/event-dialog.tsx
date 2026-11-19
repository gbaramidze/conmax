import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlignLeft, ChevronLeft, ChevronRight, Clock, MapPin, Type, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/auth-provider'
import { addDays, dayTitle, monthRange, todayIso } from '@/features/calendar/dates'
import { KINDS } from '@/features/calendar/kinds'
import type { CalendarContext, CalendarEvent } from '@/features/calendar/types'
import { groupByDay, useCalendarEvents } from '@/features/calendar/use-calendar'
import { RecipientInput, useAddressBook } from '@/features/mail/composer'
import { accountCanSend, mailAccountQuery, mailErrorText, mailReconnect, sendEventInvite, type MailAddress } from '@/features/mail/api'
import { DeleteBar } from '@/features/personal/dialogs'
import { deletePersonalItem, savePersonalItem, type PersonalItem } from '@/features/personal/api'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

/**
 * Событие — как «Новое событие» в Outlook: слева название, участники, дата и время, место, описание; справа шкала выбранного дня
 * с уже назначенными событиями — блок нового события можно поставить нажатием, перетащить и растянуть.
 * Событие хранится в личном календаре. Участникам уходит приглашение обычным письмом с вашей почты (iCalendar внутри, право
 * Mail.Send): у них оно открывается как встреча «Принять / Отклонить» и ложится в их календарь. Изменение рассылает обновление
 * (новая версия), убранным из списка и при удалении события — отмену. Доступ к календарю Outlook не нужен.
 */

const SOURCES = ['personal', 'my_tasks']
const sameAddr = (a: MailAddress, b: MailAddress) => a.address.toLowerCase() === b.address.toLowerCase()
const STEP = 15
const HOUR = 44

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}
const fromMin = (n: number) => {
  const v = Math.max(0, Math.min(24 * 60 - STEP, Math.round(n)))
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`
}
const snap = (n: number, step = STEP) => Math.round(n / step) * step
const duration = (min: number) => {
  if (min < 60) return tr('{{n}} мин', { n: min })
  const h = min / 60
  return tr('{{n}} ч', { n: Number.isInteger(h) ? h : h.toFixed(1).replace('.', ',') })
}

/** Ближайшие полчаса после «сейчас» — для нового события на сегодня. */
function defaultStart(day: string): string {
  if (day !== todayIso()) return '09:00'
  const now = new Date()
  return fromMin(Math.min(23 * 60, Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 30) * 30))
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-2.5 flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-5" aria-hidden title={label}>
        {icon}
      </span>
      <div className="min-w-0 flex-1 border-b border-input focus-within:border-primary">{children}</div>
    </div>
  )
}

export function EventDialog({ item, date, onClose }: { item: PersonalItem | null; date?: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const initialDay = item?.event_date ?? date ?? todayIso()
  const [title, setTitle] = useState(item?.title ?? '')
  const [day, setDay] = useState(initialDay)
  const [allDay, setAllDay] = useState(item ? !item.start_time : false)
  const [start, setStart] = useState(item?.start_time?.slice(0, 5) ?? defaultStart(initialDay))
  const [end, setEnd] = useState(item?.end_time?.slice(0, 5) ?? fromMin(toMin(item?.start_time?.slice(0, 5) ?? defaultStart(initialDay)) + 30))
  const [place, setPlace] = useState(item?.place ?? '')
  const [body, setBody] = useState(item?.body ?? '')
  const original = useMemo(() => item?.attendees ?? [], [item])
  const [attendees, setAttendees] = useState<MailAddress[]>(original)
  const [confirming, setConfirming] = useState(false)

  const { data: account } = useQuery(mailAccountQuery)
  const canInvite = accountCanSend(account)
  const book = useAddressBook()
  const timeInvalid = !allDay && toMin(end) <= toMin(start)

  // что поменялось с прошлого приглашения: детали — обновление всем, новые участники — приглашение им, убранные — отмена
  const hadInvites = original.length > 0 && !!item?.invited_at
  const added = attendees.filter((a) => !original.some((b) => sameAddr(a, b)))
  const removed = original.filter((a) => !attendees.some((b) => sameAddr(a, b)))
  const changedDetails =
    !item ||
    title.trim() !== item.title ||
    day !== item.event_date ||
    (allDay ? null : start) !== (item.start_time?.slice(0, 5) ?? null) ||
    (allDay ? null : end) !== (item.end_time?.slice(0, 5) ?? null) ||
    place.trim() !== (item.place ?? '') ||
    body !== item.body
  const willInvite = canInvite && attendees.length > 0 && (changedDetails || added.length > 0 || !hadInvites)

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ['personal'] })
    onClose()
  }

  const save = useMutation({
    mutationFn: async () => {
      const bump = hadInvites && (changedDetails || added.length > 0 || removed.length > 0)
      const id = await savePersonalItem({
        id: item?.id,
        kind: 'event',
        title,
        body,
        event_date: day,
        start_time: allDay ? null : start,
        end_time: allDay ? null : end,
        place,
        attendees,
        invite_seq: (item?.invite_seq ?? 0) + (bump ? 1 : 0),
      })
      let sent = 0
      let failed: unknown = null
      if (canInvite) {
        try {
          if (willInvite) {
            // детали не менялись — приглашение только новым участникам
            const onlyAdded = hadInvites && !changedDetails
            sent += (await sendEventInvite({ id, method: 'REQUEST', to: onlyAdded ? added : undefined, update: hadInvites && !onlyAdded })).sent
          }
          if (removed.length > 0 && hadInvites) await sendEventInvite({ id, method: 'CANCEL', to: removed })
        } catch (e) {
          failed = e
        }
      }
      return { sent, failed }
    },
    onSuccess: async ({ sent, failed }) => {
      if (failed) toast.error(tr('Событие сохранено, но приглашения не отправились: {{reason}}', { reason: mailErrorText(failed) }))
      else if (sent > 0) toast.success(tr('Приглашения отправлены: {{n}}', { n: sent }))
      await done()
    },
    onError: () => toast.error(tr('Не удалось сохранить. Проверьте соединение и повторите.')),
  })

  // удаление события с участниками: сначала отмена им (не ушла — событие не удаляем, чтобы встреча у них не «зависла»)
  const remove = useMutation({
    mutationFn: async () => {
      if (item!.attendees.length > 0 && item!.invited_at && canInvite) await sendEventInvite({ id: item!.id, method: 'CANCEL', bump: true })
      await deletePersonalItem(item!.id)
    },
    onSuccess: done,
    onError: (e) => toast.error(tr('Не удалось удалить: {{reason}}', { reason: mailErrorText(e) })),
  })

  const setTimes = (s: string, e: string) => {
    setStart(s)
    setEnd(e)
  }
  // смена начала сдвигает окончание, сохраняя длительность (как в Outlook)
  const changeStart = (s: string) => {
    const len = Math.max(STEP, toMin(end) - toMin(start))
    setTimes(s, fromMin(Math.min(24 * 60 - 1, toMin(s) + len)))
  }

  const submit = () => {
    if (!title.trim() || !day || timeInvalid) return
    save.mutate()
  }
  const pending = save.isPending || remove.isPending

  const startOptions = useMemo(() => withValue(Array.from({ length: 48 }, (_, i) => fromMin(i * 30)), start), [start])
  const endOptions = useMemo(() => {
    const s = toMin(start)
    const list: string[] = []
    for (let m = s + 15; m < 24 * 60; m += m - s < 60 ? 15 : 30) list.push(fromMin(m))
    return withValue(list, end)
  }, [start, end])

  const selectClass = 'h-10 rounded-md bg-transparent px-1 text-base tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm'

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-[min(64rem,calc(100%-2rem))]">
        <DialogHeader className="border-b px-5 py-3.5">
          <DialogTitle>{item ? tr('Событие') : tr('Новое событие')}</DialogTitle>
          <DialogDescription className="sr-only">{tr('Название, участники, время, место и описание события')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid min-h-0 md:grid-cols-[minmax(0,1fr)_19rem]"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="flex min-w-0 flex-col gap-4 p-5">
            <Row icon={<Type />} label={tr('Название')}>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                autoFocus={!item}
                required
                placeholder={tr('Добавить название')}
                aria-label={tr('Название')}
                className="h-11 w-full bg-transparent text-lg outline-none placeholder:text-muted-foreground"
              />
            </Row>

            {(account || attendees.length > 0) && (
              <Row icon={<Users />} label={tr('Участники')}>
                {canInvite ? (
                  <>
                    <RecipientInput label={tr('Пригласить участников')} value={attendees} onChange={setAttendees} book={book} />
                    {attendees.length === 0 && <p className="pb-1.5 text-xs text-muted-foreground">{tr('Пригласить участников: имя или адрес почты')}</p>}
                  </>
                ) : (
                  <p className="flex flex-wrap items-center gap-2 py-2 text-sm text-muted-foreground">
                    {tr('Чтобы приглашать участников, переподключите почту и разрешите отправку писем.')}
                    <Button type="button" size="sm" variant="outline" onClick={() => void mailReconnect().catch((e) => toast.error(mailErrorText(e)))}>
                      {tr('Переподключить почту')}
                    </Button>
                  </p>
                )}
              </Row>
            )}

            <Row icon={<Clock />} label={tr('Дата и время')}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1">
                <DatePicker value={day} onChange={setDay} clearable={false} aria-label={tr('Дата')} className="w-auto border-0 shadow-none" />
                {!allDay && (
                  <span className="flex items-center gap-1">
                    <select aria-label={tr('Начало')} value={start} onChange={(e) => changeStart(e.target.value)} className={selectClass}>
                      {startOptions.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <span aria-hidden>–</span>
                    <select aria-label={tr('Окончание')} value={end} onChange={(e) => setEnd(e.target.value)} className={selectClass} aria-invalid={timeInvalid}>
                      {endOptions.map((t) => (
                        <option key={t} value={t}>
                          {t} ({duration(toMin(t) - toMin(start))})
                        </option>
                      ))}
                    </select>
                  </span>
                )}
                <label className="ml-auto inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
                  {tr('На весь день')}
                </label>
              </div>
              {timeInvalid && <p className="pb-1.5 text-sm text-destructive">{tr('Окончание должно быть позже начала.')}</p>}
            </Row>

            <Row icon={<MapPin />} label={tr('Место')}>
              <input
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                maxLength={200}
                placeholder={tr('Добавить место')}
                aria-label={tr('Место')}
                className="h-11 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
              />
            </Row>

            <div className="flex items-start gap-3">
              <span className="mt-2.5 flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-5" aria-hidden>
                <AlignLeft />
              </span>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} rows={5} placeholder={tr('Описание')} aria-label={tr('Описание')} className="min-h-28 flex-1" />
            </div>

            <p className="text-xs text-muted-foreground">
              {attendees.length > 0
                ? tr('Приглашение уйдёт письмом с вашей почты {{email}}: участники примут его, и встреча появится в их календаре. Ответы придут вам на почту.', { email: account?.email ?? '' })
                : tr('Событие без участников видно только вам; за 10 минут придёт напоминание.')}
            </p>
          </div>

          <DayPanel
            day={day}
            setDay={setDay}
            start={start}
            end={end}
            allDay={allDay}
            title={title}
            ignoreId={item ? `personal-${item.id}` : undefined}
            onTimes={setTimes}
          />

          <div className="border-t px-5 py-3 md:col-span-2">
            {confirming ? (
              <>
                {item && item.attendees.length > 0 && item.invited_at && (
                  <p className="pb-2 text-sm text-muted-foreground">{tr('Участникам уйдёт письмо об отмене встречи.')}</p>
                )}
                <DeleteBar name={item?.title ?? ''} pending={remove.isPending} onConfirm={() => remove.mutate()} onCancel={() => setConfirming(false)} />
              </>
            ) : (
              <DialogFooter>
                {item && (
                  <Button type="button" variant="ghost" className="mr-auto text-destructive" onClick={() => setConfirming(true)}>
                    {tr('Удалить')}
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={onClose}>
                  {tr('Отмена')}
                </Button>
                <Button type="submit" disabled={!title.trim() || !day || timeInvalid || pending}>
                  {willInvite ? (hadInvites ? tr('Сохранить и отправить обновление') : tr('Сохранить и пригласить')) : tr('Сохранить')}
                </Button>
              </DialogFooter>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const withValue = (list: string[], v: string) => (v && !list.includes(v) ? [...list, v].sort() : list)

/** События выбранного дня из личного календаря (свои, Outlook, мои задачи). */
function useDayEvents(day: string): CalendarEvent[] {
  const { session } = useAuth()
  const month = day.slice(0, 7)
  const range = useMemo(() => monthRange(`${month}-01`), [month])
  const ctx: CalendarContext = useMemo(
    () => ({ projectId: '', code: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, userId: session?.user.id ?? '', permissions: [], range }),
    [session?.user.id, range],
  )
  const { events } = useCalendarEvents(ctx, SOURCES)
  return useMemo(() => groupByDay(events).get(day) ?? [], [events, day])
}

/** Шкала дня справа: назначенные события и блок нового события (нажатие ставит, перетаскивание двигает, нижний край растягивает). */
function DayPanel({
  day,
  setDay,
  start,
  end,
  allDay,
  title,
  ignoreId,
  onTimes,
}: {
  day: string
  setDay: (d: string) => void
  start: string
  end: string
  allDay: boolean
  title: string
  ignoreId?: string
  onTimes: (start: string, end: string) => void
}) {
  const events = useDayEvents(day).filter((e) => e.id !== ignoreId)
  const timed = events.filter((e) => e.time)
  const untimed = events.filter((e) => !e.time)
  const scroller = useRef<HTMLDivElement>(null)
  const drag = useRef<{ mode: 'move' | 'resize'; y: number; s: number; e: number } | null>(null)
  const s = toMin(start)
  const e = Math.max(s + STEP, toMin(end))

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = Math.max(0, (s / 60 - 1.5) * HOUR)
    // только при смене дня и первом показе
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day])

  const minutesAt = (clientY: number) => {
    const el = scroller.current!
    const top = el.getBoundingClientRect().top - el.scrollTop
    return ((clientY - top) / HOUR) * 60
  }

  const onGridClick = (ev: ReactMouseEvent<HTMLDivElement>) => {
    if (allDay || drag.current) return
    const ns = snap(minutesAt(ev.clientY) - 15, 30)
    const len = e - s
    const clamped = Math.max(0, Math.min(24 * 60 - len, ns))
    onTimes(fromMin(clamped), fromMin(clamped + len))
  }
  const begin = (mode: 'move' | 'resize') => (ev: ReactPointerEvent<HTMLElement>) => {
    ev.stopPropagation()
    drag.current = { mode, y: ev.clientY, s, e }
    try {
      ev.currentTarget.setPointerCapture(ev.pointerId)
    } catch {
      /* указатель уже отпущен — перетаскивание просто не начнётся */
    }
  }
  const move = (ev: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    const delta = snap(((ev.clientY - d.y) / HOUR) * 60)
    if (d.mode === 'move') {
      const len = d.e - d.s
      const ns = Math.max(0, Math.min(24 * 60 - len, d.s + delta))
      onTimes(fromMin(ns), fromMin(ns + len))
    } else {
      onTimes(fromMin(d.s), fromMin(Math.max(d.s + STEP, Math.min(24 * 60 - 1, d.e + delta))))
    }
  }
  const finish = () => {
    // клик после перетаскивания не должен переставлять блок
    window.setTimeout(() => (drag.current = null), 0)
  }

  return (
    <aside aria-label={tr('Шкала дня')} className="flex h-72 min-h-0 flex-col border-t md:h-auto md:max-h-[34rem] md:border-l md:border-t-0">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b px-2">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={tr('Предыдущий день')} onClick={() => setDay(addDays(day, -1))}>
          <ChevronLeft />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={tr('Следующий день')} onClick={() => setDay(addDays(day, 1))}>
          <ChevronRight />
        </Button>
        <span className="truncate text-sm font-medium">{dayTitle(day)}</span>
      </div>
      {(untimed.length > 0 || allDay) && (
        <div className="flex max-h-20 shrink-0 flex-col gap-0.5 overflow-y-auto border-b px-2 py-1">
          {allDay && <span className="truncate rounded bg-primary px-1.5 text-xs leading-5 text-primary-foreground">{title.trim() || tr('Новое событие')}</span>}
          {untimed.map((x) => (
            <span key={x.id} className={cn('truncate rounded px-1.5 text-xs leading-5 text-white opacity-80', KINDS[x.kind].dot)}>
              {x.title}
            </span>
          ))}
        </div>
      )}
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="relative ml-11 border-l" style={{ height: 24 * HOUR, backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px ${HOUR / 2}px)` }} onClick={onGridClick}>
          {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
            <span key={h} className="absolute -left-11 w-9 -translate-y-1/2 text-right text-[11px] tabular-nums text-muted-foreground" style={{ top: h * HOUR }}>
              {h}:00
            </span>
          ))}
          {timed.map((x) => {
            const xs = toMin(x.time!)
            const xe = x.endTime ? Math.max(toMin(x.endTime), xs + 15) : xs + 60
            return (
              <div
                key={x.id}
                className={cn('pointer-events-none absolute left-1 right-8 overflow-hidden rounded px-1.5 text-[11px] leading-tight text-white opacity-75', KINDS[x.kind].dot)}
                style={{ top: (xs / 60) * HOUR, height: Math.max(16, ((xe - xs) / 60) * HOUR - 1) }}
                title={`${x.time}${x.endTime ? `–${x.endTime}` : ''} ${x.title}`}
              >
                <span className="block truncate">
                  {x.time} {x.title}
                </span>
              </div>
            )
          })}
          {!allDay && (
            <div
              role="slider"
              aria-label={tr('Время события')}
              aria-valuemin={0}
              aria-valuemax={24 * 60}
              aria-valuenow={s}
              aria-valuetext={`${start}–${end}`}
              tabIndex={0}
              onKeyDown={(ev) => {
                const step = ev.key === 'ArrowUp' ? -STEP : ev.key === 'ArrowDown' ? STEP : 0
                if (!step) return
                ev.preventDefault()
                const len = e - s
                const ns = Math.max(0, Math.min(24 * 60 - len, s + step))
                onTimes(fromMin(ns), fromMin(ns + len))
              }}
              onPointerDown={begin('move')}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={finish}
              onClick={(ev) => ev.stopPropagation()}
              className="absolute left-2 right-1 z-10 cursor-grab touch-none select-none overflow-hidden rounded-md bg-primary px-2 py-0.5 text-xs text-primary-foreground shadow-md outline-none ring-2 ring-card focus-visible:ring-ring active:cursor-grabbing"
              style={{ top: (s / 60) * HOUR, height: Math.max(18, ((e - s) / 60) * HOUR) }}
            >
              <span className="block truncate font-semibold tabular-nums">
                {start}–{fromMin(e)}
              </span>
              {(e - s) >= 45 && <span className="block truncate opacity-90">{title.trim() || tr('Новое событие')}</span>}
              <span
                aria-hidden
                onPointerDown={begin('resize')}
                onPointerMove={move}
                onPointerUp={finish}
                onPointerCancel={finish}
                className="absolute inset-x-0 bottom-0 h-2.5 cursor-ns-resize"
              >
                <span className="absolute bottom-0.5 left-1/2 h-1 w-6 -translate-x-1/2 rounded-full bg-primary-foreground/60" />
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
