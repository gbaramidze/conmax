import { useQuery } from '@tanstack/react-query'
import { Plus, Search, SlidersHorizontal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/auth-provider'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'
import { settingsQuery, waitsForMe, type RequestRow } from './api'
import { RequestCard } from './request-card'
import { RequestForm } from './request-form'
import { RequestList } from './request-list'
import { ProcurementSettingsDialog } from './settings-dialog'

export const BOARD_TABS = ['waiting', 'mine', 'work', 'done', 'all'] as const
export type BoardTab = (typeof BOARD_TABS)[number]
const DONE = ['delivered', 'rejected', 'cancelled']

/**
 * Заявки на закупку с вкладками «Ждут меня / Мои / В работе / Завершённые / Все», поиском, сводкой для закупщика,
 * созданием заявки и карточкой. Общий для раздела проекта и для заявок отделов на странице «Закупки».
 */
export function RequestsBoard(props: {
  projectId: string
  rows: RequestRow[]
  canRequest: boolean
  isBuyer: boolean
  /** заявки отделов: в форме выбирается отдел, в строке показывается отдел */
  internal?: boolean
  help: ReactNode
  emptyText: string
  tab: BoardTab | undefined
  onTab: (t: BoardTab) => void
  openedId: string | undefined
  onOpen: (id: string | undefined) => void
}) {
  const { rows, canRequest, isBuyer, tab: tabParam, onTab, openedId, onOpen } = props
  const { session } = useAuth()
  const me = session?.user.id
  const [creating, setCreating] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { data: settings } = useQuery(settingsQuery)
  const [search, setSearch] = useState('')
  const today = new Date().toLocaleDateString('sv')

  const groups: Record<BoardTab, RequestRow[]> = {
    waiting: rows.filter((r) => waitsForMe(r, me, isBuyer)),
    mine: rows.filter((r) => r.requested_by === me),
    work: rows.filter((r) => r.status !== 'draft' && !DONE.includes(r.status)),
    done: rows.filter((r) => DONE.includes(r.status)),
    all: rows,
  }
  const tab: BoardTab = tabParam ?? (groups.waiting.length > 0 ? 'waiting' : isBuyer || groups.mine.length === 0 ? 'work' : 'mine')
  const s = search.trim().toLowerCase()
  const shown = groups[tab].filter((r) => !s || `${r.key} ${r.title} ${r.supplier} ${r.requester_name ?? ''} ${r.department_name ?? ''}`.toLowerCase().includes(s))
  const labels: Record<BoardTab, string> = { waiting: tr('Ждут меня'), mine: tr('Мои заявки'), work: tr('В работе'), done: tr('Завершённые'), all: tr('Все') }
  const fresh = rows.filter((r) => r.status === 'submitted').length
  const onTheWay = rows.filter((r) => r.status === 'ordered' || r.status === 'shipped').length
  const late = rows.filter((r) => (r.status === 'ordered' || r.status === 'shipped') && r.expected_at && r.expected_at < today).length

  return (
    <div className="flex flex-col gap-4">
      {props.help}
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
          {BOARD_TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => onTab(t)}
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
        {settings?.can_edit && (
          <Button variant="outline" onClick={() => setSettingsOpen(true)}>
            <SlidersHorizontal /> {tr('Пороги и сроки')}
          </Button>
        )}
        {canRequest && (
          <Button onClick={() => setCreating(true)}>
            <Plus /> {tr('Новая заявка')}
          </Button>
        )}
      </div>

      <RequestList
        rows={shown}
        showProject={false}
        onOpen={onOpen}
        empty={s ? tr('Ничего не найдено.') : rows.length === 0 ? props.emptyText : tab === 'waiting' ? tr('Ничего не ждёт вашего шага.') : tr('В этой группе заявок нет.')}
      />

      {creating && <RequestForm projectId={props.projectId} internal={props.internal} request={null} onClose={() => setCreating(false)} onSaved={(id) => onOpen(id)} />}
      {openedId && <RequestCard id={openedId} onClose={() => onOpen(undefined)} />}
      {settingsOpen && settings && <ProcurementSettingsDialog settings={settings} onClose={() => setSettingsOpen(false)} />}
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
