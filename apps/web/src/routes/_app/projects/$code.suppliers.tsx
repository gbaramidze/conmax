import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHelp } from '@/components/page-help'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { saveSupplier, supplierHistoryQuery, suppliersQuery, type Supplier, type SupplierInput } from '@/features/procurement/api'
import { field } from '@/features/procurement/request-form'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { symbolOf } from '@/features/projects/currency'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

// Паттерн «Список / Реестр»: справочник поставщиков компании (п. 5.4 процедуры) — контакты, статус, история предложений и цен
export const Route = createFileRoute('/_app/projects/$code/suppliers')({
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([queryClient.ensureQueryData(suppliersQuery), queryClient.ensureQueryData(myPermissionsQuery(project.id))])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем поставщиков…')}</p>,
  component: SuppliersPage,
})

const day = (d: string) => new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d))

function SuppliersPage() {
  const { code } = Route.useParams()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const { data: suppliers } = useSuspenseQuery(suppliersQuery)
  const { data: perms } = useSuspenseQuery(myPermissionsQuery(project!.id))
  const canManage = perms.includes('procurement.manage') || perms.includes('procurement.approve')
  const [search, setSearch] = useState('')
  const [onlyRestricted, setOnlyRestricted] = useState(false)
  const [opened, setOpened] = useState<Supplier | 'new' | null>(null)
  const s = search.trim().toLowerCase()
  const shown = suppliers.filter((x) => (!onlyRestricted || x.status === 'restricted') && (!s || `${x.name} ${x.category} ${x.contact} ${x.tax_id}`.toLowerCase().includes(s)))
  const restricted = suppliers.filter((x) => x.status === 'restricted').length

  return (
    <div className="flex flex-col gap-4">
      <PageHelp id="suppliers" title={tr('Справочник поставщиков')}>
        <p>{tr('Общий для всех проектов компании. Поставщик появляется сам, когда закупщик вносит его предложение в заявку; здесь можно дописать контакты, ИНН и категорию.')}</p>
        <p>{tr('Тех, кто систематически срывает сроки или качество, переводят в ограниченный список: при выборе такого поставщика закупщик и согласующие увидят предупреждение. Внутри — история всех предложений и цен.')}</p>
      </PageHelp>

      <p className="text-sm">
        {suppliers.length === 0
          ? tr('Поставщиков пока нет: они появятся, когда в заявки начнут вносить предложения.')
          : tr('Поставщиков: {{n}}, в ограниченном списке: {{r}}.', { n: suppliers.length, r: restricted })}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input aria-label={tr('Поиск поставщика')} placeholder={tr('Поиск: название, категория, контакт, ИНН')} value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 w-full rounded-md border bg-background pl-8 pr-3 text-sm" />
        </label>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyRestricted} onChange={(e) => setOnlyRestricted(e.target.checked)} className="size-4" />
          {tr('Только ограниченный список')}
        </label>
        {canManage && (
          <Button className="sm:ml-auto" onClick={() => setOpened('new')}>
            <Plus /> {tr('Новый поставщик')}
          </Button>
        )}
      </div>

      {shown.length === 0 ? (
        suppliers.length > 0 && <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">{tr('Ничего не найдено.')}</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => setOpened(x)} className="flex w-full flex-wrap items-start gap-3 rounded-lg border bg-card p-3 text-left shadow-soft outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-medium">{x.name}</span>
                  <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {x.category && <span>{x.category}</span>}
                    {x.contact && <span>{x.contact}</span>}
                    {x.phone && <span>{x.phone}</span>}
                    <span>{tr('предложений: {{n}}, выиграли: {{w}}', { n: x.quotes, w: x.wins })}</span>
                    {x.last_quote && <span>{tr('последнее: {{d}}', { d: day(x.last_quote) })}</span>}
                  </span>
                </span>
                {x.status === 'restricted' && <span className="shrink-0 rounded-full border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-xs text-red-800 dark:text-red-200">{tr('Ограниченный список')}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {opened && <SupplierDialog supplier={opened === 'new' ? null : opened} canManage={canManage} code={code} onClose={() => setOpened(null)} />}
    </div>
  )
}

const blank: SupplierInput = { name: '', tax_id: '', country: '', contact: '', phone: '', email: '', address: '', category: '', status: 'active', note: '' }

function SupplierDialog({ supplier, canManage, code, onClose }: { supplier: Supplier | null; canManage: boolean; code: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [v, setV] = useState<SupplierInput>(supplier ? { ...supplier } : blank)
  const set = (patch: Partial<SupplierInput>) => setV((x) => ({ ...x, ...patch }))
  const { data: history = [], isLoading } = useQuery({ ...supplierHistoryQuery(supplier?.id ?? ''), enabled: !!supplier && canManage })
  const save = useMutation({
    mutationFn: () => saveSupplier({ ...v, id: supplier?.id, name: v.name.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      toast.success(tr('Поставщик сохранён'))
      onClose()
    },
    onError: (e) => toast.error((e as { code?: string })?.code === '23505' ? tr('Поставщик с таким названием уже есть.') : (e as { code?: string })?.code === '42501' ? tr('Справочник ведут отдел закупок и руководители проектов.') : tr('Не удалось сохранить. Проверьте поля.')),
  })
  const nf = new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 2 })
  const input = (key: keyof SupplierInput, label: string, wide = false) => (
    <div className={cn('flex flex-col gap-1', wide && 'sm:col-span-2')}>
      <label htmlFor={`sp-${key}`} className="text-xs text-muted-foreground">
        {label}
      </label>
      <input id={`sp-${key}`} value={String(v[key] ?? '')} disabled={!canManage} onChange={(e) => set({ [key]: e.target.value })} className={cn(field, 'h-10')} />
    </div>
  )

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94svh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{supplier ? supplier.name : tr('Новый поставщик')}</DialogTitle>
          <DialogDescription>{supplier ? tr('Контакты, статус и история предложений.') : tr('Поставщика можно завести заранее — или он появится сам из предложения в заявке.')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (canManage && v.name.trim()) save.mutate()
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {input('name', tr('Название'), true)}
            {input('tax_id', tr('ИНН / идентификационный код'))}
            {input('country', tr('Страна'))}
            {input('contact', tr('Контактное лицо'))}
            {input('phone', tr('Телефон'))}
            {input('email', tr('E-mail'))}
            {input('category', tr('Что поставляет'))}
            {input('address', tr('Адрес'), true)}
          </div>
          <label className={cn('flex items-start gap-2.5 rounded-md border p-2.5 text-sm', v.status === 'restricted' && 'border-red-500/50 bg-red-500/10')}>
            <input type="checkbox" disabled={!canManage} checked={v.status === 'restricted'} onChange={(e) => set({ status: e.target.checked ? 'restricted' : 'active' })} className="mt-0.5 size-4" />
            <span className="flex flex-col">
              <span className="font-medium">{tr('Ограниченный список')}</span>
              <span className="text-xs text-muted-foreground">{tr('Систематически нарушает сроки или качество. Выбирать можно, но с предупреждением.')}</span>
            </span>
          </label>
          <div className="flex flex-col gap-1">
            <label htmlFor="sp-note" className="text-xs text-muted-foreground">
              {tr('Заметки: опыт работы, условия, кто рекомендовал')}
            </label>
            <textarea id="sp-note" rows={2} maxLength={2000} disabled={!canManage} value={v.note} onChange={(e) => set({ note: e.target.value })} className={cn(field, 'py-2')} />
          </div>
          {canManage && (
            <div>
              <Button type="submit" disabled={save.isPending || !v.name.trim()}>
                {tr('Сохранить')}
              </Button>
            </div>
          )}
        </form>

        {supplier && canManage && (
          <section className="flex flex-col gap-2" aria-label={tr('История предложений')}>
            <h3 className="text-sm font-semibold">{tr('История предложений')}</h3>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">{tr('Загружаем…')}</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tr('Предложений пока не было.')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {history.map((h) => (
                  <li key={h.quote_id} className={cn('rounded-md border p-2.5 text-sm', h.status === 'selected' && 'border-emerald-600/40 bg-emerald-500/5')}>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-xs text-muted-foreground">{day(h.created_at)}</span>
                      {h.request_id ? (
                        <Link to="/projects/$code/requests" params={{ code: h.project_code }} search={{ r: h.request_id }} className="font-medium underline-offset-2 hover:underline">
                          {h.request_key} · {h.title}
                        </Link>
                      ) : (
                        <span className="font-medium">
                          {h.rfq_key} · {h.title}
                        </span>
                      )}
                      {h.status === 'selected' && <span className="text-xs font-medium text-emerald-800 dark:text-emerald-300">{tr('выбрано')}</span>}
                      {h.project_code !== code && <span className="text-xs text-muted-foreground">{h.project_code}</span>}
                    </div>
                    <ul className="mt-1 text-xs text-muted-foreground">
                      {h.lines.map((l, i) => (
                        <li key={i} className="tabular-nums">
                          {l.name}: {nf.format(l.unit_price)} {symbolOf(h.currency)} / {l.unit || tr('ед.')}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {tr('Закрыть')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
