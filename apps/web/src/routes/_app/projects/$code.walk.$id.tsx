import { BackButton } from '@/components/app-shell/back-button'
import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { Camera, CheckCircle2, ChevronLeft, Minus, Plus, ShieldCheck } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { postComment } from '@/features/activity/api'
import { useAuth } from '@/features/auth/auth-provider'
import { disciplinesQuery } from '@/features/disciplines/api'
import { locationLabel, locationsQuery } from '@/features/locations/api'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { reasonCodesQuery } from '@/features/tasks/api'
import { DEFAULT_DISCIPLINE_STYLE, DISCIPLINE_STYLES } from '@/features/tasks/api'
import {
  checkVerdict,
  clearWalkResult,
  expectedItemsQuery,
  formatQty,
  organizationsListQuery,
  percent,
  saveWalkResult,
  submitWalk,
  toleranceOf,
  WALK_ERROR_TEXT,
  WalkError,
  walkChecksQuery,
  walkQuery,
  walkResultsQuery,
  type CheckRow,
  type Tolerance,
  type WalkResultRow,
  type WorkItemRow,
} from '@/features/volumes/api'
import { VerdictBadge } from '@/features/volumes/badges'

// Паттерн «Форма»: пошаговое заполнение чек-листа ожидаемых работ
export const Route = createFileRoute('/_app/projects/$code/walk/$id')({
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) throw notFound()
    const walk = await queryClient.ensureQueryData(walkQuery(params.id))
    if (!walk) throw notFound()
    await Promise.all([
      queryClient.ensureQueryData(expectedItemsQuery(project.id, walk.location_path, walk.kind)),
      queryClient.ensureQueryData(walkResultsQuery(walk.id)),
      queryClient.ensureQueryData(locationsQuery(project.id)),
      queryClient.ensureQueryData(disciplinesQuery(project.id)),
      queryClient.ensureQueryData(organizationsListQuery),
      queryClient.ensureQueryData(reasonCodesQuery),
    ])
  },
  notFoundComponent: () => <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{tr('Обход не найден или у вас нет к нему доступа.')}</p>,
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем обход…')}</p>,
  component: WalkPage,
})

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] } as JSONContent

