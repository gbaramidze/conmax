import { tr } from '@/lib/tr'
import type { BudgetEtc, BudgetForecast, BudgetRow } from './api'
import { money } from './lookahead-model'
import { monthLong } from './months'

/** Объяснение перерасхода статьи простыми словами: из чего сложилась сумма, где нестыковка и что сделать. */
export interface Why {
  /** Одна фраза — для списков */
  short: string
  /** Расчёт по шагам: «бюджет», «уже выполнено», «осталось», «итого» */
  steps: { label: string; value: string; tone?: 'bad' }[]
  /** Почему так вышло */
  reason: string
  /** Что сделать */
  fix: string
  /** Для раздела: статьи, из-за которых перерасход */
  items?: { code: string; name: string; over: number }[]
}

export interface WhyContext {
  etc: BudgetEtc[]
  forecast: BudgetForecast[]
  closedThrough: string | null
  rows: BudgetRow[]
}

const TOLERANCE = 9.99

/** null — статья в бюджете. */
export function explainOverrun(row: BudgetRow, ctx: WhyContext): Why | null {
  const over = -row.variance
  if (over <= TOLERANCE) return null
  const steps: Why['steps'] = [
    { label: tr('Бюджет статьи'), value: money(row.bac) },
    { label: tr('Уже выполнено (по актам)'), value: money(row.actual) },
    { label: tr('Ещё осталось потратить'), value: money(row.etc) },
    { label: tr('Итого выйдет'), value: money(row.eac) },
    { label: tr('Больше бюджета на'), value: money(over), tone: 'bad' },
  ]

  if (row.hasChildren) {
    // раздел: перечисляем статьи с перерасходом (самые глубокие, без их разделов)
    const ids = new Set<string>([row.id])
    const items: NonNullable<Why['items']> = []
    for (const r of ctx.rows) {
      if (!r.parent_id || !ids.has(r.parent_id)) continue
      ids.add(r.id)
      if (!r.hasChildren && -r.variance > TOLERANCE) items.push({ code: r.code, name: r.name, over: -r.variance })
    }
    items.sort((a, b) => b.over - a.over)
    const list = items.slice(0, 3).map((i) => `${i.code} (+${money(i.over)})`).join(', ')
    return {
      short: items.length ? tr('Перерасход из-за статей: {{list}}', { list }) : tr('Сумма статей раздела больше его бюджета'),
      steps,
      reason: items.length
        ? tr('Сам раздел ничего не тратит: его перерасход — это сумма перерасходов статей внутри. Откройте статью, чтобы увидеть её причину.')
        : tr('Статьи раздела в сумме выходят дороже бюджета раздела.'),
      fix: tr('Разберите статьи из списка ниже.'),
      items,
    }
  }

  if (row.actual > row.bac + TOLERANCE) {
    return {
      short: tr('Уже выполнено больше бюджета на {{sum}}', { sum: money(row.actual - row.bac) }),
      steps,
      reason: tr('По актам уже выполнено {{actual}}, а бюджет статьи — {{bac}}. Перерасход уже случился, он не прогноз.', { actual: money(row.actual), bac: money(row.bac) }),
      fix: tr('Проверьте акты по статье (не попали ли туда чужие затраты). Если всё верно — увеличьте бюджет статьи новой версией или покройте из резерва.'),
    }
  }

  if (row.etcSource === 'phased') {
    const closed = ctx.closedThrough?.slice(0, 7) ?? null
    const months = ctx.forecast.filter((f) => f.item_id === row.id && (!closed || f.month.slice(0, 7) > closed)).map((f) => f.month.slice(0, 7)).sort()
    const from = months[0]
    const to = months[months.length - 1]
    return {
      short: tr('По месяцам запланировано на {{sum}} больше бюджета', { sum: money(over) }),
      steps,
      reason:
        from && to
          ? tr('Бюджет статьи {{bac}}, выполнено {{actual}} — значит, осталось {{left}}. Но в раскладке на {{from}} – {{to}} запланировано {{plan}}. Месяцы расписаны на {{over}} больше, чем осталось в бюджете.', {
              bac: money(row.bac),
              actual: money(row.actual),
              left: money(Math.max(row.bac - row.actual, 0)),
              from: monthLong(from),
              to: monthLong(to),
              plan: money(row.etc),
              over: money(over),
            })
          : tr('В раскладке по месяцам запланировано больше, чем осталось в бюджете статьи.'),
      fix: tr('Откройте вкладку «Раскладка» и нажмите «Разложить заново» у этой статьи — остаток бюджета разложится по месяцам без лишнего. Если работы правда стоят дороже — увеличьте бюджет новой версией.'),
    }
  }

  if (row.etcSource === 'manual') {
    const note = ctx.etc.find((e) => e.item_id === row.id)?.note
    return {
      short: tr('Экономист оценил остаток в {{sum}}', { sum: money(row.etc) }),
      steps,
      reason: note
        ? tr('Экономист указал, что осталось потратить {{etc}} (основание: «{{note}}»). Вместе с выполненным это больше бюджета.', { etc: money(row.etc), note })
        : tr('Экономист указал, что осталось потратить {{etc}}. Вместе с выполненным это больше бюджета.', { etc: money(row.etc) }),
      fix: tr('Если оценка устарела — откройте подробную таблицу и нажмите «Вернуть расчёт системы». Если верна — увеличьте бюджет или покройте из резерва.'),
    }
  }

  if (row.etcSource === 'commit') {
    return {
      short: tr('Договоров на {{sum}} больше бюджета', { sum: money(row.commitments - row.bac) }),
      steps,
      reason: tr('Заключено договоров на {{c}}, а бюджет статьи — {{bac}}. Система считает, что по договорам придётся заплатить всё.', { c: money(row.commitments), bac: money(row.bac) }),
      fix: tr('Проверьте суммы договоров на вкладке «Договоры». Если они верны — увеличьте бюджет статьи новой версией.'),
    }
  }

  return {
    short: tr('Выйдет дороже на {{sum}}', { sum: money(over) }),
    steps,
    reason: tr('Выполненное и оставшееся вместе больше бюджета статьи.'),
    fix: tr('Проверьте акты и остаток по статье.'),
  }
}
