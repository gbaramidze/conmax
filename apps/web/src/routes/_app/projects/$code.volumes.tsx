import { NewOrganizationButton } from '@/features/volumes/new-organization'
import { tr } from '@/lib/tr'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CheckCircle2, Download, FileSpreadsheet, Layers, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ExportButton } from '@/features/export/export-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { disciplinesQuery, flattenDisciplines } from '@/features/disciplines/api'
import { flattenTree, locationLabel, locationsQuery } from '@/features/locations/api'
import { BulkItemDialog } from '@/features/volumes/bulk-dialog'
import { LocationPicker } from '@/features/locations/location-picker'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { DEFAULT_DISCIPLINE_STYLE, DISCIPLINE_STYLES } from '@/features/tasks/api'
import {
  approveWalk,
  cancelWorkItem,
  createWorkItem,
  formatQty,
  importWorkItems,
  updateWorkItem,
  workItemDates,
  organizationsListQuery,
  percent,
  readTable,
  rowsFromTable,
  setProgressApproval,
  templateCsv,
  walksToApproveQuery,
  workItemsQuery,
  type ImportReport,
  type ImportRow,
  type WorkItemRow,
} from '@/features/volumes/api'
import { VerificationBadge } from '@/features/volumes/badges'

// Паттерн «Список / Index»: план объёмов и выполнение по местам и подрядчикам
export const Route = createFileRoute('/_app/projects/$code/volumes')({
  // фильтры можно задать ссылкой, например с главной проекта: «этаж 4», «спорные позиции»
  validateSearch: z.object({
    loc: z.string().optional(),
    disc: z.string().optional(),
    contractor: z.string().optional(),
    v: z.enum(['unchecked', 'verified', 'disputed', 'accepted']).optional(),
  }),
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([
      queryClient.ensureQueryData(workItemsQuery(project.id)),
      queryClient.ensureQueryData(locationsQuery(project.id)),
      queryClient.ensureQueryData(disciplinesQuery(project.id)),
      queryClient.ensureQueryData(organizationsListQuery),
    ])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем объёмы…')}</p>,
  component: VolumesPage,
})

const ALL = '__all__'

const VERIFICATION_TEXT: Record<string, string> = {
  unchecked: tr('Не проверено'),
  verified: tr('Проверено'),
  disputed: tr('Спорная'),
  accepted: tr('Принято решением'),
}

function ProgressBar({ item }: { item: WorkItemRow }) {
  const done = percent(item.done_qty, item.planned_qty)
  const pending = Math.min(100 - done, percent(item.pending_qty, item.planned_qty))
  return (
    <div className="flex min-w-32 flex-col gap-1">
      <div
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={tr('Выполнено {{done}}%', { done })}
        className="flex h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full bg-green-500" style={{ width: `${done}%` }} />
        {pending > 0 && <div className="h-full bg-green-500/40" style={{ width: `${pending}%` }} title={tr('Ждёт подтверждения')} />}
      </div>
      <span className="text-xs text-muted-foreground">
        {formatQty(item.done_qty)}{tr('из')}{' '}{formatQty(item.planned_qty)} {item.unit} · {done}%
        {item.pending_qty > 0 && tr(' (+{{v1}} ждёт подтверждения)', { v1: formatQty(item.pending_qty) })}
      </span>
    </div>
  )
}

