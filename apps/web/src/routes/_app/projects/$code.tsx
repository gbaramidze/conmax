import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { createFileRoute, Link, notFound, Outlet, useRouterState } from '@tanstack/react-router'
import { FieldNoteFab } from '@/features/locations/field-note-fab'
import { CoverControls, ProjectCover } from '@/features/projects/cover'
import { CurrencySwitch, useSyncProjectMoney } from '@/features/projects/currency-switch'
import { setMoneyDisplayEnabled, useDisplayCurrency } from '@/features/projects/display-currency'
import { ProjectDatesDialog } from '@/features/projects/dates-dialog'
import {
  myPermissionsQuery,
  projectByCodeQuery,
  projectKindLabel,
  projectStatusLabel,
} from '@/features/projects/api'

export const Route = createFileRoute('/_app/projects/$code')({
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) throw notFound()
    await queryClient.ensureQueryData(myPermissionsQuery(project.id))
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем проект…')}</p>,
  notFoundComponent: () => (
    <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6">
      <p className="font-medium">{tr('Проект не найден')}</p>
      <p className="text-sm text-muted-foreground">{tr('Возможно, ссылка устарела или у вас нет доступа к этому проекту.')}</p>
      <Link to="/projects" className="text-sm font-medium underline underline-offset-4">{tr('К списку проектов')}</Link>
    </div>
  ),
  component: ProjectLayout,
})

const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: '2-digit' })
const fmtDate = (iso: string | null) => (iso ? dateFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00`)) : '—')

function Cell({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col justify-center gap-0.5 px-4 py-2.5 ${className}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{children}</dd>
    </div>
  )
}

/**
 * Шапка проекта в виде основной надписи чертежа: код, название, статус, сроки — ячейками, разделёнными тонкими линиями.
 * Разделы проекта — в боковой панели (десктоп) и нижней навигации (телефон).
 */
function ProjectLayout() {
  const { code } = Route.useParams()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  // loader гарантирует наличие проекта
  const p = project!
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const canEditCover = permissions.includes('project.edit')
  const [datesOpen, setDatesOpen] = useState(false)
  // Шапка-«основная надпись» нужна на обзоре; на остальных страницах проект виден в верхней панели и вкладках
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isOverview = pathname.replace(/\/$/, '') === `/projects/${code}`
  useSyncProjectMoney(p.id)
  setMoneyDisplayEnabled(/^\/projects\/[^/]+\/(budget|evm|changes|requests|risks)\/?$/.test(pathname))
  const { code: shownCurrency } = useDisplayCurrency()
  // переключатель ₾/$ нужен там, где есть суммы
  const showsMoney = /^\/projects\/[^/]+\/(budget|evm|changes|requests|risks)\/?$/.test(pathname)

  return (
    <div className="flex flex-col gap-6">
      {isOverview && (
        <div className="overflow-hidden rounded-lg border bg-card shadow-soft">
          {(p.cover?.storage_key || canEditCover) && (
            <div className={`relative overflow-hidden bg-muted ${p.cover?.storage_key ? 'h-44 sm:h-60' : 'h-14'}`}>
              {p.cover?.storage_key && <ProjectCover storageKey={p.cover.storage_key} code={p.code} name={p.name} />}
              {canEditCover && <CoverControls projectId={p.id} hasCover={!!p.cover?.storage_key} className={p.cover?.storage_key ? 'absolute bottom-3 right-3' : 'absolute inset-0 items-center justify-center'} />}
            </div>
          )}
          <dl className="grid grid-cols-[auto_1fr]">
        {/* На телефоне код и название уже в верхней панели — здесь только факты */}
        <div className="flex items-center bg-primary px-5 py-3 text-signal max-sm:hidden">
          <dt className="sr-only">{tr('Код проекта')}</dt>
          <dd className="ident text-xl font-medium tracking-wide">{p.code}</dd>
        </div>
        <div className="flex min-w-0 flex-col justify-center gap-0.5 px-4 py-3 max-sm:hidden">
          <dt className="text-xs text-muted-foreground">{tr('Проект')}</dt>
          <dd className="truncate text-lg font-semibold leading-tight">{p.name}</dd>
        </div>
        <div className="col-span-2 grid grid-cols-2 divide-x sm:grid-cols-4 sm:border-t">
          <Cell label={tr('Статус')}>{projectStatusLabel(p.status)}</Cell>
          <Cell label={tr('Сроки')}>
            <span className="flex items-center gap-1.5">
              {p.planned_start || p.planned_finish ? (
                <span className="truncate">
                  {fmtDate(p.planned_start)} — {fmtDate(p.planned_finish)}
                </span>
              ) : (
                <span className="text-muted-foreground">{tr('не заданы')}</span>
              )}
              <button type="button" onClick={() => setDatesOpen(true)} aria-label={canEditCover ? tr('Изменить сроки проекта') : tr('История сроков проекта')} title={canEditCover ? tr('Изменить сроки') : tr('История сроков')} className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
                <Pencil className="size-3.5" />
              </button>
            </span>
          </Cell>
          <Cell label={tr('Тип')} className="max-sm:hidden">
            {projectKindLabel(p.kind)}
          </Cell>
          <Cell label={tr('Адрес')} className="max-sm:hidden">
            {p.address ?? '—'}
          </Cell>
        </div>
          </dl>
        </div>
      )}

      {showsMoney && <CurrencySwitch className="justify-end" />}
      <Outlet key={shownCurrency} />
      <FieldNoteFab projectId={p.id} />
      {datesOpen && <ProjectDatesDialog projectId={p.id} start={p.planned_start} finish={p.planned_finish} canEdit={canEditCover} onClose={() => setDatesOpen(false)} />}
    </div>
  )
}
