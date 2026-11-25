import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { PageHelp } from '@/components/page-help'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/auth-provider'
import { requestsQuery, waitsForMe, type RequestRow } from '@/features/procurement/api'
import { RequestCard } from '@/features/procurement/request-card'
import { RequestForm } from '@/features/procurement/request-form'
import { RequestList } from '@/features/procurement/request-list'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

const TABS = ['waiting', 'mine', 'work', 'done', 'all'] as const
type Tab = (typeof TABS)[number]

// Паттерн «Входящие»: заявки проекта на закупку — что ждёт моего шага, мои, в работе, завершённые. Карточка открывается по ?r=
export const Route = createFileRoute('/_app/projects/$code/requests')({
  validateSearch: z.object({ r: z.string().optional(), tab: z.enum(TABS).optional() }),
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([queryClient.ensureQueryData(requestsQuery(project.id)), queryClient.ensureQueryData(myPermissionsQuery(project.id))])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем заявки…')}</p>,
  component: RequestsPage,
})

const DONE = ['delivered', 'rejected', 'cancelled']

function RequestsPage() {
  const { code } = Route.useParams()
  const { r: openedId, tab: tabParam } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { session } = useAuth()
  const me = session?.user.id
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: rows } = useSuspenseQuery(requestsQuery(p.id))
  const { data: perms } = useSuspenseQuery(myPermissionsQuery(p.id))
  const canRequest = perms.includes('procurement.request')
  const isBuyer = perms.includes('procurement.manage') || perms.includes('procurement.approve')
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const today = new Date().toLocaleDateString('sv')

  const groups: Record<Tab, RequestRow[]> = {
    waiting: rows.filter((r) => waitsForMe(r, me, isBuyer)),
    mine: rows.filter((r) => r.requested_by === me),
    work: rows.filter((r) => r.status !== 'draft' && !DONE.includes(r.status)),
    done: rows.filter((r) => DONE.includes(r.status)),
    all: rows,
  }
  const tab: Tab = tabParam ?? (groups.waiting.length > 0 ? 'waiting' : isBuyer || groups.mine.length === 0 ? 'work' : 'mine')
  const s = search.trim().toLowerCase()
  const shown = groups[tab].filter((r) => !s || `${r.key} ${r.title} ${r.supplier} ${r.requester_name ?? ''}`.toLowerCase().includes(s))
  const labels: Record<Tab, string> = { waiting: tr('Ждут меня'), mine: tr('Мои заявки'), work: tr('В работе'), done: tr('Завершённые'), all: tr('Все') }

  const fresh = rows.filter((r) => r.status === 'submitted').length
  const onTheWay = rows.filter((r) => r.status === 'ordered' || r.status === 'shipped').length
  const late = rows.filter((r) => (r.status === 'ordered' || r.status === 'shipped') && r.expected_at && r.expected_at < today).length
  const open = (id: string | undefined) => navigate({ search: (x) => ({ ...x, r: id }), replace: !id })

  return (
    <div className="flex flex-col gap-4">
      <PageHelp id="requests" title={tr('Как работает заявка на закупку')}>
        <p>{tr('Площадка отправляет заявку → отдел закупок проверяет склад и собирает предложения (лучше три) → выбранных закупщиком согласующих просят одобрить → инициатор подтверждает выбор → заказ → «в пути» с ожидаемой датой → получено.')}</p>
        <p>{tr('Во вкладке «Ждут меня» — заявки, где нужен ваш шаг. Отдел закупок (роль компании «Отдел закупок») видит заявки всех проектов. Уведомления о каждом шаге приходят в приложение, на почту и на телефон.')}</p>
      </PageHelp>

      <p className="text-sm">
        {groups.waiting.length > 0
          ? tr('Ваш шаг ждут заявки: {{n}}.', { n: groups.waiting.length })
          : rows.length === 0
            ? tr('Заявок пока нет.')
            : tr('Сейчас ваш шаг не нужен ни в одной заявке.')}
      </p>

      {isBuyer && rows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label={tr('Новые, никто не взял')} value={fresh} tone={fresh > 0 ? 'amber' : undefined} />
          <Stat label={tr('Заказано и едет')} value={onTheWay} />
          <Stat label={tr('Поставка опаздывает')} value={late} tone={late > 0 ? 'red' : undefined} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label={tr('Группы заявок')} className="flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => navigate({ search: (x) => ({ ...x, tab: t }), replace: true })}
              className={cn('flex h-9 items-center gap-1.5 rounded-md px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', tab === t ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              {labels[t]}
              <span className={cn('rounded-full px-1.5 text-xs tabular-nums', t === 'waiting' && groups.waiting.length > 0 ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{groups[t].length}</span>
            </button>
          ))}
        </div>
        <label className="relative w-full sm:ml-auto sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input aria-label={tr('Поиск по заявкам')} placeholder={tr('Поиск: номер, название, поставщик')} value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 w-full rounded-md border bg-background pl-8 pr-3 text-sm" />
        </label>
        {canRequest && (
          <Button onClick={() => setCreating(true)}>
            <Plus /> {tr('Новая заявка')}
          </Button>
        )}
      </div>

      <RequestList
        rows={shown}
        showProject={false}
        onOpen={open}
        empty={
          s
            ? tr('Ничего не найдено.')
            : rows.length === 0
              ? canRequest
                ? tr('Заведите первую заявку, когда на площадке что-то понадобится.')
                : tr('Заявок пока нет.')
              : tab === 'waiting'
                ? tr('Ничего не ждёт вашего шага.')
                : tr('В этой группе заявок нет.')
        }
      />

      {creating && <RequestForm projectId={p.id} request={null} onClose={() => setCreating(false)} onSaved={(id) => open(id)} />}
      {openedId && <RequestCard id={openedId} onClose={() => open(undefined)} />}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'amber' | 'red' }) {
  return (
    <section className={cn('flex flex-col gap-0.5 rounded-lg border bg-card p-3 shadow-soft', tone === 'amber' && 'border-amber-500/50', tone === 'red' && 'border-red-500/50')}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('text-2xl font-semibold tabular-nums', tone === 'red' && 'text-red-700 dark:text-red-300')}>{value}</span>
    </section>
  )
}
