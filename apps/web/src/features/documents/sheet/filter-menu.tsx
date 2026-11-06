import { tr } from '@/lib/tr'
import { ArrowDownAZ, ArrowUpZA, ChevronDown, Filter } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useMemo, useState } from 'react'
import { colName } from '../edit/sheet-model'

interface Props {
  col: number
  /** Значения колонки со счётчиками; считается только при открытом списке */
  getValues: () => { value: string; count: number }[]
  /** Что скрыто в этой колонке */
  excluded: Set<string> | undefined
  onChange: (excluded: Set<string>) => void
  /** Сортировка есть только в просмотре: в редакторе порядок строк менять нельзя */
  sort?: { dir: 1 | -1 } | null
  onSort?: (dir: 1 | -1 | null) => void
}

/** Кнопка фильтра в шапке колонки: список значений с поиском, «выбрать все» и сортировка */
export function FilterButton({ col, getValues, excluded, onChange, sort, onSort }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const values = useMemo(() => (open ? getValues() : []), [open, getValues])
  const active = !!excluded && excluded.size > 0
  const q = query.trim().toLowerCase()
  const shown = (q ? values.filter((v) => v.value.toLowerCase().includes(q)) : values).slice(0, 300)

  const toggle = (value: string) => {
    const next = new Set(excluded ?? [])
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(next)
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQuery('')
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={tr('Фильтр колонки {{col}}{{on}}', { col: colName(col), on: active ? tr(' (включён)') : '' })}
          title={tr('Фильтр')}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className={`grid size-[18px] place-items-center rounded-sm border bg-white outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${active || sort ? 'border-blue-500 text-blue-600' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}
        >
          {active ? <Filter className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-[80] w-64 rounded-md border bg-popover p-2 text-sm text-popover-foreground shadow-md outline-none"
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement).querySelector('input')?.focus()
          }}
        >
          {onSort && (
            <div className="mb-2 flex gap-1">
              <button type="button" onClick={() => onSort(sort?.dir === 1 ? null : 1)} className={`flex min-h-9 flex-1 items-center justify-center gap-1 rounded-md border px-2 text-xs hover:bg-accent ${sort?.dir === 1 ? 'bg-accent' : ''}`}>
                <ArrowDownAZ className="size-4" />{tr('А → Я')}</button>
              <button type="button" onClick={() => onSort(sort?.dir === -1 ? null : -1)} className={`flex min-h-9 flex-1 items-center justify-center gap-1 rounded-md border px-2 text-xs hover:bg-accent ${sort?.dir === -1 ? 'bg-accent' : ''}`}>
                <ArrowUpZA className="size-4" />{tr('Я → А')}</button>
            </div>
          )}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr('Найти значение')}
            aria-label={tr('Найти значение в списке')}
            className="mb-2 h-9 w-full rounded-md border bg-background px-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
          />
          <div className="mb-1 flex gap-3 text-xs">
            <button type="button" className="text-primary underline underline-offset-2" onClick={() => onChange(new Set())}>{tr('Выбрать все')}</button>
            <button type="button" className="text-primary underline underline-offset-2" onClick={() => onChange(new Set([...(excluded ?? []), ...values.map((v) => v.value)]))}>{tr('Снять все')}</button>
          </div>
          <div className="max-h-56 overflow-y-auto" role="group" aria-label={tr('Значения колонки')}>
            {shown.map((v) => (
              <label key={v.value} className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-1 hover:bg-accent">
                <input type="checkbox" className="size-4 shrink-0" checked={!excluded?.has(v.value)} onChange={() => toggle(v.value)} />
                <span className="min-w-0 flex-1 truncate">{v.value === '' ? tr('(пусто)') : v.value}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{v.count}</span>
              </label>
            ))}
            {shown.length === 0 && <p className="px-1 py-2 text-xs text-muted-foreground">{tr('Ничего не найдено.')}</p>}
            {values.length > shown.length && !q && <p className="px-1 py-1 text-xs text-muted-foreground">{tr('Показаны первые')}{' '}{shown.length}{tr('из')}{' '}{values.length}{tr(': уточните поиском.')}</p>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