function WalkPage() {
  const { code, id } = Route.useParams()
  const queryClient = useQueryClient()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: walk } = useSuspenseQuery(walkQuery(id))
  const w = walk!
  const isCheck = w.kind === 'check'
  const { data: items } = useSuspenseQuery(expectedItemsQuery(p.id, w.location_path, w.kind))
  const { data: results } = useSuspenseQuery(walkResultsQuery(w.id))
  const { data: locations } = useSuspenseQuery(locationsQuery(p.id))
  const { data: orgs } = useSuspenseQuery(organizationsListQuery)
  const isDraft = w.status === 'draft'
  const { data: checks } = useQuery({ ...walkChecksQuery(w.id), enabled: isCheck && !isDraft })
  const tolerance = useMemo(() => toleranceOf(p.settings), [p.settings])

  const resultOf = useMemo(() => new Map(results.map((r) => [r.work_item_id, r])), [results])
  const checkOf = useMemo(() => new Map((checks ?? []).map((c) => [c.work_item_id, c])), [checks])
  const orgName = useMemo(() => new Map(orgs.map((o) => [o.id, o.name])), [orgs])
  const filled = items.filter((i) => resultOf.has(i.id)).length
  const total = items.length
  const missing = total - filled
  const verdictCounts = useMemo(() => {
    const list = checks ?? []
    return { match: list.filter((c) => c.verdict === 'match').length, bad: list.filter((c) => c.verdict !== 'match').length }
  }, [checks])

  const groups = useMemo(() => {
    const map = new Map<string, WorkItemRow[]>()
    for (const i of items) map.set(i.contractor_org_id ?? '', [...(map.get(i.contractor_org_id ?? '') ?? []), i])
    return [...map].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : (orgName.get(a) ?? '').localeCompare(orgName.get(b) ?? '', currentLocale())))
  }, [items, orgName])

  const refreshResults = () => queryClient.invalidateQueries({ queryKey: ['walk-results', w.id] })

  const submit = useMutation({
    mutationFn: () => submitWalk(w.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['walk', w.id] }),
        queryClient.invalidateQueries({ queryKey: ['work-items'] }),
        queryClient.invalidateQueries({ queryKey: ['walks'] }),
        queryClient.invalidateQueries({ queryKey: ['walk-expected'] }),
        queryClient.invalidateQueries({ queryKey: ['activity'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['checks'] }),
      ])
      toast.success(isCheck ? tr('Проверка завершена') : tr('Обход завершён'))
    },
    onError: (e) => toast.error(e instanceof WalkError ? (WALK_ERROR_TEXT[e.code] ?? tr('Не удалось завершить.')) : tr('Не удалось завершить.')),
  })

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <BackButton fallback={
        <Button asChild variant="ghost" size="sm">
          <Link to="/projects/$code/walk" params={{ code }}>
            <ChevronLeft />{tr('Обходы')}</Link>
        </Button>
} />
      </div>

      <header className="flex flex-col gap-2 rounded-lg border bg-card p-4 shadow-soft">
        <div className="flex items-center gap-2">
          <span className="ident rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{w.location_path}</span>
          <h2 className="min-w-0 truncate text-lg font-semibold">{locationLabel(w.location_path, locations)}</h2>
        </div>
        {isCheck && (
          <p className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-4" aria-hidden />{tr('Независимая проверка')}</p>
        )}
        {isCheck && isDraft && (
          <p className="text-sm text-muted-foreground">{tr('Укажите, сколько всего сделано на месте. Заявленное откроется после ввода.')}</p>
        )}
        {isDraft ? (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{tr('Заполнено')}{' '}{filled}{tr('из')}{' '}{total}
              </span>
              {missing > 0 ? <span className="text-muted-foreground">{tr('осталось')}{' '}{missing}</span> : <span className="text-green-700 dark:text-green-300">{tr('всё заполнено')}</span>}
            </div>
            <div
              role="progressbar"
              aria-valuenow={filled}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-label={tr('Заполнено позиций обхода')}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full rounded-full bg-signal transition-[width]" style={{ width: total ? `${(filled / total) * 100}%` : '0%' }} />
            </div>
          </>
        ) : isCheck ? (
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-green-700 dark:text-green-300" aria-hidden />{tr('Проверка завершена: совпало')}{' '}{verdictCounts.match}{tr(', расхождений')}{' '}{verdictCounts.bad}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300">
            <CheckCircle2 className="size-4" /> {w.status === 'approved' ? tr('Обход завершён, факт принят') : tr('Обход завершён, факт ждёт подтверждения')}
          </p>
        )}
      </header>

      {total === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">
          {isCheck
            ? tr('В этом месте пока ничего не заявлено, проверять нечего.')
            : isDraft
              ? tr('В этом месте нет незавершённых позиций плана. Если работы здесь идут, попросите ПТО или руководителя внести план объёмов.')
              : tr('Позиции этого обхода выполнены и больше не ожидаются.')}
        </div>
      ) : (
        groups.map(([orgId, list]) => (
          <section key={orgId || 'none'} className="flex flex-col gap-2" aria-label={orgName.get(orgId) ?? tr('Без подрядчика')}>
            <h3 className="px-1 text-sm font-semibold">{orgId ? orgName.get(orgId) : tr('Без подрядчика')}</h3>
            {list.map((item) =>
              isCheck ? (
                <CheckCard
                  key={item.id}
                  item={item}
                  result={resultOf.get(item.id)}
                  check={checkOf.get(item.id)}
                  walkId={w.id}
                  projectId={p.id}
                  tolerance={tolerance}
                  readOnly={!isDraft}
                  onChanged={refreshResults}
                />
              ) : (
                <ItemCard
                  key={item.id}
                  item={item}
                  result={resultOf.get(item.id)}
                  walkId={w.id}
                  projectId={p.id}
                  locations={locations}
                  readOnly={!isDraft}
                  onChanged={refreshResults}
                />
              ),
            )}
          </section>
        ))
      )}

      {isDraft && total > 0 && (
        <div className="sticky bottom-20 z-10 flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-lg lg:bottom-4">
          <Button size="lg" disabled={missing > 0 || submit.isPending} onClick={() => submit.mutate()}>
            <CheckCircle2 /> {submit.isPending ? tr('Завершаем…') : isCheck ? tr('Завершить проверку') : tr('Завершить обход')}
          </Button>
          {missing > 0 && <p className="text-center text-xs text-muted-foreground">{tr('Заполните ещё позиций:')}{' '}{missing}</p>}
        </div>
      )}
      {!isDraft && isCheck && verdictCounts.bad > 0 && (
        <Button asChild size="lg">
          <Link to="/projects/$code/checks" params={{ code }}>{tr('Разобрать расхождения:')}{' '}{verdictCounts.bad}
          </Link>
        </Button>
      )}
      {!isDraft && (
        <Button asChild variant="outline" size="lg">
          <Link to="/projects/$code/volumes" params={{ code }}>{tr('Посмотреть выполнение')}</Link>
        </Button>
      )}
    </div>
  )
}

