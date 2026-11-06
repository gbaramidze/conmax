import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Suspense } from 'react'
import { z } from 'zod'
import { BillTab } from '@/features/ffe/bill'
import { CatalogTab } from '@/features/ffe/catalog'
import { ContractsTab } from '@/features/ffe/contracts-tab'
import { ffeContractsQuery, ffeDocsQuery, ffeItemsQuery, ffePricesQuery, ffeScopesQuery, roomFfeQuery, roomSpecsQuery, roomTypesQuery } from '@/features/ffe/api'
import { TypesTab } from '@/features/ffe/types-tab'
import { locationsQuery } from '@/features/locations/api'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { tr } from '@/lib/tr'

// Паттерн «Аналитика / Отчёт» с вкладками: ведомость что и где, каталог позиций, типы номеров
export const Route = createFileRoute('/_app/projects/$code/ffe')({
  validateSearch: z.object({ tab: z.enum(['bill', 'catalog', 'types', 'contracts']).optional().catch(undefined), type: z.string().optional().catch(undefined) }),
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([
      queryClient.ensureQueryData(myPermissionsQuery(project.id)),
      queryClient.ensureQueryData(locationsQuery(project.id)),
      queryClient.ensureQueryData(ffeItemsQuery(project.id)),
      queryClient.ensureQueryData(ffeDocsQuery(project.id)),
      queryClient.ensureQueryData(ffeContractsQuery(project.id)),
      queryClient.ensureQueryData(ffeScopesQuery(project.id)),
      queryClient.ensureQueryData(ffePricesQuery(project.id)),
      queryClient.ensureQueryData(roomTypesQuery(project.id)),
      queryClient.ensureQueryData(roomSpecsQuery(project.id)),
      queryClient.ensureQueryData(roomFfeQuery(project.id)),
    ])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем мебель и оборудование…')}</p>,
  component: FfePage,
})

const TABS = [
  ['bill', tr('Ведомость')],
  ['catalog', tr('Каталог')],
  ['types', tr('Типы номеров')],
  ['contracts', tr('Договоры')],
] as const

function FfePage() {
  const { code } = Route.useParams()
  const { tab = 'bill', type: focusType } = Route.useSearch()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const canEdit = permissions.includes('location.manage') || permissions.includes('schedule.edit')
  const canBudget = permissions.includes('budget.view')

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-sm text-muted-foreground">
        {tr('Что и где стоит в номерах: каталог мебели с кодами и чертежами, типы номеров, договоры с подрядчиками и ведомость со статусом каждой позиции — заказано, поставлено, установлено.')}
      </p>
      <nav aria-label={tr('Разделы мебели')} className="flex gap-1 overflow-x-auto border-b">
        {TABS.map(([value, label]) => (
          <Link
            key={value}
            to="/projects/$code/ffe"
            params={{ code }}
            search={{ tab: value === 'bill' ? undefined : value }}
            aria-current={tab === value ? 'page' : undefined}
            className={`-mb-px min-h-11 shrink-0 content-center border-b-2 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              tab === value ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Считаем…')}</p>}>
        {tab === 'catalog' ? (
          <CatalogTab projectId={p.id} code={code} canEdit={canEdit} />
        ) : tab === 'types' ? (
          <TypesTab projectId={p.id} code={code} canEdit={canEdit} focusType={focusType} />
        ) : tab === 'contracts' ? (
          <ContractsTab projectId={p.id} canEdit={canEdit} canBudget={canBudget} />
        ) : (
          <BillTab projectId={p.id} code={code} canEdit={canEdit} canBudget={canBudget} />
        )}
      </Suspense>
    </div>
  )
}
