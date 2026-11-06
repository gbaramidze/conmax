import { tr } from '@/lib/tr'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronUp, Copy, FileText, Loader2, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  acceptSummaryItem,
  addDecision,
  addMeetingAction,
  deleteSummary,
  meetingErrorText,
  recordingsQuery,
  requestSummary,
  summariesQuery,
  summaryActive,
  summaryErrorText,
  updateMeeting,
  type MeetingDetail,
  type ParticipantRow,
  type RecordingRow,
  type SummaryRow,
} from '@/features/meetings/api'
import { formatIn } from '@/features/meetings/time'
import { PRIORITY_LABELS } from '@/features/tasks/api'
import { currentLocale } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const STEP_TEXT = {
  queued: tr('В очереди…'),
  transcribing: tr('Расшифровываем запись: до нескольких минут…'),
  summarizing: tr('Пишем итоги по расшифровке…'),
} as const

/**
 * Итоги по записи совещания: расшифровка речи и черновик протокола — краткое содержание, решения, поручения, открытые вопросы.
 * Черновик ничего не публикует: решения и поручения попадают в протокол только по кнопке секретаря.
 */
export function MeetingSummaries({
  m,
  timezone,
  participants,
  canConduct,
  canRun,
  onChanged,
}: {
  m: MeetingDetail
  timezone: string
  participants: ParticipantRow[]
  /** Принимать решения и поручения в протокол может ведущий */
  canConduct: boolean
  /** Запускать обработку и убирать итоги могут и те, кто управляет совещанием */
  canRun: boolean
  /** Принятые решения и поручения меняют протокол: страница перечитывает совещание */
  onChanged: () => Promise<unknown>
}) {
  const { data: recordings } = useQuery(recordingsQuery(m.id, true))
  const { data: summaries } = useQuery(summariesQuery(m.id, true))
  const byRecording = useMemo(() => new Map((summaries ?? []).map((s) => [s.recording_id, s])), [summaries])
  if (!recordings || recordings.length === 0) return null

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-soft" aria-label={tr('Итоги по записи')}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">{tr('Итоги по записи')}</h2>
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">
        {tr('Расшифровка и черновик протокола по записи. Это подсказка: в протокол попадает только то, что вы примете кнопкой, и проверьте имена и сроки, речь распознаётся с ошибками.')}
      </p>
      <ul className="flex flex-col gap-3">
        {recordings.map((r) => (
          <RecordingSummary key={r.id} m={m} r={r} s={byRecording.get(r.id) ?? null} timezone={timezone} participants={participants} canConduct={canConduct} canRun={canRun} onChanged={onChanged} />
        ))}
      </ul>
    </section>
  )
}

function RecordingSummary({
  m,
  r,
  s,
  timezone,
  participants,
  canConduct,
  canRun,
  onChanged,
}: {
  m: MeetingDetail
  r: RecordingRow
  s: SummaryRow | null
  timezone: string
  participants: ParticipantRow[]
  canConduct: boolean
  canRun: boolean
  onChanged: () => Promise<unknown>
}) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['meeting-summaries', m.id] })
  const start = useMutation({
    mutationFn: (reuse: boolean) => requestSummary(r.id, reuse),
    onSettled: refresh,
    onError: (e) => toast.error(meetingErrorText(e, tr('Не удалось запустить обработку записи. Повторите.'))),
  })
  const remove = useMutation({
    mutationFn: () => deleteSummary(s!.id),
    onSuccess: async () => {
      await refresh()
      toast.success(tr('Итоги убраны'))
    },
    onError: (e) => toast.error(meetingErrorText(e, tr('Не удалось убрать итоги.'))),
  })

  const title = `${formatIn(r.created_at, timezone, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${Math.max(1, Math.round(r.duration_sec / 60))} ${tr('мин')}`
  const busy = start.isPending || (s ? summaryActive(s.status) : false)

  return (
    <li className="flex flex-col gap-3 rounded-lg border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 text-sm font-medium">{title}</span>
        {!s && canRun && (
          <Button size="sm" disabled={busy} onClick={() => start.mutate(false)}>
            {start.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {tr('Расшифровать и подготовить итоги')}
          </Button>
        )}
        {s && s.status === 'ready' && canRun && (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => start.mutate(true)}>
              <RotateCcw />
              {tr('Итоги заново')}
            </Button>
            <Button size="icon" variant="ghost" className="size-8" aria-label={tr('Убрать расшифровку и итоги')} disabled={remove.isPending} onClick={() => remove.mutate()}>
              <Trash2 />
            </Button>
          </>
        )}
      </div>

      {s && summaryActive(s.status) && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {STEP_TEXT[s.status as keyof typeof STEP_TEXT]}
        </p>
      )}

      {s && s.status === 'failed' && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3" role="alert">
          <p className="text-sm">{summaryErrorText(s.error)}</p>
          {canRun && (
            <div className="flex flex-wrap gap-2">
              {s.transcript && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => start.mutate(true)}>
                  <RotateCcw />
                  {tr('Повторить итоги')}
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => start.mutate(false)}>
                <RotateCcw />
                {tr('Повторить с расшифровки')}
              </Button>
            </div>
          )}
        </div>
      )}

      {s && s.status === 'ready' && <SummaryBody key={s.finished_at ?? s.id} m={m} s={s} participants={participants} canConduct={canConduct} onChanged={onChanged} refresh={refresh} />}
      {s && s.transcript && s.status !== 'queued' && s.status !== 'transcribing' && <Transcript text={s.transcript} />}
    </li>
  )
}

