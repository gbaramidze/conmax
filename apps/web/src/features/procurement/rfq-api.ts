import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'

export const RFQ_STATUSES = {
  open: tr('Открыт'),
  awarded: tr('Присуждён'),
  cancelled: tr('Отменён'),
} as const
export type RfqStatus = keyof typeof RFQ_STATUSES

export interface RfqLine {
  id: string
  position: number
  name: string
  unit: string
  qty: number
}

export interface RfqQuote {
  id: string
  supplier: string
  currency: 'GEL' | 'USD'
  delivery_days: number | null
  terms: string
  note: string
  status: 'received' | 'selected' | 'rejected'
  prices: { line_id: string; unit_price: number }[]
}

export interface Rfq {
  id: string
  number: number
  key: string
  title: string
  request_id: string | null
  due_date: string | null
  note: string
  status: RfqStatus
  winner_id: string | null
  created_at: string
  request: { key: string; cbs_item_id: string | null } | null
  lines: RfqLine[]
  quotes: RfqQuote[]
}

export const rfqsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['rfqs', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rfqs')
        .select(
          'id, number, key, title, request_id, due_date, note, status, winner_id, created_at, request:material_requests(key, cbs_item_id), lines:rfq_lines(id, position, name, unit, qty), quotes:rfq_quotes!rfq_id(id, supplier, currency, delivery_days, terms, note, status, prices:rfq_quote_lines(line_id, unit_price))',
        )
        .eq('project_id', projectId)
        .order('number', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data as unknown as Rfq[]).map((r) => ({
        ...r,
        lines: r.lines.map((l) => ({ ...l, qty: Number(l.qty) })).sort((a, b) => a.position - b.position),
        quotes: r.quotes.map((q) => ({ ...q, prices: q.prices.map((p) => ({ ...p, unit_price: Number(p.unit_price) })) })),
      }))
    },
  })

export async function createRfq(projectId: string, v: { title: string; requestId?: string | null; dueDate?: string | null; note?: string; lines?: { name: string; unit: string; qty: number }[] }): Promise<string> {
  const { data, error } = await supabase.rpc('rfq_create', {
    p_project: projectId,
    p_title: v.title,
    p_request: v.requestId ?? undefined,
    p_due: v.dueDate ?? undefined,
    p_note: v.note ?? '',
    p_lines: v.lines ?? [],
  })
  if (error) throw error
  return data as string
}

export async function saveQuote(rfqId: string, q: { id?: string; supplier: string; currency: string; deliveryDays: number | null; terms: string; note: string; prices: Record<string, number | null> }): Promise<string> {
  const { data, error } = await supabase.rpc('rfq_quote_save', {
    p_rfq: rfqId,
    p_supplier: q.supplier,
    p_currency: q.currency,
    p_delivery_days: q.deliveryDays ?? undefined,
    p_terms: q.terms,
    p_prices: q.prices,
    p_id: q.id,
    p_note: q.note,
  })
  if (error) throw error
  return data as string
}

export async function deleteQuote(id: string): Promise<void> {
  const { error } = await supabase.rpc('rfq_quote_delete', { p_quote: id })
  if (error) throw error
}

export async function awardRfq(rfqId: string, quoteId: string, cbsItem: string | null, docNumber: string): Promise<void> {
  const { error } = await supabase.rpc('rfq_award', { p_rfq: rfqId, p_quote: quoteId, p_cbs_item: cbsItem ?? undefined, p_doc_number: docNumber })
  if (error) throw error
}

export async function cancelRfq(rfqId: string, note = ''): Promise<void> {
  const { error } = await supabase.rpc('rfq_cancel', { p_rfq: rfqId, p_note: note })
  if (error) throw error
}

/** Сумма предложения в его валюте; null, если цены указаны не по всем позициям. */
export function quoteTotal(rfq: Rfq, q: RfqQuote): number | null {
  let sum = 0
  for (const l of rfq.lines) {
    const p = q.prices.find((x) => x.line_id === l.id)
    if (!p) return null
    sum += l.qty * p.unit_price
  }
  return sum
}

/** Сумма предложения в основной валюте проекта по курсу (лари за 1 доллар); null, если пересчитать нельзя. */
export function quoteInBase(total: number, quoteCurrency: string, base: string, rate: number | null): number | null {
  if (quoteCurrency === base) return total
  if (!rate) return null
  return base === 'GEL' ? total * rate : total / rate
}
