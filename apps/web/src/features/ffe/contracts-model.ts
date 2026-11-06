import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  contractorName,
  ffeContractsQuery,
  ffePricesQuery,
  ffeScopesQuery,
  roomFfeQuery,
  statusTotals,
  type FfeContract,
  type RoomFfe,
} from '@/features/ffe/api'
import { locationsQuery, type LocationRow } from '@/features/locations/api'

export interface ContractsModel {
  contracts: FfeContract[]
  byId: Map<string, FfeContract>
  /** Договор, под который попадает место: самый конкретный охват (номер перекрывает этаж). */
  contractAt: (locationPath: string) => FfeContract | undefined
  price: (contractId: string, itemId: string) => number | undefined
  /** Сумма строки мебели по цене договора; null — договора или цены нет. */
  lineAmount: (line: RoomFfe) => number | null
  locById: Map<string, LocationRow>
  scopeLocationIds: (contractId: string) => string[]
  /** Сумма и штуки по статусам для договора по всем строкам его охвата. */
  summary: (contractId: string) => { amount: number; unpriced: number; lines: number; totals: ReturnType<typeof statusTotals> }
}

/** Договоры, охват и цены; по ним любая строка мебели получает подрядчика и сумму. */
export function useContractsModel(projectId: string, withLines = true): ContractsModel {
  const { data: contracts } = useSuspenseQuery(ffeContractsQuery(projectId))
  const { data: scopes } = useSuspenseQuery(ffeScopesQuery(projectId))
  const { data: prices } = useSuspenseQuery(ffePricesQuery(projectId))
  // строки всего проекта нужны только для сводок по договорам; страница номера обходится без них
  const { data: lines } = useSuspenseQuery(withLines ? roomFfeQuery(projectId) : { queryKey: ['ffe', 'no-lines'], queryFn: async () => [] as RoomFfe[] })
  const { data: locations } = useSuspenseQuery(locationsQuery(projectId))

  return useMemo(() => {
    const byId = new Map(contracts.map((c) => [c.id, c]))
    const locById = new Map(locations.map((l) => [l.id, l]))
    const scopeByPath = new Map<string, string>()
    for (const s of scopes) {
      const loc = locById.get(s.location_id)
      if (loc && byId.has(s.contract_id)) scopeByPath.set(loc.path, s.contract_id)
    }
    const priceMap = new Map(prices.map((p) => [`${p.contract_id}:${p.item_id}`, Number(p.unit_price)]))
    const cache = new Map<string, FfeContract | undefined>()
    const contractAt = (path: string) => {
      if (cache.has(path)) return cache.get(path)
      const parts = path.split('.')
      let found: FfeContract | undefined
      for (let i = parts.length; i >= 1 && !found; i--) {
        const id = scopeByPath.get(parts.slice(0, i).join('.'))
        if (id) found = byId.get(id)
      }
      cache.set(path, found)
      return found
    }
    const price = (contractId: string, itemId: string) => priceMap.get(`${contractId}:${itemId}`)
    const lineAmount = (line: RoomFfe) => {
      const path = locById.get(line.location_id)?.path
      const c = path ? contractAt(path) : undefined
      const p = c ? price(c.id, line.item_id) : undefined
      return p === undefined ? null : p * line.qty
    }
    const scopeLocationIds = (contractId: string) => scopes.filter((s) => s.contract_id === contractId).map((s) => s.location_id)
    const summary = (contractId: string) => {
      const own = lines.filter((l) => {
        const path = locById.get(l.location_id)?.path
        return path ? contractAt(path)?.id === contractId : false
      })
      let amount = 0
      let unpriced = 0
      for (const l of own) {
        const p = price(contractId, l.item_id)
        if (p === undefined) unpriced += 1
        else amount += p * l.qty
      }
      return { amount, unpriced, lines: own.length, totals: statusTotals(own) }
    }
    return { contracts, byId, contractAt, price, lineAmount, locById, scopeLocationIds, summary }
  }, [contracts, scopes, prices, lines, locations])
}

export { contractorName }
