import { tr } from '@/lib/tr'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Suspense } from 'react'
import { z } from 'zod'
import { activityBudgetsQuery, actualsQuery, budgetAmountsQuery, budgetSettingsQuery, budgetVersionsQuery, cbsQuery, commitmentsBudgetQuery, etcQuery, forecastQuery } from '@/features/budget/api'
import { ActualsTab, CommitmentsTab } from '@/features/budget/contracts'
import { BudgetEditor } from '@/features/budget/editor'
import { LookaheadTab } from '@/features/budget/lookahead'
import { BudgetSummary } from '@/features/budget/summary'
import { useBudget } from '@/features/budget/use-budget'
import { AllocateTab } from '@/features/budget/works'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'

// Паттерн «Аналитика / Отчёт» с вкладками: сводка, статьи и версии, раскладка по месяцам, договоры, факт, распределение по работам
export const Route = createFileRoute('/_app/projects/$code/budget')({
  validateSearch: z.object({ tab: z.enum(['summary', 'budget', 'plan', 'contracts', 'costs', 'works']).optional().catch(undefined) }),
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([
      queryClient.ensureQueryData(myPermissionsQuery(project.id)),
      queryClient.ensureQueryData(cbsQuery(project.id)),
      queryClient.ensureQueryData(budgetVersionsQuery(project.id)),
      queryClient.ensureQueryData(budgetAmountsQuery(project.id)),
      queryClient.ensureQueryData(commitmentsBudgetQuery(project.id)),
      queryClient.ensureQueryData(actualsQuery(project.id)),
      queryClient.ensureQueryData(etcQuery(project.id)),
      queryClient.ensureQueryData(activityBudgetsQuery(project.id)),
      queryClient.ensureQueryData(forecastQuery(project.id)),
      queryClient.ensureQueryData(budgetSettingsQuery(project.id)),
    ])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем бюджет…')}</p>,
  component: BudgetPage,
})

const TABS = [
  ['summary', tr('Сводка')],
  ['budget', tr('Бюджет')],
  ['plan', tr('Раскладка')],
  ['contracts', tr('Договоры')],
  ['costs', tr('Факт')],
  ['works', tr('По работам')],
] as const

function BudgetPage() {
  const { code } = Route.useParams()
  const { tab: searchTab = 'summary' } = Route.useSearch()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const canApprove = permissions.includes('budget.approve')
  const canEdit = permissions.includes('budget.edit') || canApprove
  const canRecord = canEdit || permissions.includes('cost.record')
  // «Договоры» — модуль «Договоры», «По работам» — модуль «График и выполнение»: выключены — вкладок нет
  const tabModule: Partial<Record<(typeof TABS)[number][0], string>> = { contracts: 'contracts', works: 'schedule' }
  const tabs = TABS.filter(([value]) => !tabModule[value] || p.modules.includes(tabModule[value]))
  const tab = tabs.some(([value]) => value === searchTab) ? searchTab : 'summary'

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label={tr('Разделы бюджета')} className="flex gap-1 overflow-x-auto border-b">
        {tabs.map(([value, label]) => (
          <Link
            key={value}
            to="/projects/$code/budget"
            params={{ code }}
            search={{ tab: value === 'summary' ? undefined : value }}
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
        <Content tab={tab} projectId={p.id} projectCode={code} canEdit={canEdit} canApprove={canApprove} canRecord={canRecord} />
      </Suspense>
    </div>
  )
}

function Content({ tab, projectId, projectCode, canEdit, canApprove, canRecord }: { tab: (typeof TABS)[number][0]; projectId: string; projectCode: string; canEdit: boolean; canApprove: boolean; canRecord: boolean }) {
  const b = useBudget(projectId)
  if (tab === 'budget') return <BudgetEditor projectId={projectId} model={b.model} items={b.items} versions={b.versions} amounts={b.amounts} canEdit={canEdit} canApprove={canApprove} />
  if (tab === 'plan')
    return (
      <LookaheadTab
        projectId={projectId}
        items={b.items}
        model={b.model}
        versions={b.versions}
        actuals={b.actuals}
        forecast={b.forecast}
        closedThrough={b.settings.closed_through}
        canEdit={canEdit}
        canApprove={canApprove}
        canRecord={canRecord}
      />
    )
  if (tab === 'contracts') return <CommitmentsTab projectId={projectId} items={b.items} commitments={b.commitments} actuals={b.actuals} canEdit={canEdit} />
  if (tab === 'costs') return <ActualsTab projectId={projectId} items={b.items} commitments={b.commitments} actuals={b.actuals} canRecord={canRecord} />
  if (tab === 'works') return <AllocateTab projectId={projectId} items={b.items} model={b.model} activityBudgets={b.activityBudgets} canEdit={canEdit} />
  return <BudgetSummary projectId={projectId} projectCode={projectCode} model={b.model} items={b.items} commitments={b.commitments} actuals={b.actuals} canEdit={canEdit} />
}
