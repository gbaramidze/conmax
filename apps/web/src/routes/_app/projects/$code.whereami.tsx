import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { LocateFixed, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHelp } from '@/components/page-help'
import { Button } from '@/components/ui/button'
import { collectFixes, locate, suitability, summarize, type Reading } from '@/features/locations/floor-calibration'
import { flattenTree, locationLabel, locationsQuery } from '@/features/locations/api'
import { projectByCodeQuery } from '@/features/projects/api'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

// Паттерн «Форма»: калибровка этажей по высоте телефона и определение, на каком этаже вы сейчас
export const Route = createFileRoute('/_app/projects/$code/whereami')({
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await queryClient.ensureQueryData(locationsQuery(project.id))
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем…')}</p>,
  component: WhereAmIPage,
})

const SAMPLE_MS = 10_000

function load(key: string): Record<string, Reading> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, Reading>
  } catch {
    return {}
  }
}

function errorText(e: unknown): string {
  const code = (e as { code?: number } | null)?.code
  if (code === 1) return tr('Нет разрешения на геолокацию. Разрешите её для этого сайта в настройках браузера.')
  if (code === 2 || code === 3) return tr('Не удалось определить положение. Выйдите к окну или на открытое место и повторите.')
  return tr('Геолокация недоступна в этом браузере.')
}

