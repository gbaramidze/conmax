import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { activityBudgetsQuery, actualsQuery, budgetAmountsQuery, budgetSettingsQuery, budgetVersionsQuery, buildBudget, cbsQuery, commitmentsBudgetQuery, etcQuery, forecastQuery } from './api'

/** Все данные бюджета проекта и рассчитанная таблица. */
export function useBudget(projectId: string) {
  const { data: items } = useSuspenseQuery(cbsQuery(projectId))
  const { data: versions } = useSuspenseQuery(budgetVersionsQuery(projectId))
  const { data: amounts } = useSuspenseQuery(budgetAmountsQuery(projectId))
  const { data: commitments } = useSuspenseQuery(commitmentsBudgetQuery(projectId))
  const { data: actuals } = useSuspenseQuery(actualsQuery(projectId))
  const { data: etc } = useSuspenseQuery(etcQuery(projectId))
  const { data: activityBudgets } = useSuspenseQuery(activityBudgetsQuery(projectId))
  const { data: forecast } = useSuspenseQuery(forecastQuery(projectId))
  const { data: settings } = useSuspenseQuery(budgetSettingsQuery(projectId))
  const model = useMemo(
    () => buildBudget({ items, versions, amounts, commitments, actuals, etc, forecast, closedThrough: settings.closed_through }),
    [items, versions, amounts, commitments, actuals, etc, forecast, settings.closed_through],
  )
  return { items, versions, amounts, commitments, actuals, etc, activityBudgets, forecast, settings, model }
}