type Mode = 'progress' | 'no_work' | 'blocked' | null

function ItemCard({
  item,
  result,
  walkId,
  projectId,
  locations,
  readOnly,
  onChanged,
}: {
  item: WorkItemRow
  result: WalkResultRow | undefined
  walkId: string
  projectId: string
  locations: Parameters<typeof locationLabel>[1]
  readOnly: boolean
  onChanged: () => Promise<unknown>
}) {
  const { tenantId } = useAuth()
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(projectId))
  const { data: reasons } = useSuspenseQuery(reasonCodesQuery)
  const { data: disciplineRows } = useSuspenseQuery(disciplinesQuery(projectId))
  const discipline = disciplineRows.find((d) => d.id === item.discipline_id)

  const remaining = Math.max(0, item.planned_qty - item.done_qty - item.pending_qty)
  const step = remaining >= 100 ? 10 : 1
  const [mode, setMode] = useState<Mode>(null)
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const camera = useRef<HTMLInputElement>(null)

  const donePct = percent(item.done_qty + item.pending_qty, item.planned_qty)
  const entered = Number(qty.replace(',', '.'))
  const over = mode === 'progress' && entered > remaining

  const save = useMutation({
    mutationFn: (v: { result: 'progress' | 'no_work' | 'blocked'; qty?: number; reason?: string; comment?: string }) =>
      saveWalkResult({ walkId, itemId: item.id, result: v.result, qty: v.qty, reasonCode: v.reason, comment: v.comment }),
    onSuccess: async () => {
      setMode(null)
      await onChanged()
    },
    onError: (e) => toast.error(e instanceof WalkError ? (WALK_ERROR_TEXT[e.code] ?? tr('Не удалось сохранить.')) : tr('Не удалось сохранить.')),
  })
  const clear = useMutation({
    mutationFn: () => clearWalkResult(walkId, item.id),
    onSuccess: onChanged,
  })

  const photo = useMutation({
    mutationFn: async (file: File) => {
      const visibility = permissions.includes('comment.internal.create') ? 'internal' : 'external'
      await postComment({ entity: { type: 'work_item', id: item.id }, projectId, tenantId: tenantId!, body: EMPTY_DOC, visibility, files: [file] })
    },
    onSuccess: () => toast.success(tr('Фото сохранено')),
    onError: () => toast.error(tr('Не удалось сохранить фото. Попробуйте ещё раз.')),
  })

  const reasonName = (c: string | null) => reasons.find((r) => r.code === c)?.name ?? c

  const chip = result && (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
        result.result === 'progress'
          ? 'bg-green-500/10 text-green-700 dark:text-green-300'
          : result.result === 'blocked'
            ? 'bg-red-500/10 text-red-700 dark:text-red-300'
            : 'bg-muted text-muted-foreground'
      }`}
    >
      {result.result === 'progress' && tr('Сделано +{{v1}} {{unit}}', { v1: formatQty(result.qty ?? 0), unit: item.unit })}
      {result.result === 'no_work' && tr('Не работали')}
      {result.result === 'blocked' && tr('Не удалось: {{v1}}', { v1: reasonName(result.reason_code) })}
    </span>
  )

  return (
    <article className={`flex flex-col gap-3 rounded-lg border bg-card p-3.5 shadow-soft ${result ? 'border-l-4 border-l-green-500' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-medium">{item.name}</h4>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {discipline && (
              <span className={`ident rounded px-1.5 py-0.5 font-medium ${(discipline.color && DISCIPLINE_STYLES[discipline.color]) || DEFAULT_DISCIPLINE_STYLE}`}>{discipline.code}</span>
            )}
            <span className="ident">{item.location_path}</span>
            <span className="hidden sm:inline">{locationLabel(item.location_path, locations)}</span>
          </p>
        </div>
        {!readOnly && (
          <>
            <input
              ref={camera}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) photo.mutate(f)
                if (camera.current) camera.current.value = ''
              }}
            />
            <Button type="button" size="icon" variant="outline" aria-label={tr('Снять фото: {{name}}', { name: item.name })} disabled={photo.isPending} onClick={() => camera.current?.click()}>
              <Camera />
            </Button>
          </>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div role="progressbar" aria-valuenow={donePct} aria-valuemin={0} aria-valuemax={100} aria-label={tr('Выполнено {{donePct}}%', { donePct })} className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-green-500" style={{ width: `${donePct}%` }} />
        </div>
        <p className="text-sm text-muted-foreground">{tr('Сделано')}{' '}{formatQty(item.done_qty + item.pending_qty)}{tr('из')}{' '}{formatQty(item.planned_qty)} {item.unit}{tr('· осталось')}{' '}{formatQty(remaining)}
        </p>
      </div>

      {result && mode === null && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {chip}
          {!readOnly && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => { setMode(result.result as Mode); setQty(result.qty ? String(result.qty) : ''); setReason(result.reason_code ?? ''); setComment(result.comment ?? '') }}>{tr('Изменить')}</Button>
              <Button size="sm" variant="ghost" disabled={clear.isPending} onClick={() => clear.mutate()}>{tr('Сбросить')}</Button>
            </div>
          )}
        </div>
      )}

      {!readOnly && !result && mode === null && (
        <div className="grid grid-cols-3 gap-2">
          <Button type="button" onClick={() => { setMode('progress'); setQty('') }}>{tr('Сделано')}</Button>
          <Button type="button" variant="outline" disabled={save.isPending} onClick={() => save.mutate({ result: 'no_work' })}>{tr('Не работали')}</Button>
          <Button type="button" variant="outline" onClick={() => setMode('blocked')}>{tr('Не удалось')}</Button>
        </div>
      )}

      {!readOnly && mode === 'progress' && (
        <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3">
          <Label htmlFor={`qty-${item.id}`}>{tr('Сколько сделано с прошлого обхода,')}{' '}{item.unit}</Label>
          <div className="flex items-center gap-2">
            <Button type="button" size="icon-lg" variant="outline" aria-label={tr('Меньше')} onClick={() => setQty(String(Math.max(0, (Number(qty.replace(',', '.')) || 0) - step)))}>
              <Minus />
            </Button>
            <Input
              id={`qty-${item.id}`}
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              autoFocus
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="h-14 flex-1 text-center text-2xl font-semibold md:h-12"
            />
            <Button type="button" size="icon-lg" variant="outline" aria-label={tr('Больше')} onClick={() => setQty(String((Number(qty.replace(',', '.')) || 0) + step))}>
              <Plus />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {[10, 50].map((n) => (
              <Button key={n} type="button" size="sm" variant="outline" onClick={() => setQty(String((Number(qty.replace(',', '.')) || 0) + n))}>
                +{n}
              </Button>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={() => setQty(String(remaining))}>{tr('Всё остальное:')}{' '}{formatQty(remaining)}
            </Button>
          </div>
          {over && <p className="text-sm text-amber-700 dark:text-amber-300">{tr('Это больше, чем осталось по плану (')}{formatQty(remaining)} {item.unit}{tr('). Проверьте число.')}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setMode(null)}>{tr('Отмена')}</Button>
            <Button type="button" className="flex-1" disabled={!(entered > 0) || save.isPending} onClick={() => save.mutate({ result: 'progress', qty: entered })}>{tr('Записать')}</Button>
          </div>
        </div>
      )}

      {!readOnly && mode === 'blocked' && (
        <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`reason-${item.id}`}>{tr('Почему не удалось')}</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id={`reason-${item.id}`} className="w-full">
                <SelectValue placeholder={tr('Выберите причину')} />
              </SelectTrigger>
              <SelectContent>
                {reasons.map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`comment-${item.id}`}>{tr('Комментарий')}{reason === 'other' ? '' : tr(' (необязательно)')}</Label>
            <Textarea id={`comment-${item.id}`} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} className="text-base md:text-sm" />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setMode(null)}>{tr('Отмена')}</Button>
            <Button
              type="button"
              className="flex-1"
              disabled={!reason || (reason === 'other' && !comment.trim()) || save.isPending}
              onClick={() => save.mutate({ result: 'blocked', reason, comment })}
            >{tr('Записать')}</Button>
          </div>
        </div>
      )}
    </article>
  )
}

