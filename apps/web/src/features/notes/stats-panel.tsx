import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import { DashTabs } from '@/features/dashboard/tabs'
import { Fold } from '@/features/dashboard/fold'
import { fmtDuration, STALE_DAYS, type BarStat, type NoteStats } from '@/features/notes/api'
import { cn } from '@/lib/utils'

function Tile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'warn' }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5 bg-card px-4 py-3', tone === 'warn' && 'bg-amber-500/10')}>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span className="text-3xl font-semibold tabular-nums leading-tight tracking-tight">{value}</span>
      {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

/** Строки с полосой: сколько открытых (тёмная часть) и закрытых (светлая) заметок. Нажатие включает фильтр по этой строке. */
function BarList({ rows, onPick, empty }: { rows: BarStat[]; onPick?: (row: BarStat) => void; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>
  const max = Math.max(...rows.map((r) => r.open + r.done), 1)
  return (
    <ul className="grid gap-x-8 gap-y-0.5 lg:grid-cols-2">
      {rows.slice(0, 12).map((r) => {
        const total = r.open + r.done
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                <b className="font-semibold text-foreground">{r.open}</b> {tr('откр.')} · {r.done} {tr('закр.')}
              </span>
            </span>
            <span className="flex h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
              <span className="bg-signal" style={{ width: `${(r.open / max) * 100}%` }} />
              <span className="bg-foreground/25" style={{ width: `${(r.done / max) * 100}%` }} />
            </span>
          </>
        )
        return (
          <li key={r.key}>
            {onPick ? (
              <button type="button" onClick={() => onPick(r)} title={`${r.label}: ${total}`} className="flex min-h-11 w-full flex-col justify-center gap-1.5 rounded-md px-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring">
                {body}
              </button>
            ) : (
              <div className="flex min-h-11 flex-col justify-center gap-1.5 px-2">{body}</div>
            )}
          </li>
        )
      })}
      {rows.length > 12 && <li className="px-2 text-xs text-muted-foreground lg:col-span-2">{tr('И ещё {{n}}', { n: rows.length - 12 })}</li>}
    </ul>
  )
}

const dayFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short' })

/** 14 дней: сколько заметок создано (тёмный столбик) и закрыто (светлый) за каждый день. */
function DayChart({ days }: { days: NoteStats['byDay'] }) {
  const max = Math.max(...days.flatMap((d) => [d.created, d.closed]), 1)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-28 items-end gap-1" role="img" aria-label={tr('Заметки по дням за две недели: создано и закрыто')}>
        {days.map((d) => (
          <div key={d.date} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${dayFmt.format(new Date(`${d.date}T00:00:00`))}: ${d.created} ${tr('создано')}, ${d.closed} ${tr('закрыто')}`}>
            <div className="flex items-end justify-center gap-px">
              <span className="w-1/2 rounded-t-sm bg-signal" style={{ height: `${(d.created / max) * 100}px` }} />
              <span className="w-1/2 rounded-t-sm bg-foreground/25" style={{ height: `${(d.closed / max) * 100}px` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
        <span>{dayFmt.format(new Date(`${days[0].date}T00:00:00`))}</span>
        <span className="flex gap-3">
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-signal" />{tr('создано')}</span>
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-foreground/25" />{tr('закрыто')}</span>
        </span>
        <span>{dayFmt.format(new Date(`${days[days.length - 1].date}T00:00:00`))}</span>
      </div>
    </div>
  )
}

export interface StatPick {
  kind: 'addressee' | 'floor' | 'author'
  key: string
}

/**
 * Статистика заметок по текущим условиям (без фильтра статуса): главные числа всегда на виду,
 * разбивки по адресатам, этажам, авторам и дням — во вкладках (на телефоне свёрнуты).
 */
export function NoteStatsPanel({ stats, storageKey, onPick, onStale }: { stats: NoteStats; storageKey: string; onPick: (p: StatPick) => void; onStale: () => void }) {
  return (
    <section aria-label={tr('Статистика заметок')} className="flex flex-col gap-3">
      {/* На телефоне вся статистика свёрнута в одну строку, чтобы список заметок был виден сразу; на компьютере раскрыта */}
      <Fold
        title={tr('Статистика')}
        summary={tr('Открыто: {{open}} · закрыто: {{done}}', { open: stats.open, done: stats.done }) + (stats.stale > 0 ? tr(' · висят долго: {{n}}', { n: stats.stale }) : '')}
      >
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border shadow-soft sm:grid-cols-4">
        <Tile label={tr('Открытые')} value={stats.open} hint={tr('из {{n}} всего', { n: stats.total })} />
        <Tile label={tr('Закрытые')} value={stats.done} hint={tr('за 7 дней: {{n}}', { n: stats.closed7 })} />
        <Tile label={tr('Новых за 7 дней')} value={stats.created7} hint={tr('с фото: {{n}}', { n: stats.withPhoto })} />
        <Tile label={tr('Закрывают за')} value={fmtDuration(stats.avgCloseHours)} hint={tr('в среднем')} />
      </div>
      {stats.stale > 0 && (
        <button type="button" onClick={onStale} className="flex min-h-11 items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <span>{tr('Висят дольше {{d}} дней: {{n}}', { d: STALE_DAYS, n: stats.stale })}</span>
          <span className="ml-auto text-xs font-medium underline underline-offset-4">{tr('Показать')}</span>
        </button>
      )}
        <div className="rounded-lg border bg-card p-4 shadow-soft">
        <DashTabs
          storageKey={storageKey}
          label={tr('Разбивка заметок')}
          tabs={[
            { id: 'addressee', label: tr('Кому'), render: () => <BarList rows={stats.byAddressee} empty={tr('Заметок нет')} onPick={(r) => onPick({ kind: 'addressee', key: r.key })} /> },
            { id: 'floor', label: tr('Этажи'), render: () => <BarList rows={stats.byFloor} empty={tr('Заметок нет')} onPick={(r) => onPick({ kind: 'floor', key: r.key })} /> },
            { id: 'author', label: tr('Авторы'), render: () => <BarList rows={stats.byAuthor} empty={tr('Заметок нет')} onPick={(r) => onPick({ kind: 'author', key: r.key })} /> },
            { id: 'days', label: tr('Динамика'), render: () => <DayChart days={stats.byDay} /> },
          ]}
        />
        </div>
      </Fold>
    </section>
  )
}
