import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { tr } from '@/lib/tr'

/**
 * Группа фильтров, которая на телефоне сворачивается в одну кнопку «Фильтры» с числом включённых, а от планшета показывается как есть
 * (дети встают в строку родителя). Поиск и главная кнопка страницы остаются снаружи, чтобы список начинался на первом экране.
 */
export function MobileFilters({ activeCount = 0, children }: { activeCount?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-full items-center gap-2 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
      >
        <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden />
        <span className="flex-1 text-left font-medium">{tr('Фильтры')}</span>
        {activeCount > 0 && <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold tabular-nums text-primary-foreground">{activeCount}</span>}
        <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      <div className={cn(open ? 'flex flex-col gap-2' : 'hidden', 'sm:contents')}>{children}</div>
    </>
  )
}
