import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface DashTab {
  id: string
  label: string
  /** Число рядом с названием, например количество участников */
  count?: number
  render: () => ReactNode
}

function readSaved(key: string, ids: string[]): string | null {
  try {
    const v = localStorage.getItem(key)
    return v && ids.includes(v) ? v : null
  } catch {
    return null
  }
}

/**
 * Вкладки нижней части обзора: вместо длинной ленты блоков открыта одна вкладка, остальные не строятся и данные для них
 * не запрашиваются. Выбранная вкладка запоминается для проекта. Полоса вкладок прокручивается вбок, если не помещается.
 * Стрелки влево и вправо переключают вкладки, Home и End идут к первой и последней.
 */
export function DashTabs({ storageKey, tabs, label }: { storageKey: string; tabs: DashTab[]; label: string }) {
  const ids = tabs.map((t) => t.id)
  const [active, setActive] = useState(() => readSaved(storageKey, ids) ?? ids[0])
  const bar = useRef<HTMLDivElement>(null)
  const current = tabs.find((t) => t.id === active) ?? tabs[0]

  const select = (id: string, focus = false) => {
    setActive(id)
    try {
      localStorage.setItem(storageKey, id)
    } catch {
      // выбор запомнится только до перезагрузки
    }
    if (focus) bar.current?.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)?.focus()
  }

  const onKey = (e: KeyboardEvent) => {
    const i = ids.indexOf(current.id)
    const next = e.key === 'ArrowRight' ? ids[(i + 1) % ids.length] : e.key === 'ArrowLeft' ? ids[(i - 1 + ids.length) % ids.length] : e.key === 'Home' ? ids[0] : e.key === 'End' ? ids[ids.length - 1] : null
    if (next) {
      e.preventDefault()
      select(next, true)
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-label={label}>
      <div ref={bar} role="tablist" aria-label={label} onKeyDown={onKey} className="-mx-4 flex gap-1 overflow-x-auto border-b px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => {
          const on = t.id === current.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`dash-tab-${t.id}`}
              data-tab={t.id}
              aria-selected={on}
              aria-controls="dash-tabpanel"
              tabIndex={on ? 0 : -1}
              onClick={() => select(t.id)}
              className={cn(
                'relative flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                on ? 'font-semibold text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-t after:bg-signal' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
              {t.count !== undefined && <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{t.count}</span>}
            </button>
          )
        })}
      </div>
      <div role="tabpanel" id="dash-tabpanel" aria-labelledby={`dash-tab-${current.id}`} className="flex flex-col gap-4">
        {current.render()}
      </div>
    </section>
  )
}
