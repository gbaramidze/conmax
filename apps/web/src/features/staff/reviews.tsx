import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { CalendarClock, Lock, Plus, Star } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'
import {
  RATING_LABELS,
  REVIEW_STATUS_LABELS,
  reviewsQuery,
  saveAssessment,
  saveSelfReview,
  staffError,
  startReview,
  type Employee,
  type Review,
} from '@/features/staff/api'
import { fmtDate, isoInDays, PersonChip, selectCls, todayIso, useStaffAccess } from '@/features/staff/ui'

const statusCls: Record<Review['status'], string> = {
  self: 'bg-signal/25 text-foreground',
  manager: 'bg-primary/10 text-foreground',
  done: 'bg-muted text-muted-foreground',
}

export function StatusBadge({ review }: { review: Review }) {
  const late = review.status !== 'done' && review.due_on < todayIso()
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium', late ? 'bg-destructive/10 text-destructive' : statusCls[review.status])}>
      {REVIEW_STATUS_LABELS[review.status]}
      {late && ` · ${tr('просрочена')}`}
    </span>
  )
}

/** Вкладка «Оценки» раздела: что ждёт меня, оценки моей команды и у кого скоро срок следующей оценки */
export function ReviewsOverview() {
  const { data: reviews } = useSuspenseQuery(reviewsQuery())
  const { me, employees, byId, leads } = useStaffAccess()
  const [starting, setStarting] = useState<Employee | null>(null)

  const myTurn = reviews.filter((r) => (r.status === 'self' && r.user_id === me) || (r.status === 'manager' && r.user_id !== me && (r.reviewer_id === me || leads(r.user_id))))
  const open = reviews.filter((r) => r.status !== 'done' && !myTurn.includes(r))
  const done = reviews.filter((r) => r.status === 'done')
  const soonLimit = isoInDays(45)
  const upcoming = employees
    .filter((e) => leads(e.id) && !reviews.some((r) => r.user_id === e.id && r.status !== 'done'))
    .filter((e) => !e.profile?.next_review_on || e.profile.next_review_on <= soonLimit)
    .sort((a, b) => (a.profile?.next_review_on ?? '0').localeCompare(b.profile?.next_review_on ?? '0'))

  return (
    <div className="flex flex-col gap-6">
      <ReviewTable title={tr('Ждут вас')} empty={tr('Сейчас от вас ничего не ждут.')} rows={myTurn} byId={byId} highlight />
      {upcoming.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{tr('Пора оценить')}</h3>
          <ul className="flex flex-col divide-y rounded-lg border bg-card shadow-soft">
            {upcoming.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <PersonChip person={e} className="min-w-48 flex-1" />
                <span className={cn('flex items-center gap-1.5 text-sm', e.profile?.next_review_on && e.profile.next_review_on < todayIso() ? 'text-destructive' : 'text-muted-foreground')}>
                  <CalendarClock className="size-4" aria-hidden />
                  {e.profile?.next_review_on ? tr('срок {{v1}}', { v1: fmtDate(e.profile.next_review_on) }) : tr('срок не задан')}
                </span>
                <Button size="sm" variant="outline" onClick={() => setStarting(e)}>
                  <Plus /> {tr('Начать оценку')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ReviewTable title={tr('В работе')} empty={tr('Открытых оценок нет.')} rows={open} byId={byId} />
      <ReviewTable title={tr('Завершённые')} empty={tr('Завершённых оценок пока нет.')} rows={done} byId={byId} />
      {starting && <StartReviewDialog person={starting} onClose={() => setStarting(null)} />}
    </div>
  )
}

function ReviewTable({ title, empty, rows, byId, highlight }: { title: string; empty: string; rows: Review[]; byId: Map<string, Employee>; highlight?: boolean }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">
        {title} <span className="font-normal text-muted-foreground">· {rows.length}</span>
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className={cn('flex flex-col divide-y rounded-lg border bg-card shadow-soft', highlight && 'border-signal')}>
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
              <PersonChip person={byId.get(r.user_id)} sub={r.period} className="min-w-48 flex-1" />
              <StatusBadge review={r} />
              <span className="text-sm text-muted-foreground">{tr('до {{v1}}', { v1: fmtDate(r.due_on) })}</span>
              {r.assessment?.rating && r.status === 'done' && <Rating value={r.assessment.rating} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Rating({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm" title={RATING_LABELS[value]}>
      <Star className="size-4 fill-signal text-signal" aria-hidden />
      {value}/5 · <span className="text-muted-foreground">{RATING_LABELS[value]}</span>
    </span>
  )
}

/** Оценки одного сотрудника: текущая (с формой для того, чей шаг) и история */
export function PersonReviews({ person }: { person: Employee }) {
  const { data: reviews } = useSuspenseQuery(reviewsQuery(person.id))
  const { me, leads } = useStaffAccess()
  const [starting, setStarting] = useState(false)
  const canLead = leads(person.id)
  const hasOpen = reviews.some((r) => r.status !== 'done')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {person.profile?.next_review_on
            ? tr('Следующая оценка — {{v1}}. Руководителю придёт напоминание за 2 недели.', { v1: fmtDate(person.profile.next_review_on) })
            : tr('Срок следующей оценки не задан — его можно указать в карточке.')}
        </p>
        {canLead && !hasOpen && (
          <Button size="sm" onClick={() => setStarting(true)}>
            <Plus /> {tr('Начать оценку')}
          </Button>
        )}
      </div>
      {reviews.length === 0 && <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{tr('Оценок ещё не было.')}</p>}
      {reviews.map((r) => (
        <ReviewCard key={r.id} review={r} isSelf={person.id === me} canLead={canLead || r.reviewer_id === me} />
      ))}
      {starting && <StartReviewDialog person={person} onClose={() => setStarting(false)} />}
    </div>
  )
}

function ReviewCard({ review: r, isSelf, canLead }: { review: Review; isSelf: boolean; canLead: boolean }) {
  const qc = useQueryClient()
  const { byId } = useStaffAccess()
  const [selfText, setSelfText] = useState(r.self_text)
  const [mText, setMText] = useState(r.assessment?.manager_text ?? '')
  const [rating, setRating] = useState<number | null>(r.assessment?.rating ?? null)
  const [goals, setGoals] = useState(r.assessment?.goals ?? '')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['staff'] })

  const saveSelf = useMutation({
    mutationFn: (submit: boolean) => saveSelfReview(r.id, selfText, submit),
    onSuccess: (_, submit) => {
      toast.success(submit ? tr('Самооценка отправлена руководителю') : tr('Черновик сохранён'))
      refresh()
    },
    onError: (e) => toast.error(staffError(e)),
  })
  const assess = useMutation({
    mutationFn: (share: boolean) => saveAssessment(r.id, { text: mText, rating, goals }, share),
    onSuccess: (_, share) => {
      toast.success(share ? tr('Итоги отправлены сотруднику') : tr('Черновик сохранён'))
      refresh()
    },
    onError: (e) => toast.error(staffError(e)),
  })

  const selfEditable = isSelf && r.status === 'self'
  const managerEditable = canLead && !isSelf && r.status !== 'done'
  const reviewer = r.reviewer_id ? byId.get(r.reviewer_id) : undefined

  return (
    <article className="flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-soft">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="font-medium">{r.period}</h3>
        <StatusBadge review={r} />
        <span className="text-sm text-muted-foreground">{tr('срок {{v1}}', { v1: fmtDate(r.due_on) })}</span>
        {reviewer && <span className="text-sm text-muted-foreground">{tr('оценивает {{v1}}', { v1: reviewer.full_name })}</span>}
      </header>

      <section className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">{tr('Самооценка сотрудника')}</h4>
        {selfEditable ? (
          <>
            <Textarea value={selfText} onChange={(e) => setSelfText(e.target.value)} rows={5} maxLength={8000} aria-label={tr('Самооценка')} placeholder={tr('Что получилось за период, что нет, чему научились, какая помощь нужна')} />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => saveSelf.mutate(false)} disabled={saveSelf.isPending}>
                {tr('Сохранить черновик')}
              </Button>
              <Button size="sm" onClick={() => saveSelf.mutate(true)} disabled={saveSelf.isPending || !selfText.trim()}>
                {tr('Отправить руководителю')}
              </Button>
            </div>
          </>
        ) : r.self_submitted_at ? (
          <p className="whitespace-pre-wrap text-sm">{r.self_text || '—'}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{tr('Сотрудник ещё не отправил самооценку.')}</p>
        )}
      </section>

      {(managerEditable || r.assessment) && (
        <section className="flex flex-col gap-2 border-t pt-3">
          <h4 className="flex items-center gap-1.5 text-sm font-medium">
            {tr('Оценка руководителя')}
            {managerEditable && (
              <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                <Lock className="size-3" aria-hidden /> {tr('сотрудник увидит после «Поделиться итогами»')}
              </span>
            )}
          </h4>
          {managerEditable ? (
            <div className="flex flex-col gap-3">
              <Textarea value={mText} onChange={(e) => setMText(e.target.value)} rows={5} maxLength={8000} aria-label={tr('Оценка руководителя')} placeholder={tr('Результаты, сильные стороны, что улучшить')} />
              <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
                <label className="flex flex-col gap-1 text-sm">
                  {tr('Итоговая оценка')}
                  <select value={rating ?? ''} onChange={(e) => setRating(e.target.value ? Number(e.target.value) : null)} className={selectCls}>
                    <option value="">{tr('— не выставлена —')}</option>
                    {[5, 4, 3, 2, 1].map((n) => (
                      <option key={n} value={n}>
                        {n} — {RATING_LABELS[n]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {tr('Цели на следующий период')}
                  <Textarea value={goals} onChange={(e) => setGoals(e.target.value)} rows={2} maxLength={4000} />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => assess.mutate(false)} disabled={assess.isPending}>
                  {tr('Сохранить черновик')}
                </Button>
                <Button size="sm" onClick={() => assess.mutate(true)} disabled={assess.isPending || !rating}>
                  {tr('Поделиться итогами')}
                </Button>
              </div>
            </div>
          ) : r.assessment ? (
            <div className="flex flex-col gap-2 text-sm">
              {r.assessment.rating && <Rating value={r.assessment.rating} />}
              {r.assessment.manager_text && <p className="whitespace-pre-wrap">{r.assessment.manager_text}</p>}
              {r.assessment.goals && (
                <p className="whitespace-pre-wrap">
                  <span className="font-medium">{tr('Цели')}: </span>
                  {r.assessment.goals}
                </p>
              )}
            </div>
          ) : null}
        </section>
      )}
    </article>
  )
}

export function StartReviewDialog({ person, onClose }: { person: Employee; onClose: () => void }) {
  const qc = useQueryClient()
  const { employees, me } = useStaffAccess()
  const [period, setPeriod] = useState(() => todayIso().slice(0, 4))
  const [due, setDue] = useState(() => (person.profile?.next_review_on && person.profile.next_review_on > todayIso() ? person.profile.next_review_on : isoInDays(21)))
  const [reviewer, setReviewer] = useState(person.profile?.manager_id ?? me)
  const start = useMutation({
    mutationFn: () => startReview(person.id, period.trim(), due, reviewer || null),
    onSuccess: () => {
      toast.success(tr('Оценка начата — {{v1}} получит уведомление', { v1: person.full_name }))
      void qc.invalidateQueries({ queryKey: ['staff'] })
      onClose()
    },
    onError: (e) => toast.error(staffError(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Оценка: {{v1}}', { v1: person.full_name })}</DialogTitle>
          <DialogDescription>{tr('Сначала сотрудник заполняет самооценку, затем оценивающий пишет свою часть и делится итогами.')}</DialogDescription>
        </DialogHeader>
        <form
          id="start-review"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            start.mutate()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rv-period">{tr('Период')}</Label>
            <Input id="rv-period" value={period} onChange={(e) => setPeriod(e.target.value)} maxLength={60} required placeholder={tr('например, 2026 или 1-е полугодие 2026')} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rv-due">{tr('Завершить до')}</Label>
            <DatePicker id="rv-due" value={due} onChange={setDue} min={todayIso()} clearable={false} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rv-reviewer">{tr('Оценивает')}</Label>
            <select id="rv-reviewer" value={reviewer} onChange={(e) => setReviewer(e.target.value)} className={selectCls}>
              {employees
                .filter((e) => e.id !== person.id)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
            </select>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button type="submit" form="start-review" disabled={!period.trim() || !due || start.isPending}>
            {tr('Начать')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
