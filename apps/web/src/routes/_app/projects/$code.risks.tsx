import { useProjectCurrency } from '@/features/projects/currency'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { PageHelp } from '@/components/page-help'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAuth } from '@/features/auth/auth-provider'
import { projectByCodeQuery, projectMembersQuery, myPermissionsQuery } from '@/features/projects/api'
import {
  deleteRisk,
  IMPACT_LABELS,
  isActive,
  PROBABILITY_LABELS,
  RISK_CATEGORIES,
  RISK_RESPONSES,
  RISK_STATUSES,
  riskLevel,
  risksQuery,
  saveRisk,
  type Risk,
  type RiskCategory,
  type RiskInput,
  type RiskResponse,
  type RiskStatus,
} from '@/features/risks/api'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

// Паттерн «Список / Реестр» с матрицей: вероятность × влияние сверху, ниже риски с фильтрами
export const Route = createFileRoute('/_app/projects/$code/risks')({
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([queryClient.ensureQueryData(risksQuery(project.id)), queryClient.ensureQueryData(myPermissionsQuery(project.id)), queryClient.ensureQueryData(projectMembersQuery(project.id))])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем риски…')}</p>,
  component: RisksPage,
})

const GROUPS = ['active', 'closed', 'all'] as const
type Group = (typeof GROUPS)[number]

