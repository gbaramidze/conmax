import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useMediaQuery } from '@/features/calendar/use-calendar'
import { cn } from '@/lib/utils'

/**
 * Блок обзора, который на телефоне сворачивается в одну строку (название, коротко о главном, стрелка), а на компьютере
 * показывается как есть. Свёрнутое содержимое не строится и данные для него не запрашиваются: страница на телефоне
 * остаётся короткой и быстрой, а нужное открывается одним касанием.
 */
export function Fold({ title, summary, children, defaultOpen = false }: { title: string; summary?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const desktop = useMediaQuery('(min-width: 1024px)')
  const [open, setOpen] = useState(defaultOpen)
  if (desktop) return <>{children}</>
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-14 w-full items-center gap-3 rounded-lg border bg-card px-4 py-2 text-left shadow-soft outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{title}</span>
          {summary && <span className="block truncate text-xs text-muted-foreground">{summary}</span>}
        </span>
        <ChevronDown className={cn('size-5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && children}
    </div>
  )
}