function VolumesPage() {
  const { code } = Route.useParams()
  const queryClient = useQueryClient()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: items } = useSuspenseQuery(workItemsQuery(p.id))
  const { data: locations } = useSuspenseQuery(locationsQuery(p.id))
  const { data: disciplineRows } = useSuspenseQuery(disciplinesQuery(p.id))
  const { data: orgs } = useSuspenseQuery(organizationsListQuery)
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const canManage = permissions.includes('workitem.manage')
  const canApprove = permissions.includes('walk.approve')
  // состояние проверки и расхождения — внутренняя кухня: подрядчику и заказчику не показываем
  const showVerification = canApprove || permissions.includes('walk.verify')
  const { data: toApprove } = useQuery({ ...walksToApproveQuery(p.id), enabled: canApprove })

  const approvalOn = (p.settings as { progress_approval?: boolean } | null)?.progress_approval === true
  const disciplines = useMemo(() => new Map(disciplineRows.map((d) => [d.id, d])), [disciplineRows])
  const orgName = useMemo(() => new Map(orgs.map((o) => [o.id, o.name])), [orgs])
  const locationNodes = useMemo(() => flattenTree(locations), [locations])

  const search = Route.useSearch()
  const [locationFilter, setLocationFilter] = useState(search.loc ?? ALL)
  const [contractorFilter, setContractorFilter] = useState(search.contractor ?? ALL)
  const [disciplineFilter, setDisciplineFilter] = useState(search.disc ?? ALL)
  const [verificationFilter, setVerificationFilter] = useState<string>(search.v ?? ALL)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<WorkItemRow | null>(null)
  const [bulk, setBulk] = useState(false)
  const [importing, setImporting] = useState(false)

  // направление включает поднаправления
  const disciplineIds = useMemo(() => {
    if (disciplineFilter === ALL) return null
    const ids = new Set([disciplineFilter])
    for (let grew = true; grew; ) {
      grew = false
      for (const d of disciplineRows) {
        if (d.parent_id && ids.has(d.parent_id) && !ids.has(d.id)) {
          ids.add(d.id)
          grew = true
        }
      }
    }
    return ids
  }, [disciplineFilter, disciplineRows])

  const visible = useMemo(
    () =>
      items.filter(
        (i) =>
          i.status === 'active' &&
          (locationFilter === ALL || i.location_path === locationFilter || i.location_path.startsWith(locationFilter + '.')) &&
          (contractorFilter === ALL || (contractorFilter === 'none' ? !i.contractor_org_id : i.contractor_org_id === contractorFilter)) &&
          (!disciplineIds || (i.discipline_id !== null && disciplineIds.has(i.discipline_id))) &&
          (verificationFilter === ALL || i.verification === verificationFilter),
      ),
    [items, locationFilter, contractorFilter, disciplineIds, verificationFilter],
  )
  const completed = visible.filter((i) => i.done_qty >= i.planned_qty).length

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['work-items', p.id] }),
      queryClient.invalidateQueries({ queryKey: ['walks'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    ])

  const toggleApproval = useMutation({
    mutationFn: (on: boolean) => setProgressApproval(p.id, (p.settings as Record<string, unknown>) ?? {}, on),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
    onError: () => toast.error(tr('Не удалось изменить настройку.')),
  })
  const approve = useMutation({
    mutationFn: (id: string) => approveWalk(id),
    onSuccess: async () => {
      await refresh()
      toast.success(tr('Факт подтверждён'))
    },
    onError: () => toast.error(tr('Не удалось подтвердить обход.')),
  })
  const cancel = useMutation({
    mutationFn: (id: string) => cancelWorkItem(id),
    onSuccess: refresh,
    onError: () => toast.error(tr('Не удалось убрать позицию.')),
  })

  const contractors = [...new Set(items.map((i) => i.contractor_org_id).filter((x): x is string => !!x))]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">{tr('План объёмов по местам и подрядчикам и выполнение. Факт вносят прорабы и подрядчики на обходе.')}</p>
        <div className="flex flex-wrap gap-2">
          <ExportButton
            fileName={tr('Объёмы {{code}}', { code: p.code })}
            disabled={visible.length === 0}
            build={() => ({
              name: tr('Объёмы'),
              headers: [tr('Место'), tr('Работа'), tr('Подрядчик'), tr('Направление'), tr('Ед.'), tr('План'), tr('Принято'), tr('Ждёт подтверждения'), tr('Выполнено, %'), ...(showVerification ? [tr('Проверка')] : [])],
              rows: visible.map((i) => [
                i.location_path,
                i.name,
                orgName.get(i.contractor_org_id ?? '') ?? '',
                i.discipline_id ? (disciplines.get(i.discipline_id)?.code ?? '') : '',
                i.unit,
                i.planned_qty,
                i.done_qty,
                i.pending_qty,
                percent(i.done_qty, i.planned_qty),
                ...(showVerification ? [VERIFICATION_TEXT[i.verification]] : []),
              ]),
            })}
          />
          {canManage && (
            <>
              <Button variant="outline" onClick={() => setImporting(true)}>
                <FileSpreadsheet />{tr('Импорт')}</Button>
              <Button variant="outline" onClick={() => setBulk(true)}>
                <Layers />{tr('На много мест')}</Button>
              <Button onClick={() => setAdding(true)}>
                <Plus />{tr('Добавить позицию')}</Button>
            </>
          )}
        </div>
      </div>

      {canManage && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 text-sm">
          <input
            type="checkbox"
            className="size-5 md:size-4"
            checked={approvalOn}
            disabled={toggleApproval.isPending}
            onChange={(e) => toggleApproval.mutate(e.target.checked)}
          />
          <span>{tr('Подтверждать факт после обхода')}<span className="block text-xs text-muted-foreground">{tr('Выключено — факт принимается сразу. Включено — ПТО подтверждает каждый обход.')}</span>
          </span>
        </label>
      )}

      {canApprove && (toApprove?.length ?? 0) > 0 && (
        <section className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3" aria-label={tr('Обходы на подтверждении')}>
          <h2 className="text-sm font-semibold">{tr('Ждут подтверждения:')}{' '}{toApprove!.length}</h2>
          <ul className="flex flex-col gap-2">
            {toApprove!.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 rounded-md bg-card px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="ident mr-2">{w.location_path}</span>
                  <span className="text-muted-foreground">{w.author?.full_name}</span>
                </span>
                <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(w.id)}>
                  <CheckCircle2 />{tr('Подтвердить')}</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={locationFilter} onValueChange={setLocationFilter}>
          <SelectTrigger size="sm" aria-label={tr('Место')} className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value={ALL}>{tr('Вся площадка')}</SelectItem>
            {locationNodes
              .filter((n) => n.kind !== 'room')
              .map((n) => (
                <SelectItem key={n.id} value={n.path}>
                  <span style={{ paddingLeft: n.depth * 12 }}>
                    <span className="ident text-muted-foreground">{n.code}</span> {n.name}
                  </span>
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select value={contractorFilter} onValueChange={setContractorFilter}>
          <SelectTrigger size="sm" aria-label={tr('Подрядчик')} className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{tr('Все подрядчики')}</SelectItem>
            <SelectItem value="none">{tr('Без подрядчика')}</SelectItem>
            {contractors.map((id) => (
              <SelectItem key={id} value={id}>
                {orgName.get(id) ?? tr('Организация')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={disciplineFilter} onValueChange={setDisciplineFilter}>
          <SelectTrigger size="sm" aria-label={tr('Направление')} className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value={ALL}>{tr('Все направления')}</SelectItem>
            {flattenDisciplines(disciplineRows).map((d) => (
              <SelectItem key={d.id} value={d.id}>
                <span style={{ paddingLeft: d.depth * 12 }}>
                  <span className="ident text-muted-foreground">{d.code}</span> {d.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showVerification && (
          <Select value={verificationFilter} onValueChange={setVerificationFilter}>
            <SelectTrigger size="sm" aria-label={tr('Проверка')} className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{tr('Любая проверка')}</SelectItem>
              <SelectItem value="disputed">{tr('Спорные')}</SelectItem>
              <SelectItem value="unchecked">{tr('Не проверены')}</SelectItem>
              <SelectItem value="verified">{tr('Проверены')}</SelectItem>
              <SelectItem value="accepted">{tr('Принято решением')}</SelectItem>
            </SelectContent>
          </Select>
        )}
        <span className="text-sm text-muted-foreground">{tr('Позиций:')}{' '}{visible.length}{tr('· завершено:')}{' '}{completed}
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">
          {items.length === 0
            ? canManage
              ? tr('Плана объёмов пока нет. Добавьте позицию вручную или загрузите таблицу из Excel — шаблон скачивается в окне импорта.')
              : tr('План объёмов ещё не внесён.')
            : tr('По этим условиям позиций нет. Ослабьте фильтры.')}
        </div>
      ) : (
        <>
          {/* Телефон: карточки */}
          <ul className="flex flex-col gap-2 md:hidden">
            {visible.map((i) => (
              <li key={i.id} className="flex flex-col gap-2 rounded-lg border bg-card p-3.5 shadow-soft">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{i.name}</span>
                  <span className="ident shrink-0 text-muted-foreground">{i.location_path}</span>
                </div>
                <ProgressBar item={i} />
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {orgName.get(i.contractor_org_id ?? '') ?? tr('Без подрядчика')}
                    {i.discipline_id && disciplines.get(i.discipline_id) ? ` · ${disciplines.get(i.discipline_id)!.code}` : ''}
                  </span>
                  {showVerification && <VerificationBadge verification={i.verification} checkedAt={i.checked_at} reported={i.done_qty + i.pending_qty > 0} />}
                  {canManage && (
                    <Button type="button" size="sm" variant="outline" className="ml-auto h-8 gap-1" onClick={() => setEditing(i)}>
                      <Pencil className="size-3.5" aria-hidden /> {tr('Изменить')}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {/* Планшет и десктоп: таблица */}
          <div className="hidden overflow-hidden rounded-lg border bg-card shadow-soft md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-36">{tr('Место')}</TableHead>
                  <TableHead>{tr('Работа')}</TableHead>
                  <TableHead>{tr('Подрядчик')}</TableHead>
                  <TableHead>{tr('Направление')}</TableHead>
                  <TableHead className="w-64">{tr('Выполнено')}</TableHead>
                  {showVerification && <TableHead className="w-44">{tr('Проверка')}</TableHead>}
                  {canManage && <TableHead className="w-24" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((i) => {
                  const d = i.discipline_id ? disciplines.get(i.discipline_id) : null
                  return (
                    <TableRow key={i.id}>
                      <TableCell className="ident text-muted-foreground" title={locationLabel(i.location_path, locations)}>
                        {i.location_path}
                      </TableCell>
                      <TableCell className="whitespace-normal font-medium">{i.name}</TableCell>
                      <TableCell className="text-muted-foreground">{orgName.get(i.contractor_org_id ?? '') ?? '—'}</TableCell>
                      <TableCell>
                        {d ? (
                          <span className={`ident rounded px-1.5 py-0.5 font-medium ${(d.color && DISCIPLINE_STYLES[d.color]) || DEFAULT_DISCIPLINE_STYLE}`}>{d.code}</span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        <ProgressBar item={i} />
                      </TableCell>
                      {showVerification && (
                        <TableCell>
                          <VerificationBadge verification={i.verification} checkedAt={i.checked_at} reported={i.done_qty + i.pending_qty > 0} />
                        </TableCell>
                      )}
                      {canManage && (
                        <TableCell className="whitespace-nowrap">
                          <Button size="icon" variant="ghost" className="md:size-8" aria-label={tr('Изменить позицию {{name}}', { name: i.name })} title={tr('Изменить позицию')} onClick={() => setEditing(i)}>
                            <Pencil />
                          </Button>
                          <Button size="icon" variant="ghost" className="md:size-8" aria-label={tr('Убрать позицию {{name}}', { name: i.name })} title={tr('Убрать из плана')} onClick={() => cancel.mutate(i.id)}>
                            <Trash2 />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <p className="text-sm text-muted-foreground">{tr('Нужно внести факт? Откройте')}{' '}
        <Link to="/projects/$code/walk" params={{ code }} className="font-medium text-foreground underline underline-offset-4">{tr('обход')}</Link>
        .
      </p>

      {bulk && <BulkItemDialog projectId={p.id} onClose={() => setBulk(false)} onDone={refresh} />}
      {adding && <AddItemDialog projectId={p.id} onClose={() => setAdding(false)} onDone={refresh} />}
      {editing && <AddItemDialog projectId={p.id} item={editing} locationName={locationLabel(editing.location_path, locations)} onClose={() => setEditing(null)} onDone={refresh} />}
      {importing && <ImportDialog projectId={p.id} onClose={() => setImporting(false)} onDone={refresh} />}
    </div>
  )
}

const NONE = '__none__'

const itemSchema = z.object({
  name: z.string().trim().min(2, tr('Укажите название работы')),
  unit: z.string().trim().min(1, tr('Единица измерения, например м²')).max(20),
  qty: z.coerce.number().positive(tr('Объём больше нуля')),
  // необязательно: пустая строка = вес не задан
  weight: z.string().refine((v) => v.trim() === '' || Number(v.replace(',', '.')) > 0, tr('Вес больше нуля или оставьте пустым')),
  discipline: z.string(),
  contractor: z.string(),
  start: z.string(),
  finish: z.string(),
}).refine((v) => !v.start || !v.finish || v.finish >= v.start, { path: ['finish'], message: tr('Окончание не может быть раньше начала') })

function AddItemDialog({ projectId, item, locationName, onClose, onDone }: { projectId: string; item?: WorkItemRow; locationName?: string; onClose: () => void; onDone: () => Promise<unknown> }) {
  const { data: dates } = useSuspenseQuery({ queryKey: ['work-item-dates', item?.id ?? 'new'], gcTime: 0, queryFn: () => (item ? workItemDates(item.id) : Promise.resolve({ start: '', finish: '' })) })
  const { data: disciplineRows } = useSuspenseQuery(disciplinesQuery(projectId))
  const { data: orgs } = useSuspenseQuery(organizationsListQuery)
  const disciplines = useMemo(() => flattenDisciplines(disciplineRows), [disciplineRows])
  const [location, setLocation] = useState<string | null>(null)
  const [locationError, setLocationError] = useState(false)
  const {
    register,
    control,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(itemSchema), mode: 'onBlur', defaultValues: item
      ? { name: item.name, unit: item.unit, qty: item.planned_qty, weight: item.weight === null ? '' : String(item.weight), discipline: item.discipline_id ?? NONE, contractor: item.contractor_org_id ?? NONE, start: dates.start, finish: dates.finish }
      : { name: '', unit: tr('м²'), qty: undefined as unknown as number, weight: '', discipline: NONE, contractor: NONE, start: '', finish: '' },
  })

  const save = useMutation({
    mutationFn: (v: z.output<typeof itemSchema>) =>
      item
        ? updateWorkItem(item.id, {
            disciplineId: v.discipline === NONE ? null : v.discipline,
            contractorId: v.contractor === NONE ? null : v.contractor,
            name: v.name,
            unit: v.unit,
            plannedQty: v.qty,
            weight: v.weight.trim() === '' ? null : Number(v.weight.replace(',', '.')),
            plannedStart: v.start || null,
            plannedFinish: v.finish || null,
          })
        : createWorkItem({
        projectId,
        locationId: location!,
        disciplineId: v.discipline === NONE ? null : v.discipline,
        contractorId: v.contractor === NONE ? null : v.contractor,
        name: v.name,
        unit: v.unit,
        plannedQty: v.qty,
        weight: v.weight.trim() === '' ? null : Number(v.weight.replace(',', '.')),
        plannedStart: v.start || null,
        plannedFinish: v.finish || null,
      }),
    onSuccess: async () => {
      await onDone()
      toast.success(item ? tr('Позиция сохранена') : tr('Позиция добавлена'))
      onClose()
    },
    onError: () => toast.error(item ? tr('Не удалось сохранить позицию. Проверьте права и данные.') : tr('Не удалось добавить позицию. Проверьте права и данные.')),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{item ? tr('Правка позиции плана') : tr('Новая позиция плана')}</DialogTitle>
          <DialogDescription>{tr('Что, где, кем и сколько нужно выполнить.')}</DialogDescription>
        </DialogHeader>
        <form
          id="item-form"
          className="grid gap-x-6 gap-y-4 md:grid-cols-2 md:items-start"
          noValidate
          onSubmit={handleSubmit((v) => {
            if (!item && !location) return setLocationError(true)
            setLocationError(false)
            save.mutate(v)
          })}
        >
          <div className="flex flex-col gap-2 md:col-span-2">
            <Label>{tr('Место')}</Label>
            {item ? (
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="ident text-muted-foreground">{item.location_path}</span> {locationName && locationName !== item.location_path ? `· ${locationName}` : ''}
              </p>
            ) : (
              <LocationPicker projectId={projectId} value={location} onChange={(id) => { setLocation(id); setLocationError(false) }} />
            )}
            {locationError && <p className="text-sm text-destructive">{tr('Выберите место')}</p>}
          </div>
          <div className="flex flex-col gap-2 md:col-span-2">
            <Label htmlFor="i-name">{tr('Работа')}</Label>
            <Input id="i-name" placeholder={tr('Монтаж стеклопакетов')} aria-invalid={!!errors.name} {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="i-qty">{tr('Объём')}</Label>
              <Input id="i-qty" type="number" inputMode="decimal" step="any" aria-invalid={!!errors.qty} {...register('qty')} />
              {errors.qty && <p className="text-sm text-destructive">{errors.qty.message}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="i-unit">{tr('Ед. изм.')}</Label>
              <Input id="i-unit" aria-invalid={!!errors.unit} {...register('unit')} />
              {errors.unit && <p className="text-sm text-destructive">{errors.unit.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="i-start">{tr('Начало')}</Label>
              <Controller control={control} name="start" render={({ field }) => <DatePicker id="i-start" value={field.value} onChange={field.onChange} />} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="i-finish">{tr('Окончание')}</Label>
              <Controller control={control} name="finish" render={({ field }) => <DatePicker id="i-finish" value={field.value} aria-invalid={!!errors.finish} onChange={field.onChange} />} />
              {errors.finish && <p className="text-sm text-destructive">{errors.finish.message}</p>}
            </div>
          </div>
          <div className="flex flex-col gap-2 md:col-span-2">
            <Label htmlFor="i-weight">{tr('Вес в проекте (необязательно)')}</Label>
            <Input id="i-weight" inputMode="decimal" placeholder={tr('Например, стоимость или человеко-часы')} aria-invalid={!!errors.weight} {...register('weight')} />
            {errors.weight ? (
              <p className="text-sm text-destructive">{errors.weight.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{tr('Нужен для процента готовности проекта: чем больше вес, тем сильнее позиция влияет на итог. Единица любая, но одна для всех позиций.')}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="i-contractor">{tr('Подрядчик')}</Label>
              <NewOrganizationButton projectId={projectId} onCreated={(id) => setValue('contractor', id, { shouldDirty: true })} />
            </div>
            <Controller
              control={control}
              name="contractor"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="i-contractor" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{tr('Свои силы / не указан')}</SelectItem>
                    {orgs.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="i-discipline">{tr('Направление')}</Label>
            <Controller
              control={control}
              name="discipline"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="i-discipline" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{tr('Без направления')}</SelectItem>
                    {disciplines.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        <span style={{ paddingLeft: d.depth * 12 }}>
                          <span className="ident text-muted-foreground">{d.code}</span> {d.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button type="submit" form="item-form" disabled={save.isPending}>{item ? tr('Сохранить') : tr('Добавить позицию')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ImportDialog({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => Promise<unknown> }) {
  const input = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onFile(file: File | undefined) {
    if (!file) return
    setFileError(null)
    setReport(null)
    setRows(null)
    setBusy(true)
    try {
      const { rows: parsed, missing } = rowsFromTable(await readTable(file))
      if (missing.length > 0) return setFileError(tr('В файле нет колонок: {{v1}}. Скачайте шаблон и заполните его.', { v1: missing.join(', ') }))
      if (parsed.length === 0) return setFileError(tr('В файле нет строк с данными.'))
      if (parsed.length > 2000) return setFileError(tr('Не больше 2000 строк за раз.'))
      setRows(parsed)
      setReport(await importWorkItems(projectId, parsed, true)) // проверка без записи
    } catch {
      setFileError(tr('Не удалось прочитать файл. Подойдут .xlsx и .csv.'))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const run = useMutation({
    mutationFn: () => importWorkItems(projectId, rows!, false),
    onSuccess: async (r) => {
      await onDone()
      toast.success(tr('Загружено позиций: {{created}}', { created: r.created }))
      onClose()
    },
    onError: () => toast.error(tr('Не удалось загрузить. Исправьте ошибки в файле и попробуйте снова.')),
  })

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'plan-obyomov.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const hasErrors = (report?.errors.length ?? 0) > 0

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Импорт плана объёмов')}</DialogTitle>
          <DialogDescription>{tr('Таблица с колонками: Место (например K1.S1.F05), Направление (код), Подрядчик (название), Работа, Ед. изм., Объём и необязательный Вес (стоимость или трудоёмкость).')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Button type="button" variant="outline" onClick={downloadTemplate}>
            <Download />{tr('Скачать шаблон')}</Button>
          <input ref={input} type="file" accept=".xlsx,.csv" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          <Button type="button" onClick={() => input.current?.click()} disabled={busy}>
            <FileSpreadsheet /> {busy ? tr('Читаем файл…') : tr('Выбрать файл (.xlsx или .csv)')}
          </Button>
          {fileError && (
            <p role="alert" className="text-sm text-destructive">
              {fileError}
            </p>
          )}
          {report && (
            <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
              <p>{tr('Строк:')}{' '}{report.total}{tr('· готовы к загрузке:')}{' '}<strong>{report.valid}</strong>
                {hasErrors && tr(' · с ошибками: {{length}}', { length: report.errors.length })}
              </p>
              {hasErrors && (
                <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-destructive">
                  {report.errors.slice(0, 30).map((e) => (
                    <li key={`${e.row}-${e.message}`}>{tr('Строка')}{' '}{e.row + 1}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
              {hasErrors && <p className="text-muted-foreground">{tr('Загрузка идёт «всё или ничего»: исправьте файл и выберите его снова.')}</p>}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button disabled={!rows || !report || hasErrors || report.valid === 0 || run.isPending} onClick={() => run.mutate()}>{tr('Загрузить')}{report && !hasErrors ? `: ${report.valid}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