function RisksPage() {
  const { code } = Route.useParams()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: risks } = useSuspenseQuery(risksQuery(p.id))
  const { data: perms } = useSuspenseQuery(myPermissionsQuery(p.id))
  const { session } = useAuth()
  const userId = session?.user.id
  const canManage = perms.includes('risk.manage')
  const [group, setGroup] = useState<Group>('active')
  const [category, setCategory] = useState<RiskCategory | ''>('')
  const [mine, setMine] = useState(false)
  const [query, setQuery] = useState('')
  const [cell, setCell] = useState<{ p: number; i: number } | null>(null)
  const [editing, setEditing] = useState<Risk | 'new' | null>(null)

  const active = useMemo(() => risks.filter((r) => isActive(r.status)), [risks])
  const grid = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of active) m.set(`${r.probability}-${r.impact}`, (m.get(`${r.probability}-${r.impact}`) ?? 0) + 1)
    return m
  }, [active])
  const high = active.filter((r) => r.score >= 10).length
  const overdue = active.filter((r) => r.review_date && r.review_date < new Date().toLocaleDateString('sv')).length

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return risks
      .filter((r) => (group === 'all' ? true : group === 'active' ? isActive(r.status) : !isActive(r.status)))
      .filter((r) => !category || r.category === category)
      .filter((r) => !mine || r.owner_id === userId)
      .filter((r) => !cell || (r.probability === cell.p && r.impact === cell.i))
      .filter((r) => !q || [r.key, r.title, r.description, r.owner?.full_name, r.mitigation].some((s) => s?.toLowerCase().includes(q)))
      .sort((a, b) => b.score - a.score || (a.review_date ?? '9999').localeCompare(b.review_date ?? '9999'))
  }, [risks, group, category, mine, cell, query, userId])

  const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short' })
  const today = new Date().toLocaleDateString('sv')

  return (
    <div className="flex flex-col gap-4">
      <PageHelp id="risks" title={tr('Что такое реестр рисков')}>
        <p>{tr('Риск — то, что ещё не случилось, но может сорвать сроки или бюджет: задержка поставки, срыв согласования, плохая погода. Для каждого оценивают вероятность и влияние по шкале от 1 до 5; их произведение — оценка риска.')}</p>
        <p>{tr('Матрица показывает, где риски сгущаются: красные клетки — их нужно разбирать в первую очередь. У каждого риска есть владелец, выбранная стратегия (избежать, снизить, передать, принять), меры и срок пересмотра.')}</p>
      </PageHelp>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <section className="flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-soft" aria-label={tr('Матрица рисков')}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">{tr('Матрица рисков')}</h2>
            <span className="text-xs text-muted-foreground">{tr('Активных: {{n}}, высоких и критических: {{h}}', { n: active.length, h: high })}</span>
          </div>
          <div className="grid grid-cols-[auto_repeat(5,minmax(0,1fr))] gap-1 text-center text-[11px] text-muted-foreground">
            {[5, 4, 3, 2, 1].map((pr) => (
              <div key={pr} className="contents">
                <span className="grid place-items-center pr-1" title={PROBABILITY_LABELS[pr - 1]}>
                  {pr}
                </span>
                {[1, 2, 3, 4, 5].map((im) => {
                  const n = grid.get(`${pr}-${im}`) ?? 0
                  const on = cell?.p === pr && cell?.i === im
                  return (
                    <button
                      key={im}
                      type="button"
                      aria-pressed={on}
                      aria-label={tr('Вероятность {{p}}, влияние {{i}}: рисков {{n}}', { p: pr, i: im, n })}
                      onClick={() => setCell(on ? null : { p: pr, i: im })}
                      className={cn('grid aspect-square min-h-9 place-items-center rounded-md text-sm font-semibold tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring', riskLevel(pr * im).cell, on && 'ring-2 ring-foreground')}
                    >
                      {n > 0 ? n : ''}
                    </button>
                  )
                })}
              </div>
            ))}
            <span />
            {[1, 2, 3, 4, 5].map((im) => (
              <span key={im} title={IMPACT_LABELS[im - 1]}>
                {im}
              </span>
            ))}
          </div>
          <p className="text-center text-[11px] text-muted-foreground">{tr('По вертикали вероятность, по горизонтали влияние')}</p>
          {overdue > 0 && <p className="text-xs text-red-700 dark:text-red-300">{tr('Пересмотр просрочен у рисков: {{n}}', { n: overdue })}</p>}
        </section>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label={tr('Найти риск')} placeholder={tr('Название, ключ, владелец')} className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </div>
            <select aria-label={tr('Показать')} value={group} onChange={(e) => setGroup(e.target.value as Group)} className="h-10 rounded-md border bg-background px-2 text-sm">
              <option value="active">{tr('Активные')}</option>
              <option value="closed">{tr('Закрытые')}</option>
              <option value="all">{tr('Все')}</option>
            </select>
            <select aria-label={tr('Категория')} value={category} onChange={(e) => setCategory(e.target.value as RiskCategory | '')} className="h-10 rounded-md border bg-background px-2 text-sm">
              <option value="">{tr('Любая категория')}</option>
              {(Object.keys(RISK_CATEGORIES) as RiskCategory[]).map((c) => (
                <option key={c} value={c}>
                  {RISK_CATEGORIES[c]}
                </option>
              ))}
            </select>
            <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={mine} onChange={(e) => setMine(e.target.checked)} />
              {tr('Мои')}
            </label>
            {cell && (
              <Button size="sm" variant="secondary" onClick={() => setCell(null)}>
                {tr('Клетка {{p}}×{{i}} · сбросить', { p: cell.p, i: cell.i })}
              </Button>
            )}
            {canManage && (
              <Button className="ml-auto" onClick={() => setEditing('new')}>
                <Plus /> {tr('Новый риск')}
              </Button>
            )}
          </div>

          {shown.length === 0 ? (
            <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">
              {risks.length === 0 ? (canManage ? tr('Рисков пока нет. Запишите первый: что может пойти не так на этом проекте.') : tr('Рисков пока нет.')) : tr('По этим условиям рисков нет. Ослабьте фильтры.')}
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {shown.map((r) => {
                const lv = riskLevel(r.score)
                const late = isActive(r.status) && r.review_date && r.review_date < today
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => setEditing(r)} className="flex w-full items-start gap-3 rounded-lg border bg-card p-3 text-left shadow-soft outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
                      <span className={cn('grid size-11 shrink-0 place-items-center rounded-lg text-base font-semibold tabular-nums', lv.className)} title={lv.label}>
                        {r.score}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-x-2">
                          <span className="ident text-xs text-muted-foreground">{r.key}</span>
                          <span className={cn('font-medium', !isActive(r.status) && 'text-muted-foreground line-through')}>{r.title}</span>
                        </span>
                        <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span>{RISK_CATEGORIES[r.category]}</span>
                          <span className="tabular-nums">
                            {tr('вероятность {{p}} × влияние {{i}}', { p: r.probability, i: r.impact })}
                          </span>
                          {r.owner && <span>{r.owner.full_name}</span>}
                          {r.response && <span>{RISK_RESPONSES[r.response]}</span>}
                          {r.review_date && <span className={cn(late && 'font-medium text-red-700 dark:text-red-300')}>{tr('пересмотр {{d}}', { d: dateFmt.format(new Date(`${r.review_date}T12:00:00`)) })}</span>}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs">{RISK_STATUSES[r.status]}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {editing && <RiskDialog projectId={p.id} risk={editing === 'new' ? null : editing} canManage={canManage} onClose={() => setEditing(null)} />}
    </div>
  )
}

function Scale({ label, value, onChange, labels, disabled }: { label: string; value: number; onChange: (n: number) => void; labels: string[]; disabled: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">
        {label}: <span className="font-medium text-foreground">{value} — {labels[value - 1]}</span>
      </span>
      <div className="flex gap-1" role="group" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            aria-pressed={value === n}
            onClick={() => onChange(n)}
            className={cn('h-10 flex-1 rounded-md border text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring', value === n && 'border-primary bg-primary/10')}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}

function RiskDialog({ projectId, risk, canManage, onClose }: { projectId: string; risk: Risk | null; canManage: boolean; onClose: () => void }) {
  const { symbol: cur } = useProjectCurrency(projectId)
  const queryClient = useQueryClient()
  const { data: members } = useSuspenseQuery(projectMembersQuery(projectId))
  const [f, setF] = useState<RiskInput>(() => ({
    id: risk?.id,
    title: risk?.title ?? '',
    description: risk?.description ?? '',
    category: risk?.category ?? 'other',
    probability: risk?.probability ?? 3,
    impact: risk?.impact ?? 3,
    cost_impact: risk?.cost_impact ?? null,
    schedule_impact_days: risk?.schedule_impact_days ?? null,
    owner_id: risk?.owner_id ?? null,
    response: risk?.response ?? null,
    mitigation: risk?.mitigation ?? '',
    trigger_text: risk?.trigger_text ?? '',
    status: risk?.status ?? 'open',
    review_date: risk?.review_date ?? null,
  }))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = <K extends keyof RiskInput>(k: K, v: RiskInput[K]) => setF((cur) => ({ ...cur, [k]: v }))
  const level = riskLevel(f.probability * f.impact)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['risks', projectId] })
  const save = useMutation({
    mutationFn: () => saveRisk(projectId, { ...f, title: f.title.trim() }),
    onSuccess: async () => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ['activity'] })])
      toast.success(risk ? tr('Риск сохранён') : tr('Риск записан'))
      onClose()
    },
    onError: (e) => toast.error((e as { code?: string })?.code === '42501' ? tr('Нет права вести реестр рисков.') : tr('Не удалось сохранить риск. Проверьте поля.')),
  })
  const remove = useMutation({
    mutationFn: () => deleteRisk(risk!.id),
    onSuccess: async () => {
      await refresh()
      toast.success(tr('Риск убран'))
      onClose()
    },
    onError: () => toast.error(tr('Не удалось убрать риск.')),
  })
  const ro = !canManage
  const text = 'rounded-md border bg-background px-3 text-sm disabled:opacity-70'

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{risk ? `${risk.key} · ${tr('риск')}` : tr('Новый риск')}</DialogTitle>
          <DialogDescription>{tr('Что может пойти не так, насколько вероятно и серьёзно, кто отвечает и что делаем.')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (f.title.trim() && !ro) save.mutate()
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="risk-title" className="text-xs text-muted-foreground">
              {tr('Название')}
            </label>
            <input id="risk-title" value={f.title} maxLength={200} required disabled={ro} onChange={(e) => set('title', e.target.value)} className={cn(text, 'h-10')} autoFocus={!risk} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="risk-desc" className="text-xs text-muted-foreground">
              {tr('Описание')}
            </label>
            <textarea id="risk-desc" rows={2} maxLength={4000} disabled={ro} value={f.description} onChange={(e) => set('description', e.target.value)} className={cn(text, 'py-2')} />
          </div>
          <Scale label={tr('Вероятность')} value={f.probability} onChange={(n) => set('probability', n)} labels={PROBABILITY_LABELS} disabled={ro} />
          <Scale label={tr('Влияние')} value={f.impact} onChange={(n) => set('impact', n)} labels={IMPACT_LABELS} disabled={ro} />
          <p className="flex items-center gap-2 text-sm">
            <span className={cn('grid size-9 place-items-center rounded-md font-semibold tabular-nums', level.className)}>{f.probability * f.impact}</span>
            {tr('Оценка риска: {{level}}', { level: level.label })}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="risk-cat" className="text-xs text-muted-foreground">
                {tr('Категория')}
              </label>
              <select id="risk-cat" disabled={ro} value={f.category} onChange={(e) => set('category', e.target.value as RiskCategory)} className={cn(text, 'h-10')}>
                {(Object.keys(RISK_CATEGORIES) as RiskCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {RISK_CATEGORIES[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="risk-status" className="text-xs text-muted-foreground">
                {tr('Статус')}
              </label>
              <select id="risk-status" disabled={ro} value={f.status} onChange={(e) => set('status', e.target.value as RiskStatus)} className={cn(text, 'h-10')}>
                {(Object.keys(RISK_STATUSES) as RiskStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {RISK_STATUSES[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="risk-owner" className="text-xs text-muted-foreground">
                {tr('Владелец')}
              </label>
              <select id="risk-owner" disabled={ro} value={f.owner_id ?? ''} onChange={(e) => set('owner_id', e.target.value || null)} className={cn(text, 'h-10')}>
                <option value="">{tr('Не назначен')}</option>
                {members.map((m) => (
                  <option key={m.user!.id} value={m.user!.id}>
                    {m.user!.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="risk-resp" className="text-xs text-muted-foreground">
                {tr('Стратегия')}
              </label>
              <select id="risk-resp" disabled={ro} value={f.response ?? ''} onChange={(e) => set('response', (e.target.value || null) as RiskResponse | null)} className={cn(text, 'h-10')}>
                <option value="">{tr('Не выбрана')}</option>
                {(Object.keys(RISK_RESPONSES) as RiskResponse[]).map((r) => (
                  <option key={r} value={r}>
                    {RISK_RESPONSES[r]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="risk-cost" className="text-xs text-muted-foreground">
                {tr('Влияние на стоимость, {{cur}}', { cur })}
              </label>
              <input id="risk-cost" inputMode="decimal" disabled={ro} value={f.cost_impact ?? ''} onChange={(e) => set('cost_impact', e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) || 0)} className={cn(text, 'h-10 tabular-nums')} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="risk-days" className="text-xs text-muted-foreground">
                {tr('Влияние на срок, дней')}
              </label>
              <input id="risk-days" inputMode="numeric" disabled={ro} value={f.schedule_impact_days ?? ''} onChange={(e) => set('schedule_impact_days', e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value) || 0)))} className={cn(text, 'h-10 tabular-nums')} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="risk-mit" className="text-xs text-muted-foreground">
              {tr('Меры: что делаем, чтобы риск не наступил или стал меньше')}
            </label>
            <textarea id="risk-mit" rows={2} maxLength={4000} disabled={ro} value={f.mitigation} onChange={(e) => set('mitigation', e.target.value)} className={cn(text, 'py-2')} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="risk-trigger" className="text-xs text-muted-foreground">
              {tr('Триггер: по какому признаку поймём, что риск наступает')}
            </label>
            <input id="risk-trigger" maxLength={1000} disabled={ro} value={f.trigger_text} onChange={(e) => set('trigger_text', e.target.value)} className={cn(text, 'h-10')} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="risk-review" className="text-xs text-muted-foreground">
              {tr('Пересмотреть до')}
            </label>
            <DatePicker id="risk-review" disabled={ro} value={f.review_date ?? ''} onChange={(v) => set('review_date', v || null)} />
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {risk && canManage ? (
              confirmDelete ? (
                <span className="flex gap-1.5">
                  <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
                    {tr('Убрать риск')}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>
                    {tr('Не убирать')}
                  </Button>
                </span>
              ) : (
                <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>
                  {tr('Убрать')}
                </Button>
              )
            ) : (
              <span />
            )}
            <span className="flex gap-1.5">
              <Button type="button" variant="ghost" onClick={onClose}>
                {ro ? tr('Закрыть') : tr('Отмена')}
              </Button>
              {!ro && (
                <Button type="submit" disabled={save.isPending || !f.title.trim()}>
                  {tr('Сохранить')}
                </Button>
              )}
            </span>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