function SummaryBody({
  m,
  s,
  participants,
  canConduct,
  onChanged,
  refresh,
}: {
  m: MeetingDetail
  s: SummaryRow
  participants: ParticipantRow[]
  canConduct: boolean
  onChanged: () => Promise<unknown>
  refresh: () => Promise<unknown>
}) {
  const res = s.result
  const live = m.status === 'in_progress' || m.status === 'minutes_draft'
  const canAccept = canConduct && live
  const accepted = new Set(s.accepted)
  // исполнитель по названному имени: можно поправить до создания поручения
  const matchUser = (name: string | null) => participants.find((p) => p.user?.full_name === name)?.user_id ?? ''
  const [assignees, setAssignees] = useState<Record<number, string>>(() => Object.fromEntries((res.actions ?? []).map((a, i) => [i, matchUser(a.assignee_name)])))

  const afterAccept = async () => {
    await Promise.all([refresh(), onChanged()])
  }
  const acceptDecision = useMutation({
    mutationFn: async (i: number) => {
      await addDecision(m.id, res.decisions![i]!.text, null)
      await acceptSummaryItem(s.id, `d${i}`)
    },
    onSuccess: afterAccept,
    onError: (e) => toast.error(meetingErrorText(e, tr('Не удалось записать решение.'))),
  })
  const acceptAction = useMutation({
    mutationFn: async (i: number) => {
      const a = res.actions![i]!
      await addMeetingAction({ meetingId: m.id, title: a.title, assignee: assignees[i] || null, dueDate: a.due_date, priority: a.priority })
      await acceptSummaryItem(s.id, `a${i}`)
    },
    onSuccess: afterAccept,
    onError: (e) => toast.error(meetingErrorText(e, tr('Не удалось создать поручение.'))),
  })
  const saveAsSummary = useMutation({
    mutationFn: () => updateMeeting(m.id, { summary: res.summary ?? '' }),
    onSuccess: async () => {
      await onChanged()
      toast.success(tr('Краткое содержание записано в итоги совещания'))
    },
    onError: (e) => toast.error(meetingErrorText(e, tr('Не удалось сохранить.'))),
  })
  const addAll = async () => {
    for (const [i] of (res.decisions ?? []).entries()) if (!accepted.has(`d${i}`)) await acceptDecision.mutateAsync(i).catch(() => undefined)
  }

  const pendingDecisions = (res.decisions ?? []).filter((_, i) => !accepted.has(`d${i}`)).length

  return (
    <div className="flex flex-col gap-4">
      {res.summary && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{tr('Краткое содержание')}</h3>
          <p className="whitespace-pre-line text-sm">{res.summary}</p>
          {canConduct && live && m.summary !== res.summary && (
            <Button size="sm" variant="outline" className="w-fit" disabled={saveAsSummary.isPending} onClick={() => saveAsSummary.mutate()}>
              {tr('Записать как итог совещания')}
            </Button>
          )}
        </div>
      )}

      {(res.topics ?? []).length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{tr('Что обсуждали')}</h3>
          <ul className="flex flex-col gap-2">
            {res.topics!.map((t, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium">{t.title}</span>
                {t.points.length > 0 && (
                  <ul className="mt-0.5 list-disc pl-5 text-muted-foreground">
                    {t.points.map((p, j) => (
                      <li key={j}>{p}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{tr('Предложенные решения')}</h3>
          {canAccept && pendingDecisions > 1 && (
            <Button size="sm" variant="outline" disabled={acceptDecision.isPending} onClick={() => void addAll()}>
              {tr('Записать все')}
            </Button>
          )}
        </div>
        {(res.decisions ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr('Решений в разговоре не нашлось.')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {res.decisions!.map((d, i) => (
              <li key={i} className="flex flex-wrap items-start gap-2 rounded-lg border bg-card p-2.5">
                <p className="min-w-0 flex-1 text-sm">{d.text}</p>
                <AcceptButton done={accepted.has(`d${i}`)} disabled={!canAccept || acceptDecision.isPending} onClick={() => acceptDecision.mutate(i)} label={tr('В решения')} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{tr('Предложенные поручения')}</h3>
        {(res.actions ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr('Поручений в разговоре не нашлось.')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {res.actions!.map((a, i) => (
              <li key={i} className="flex flex-col gap-2 rounded-lg border bg-card p-2.5">
                <p className="text-sm">{a.title}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <select
                    aria-label={tr('Исполнитель')}
                    value={assignees[i] ?? ''}
                    disabled={accepted.has(`a${i}`)}
                    onChange={(e) => setAssignees((cur) => ({ ...cur, [i]: e.target.value }))}
                    className="h-8 max-w-48 rounded-md border bg-background px-2 text-xs text-foreground"
                  >
                    <option value="">{tr('Исполнитель не выбран')}</option>
                    {participants.map((p) => (
                      <option key={p.user_id} value={p.user_id}>
                        {p.user?.full_name}
                      </option>
                    ))}
                  </select>
                  <span>{a.due_date ? tr('до {{date}}', { date: new Date(`${a.due_date}T12:00:00`).toLocaleDateString(currentLocale()) }) : tr('срок не назван')}</span>
                  {a.priority !== 'normal' && <span>{PRIORITY_LABELS[a.priority as keyof typeof PRIORITY_LABELS] ?? a.priority}</span>}
                  <span className="ml-auto" />
                  <AcceptButton done={accepted.has(`a${i}`)} disabled={!canAccept || acceptAction.isPending} onClick={() => acceptAction.mutate(i)} label={tr('Создать поручение')} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(res.questions ?? []).length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{tr('Открытые вопросы')}</h3>
          <ul className="list-disc pl-5 text-sm">
            {res.questions!.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      {!canAccept && canConduct && <p className="text-xs text-muted-foreground">{tr('Записать решения и поручения в протокол можно, пока совещание идёт или протокол в работе.')}</p>}
    </div>
  )
}

function AcceptButton({ done, disabled, onClick, label }: { done: boolean; disabled: boolean; onClick: () => void; label: string }) {
  if (done)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
        <Check className="size-3.5" aria-hidden /> {tr('В протоколе')}
      </span>
    )
  return (
    <Button size="sm" variant="secondary" disabled={disabled} onClick={onClick}>
      {label}
    </Button>
  )
}

/** Расшифровка целиком: свёрнута, чтобы не загромождать страницу; можно найти слово и скопировать. */
function Transcript({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const words = query.trim().toLowerCase()
  const hits = words ? text.toLowerCase().split(words).length - 1 : 0
  return (
    <div className="flex flex-col gap-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-h-9 w-fit items-center gap-1.5 text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
        {open ? <ChevronUp className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
        {tr('Расшифровка')}
      </button>
      {open && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={tr('Найти в расшифровке')}
              placeholder={tr('Найти в расшифровке')}
              className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm sm:max-w-xs"
            />
            {words && <span className="text-xs text-muted-foreground">{hits === 0 ? tr('Не найдено') : tr('Совпадений: {{n}}', { n: hits })}</span>}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(text).then(() => toast.success(tr('Расшифровка скопирована')))
              }}
            >
              <Copy />
              {tr('Копировать')}
            </Button>
          </div>
          <div className={cn('max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-card p-3 text-sm leading-relaxed')}>
            <Highlighted text={text} query={words} />
          </div>
        </div>
      )}
    </div>
  )
}

function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-signal/40 px-0.5">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  )
}
