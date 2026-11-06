import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Download, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { downloadXlsx } from '@/features/export/xlsx'
import { equipmentQuery, type EquipmentRow } from '@/features/plans/equipment-api'
import { OBJECT_STATUS_COLORS, OBJECT_STATUS_LABELS, objectType, objectVariant, specTexts, type ObjectStatus } from '@/features/plans/object-types'
import { locationLabel, locationsQuery } from '@/features/locations/api'
import { projectByCodeQuery } from '@/features/projects/api'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

// Паттерн «Список / Реестр» со сводкой: что поставлено на планах проекта, в каком состоянии и на каком листе
export const Route = createFileRoute('/_app/projects/$code/equipment')({
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([queryClient.ensureQueryData(equipmentQuery(project.id)), queryClient.ensureQueryData(locationsQuery(project.id))])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем оборудование…')}</p>,
  component: EquipmentPage,
})

const STATUSES = Object.keys(OBJECT_STATUS_LABELS) as ObjectStatus[]

function Dot({ status }: { status: ObjectStatus }) {
  return <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: OBJECT_STATUS_COLORS[status] }} />
}

function EquipmentPage() {
  const { code } = Route.useParams()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: rows } = useSuspenseQuery(equipmentQuery(p.id))
  const { data: locations } = useSuspenseQuery(locationsQuery(p.id))
  const placeOf = (r: EquipmentRow) => {
    const l = r.location_id ? locations.find((x) => x.id === r.location_id) : undefined
    return l ? locationLabel(l.path, locations) : ''
  }
  const [query, setQuery] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState<ObjectStatus | ''>('')

  const named = useMemo(
    () =>
      rows.map((r) => {
        const t = objectType(r.type_code, r.geometry)
        const v = objectVariant(t, r.variant)
        return { r, t, v, specs: specTexts(t, r.specs) }
      }),
    [rows],
  )

  // сводка по типам: сколько всего, сколько с дефектом
  const summary = useMemo(() => {
    const m = new Map<string, { t: ReturnType<typeof objectType>; total: number; byStatus: Record<ObjectStatus, number> }>()
    for (const { r, t } of named) {
      const cur = m.get(r.type_code) ?? { t, total: 0, byStatus: { planned: 0, installed: 0, checked: 0, defect: 0 } }
      cur.total += 1
      cur.byStatus[r.status] += 1
      m.set(r.type_code, cur)
    }
    return [...m.entries()].sort((a, b) => a[1].t.name.localeCompare(b[1].t.name)).map(([codeKey, v]) => ({ code: codeKey, ...v }))
  }, [named])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return named
      .filter(({ r, t, v, specs }) => {
        if (type && r.type_code !== type) return false
        if (status && r.status !== status) return false
        if (!q) return true
        return [t.name, v?.name, r.label, r.notes, r.doc?.title, r.doc?.code, placeOf(r), ...specs].some((s) => s?.toLowerCase().includes(q))
      })
      .sort((a, b) => a.t.name.localeCompare(b.t.name) || a.r.label.localeCompare(b.r.label, undefined, { numeric: true }) || (a.r.doc?.title ?? '').localeCompare(b.r.doc?.title ?? ''))
  }, [named, query, type, status])

  const defects = rows.filter((r) => r.status === 'defect').length
  const filtered = !!(query || type || status)

  const planLink = (r: EquipmentRow) => (
    <Link to="/projects/$code/plan/$id" params={{ code, id: r.document_id }} search={{ page: r.page, obj: r.id }} className="underline-offset-2 hover:underline">
      {r.doc?.title ?? '—'}
      {r.page > 1 ? <span className="text-muted-foreground"> · {tr('лист {{n}}', { n: r.page })}</span> : null}
    </Link>
  )

  const exportXlsx = () =>
    downloadXlsx(`${tr('Оборудование')} ${p.code}`, {
      name: tr('Оборудование'),
      headers: [tr('Тип'), tr('Вид'), tr('Обозначение'), tr('Характеристики'), tr('Состояние'), tr('Место'), tr('План'), tr('Лист'), tr('Заметка')],
      rows: shown.map(({ r, t, v, specs }) => [t.name, v?.name ?? '', r.label, specs.join('; '), OBJECT_STATUS_LABELS[r.status], placeOf(r), r.doc?.title ?? '', r.page, r.notes]),
    })

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-sm text-muted-foreground">
        {tr('Всё, что поставлено на планах проекта: камеры, щиты, гидранты, трассы труб и кабелей. Нажмите на название плана, чтобы увидеть объект на плане.')}
      </p>

      {rows.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">
          {tr('Объектов пока нет. Откройте любой план и поставьте камеру, щит или трассу на вкладке «Слои»: они появятся здесь.')}
          <Button asChild variant="outline" size="sm" className="mt-3 block w-fit">
            <Link to="/projects/$code/plans" params={{ code }} search={{}}>
              {tr('К планам')}
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" aria-label={tr('Сводка по типам')}>
            {summary.map(({ code: c, t, total, byStatus }) => {
              const on = type === c
              const Icon = t.Icon
              return (
                <li key={c}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setType(on ? '' : c)}
                    className={cn('flex min-h-16 w-full flex-col gap-1 rounded-lg border bg-card p-3 text-left shadow-soft outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring', on && 'border-primary bg-primary/5')}
                  >
                    <span className="flex items-center gap-2">
                      {Icon ? (
                        <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full text-white" style={{ background: t.color }}>
                          <Icon className="size-3.5" />
                        </span>
                      ) : (
                        <span aria-hidden className="block h-1 w-5 shrink-0 rounded" style={{ background: t.color }} />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</span>
                      <span className="text-lg font-semibold tabular-nums">{total}</span>
                    </span>
                    <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      {STATUSES.filter((s) => byStatus[s] > 0).map((s) => (
                        <span key={s} className={cn('inline-flex items-center gap-1', s === 'defect' && 'text-red-700 dark:text-red-300')}>
                          <Dot status={s} /> {byStatus[s]}
                        </span>
                      ))}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={tr('Найти в оборудовании')}
                placeholder={tr('Обозначение, характеристика, план')}
                className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <select aria-label={tr('Состояние')} value={status} onChange={(e) => setStatus(e.target.value as ObjectStatus | '')} className="h-10 rounded-md border bg-background px-2 text-sm">
              <option value="">{tr('Любое состояние')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {OBJECT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            {defects > 0 && status !== 'defect' && (
              <Button variant="outline" size="sm" className="text-red-700 dark:text-red-300" onClick={() => setStatus('defect')}>
                {tr('Только с дефектом: {{n}}', { n: defects })}
              </Button>
            )}
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuery('')
                  setType('')
                  setStatus('')
                }}
              >
                {tr('Сбросить')}
              </Button>
            )}
            <span className="ml-auto text-sm text-muted-foreground tabular-nums">{tr('Показано {{n}} из {{total}}', { n: shown.length, total: rows.length })}</span>
            <Button variant="outline" size="sm" disabled={shown.length === 0} onClick={() => void exportXlsx()}>
              <Download /> {tr('Excel')}
            </Button>
          </div>

          {shown.length === 0 ? (
            <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">{tr('По этим условиям ничего нет. Ослабьте фильтры.')}</div>
          ) : (
            <>
              <ul className="flex flex-col gap-2 md:hidden">
                {shown.map(({ r, t, v, specs }) => (
                  <li key={r.id} className="flex flex-col gap-1 rounded-lg border bg-card p-3 shadow-soft">
                    <div className="flex items-center gap-2">
                      <Dot status={r.status} />
                      <span className="min-w-0 flex-1 font-medium">
                        {t.name}
                        {v ? <span className="font-normal text-muted-foreground"> · {v.name}</span> : null}
                        {r.label ? <span className="ident text-muted-foreground"> · {r.label}</span> : null}
                      </span>
                    </div>
                    {specs.length > 0 && <p className="text-xs text-muted-foreground">{specs.join(' · ')}</p>}
                    {placeOf(r) && <p className="text-xs text-muted-foreground">{placeOf(r)}</p>}
                    <p className="text-xs">
                      <span className="text-muted-foreground">{OBJECT_STATUS_LABELS[r.status]} · </span>
                      {planLink(r)}
                    </p>
                  </li>
                ))}
              </ul>

              <div className="hidden overflow-hidden rounded-lg border bg-card shadow-soft md:block">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">{tr('Тип')}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{tr('Обозначение')}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{tr('Характеристики')}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{tr('Состояние')}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{tr('Место')}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{tr('План')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {shown.map(({ r, t, v, specs }) => (
                      <tr key={r.id} className="hover:bg-muted/30">
                        <td className="px-3 py-2">
                          {t.name}
                          {v ? <span className="text-muted-foreground"> · {v.name}</span> : null}
                        </td>
                        <td className="ident px-3 py-2">{r.label || '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">{specs.join(' · ') || '—'}</td>
                        <td className="px-3 py-2">
                          <span className={cn('inline-flex items-center gap-1.5', r.status === 'defect' && 'text-red-700 dark:text-red-300')}>
                            <Dot status={r.status} /> {OBJECT_STATUS_LABELS[r.status]}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{placeOf(r) || '—'}</td>
                        <td className="px-3 py-2">{planLink(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