function WhereAmIPage() {
  const { code } = Route.useParams()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: rows } = useSuspenseQuery(locationsQuery(p.id))
  const floors = useMemo(() => flattenTree(rows).filter((n) => n.kind === 'floor'), [rows])
  const storageKey = `floor-cal:${p.id}`
  const [saved, setSaved] = useState(() => load(storageKey))
  const [busy, setBusy] = useState<string | 'where' | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ now: Reading; found: NonNullable<ReturnType<typeof locate>> } | { noAltitude: true } | null>(null)

  const persist = (next: Record<string, Reading>) => {
    setSaved(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      // калибровка останется только до перезагрузки
    }
  }

  async function measure(forFloor: string | 'where') {
    setBusy(forFloor)
    setError(null)
    setResult(null)
    setProgress(0)
    try {
      const fixes = await collectFixes(SAMPLE_MS, (ms) => setProgress(Math.min(100, Math.round((ms / SAMPLE_MS) * 100))))
      const reading = summarize(fixes)
      if (forFloor === 'where') {
        if (!reading) setResult({ noAltitude: true })
        else {
          const found = locate(reading, saved)
          if (found) setResult({ now: reading, found })
          else setError(tr('Сначала откалибруйте хотя бы один этаж.'))
        }
      } else if (!reading) {
        setResult({ noAltitude: true })
      } else {
        persist({ ...saved, [forFloor]: reading })
      }
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const label = (id: string) => {
    const f = floors.find((x) => x.id === id)
    return f ? locationLabel(f.path, rows) : id
  }
  const fit = suitability(
    floors.map((f) => f.id),
    saved,
  )
  const secure = typeof window !== 'undefined' && window.isSecureContext
  const calibrated = floors.filter((f) => saved[f.id]).length

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHelp id="whereami" title={tr('Как определить этаж по высоте')}>
        <p>{tr('Обойдите этажи и на каждом нажмите «Я здесь»: телефон 10 секунд измеряет высоту и запоминает её. Потом «Где я?» сравнит текущую высоту с запомненными и назовёт ближайший этаж.')}</p>
        <p>{tr('Точность зависит от телефона: высота по GPS часто плавает на несколько метров. Ниже показывается, насколько запомненные этажи отличаются друг от друга и от шума замеров: если разница мала, способ для вашего телефона не подойдёт, лучше QR-наклейки на этажах.')}</p>
      </PageHelp>

      {!secure && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          {tr('Геолокация работает только на защищённом адресе (https) или на localhost. Откройте приложение по https, иначе браузер не даст высоту.')}
        </p>
      )}

      <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-soft" aria-label={tr('Где я')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{tr('Где я?')}</h2>
          <Button className="max-sm:h-12 max-sm:w-full" disabled={busy !== null || calibrated === 0 || !secure} onClick={() => measure('where')}>
            <LocateFixed /> {busy === 'where' ? tr('Измеряем… {{n}}%', { n: progress }) : tr('Определить этаж')}
          </Button>
        </div>
        {calibrated === 0 && <p className="text-sm text-muted-foreground">{tr('Сначала откалибруйте этажи ниже.')}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {result && 'noAltitude' in result && (
          <p className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">{tr('Телефон не отдаёт высоту (или отдаёт слишком редко). Этот способ на нём не сработает: используйте QR-наклейки на этажах.')}</p>
        )}
        {result && 'found' in result && (
          <div className={cn('flex flex-col gap-2 rounded-md border p-3', result.found.verdict === 'confident' ? 'border-emerald-600/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10')}>
            <p className="text-lg font-semibold">{label(result.found.best.id)}</p>
            <p className="text-sm">
              {result.found.verdict === 'confident' ? tr('Уверенно: высота совпала с запомненной и заметно отличается от соседних этажей.') : tr('Неуверенно: соседние этажи по высоте слишком близки к шуму замеров. Проверьте глазами.')}
            </p>
            <p className="text-xs tabular-nums text-muted-foreground">{tr('Сейчас: {{alt}} м, разброс {{s}} м, замеров {{n}}', { alt: result.now.alt.toFixed(1), s: result.now.spread.toFixed(1), n: result.now.n })}</p>
            <ul className="text-xs tabular-nums text-muted-foreground">
              {result.found.ranked.slice(0, 3).map((c) => (
                <li key={c.id}>
                  {label(c.id)}: {tr('отличие {{d}} м', { d: c.diff.toFixed(1) })}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-soft" aria-label={tr('Калибровка этажей')}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">{tr('Калибровка этажей')}</h2>
          <span className="text-xs text-muted-foreground">{tr('Откалибровано: {{n}} из {{total}}', { n: calibrated, total: floors.length })}</span>
        </div>
        {fit && (
          <p className={cn('rounded-md border p-2 text-sm', fit.ok ? 'border-emerald-600/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10')}>
            {fit.ok
              ? tr('Способ подходит: соседние этажи отличаются минимум на {{g}} м при шуме замеров до {{s}} м.', { g: fit.minGap.toFixed(1), s: fit.maxSpread.toFixed(1) })
              : tr('Способ ненадёжен: соседние этажи отличаются минимум на {{g}} м, а шум замеров до {{s}} м. Лучше QR-наклейки.', { g: fit.minGap.toFixed(1), s: fit.maxSpread.toFixed(1) })}
          </p>
        )}
        {floors.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {tr('В структуре проекта нет этажей.')}{' '}
            <Link to="/projects/$code/locations" params={{ code }} className="underline underline-offset-2">
              {tr('Открыть структуру')}
            </Link>
          </p>
        ) : (
          <ul className="divide-y">
            {floors.map((f) => {
              const r = saved[f.id]
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                  <span className="min-w-0 flex-1 basis-40">
                    <span className="block font-medium">{locationLabel(f.path, rows)}</span>
                    <span className="block text-xs tabular-nums text-muted-foreground">
                      {r ? tr('Высота {{alt}} м, разброс {{s}} м, замеров {{n}}', { alt: r.alt.toFixed(1), s: r.spread.toFixed(1), n: r.n }) : tr('Не откалиброван')}
                    </span>
                  </span>
                  <Button variant={r ? 'outline' : 'default'} size="sm" className="max-sm:h-11" disabled={busy !== null || !secure} onClick={() => measure(f.id)}>
                    {busy === f.id ? tr('Измеряем… {{n}}%', { n: progress }) : r ? tr('Замерить заново') : tr('Я здесь')}
                  </Button>
                  {r && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="max-sm:size-11"
                      aria-label={tr('Забыть замер')}
                      disabled={busy !== null}
                      onClick={() => {
                        const next = { ...saved }
                        delete next[f.id]
                        persist(next)
                      }}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{tr('Замеры хранятся только на этом телефоне. Во время замера стойте на месте, лучше у окна.')}</p>
      </section>
    </div>
  )
}
