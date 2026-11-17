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
 * не запрашиваются. Выбранная вкладка запоминается для проекта. На телефоне и планшете вкладки переносятся на новые строки (без боковой прокрутки), на широком экране — полоса с подчёркиванием.
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
      <div ref={bar} role="tablist" aria-label={label} onKeyDown={onKey} className="flex flex-wrap gap-2 xl:flex-nowrap xl:gap-1 xl:overflow-x-auto xl:border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                'relative flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring xl:shrink-0 xl:rounded-none xl:border-0 xl:px-3 xl:focus-visible:ring-inset',
                on
                  ? 'border-primary bg-primary font-semibold text-signal xl:bg-transparent xl:text-foreground xl:after:absolute xl:after:inset-x-2 xl:after:bottom-0 xl:after:h-[3px] xl:after:rounded-t xl:after:bg-signal'
                  : 'bg-card text-muted-foreground hover:text-foreground',
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