type CheckMode = 'observe' | 'blocked' | null

/** Карточка проверки: слепой ввод итога на месте; заявленное и вердикт показываются только после ввода. */
function CheckCard({
  item,
  result,
  check,
  walkId,
  projectId,
  tolerance,
  readOnly,
  onChanged,
}: {
  item: WorkItemRow
  result: WalkResultRow | undefined
  check: CheckRow | undefined
  walkId: string
  projectId: string
  tolerance: Tolerance
  readOnly: boolean
  onChanged: () => Promise<unknown>
}) {
  const { tenantId } = useAuth()
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(projectId))
  const { data: reasons } = useSuspenseQuery(reasonCodesQuery)
  const [mode, setMode] = useState<CheckMode>(null)
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const camera = useRef<HTMLInputElement>(null)

  const entered = qty.trim() === '' ? NaN : Number(qty.replace(',', '.'))
  const step = item.planned_qty >= 100 ? 10 : 1
  const reported = item.done_qty + item.pending_qty

  const save = useMutation({
    mutationFn: (v: { result: 'observed' | 'blocked'; qty?: number; reason?: string; comment?: string }) =>
      saveWalkResult({ walkId, itemId: item.id, result: v.result, qty: v.qty, reasonCode: v.reason, comment: v.comment }),
    onSuccess: async () => {
      setMode(null)
      await onChanged()
    },
    onError: (e) => toast.error(e instanceof WalkError ? (WALK_ERROR_TEXT[e.code] ?? tr('Не удалось сохранить.')) : tr('Не удалось сохранить.')),
  })
  const clear = useMutation({
    mutationFn: () => clearWalkResult(walkId, item.id),
    onSuccess: onChanged,
  })
  const photo = useMutation({
    mutationFn: async (file: File) => {
      const visibility = permissions.includes('comment.internal.create') ? 'internal' : 'external'
      await postComment({ entity: { type: 'work_item', id: item.id }, projectId, tenantId: tenantId!, body: EMPTY_DOC, visibility, files: [file] })
    },
    onSuccess: () => toast.success(tr('Фото сохранено')),
    onError: () => toast.error(tr('Не удалось сохранить фото. Попробуйте ещё раз.')),
  })

  const observed = result?.result === 'observed' ? (result.qty ?? 0) : null
  // после завершения — вердикт сервера; в черновике — предварительный по тем же правилам
  const verdict = check ? check.verdict : observed !== null ? checkVerdict(item.planned_qty, reported, observed, tolerance) : null
  const shownReported = check ? check.reported_qty : reported
  const blockedReason = reasons.find((r) => r.code === result?.reason_code)?.name ?? result?.reason_code

  return (
    <article className={`flex flex-col gap-3 rounded-lg border bg-card p-3.5 shadow-soft ${result ? 'border-l-4 border-l-green-500' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-medium">{item.name}</h4>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="ident">{item.location_path}</span>
            <span>{tr('План:')}{' '}{formatQty(item.planned_qty)} {item.unit}</span>
          </p>
        </div>
        {!readOnly && (
          <>
            <input
              ref={camera}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) photo.mutate(f)
                if (camera.current) camera.current.value = ''
              }}
            />
            <Button type="button" size="icon" variant="outline" aria-label={tr('Снять фото: {{name}}', { name: item.name })} disabled={photo.isPending} onClick={() => camera.current?.click()}>
              <Camera />
            </Button>
          </>
        )}
      </div>

      {result && mode === null && (
        <div className="flex flex-col gap-2">
          {result.result === 'observed' && verdict && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">{tr('На месте:')}{' '}<strong className="tabular-nums">{formatQty(observed ?? 0)}</strong> {item.unit}
                </span>
                <VerdictBadge verdict={verdict} />
              </div>
              <p className="text-sm text-muted-foreground tabular-nums">{tr('Заявлено')}{' '}{formatQty(shownReported)}{tr('→ на месте')}{' '}{formatQty(observed ?? 0)} {item.unit} (
                {(observed ?? 0) === shownReported ? '0' : `${(observed ?? 0) > shownReported ? '+' : '−'}${formatQty(Math.abs((observed ?? 0) - shownReported))}`})
              </p>
            </>
          )}
          {result.result === 'blocked' && (
            <span className="inline-flex w-fit items-center rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{tr('Не удалось проверить:')}{' '}{blockedReason}</span>
          )}
          {!readOnly && (
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setMode(result.result === 'blocked' ? 'blocked' : 'observe')
                  setQty(result.qty !== null ? String(result.qty) : '')
                  setReason(result.reason_code ?? '')
                  setComment(result.comment ?? '')
                }}
              >{tr('Изменить')}</Button>
              <Button size="sm" variant="ghost" disabled={clear.isPending} onClick={() => clear.mutate()}>{tr('Сбросить')}</Button>
            </div>
          )}
        </div>
      )}

      {!readOnly && !result && mode === null && (
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" onClick={() => { setMode('observe'); setQty('') }}>{tr('Указать итог')}</Button>
          <Button type="button" variant="outline" onClick={() => setMode('blocked')}>{tr('Не удалось проверить')}</Button>
        </div>
      )}

      {!readOnly && mode === 'observe' && (
        <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3">
          <Label htmlFor={`obs-${item.id}`}>{tr('Сколько всего сделано на месте,')}{' '}{item.unit}</Label>
          <div className="flex items-center gap-2">
            <Button type="button" size="icon-lg" variant="outline" aria-label={tr('Меньше')} onClick={() => setQty(String(Math.max(0, (Number.isNaN(entered) ? 0 : entered) - step)))}>
              <Minus />
            </Button>
            <Input
              id={`obs-${item.id}`}
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              autoFocus
              placeholder="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="h-14 flex-1 text-center text-2xl font-semibold md:h-12"
            />
            <Button type="button" size="icon-lg" variant="outline" aria-label={tr('Больше')} onClick={() => setQty(String((Number.isNaN(entered) ? 0 : entered) + step))}>
              <Plus />
            </Button>
          </div>
          {entered > item.planned_qty && (
            <p className="text-sm text-amber-700 dark:text-amber-300">{tr('Это больше плана (')}{formatQty(item.planned_qty)} {item.unit}{tr('). Проверьте число.')}</p>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setMode(null)}>{tr('Отмена')}</Button>
            <Button type="button" className="flex-1" disabled={!(entered >= 0) || save.isPending} onClick={() => save.mutate({ result: 'observed', qty: entered })}>{tr('Записать')}</Button>
          </div>
        </div>
      )}

      {!readOnly && mode === 'blocked' && (
        <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`creason-${item.id}`}>{tr('Почему не удалось проверить')}</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id={`creason-${item.id}`} className="w-full">
                <SelectValue placeholder={tr('Выберите причину')} />
              </SelectTrigger>
              <SelectContent>
                {reasons.map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`ccomment-${item.id}`}>{tr('Комментарий')}{reason === 'other' ? '' : tr(' (необязательно)')}</Label>
            <Textarea id={`ccomment-${item.id}`} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} className="text-base md:text-sm" />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setMode(null)}>{tr('Отмена')}</Button>
            <Button
              type="button"
              className="flex-1"
              disabled={!reason || (reason === 'other' && !comment.trim()) || save.isPending}
              onClick={() => save.mutate({ result: 'blocked', reason, comment })}
            >{tr('Записать')}</Button>
          </div>
        </div>
      )}
    </article>
  )
}
