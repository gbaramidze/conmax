import { useProjectCurrency } from '@/features/projects/currency'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { FileSignature, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { DatePicker } from '@/components/ui/date-picker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cbsQuery, fmtMoney } from '@/features/budget/api'
import {
  addScope,
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_STYLES,
  CONTRACT_STATUSES,
  contractError,
  contractorName,
  deleteContract,
  ffeItemsQuery,
  removeScope,
  resyncContracts,
  setPrice,
  upsertContract,
  type ContractStatus,
  type FfeContract,
} from '@/features/ffe/api'
import { useContractsModel } from '@/features/ffe/contracts-model'
import { FloorRangeButton } from '@/features/locations/floor-range'
import { LocationPicker } from '@/features/locations/location-picker'
import { locationLabel, locationsQuery } from '@/features/locations/api'
import { organizationsQuery, projectMembersQuery } from '@/features/projects/api'
import { NewOrganizationButton } from '@/features/volumes/new-organization'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'

const OTHER = '__other__'
const NONE = ''

const dayFmt = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

/** Договоры на мебель: кто делает, где (этажи, секции, номера), кто и когда подписал, по каким ценам и сколько это стоит. */
export function ContractsTab({ projectId, canEdit, canBudget }: { projectId: string; canEdit: boolean; canBudget: boolean }) {
  const model = useContractsModel(projectId)
  const { data: locations } = useSuspenseQuery(locationsQuery(projectId))
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<FfeContract | 'new' | null>(null)
  const [removing, setRemoving] = useState<FfeContract | null>(null)

  const remove = useMutation({
    mutationFn: (c: FfeContract) => deleteContract(projectId, c.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ffe'] })
      toast.success(tr('Договор удалён'))
      setRemoving(null)
    },
    onError: (e) => toast.error(contractError(e)),
  })
  const resync = useMutation({
    mutationFn: () => resyncContracts(projectId),
    onSuccess: async (n) => {
      await queryClient.invalidateQueries({ queryKey: ['budget'] })
      toast.success(tr('Суммы обновлены в бюджете: договоров {{n}}', { n }))
    },
    onError: (e) => toast.error(contractError(e)),
  })

  const total = model.contracts.filter((c) => c.status !== 'terminated').reduce((s, c) => s + model.summary(c.id).amount, 0)
  const linked = model.contracts.some((c) => c.cbs_item_id)
  const uncovered = useMemo(() => {
    // номера с мебелью, которые не попали ни под один договор
    const rooms = locations.filter((l) => l.kind === 'room')
    return rooms.filter((r) => !model.contractAt(r.path)).length
  }, [locations, model])

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="max-w-prose text-sm text-muted-foreground">
          {tr('Подрядчик закрепляется за этажами, секциями или отдельными номерами. Мебель в этих местах относится к его договору; номер перекрывает этаж.')}
        </p>
        {canEdit && (
          <span className="ml-auto flex gap-2">
            {linked && (
              <Button size="sm" variant="outline" disabled={resync.isPending} onClick={() => resync.mutate()} title={tr('Пересчитать суммы договоров и обновить обязательства в бюджете')}>
                <RefreshCw /> {tr('Обновить в бюджете')}
              </Button>
            )}
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus /> {tr('Новый договор')}
            </Button>
          </span>
        )}
      </div>

      {model.contracts.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
          <p className="font-medium">{tr('Договоров на мебель пока нет')}</p>
          <p className="max-w-prose text-sm text-muted-foreground">
            {tr('Заведите договор: подрядчик, дата и подписанты, этажи или номера, цены по позициям. Тогда в ведомости у каждой мебели будет виден подрядчик и стоимость.')}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label={tr('Договоров')} value={String(model.contracts.length)} />
            {canBudget && <Stat label={tr('Сумма договоров')} value={fmtMoney(total)} />}
            <Stat label={tr('Номеров без подрядчика')} value={String(uncovered)} />
          </div>
          <ul className="flex flex-col gap-3">
            {model.contracts.map((c) => {
              const s = model.summary(c.id)
              const installed = s.totals.total > 0 ? Math.round((s.totals.installed / s.totals.total) * 100) : 0
              return (
                <li key={c.id} className="flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-soft">
                  <div className="flex flex-wrap items-start gap-2">
                    <FileSignature className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {c.title} {c.number && <span className="ident ml-1 text-sm text-muted-foreground">№ {c.number}</span>}
                      </p>
                      <p className="text-sm text-muted-foreground">{tr('Подрядчик: {{name}}', { name: contractorName(c) })}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CONTRACT_STATUS_STYLES[c.status]}`}>{CONTRACT_STATUS_LABELS[c.status]}</span>
                    {canEdit && (
                      <span className="flex gap-1">
                        <Button size="icon" variant="ghost" aria-label={tr('Изменить {{name}}', { name: c.title })} onClick={() => setEditing(c)}>
                          <Pencil />
                        </Button>
                        <Button size="icon" variant="ghost" aria-label={tr('Удалить {{name}}', { name: c.title })} onClick={() => setRemoving(c)}>
                          <Trash2 />
                        </Button>
                      </span>
                    )}
                  </div>
                  <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                    <Row label={tr('Подписан')} value={dayFmt(c.signed_on)} />
                    <Row label={tr('Подписал от нас')} value={c.signer?.full_name ?? '—'} />
                    <Row label={tr('Подписал подрядчик')} value={c.contractor_signatory ?? '—'} />
                    <Row label={tr('Где работает')} value={scopeSummary(model.scopeLocationIds(c.id), model.locById, locations)} />
                    {canBudget && <Row label={tr('Сумма по ценам')} value={`${fmtMoney(s.amount)}${s.unpriced > 0 ? ' · ' + tr('без цены строк: {{n}}', { n: s.unpriced }) : ''}`} />}
                    <Row label={tr('Мебели в охвате')} value={tr('{{n}} шт., установлено {{p}}%', { n: s.totals.total, p: installed })} />
                  </dl>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {editing && <ContractDialog projectId={projectId} contract={editing === 'new' ? null : editing} canBudget={canBudget} onClose={() => setEditing(null)} />}
      {removing && (
        <Dialog open onOpenChange={(o) => !o && setRemoving(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{tr('Удалить договор «{{name}}»?', { name: removing.title })}</DialogTitle>
              <DialogDescription>{tr('Мебель в его охвате останется, но подрядчика у неё не будет. Обязательство в бюджете будет снято.')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRemoving(null)}>{tr('Отмена')}</Button>
              <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(removing)}>{tr('Удалить')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-card px-3 py-2 shadow-soft">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-36 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">{value}</dd>
    </div>
  )
}

/** «Корпус 1 › Секция 1: этажи 3–8; Номер 601» — подряд идущие этажи одной секции сжимаются в диапазон. */
export function scopeSummary(ids: string[], locById: Map<string, { id: string; path: string; kind: string; sort: number; parent_id: string | null; name: string }>, rows: Parameters<typeof locationLabel>[1]): string {
  if (ids.length === 0) return tr('не задано')
  const floors = new Map<string, number[]>()
  const others: string[] = []
  for (const id of ids) {
    const l = locById.get(id)
    if (!l) continue
    if (l.kind === 'floor' && l.parent_id) floors.set(l.parent_id, [...(floors.get(l.parent_id) ?? []), l.sort])
    else others.push(locationLabel(l.path, rows))
  }
  const parts: string[] = []
  for (const [parentId, sorts] of floors) {
    const parent = locById.get(parentId)
    const label = parent ? locationLabel(parent.path, rows) : ''
    const ordered = [...sorts].sort((a, b) => a - b)
    const ranges: string[] = []
    let start = ordered[0]
    let prev = ordered[0]
    for (const n of [...ordered.slice(1), Number.NaN]) {
      if (n === prev + 1) {
        prev = n
        continue
      }
      ranges.push(start === prev ? String(start) : `${start}–${prev}`)
      start = n
      prev = n
    }
    parts.push(`${label}: ${tr('этажи')} ${ranges.join(', ')}`)
  }
  return [...parts, ...others].join('; ')
}

function ContractDialog({ projectId, contract, canBudget, onClose }: { projectId: string; contract: FfeContract | null; canBudget: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: orgs = [] } = useQuery(organizationsQuery)
  const { data: members = [] } = useQuery(projectMembersQuery(projectId))
  const { data: cbs = [] } = useQuery({ ...cbsQuery(projectId), enabled: canBudget })
  const [savedId, setSavedId] = useState<string | null>(contract?.id ?? null)
  const [title, setTitle] = useState(contract?.title ?? '')
  const [number, setNumber] = useState(contract?.number ?? '')
  const [org, setOrg] = useState<string>(contract?.organization_id ?? (contract?.contractor_name ? OTHER : NONE))
  const [otherName, setOtherName] = useState(contract?.contractor_name ?? '')
  const [signedOn, setSignedOn] = useState(contract?.signed_on ?? '')
  const [signedBy, setSignedBy] = useState(contract?.signed_by_user ?? '')
  const [signatory, setSignatory] = useState(contract?.contractor_signatory ?? '')
  const [status, setStatus] = useState<ContractStatus>(contract?.status ?? 'draft')
  const [cbsItem, setCbsItem] = useState(contract?.cbs_item_id ?? '')
  const [note, setNote] = useState(contract?.note ?? '')

  const contractorOk = (org && org !== OTHER) || (org === OTHER && otherName.trim().length > 0)

  const save = useMutation({
    mutationFn: () =>
      upsertContract({
        projectId,
        id: savedId,
        title: title.trim(),
        number: number.trim(),
        organizationId: org && org !== OTHER ? org : null,
        contractorName: org === OTHER ? otherName.trim() : '',
        signedOn,
        signedBy: signedBy || null,
        contractorSignatory: signatory.trim(),
        status,
        cbsItemId: cbsItem || null,
        note: note.trim(),
      }),
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['ffe'] })
      await queryClient.invalidateQueries({ queryKey: ['budget'] })
      toast.success(tr('Договор сохранён'))
      if (savedId) onClose()
      else setSavedId(id)
    },
    onError: (e) => toast.error(contractError(e)),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="flex max-h-[92svh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{contract ? tr('Договор «{{name}}»', { name: contract.title }) : tr('Новый договор на мебель')}</DialogTitle>
          <DialogDescription>{tr('Подрядчик, подписанты и обязательство в бюджете. Охват и цены — ниже, после сохранения.')}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          <form
            id="ffe-contract-form"
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (title.trim() && contractorOk && !save.isPending) save.mutate()
            }}
          >
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="fc-title">{tr('Название')}</Label>
              <Input id="fc-title" value={title} maxLength={300} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder={tr('Например, поставка и монтаж мебели, этажи 3–8')} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fc-number">{tr('Номер договора')}</Label>
              <Input id="fc-number" value={number} maxLength={60} onChange={(e) => setNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fc-status">{tr('Статус')}</Label>
              <select id="fc-status" value={status} onChange={(e) => setStatus(e.target.value as ContractStatus)} className="h-9 rounded-md border bg-background px-2 text-sm">
                {CONTRACT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {CONTRACT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="fc-org">{tr('Подрядчик')}</Label>
                <NewOrganizationButton projectId={projectId} onCreated={setOrg} />
              </div>
              <select id="fc-org" value={org} onChange={(e) => setOrg(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                <option value={NONE}>{tr('Выберите организацию…')}</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
                <option value={OTHER}>{tr('Другая (ввести название)')}</option>
              </select>
              {org === OTHER && <Input value={otherName} maxLength={200} aria-label={tr('Название подрядчика')} onChange={(e) => setOtherName(e.target.value)} placeholder={tr('Название подрядчика')} />}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fc-signed">{tr('Дата подписания')}</Label>
              <DatePicker id="fc-signed" value={signedOn} onChange={(v) => setSignedOn(v)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fc-by">{tr('Подписал от нас')}</Label>
              <select id="fc-by" value={signedBy} onChange={(e) => setSignedBy(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                <option value="">{tr('Не указан')}</option>
                {members.map((m) => (m.user ? <option key={m.user.id} value={m.user.id}>{m.user.full_name}</option> : null))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fc-sig">{tr('Подписал подрядчик')}</Label>
              <Input id="fc-sig" value={signatory} maxLength={200} onChange={(e) => setSignatory(e.target.value)} placeholder={tr('ФИО и должность')} />
            </div>
            {canBudget && (
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="fc-cbs">{tr('Статья бюджета')}</Label>
                <select id="fc-cbs" value={cbsItem} onChange={(e) => setCbsItem(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                  <option value="">{tr('Не связывать с бюджетом')}</option>
                  {cbs
                    .slice()
                    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.code} · {i.name}
                      </option>
                    ))}
                </select>
                <p className="text-xs text-muted-foreground">{tr('Подписанный договор станет обязательством по этой статье на сумму по ценам; черновик и расторгнутый в обязательства не входят.')}</p>
              </div>
            )}
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="fc-note">{tr('Примечание')}</Label>
              <Textarea id="fc-note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </form>

          {savedId ? (
            <>
              <ScopeEditor projectId={projectId} contractId={savedId} />
              {canBudget ? <PriceEditor projectId={projectId} contractId={savedId} /> : <p className="text-sm text-muted-foreground">{tr('Цены видят и меняют только те, у кого есть доступ к бюджету.')}</p>}
            </>
          ) : (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{tr('Сохраните договор — после этого можно выбрать этажи и номера и задать цены.')}</p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>{savedId && !contract ? tr('Готово') : tr('Закрыть')}</Button>
          <Button type="submit" form="ffe-contract-form" disabled={!title.trim() || !contractorOk || save.isPending}>
            {save.isPending ? tr('Сохраняем…') : savedId ? tr('Сохранить') : tr('Сохранить и выбрать этажи')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ScopeEditor({ projectId, contractId }: { projectId: string; contractId: string }) {
  const queryClient = useQueryClient()
  const model = useContractsModel(projectId)
  const { data: locations } = useSuspenseQuery(locationsQuery(projectId))
  const ids = model.scopeLocationIds(contractId)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ffe'] })

  const add = useMutation({
    mutationFn: async (picked: string[]) => {
      try {
        return await addScope(projectId, contractId, picked)
      } catch (e) {
        if ((e as { message?: string }).message?.startsWith('scope_taken') && window.confirm(tr('Некоторые места уже закреплены за другим договором. Перенести их в этот?'))) {
          return addScope(projectId, contractId, picked, true)
        }
        throw e
      }
    },
    onSuccess: async (n) => {
      await refresh()
      toast.success(tr('Добавлено мест: {{n}}', { n }))
    },
    onError: (e) => toast.error(contractError(e)),
  })
  const drop = useMutation({
    mutationFn: (id: string) => removeScope(projectId, contractId, [id]),
    onSuccess: refresh,
    onError: (e) => toast.error(contractError(e)),
  })

  return (
    <section className="flex flex-col gap-2" aria-label={tr('Охват договора')}>
      <h3 className="text-sm font-semibold">{tr('Где работает подрядчик')}</h3>
      <p className="text-xs text-muted-foreground">{tr('Этажи, секции, корпуса или отдельные номера. Номер перекрывает этаж, этаж — секцию.')}</p>
      {ids.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr('Места не выбраны.')}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {ids
            .map((id) => model.locById.get(id))
            .filter((l): l is NonNullable<typeof l> => !!l)
            .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
            .map((l) => (
              <li key={l.id} className="flex items-center gap-1 rounded-full border bg-card py-0.5 pl-2.5 pr-1 text-xs">
                {locationLabel(l.path, locations)}
                <button type="button" className="rounded-full p-0.5 hover:bg-muted" aria-label={tr('Убрать место: {{name}}', { name: l.name })} onClick={() => drop.mutate(l.id)}>
                  <X className="size-3" />
                </button>
              </li>
            ))}
        </ul>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <LocationPicker projectId={projectId} value={null} placeholder={tr('Добавить корпус, секцию, этаж или номер')} onChange={(id) => add.mutate([id])} />
        </div>
        <FloorRangeButton projectId={projectId} disabled={add.isPending} onPick={(picked) => add.mutate(picked)} />
      </div>
    </section>
  )
}

function PriceEditor({ projectId, contractId }: { projectId: string; contractId: string }) {
  const { symbol: cur } = useProjectCurrency(projectId)
  const queryClient = useQueryClient()
  const model = useContractsModel(projectId)
  const { data: items } = useSuspenseQuery(ffeItemsQuery(projectId))
  const [query, setQuery] = useState('')
  const save = useMutation({
    mutationFn: (v: { itemId: string; price: number | null }) => setPrice(projectId, contractId, v.itemId, v.price),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ffe'] })
      await queryClient.invalidateQueries({ queryKey: ['budget'] })
    },
    onError: (e) => toast.error(contractError(e)),
  })
  const shown = items.filter((i) => !query.trim() || i.code.toLowerCase().includes(query.trim().toLowerCase()) || i.name.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <section className="flex flex-col gap-2" aria-label={tr('Цены договора')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{tr('Цены за единицу')}</h3>
        <Input className="h-8 w-44" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Код или название')} aria-label={tr('Поиск позиции')} />
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr('Каталог пуст: сначала добавьте позиции.')}</p>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-lg border">
          <table className="w-full text-sm">
            <tbody>
              {shown.map((i) => {
                const p = model.price(contractId, i.id)
                return (
                  <tr key={i.id} className="border-b last:border-b-0">
                    <td className="ident w-28 px-3 py-1.5">{i.code}</td>
                    <td className="px-2 py-1.5">{i.name}</td>
                    <td className="w-32 px-2 py-1">
                      <Input
                        key={`${i.id}-${p ?? ''}`}
                        inputMode="decimal"
                        className="h-8 text-right tabular-nums"
                        defaultValue={p === undefined ? '' : String(p)}
                        placeholder={`${cur} / ${i.unit}`}
                        aria-label={tr('Цена: {{name}}', { name: i.name })}
                        onBlur={(e) => {
                          const raw = e.target.value.trim().replace(/\s/g, '').replace(',', '.')
                          const n = raw === '' ? null : Number(raw)
                          if (n !== null && !(n >= 0)) return
                          if (n !== (p ?? null)) save.mutate({ itemId: i.id, price: n })
                        }}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
