import { Info } from 'lucide-react'
import { useState } from 'react'
import { tr } from '@/lib/tr'

const storageKey = (id: string) => `page-help:${id}`

function readOpen(id: string): boolean {
  try {
    return localStorage.getItem(storageKey(id)) !== 'closed'
  } catch {
    return true
  }
}

/**
 * Короткое пояснение «Что это и зачем» вверху страницы, которая новому человеку может быть непонятна.
 * Раскрыто, пока человек его не скрыл; выбор запоминается в браузере (на каждую страницу отдельно).
 */
export function PageHelp({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(() => readOpen(id))
  const toggle = () => {
    const next = !open
    setOpen(next)
    try {
      localStorage.setItem(storageKey(id), next ? 'open' : 'closed')
    } catch {
      // выбор запомнится только до перезагрузки
    }
  }
  return (
    <section className="rounded-lg border bg-muted/40" aria-label={title}>
      <div className="flex items-center gap-2 px-3 py-2">
        <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="min-w-0 flex-1 text-sm font-medium">{title}</h2>
        <button type="button" aria-expanded={open} onClick={toggle} className="min-h-11 rounded-md px-3 text-xs sm:min-h-8 sm:px-2 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          {open ? tr('Скрыть') : tr('Показать')}
        </button>
      </div>
      {open && <div className="flex max-w-prose flex-col gap-2 px-3 pb-3 text-sm text-muted-foreground">{children}</div>}
    </section>
  )
}
