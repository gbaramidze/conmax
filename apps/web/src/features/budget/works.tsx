import { tr } from '@/lib/tr'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { activitiesQuery } from '@/features/schedule/api'
import { fmtDate } from '@/features/schedule/model'
import { ItemSelect } from './contracts'
import { allocateBudget, budgetErrorText, fmtMoney, type ActivityBudget, type BudgetModel, type CbsItem } from './api'

/** Распределение бюджета статьи по работам графика: основа для плановой стоимости (PV) и освоенного объёма (EV). */
export function AllocateTab({ projectId, items, model, activityBudgets, canEdit }: { projectId: string; items: CbsItem[]; model: BudgetModel; activityBudgets: ActivityBudget[]; canEdit: boolean }) {
  const qc = useQueryClient()
  const { data: activities = [], isLoading } = useQuery(activitiesQuery(projectId))
  const [itemId, setItemId] = useState('')
  const [basis, setBasis] = useState<'duration' | 'equal'>('duration')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const byAct = useMemo(() => new Map(activityBudgets.map((a) => [a.activity_id, a])), [activityBudgets])
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const row = model.rows.find((r) => r.id === itemId)
  const allocated = activityBudgets.filter((a) => a.item_id === itemId).reduce((s, a) => s + a.amount, 0)

  // при смене статьи выбираются работы, уже закреплённые за ней
  useEffect(() => {
    setPicked(new Set(activityBudgets.filter((a) => a.item_id === itemId).map((a) => a.activity_id)))
  }, [itemId, activityBudgets])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return activities.filter((a) => a.kind === 'task' && (!q || a.name.toLowerCase().includes(q)))
  }, [activities, query])
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const otherCount = [...picked].filter((id) => byAct.has(id) && byAct.get(id)!.item_id !== itemId).length

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-sm text-muted-foreground">{tr('Бюджет статьи делится между работами графика: поровну или пропорционально длительности. Эти доли нужны, чтобы считать плановую стоимость работ и освоенный объём.')}</p>
      {!canEdit && <p className="text-sm text-muted-foreground">{tr('Распределять бюджет могут экономист и руководитель проекта.')}</p>}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="al-item">{tr('Статья бюджета')}</Label>
          <ItemSelect id="al-item" items={items} value={itemId} onChange={setItemId} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="al-basis">{tr('Как делить')}</Label>
          <Select value={basis} onValueChange={(v) => setBasis(v as 'duration' | 'equal')}>
            <SelectTrigger id="al-basis" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="duration">{tr('По длительности')}</SelectItem>
              <SelectItem value="equal">{tr('Поровну')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {row && (
        <p className="text-sm">{tr('Бюджет статьи с вложенными:')}{' '}<span className="font-semibold tabular-nums">{fmtMoney(row.bac)}</span>{tr('; закреплено за работами:')}{' '}
          <span className={`font-semibold tabular-nums ${Math.abs(allocated - row.bac) > 0.5 && allocated > 0 ? 'text-amber-700 dark:text-amber-300' : ''}`}>{fmtMoney(allocated)}</span>
          {allocated > 0 && Math.abs(allocated - row.bac) > 0.5 && tr(' — бюджет изменился, распределите заново')}
        </p>
      )}
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Найти работу')} aria-label={tr('Найти работу')} className="pl-9" />
      </div>
      <div className="max-h-[50svh] overflow-y-auto rounded-lg border bg-card">
        {list.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{isLoading ? tr('Загружаем график…') : tr('В графике нет подходящих работ.')}</p>
        ) : (
          <ul className="divide-y">
            {list.map((a) => {
              const cur = byAct.get(a.id)
              return (
                <li key={a.id}>
                  <label className={`flex min-h-12 items-start gap-3 px-3 py-2 ${canEdit && itemId ? 'cursor-pointer hover:bg-muted/50' : 'opacity-70'}`}>
                    <input type="checkbox" className="mt-1 size-4" disabled={!canEdit || !itemId} checked={picked.has(a.id)} onChange={() => toggle(a.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{a.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {fmtDate(a.start_date)} – {fmtDate(a.finish_date)} · {a.duration_days}{tr('раб. дн.')}</span>
                    </span>
                    <span className="shrink-0 text-right text-xs text-muted-foreground">
                      {cur ? (
                        <>
                          <span className="block tabular-nums text-foreground">{fmtMoney(cur.amount)}</span>
                          <span className="ident">{itemById.get(cur.item_id)?.code}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={!itemId || picked.size === 0 || busy}
            onClick={async () => {
              if (otherCount > 0 && !window.confirm(tr('У {{otherCount}} выбранных работ уже есть доля другой статьи. Перенести их на эту статью?', { otherCount }))) return
              setBusy(true)
              try {
                const total = await allocateBudget(itemId, [...picked], basis)
                await qc.invalidateQueries({ queryKey: ['budget', 'activity-budgets', projectId] })
                toast.success(tr('Распределено {{v1}} на работ: {{size}}', { v1: fmtMoney(total), size: picked.size }))
              } catch (e) {
                toast.error(budgetErrorText(e, tr('Не удалось распределить бюджет.')))
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? tr('Распределяем…') : tr('Распределить на выбранные ({{size}})', { size: picked.size })}
          </Button>
          {itemId && row && row.bac === 0 && <p className="text-xs text-muted-foreground">{tr('У статьи нет суммы в бюджете — доли будут нулевыми.')}</p>}
        </div>
      )}
    </div>
  )
}
