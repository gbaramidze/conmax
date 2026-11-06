import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { activityBudgetsQuery, actualsQuery, budgetAmountsQuery, budgetVersionsQuery, buildBudget, cbsQuery, commitmentsBudgetQuery, etcQuery } from './api'

/** Все данные бюджета проекта и рассчитанная таблица. */
export function useBudget(projectId: string) {
  const { data: items } = useSuspenseQuery(cbsQuery(projectId))
  const { data: versions } = useSuspenseQuery(budgetVersionsQuery(projectId))
  const { data: amounts } = useSuspenseQuery(budgetAmountsQuery(projectId))
  const { data: commitments } = useSuspenseQuery(commitmentsBudgetQuery(projectId))
  const { data: actuals } = useSuspenseQuery(actualsQuery(projectId))
  const { data: etc } = useSuspenseQuery(etcQuery(projectId))
  const { data: activityBudgets } = useSuspenseQuery(activityBudgetsQuery(projectId))
  const model = useMemo(() => buildBudget({ items, versions, amounts, commitments, actuals, etc }), [items, versions, amounts, commitments, actuals, etc])
  return { items, versions, amounts, commitments, actuals, etc, activityBudgets, model }
}
