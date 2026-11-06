import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { FolderUp, MapPin, Search, Upload } from 'lucide-react'
import { useShowMore } from '@/components/show-more'
import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { documentsQuery } from '@/features/documents/api'
import { locationLabel, locationsQuery } from '@/features/locations/api'
import { isPlanDocument, needsPreview, pinsQuery } from '@/features/plans/api'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'

// Паттерн «Список / Index»: планы и чертежи проекта, которые можно открыть и отметить на них замечания
export const Route = createFileRoute('/_app/projects/$code/plans')({
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([
      queryClient.ensureQueryData(documentsQuery(project.id)),
      queryClient.ensureQueryData(pinsQuery(project.id)),
      queryClient.ensureQueryData(locationsQuery(project.id)),
      queryClient.ensureQueryData(myPermissionsQuery(project.id)),
    ])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем планы…')}</p>,
  component: PlansPage,
})

function PlansPage() {
  const { code } = Route.useParams()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: docs } = useSuspenseQuery(documentsQuery(p.id))
  const { data: pins } = useSuspenseQuery(pinsQuery(p.id))
  const { data: locations } = useSuspenseQuery(locationsQuery(p.id))
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const canUpload = permissions.includes('document.upload')
  const [query, setQuery] = useState('')

  const plans = useMemo(() => docs.filter(isPlanDocument), [docs])
  const unsupported = useMemo(() => docs.filter(needsPreview), [docs])

  const stats = useMemo(() => {
    const m = new Map<string, { total: number; open: number }>()
    for (const x of pins) {
      const s = m.get(x.document_id) ?? { total: 0, open: 0 }
      s.total++
      if (x.task!.status_category !== 'done' && x.task!.status_category !== 'cancelled') s.open++
      m.set(x.document_id, s)
    }
    return m
  }, [pins])

  // планы по местам: этаж — группа; планы без привязки — отдельно в конце
  const filteredPlans = useMemo(() => {
    const q = query.trim().toLowerCase()
    return plans.filter((d) => !q || d.title.toLowerCase().includes(q) || (d.code ?? '').toLowerCase().includes(q))
  }, [plans, query])
  // порциями по планам (а не по группам), иначе одна большая группа тянет страницу на десятки экранов
  const { shown: shownPlans, more: morePlans } = useShowMore(filteredPlans, 30, query)
  const groups = useMemo(() => {
    const list = shownPlans
    const byPlace = new Map<string, typeof list>()
    for (const d of list) {
      const key = d.location_paths[0] ?? ''
      byPlace.set(key, [...(byPlace.get(key) ?? []), d])
    }
    return [...byPlace.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, currentLocale(), { numeric: true })))
  }, [shownPlans])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">{tr('Планы и чертежи в PDF или как изображения. Откройте план и поставьте замечание прямо на нужное место: оно станет задачей с исполнителем и сроком.')}</p>
        {canUpload && (
          <div className="flex flex-wrap gap-2">
            <Link to="/projects/$code/documents" params={{ code }} search={{ create: 'folder' }} className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted">
              <FolderUp className="size-4" />{tr('Загрузить папку')}</Link>
            <Link to="/projects/$code/documents" params={{ code }} search={{ create: 'upload' }} className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted">
              <Upload className="size-4" />{tr('Загрузить план')}</Link>
          </div>
        )}
      </div>

      {plans.length > 0 && (
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label={tr('Поиск по названию и шифру')} placeholder={tr('Название или шифр')} className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}

      {plans.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">
          {canUpload
            ? tr('Планов пока нет. Загрузите документ типа «План» или «Чертёж» в формате PDF или изображения и привяжите его к этажу — тогда замечания получат место автоматически.')
            : tr('Планов пока нет.')}
        </div>
      ) : (
        groups.map(([path, list]) => (
          <section key={path || 'none'} className="flex flex-col gap-2" aria-label={path ? locationLabel(path, locations) : tr('Без привязки к месту')}>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <MapPin className="size-3.5 text-muted-foreground" aria-hidden />
              {path ? locationLabel(path, locations) : tr('Без привязки к месту')}
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((d) => {
                const s = stats.get(d.id)
                return (
                  <li key={d.id}>
                    <Link
                      to="/projects/$code/plan/$id"
                      params={{ code, id: d.id }}
                      search={{}}
                      className="flex h-full flex-col gap-1.5 rounded-lg border bg-card p-3.5 shadow-soft outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0 font-medium leading-snug">{d.title}</span>
                        {d.current_revision && <span className="ident shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{d.current_revision}</span>}
                      </span>
                      {d.code && <span className="ident text-xs text-muted-foreground">{d.code}</span>}
                      <span className="mt-auto flex items-center gap-3 pt-1 text-xs text-muted-foreground">
                        {s ? (
                          <>
                            <span className={s.open > 0 ? 'font-medium text-foreground' : ''}>{tr('открытых замечаний:')}{' '}{s.open}</span>
                            <span>{tr('всего:')}{' '}{s.total}</span>
                          </>
                        ) : (
                          <span>{tr('замечаний нет')}</span>
                        )}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}

      {morePlans}

      {unsupported.length > 0 && (
        <section className="flex flex-col gap-2" aria-label={tr('Нужен PDF для просмотра')}>
          <h2 className="text-sm font-semibold">{tr('Нужен PDF для просмотра ·')}{' '}{unsupported.length}</h2>
          <p className="max-w-prose text-xs text-muted-foreground">{tr('Эти планы в формате, который на экране не открывается (например, DWG). Приложите к версии PDF-печать — и план откроется здесь, а исходник останется для скачивания.')}</p>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {unsupported.map((d) => (
              <li key={d.id}>
                <Link
                  to="/projects/$code/document/$id"
                  params={{ code, id: d.id }}
                  search={{}}
                  className="flex h-full flex-col gap-1 rounded-lg border border-dashed bg-card p-3.5 outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-medium leading-snug">{d.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {d.file_name ?? tr('файл')}
                    {d.code && <span className="ident"> · {d.code}</span>}
                  </span>
                  <span className="mt-auto pt-1 text-xs font-medium underline underline-offset-2">{tr('Добавить PDF для просмотра')}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
