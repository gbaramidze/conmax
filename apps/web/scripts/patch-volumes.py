base = 'C:/dev/buildos/apps/web/src/'


def rd(p):
    return open(base + p, encoding='utf-8').read()


def wr(p, s):
    open(base + p, 'w', encoding='utf-8').write(s)


def sub(s, old, new, label):
    if old not in s:
        print('MISSING', label)
        return s
    return s.replace(old, new, 1)


p = 'features/volumes/api.ts'
s = rd(p)
s = sub(s, "  plannedQty: number\n  weight: number | null\n}): Promise<void> {", "  plannedQty: number\n  weight: number | null\n  plannedStart?: string | null\n  plannedFinish?: string | null\n}): Promise<void> {", 'create sig')
s = sub(s, "    weight: input.weight,\n  } as never) // tenant_id и location_path проставляет триггер БД", "    weight: input.weight,\n    planned_start: input.plannedStart || null,\n    planned_finish: input.plannedFinish || null,\n  } as never) // tenant_id и location_path проставляет триггер БД", 'create body')
s = sub(s, "  qty: string\n  weight: string\n}", "  qty: string\n  weight: string\n  start: string\n  finish: string\n}", 'ImportRow')
s = sub(s, "  weight: ['вес', 'стоимость', 'трудоёмкость', 'трудоемкость', 'weight'],\n}", "  weight: ['вес', 'стоимость', 'трудоёмкость', 'трудоемкость', 'weight'],\n  start: ['начало', 'дата начала', 'старт', 'start', 'start date'],\n  finish: ['окончание', 'конец', 'дата окончания', 'финиш', 'finish', 'end', 'end date'],\n}", 'aliases')
s = sub(s, "export const IMPORT_TEMPLATE_HEADER = ['Место', 'Направление', 'Подрядчик', 'Работа', 'Ед. изм.', 'Объём', 'Вес']", "export const IMPORT_TEMPLATE_HEADER = ['Место', 'Направление', 'Подрядчик', 'Работа', 'Ед. изм.', 'Объём', 'Вес', 'Начало', 'Окончание']", 'template header')
s = sub(s, "  const cell = (r: unknown[], f: keyof ImportRow) => (index.has(f) ? String(r[index.get(f)!] ?? '').trim() : '')", """  const cell = (r: unknown[], f: keyof ImportRow) => {
    if (!index.has(f)) return ''
    const v = r[index.get(f)!]
    if (f === 'start' || f === 'finish') return normDate(v)
    return String(v ?? '').trim()
  }""", 'cell')
s = sub(s, "    weight: cell(r, 'weight').replace(/[\\s ]/g, ''),\n  }))", "    weight: cell(r, 'weight').replace(/[\\s ]/g, ''),\n    start: cell(r, 'start'),\n    finish: cell(r, 'finish'),\n  }))", 'rows')
s = sub(s, "/** Разбор строк таблицы по заголовкам", """/** Дата из таблицы: ячейка-дата Excel, «25.10.2026» или «2026-10-25» → «2026-10-25»; непонятное остаётся как есть (сервер сообщит об ошибке). */
export function normDate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`
  const t = String(v ?? '').trim()
  const dmy = /^(\\d{1,2})[./](\\d{1,2})[./](\\d{4})$/.exec(t)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  return t
}

/** Разбор строк таблицы по заголовкам""", 'normDate')
s = sub(s, "  const example = ['K1.S1.F05', 'KR', tr('МонолитСтрой'), tr('Монтаж стеклопакетов'), tr('м²'), '150', '900']", "  const example = ['K1.S1.F05', 'KR', tr('МонолитСтрой'), tr('Монтаж стеклопакетов'), tr('м²'), '150', '900', '2026-11-02', '2026-11-20']", 'example')
s += """
/** Позиция на много мест сразу: одинаковые название, объём и сроки для каждого выбранного места. Возвращает число созданных. */
export async function createWorkItemsBulk(input: {
  projectId: string
  locationIds: string[]
  disciplineId: string | null
  contractorId: string | null
  name: string
  unit: string
  plannedQty: number
  weight: number | null
  plannedStart: string | null
  plannedFinish: string | null
}): Promise<number> {
  let created = 0
  for (let i = 0; i < input.locationIds.length; i += 300) {
    const rows = input.locationIds.slice(i, i + 300).map((locationId) => ({
      project_id: input.projectId,
      location_id: locationId,
      discipline_id: input.disciplineId,
      contractor_org_id: input.contractorId,
      name: input.name,
      unit: input.unit,
      planned_qty: input.plannedQty,
      weight: input.weight,
      planned_start: input.plannedStart || null,
      planned_finish: input.plannedFinish || null,
    }))
    const { error } = await supabase.from('work_items').insert(rows as never)
    if (error) throw error
    created += rows.length
  }
  return created
}

/** Места, где позиция с таким названием уже есть (повторное массовое добавление их пропускает). */
export async function locationsWithItem(projectId: string, name: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('work_items').select('location_id').eq('project_id', projectId).eq('status', 'active').is('deleted_at', null).ilike('name', name.trim()).limit(5000)
  if (error) throw error
  return new Set((data ?? []).map((r) => r.location_id))
}
"""
wr(p, s)

# route: dates in the add dialog + bulk button
p = 'routes/_app/projects/$code.volumes.tsx'
s = rd(p)
s = sub(s, "  discipline: z.string(),\n  contractor: z.string(),\n})", "  discipline: z.string(),\n  contractor: z.string(),\n  start: z.string(),\n  finish: z.string(),\n}).refine((v) => !v.start || !v.finish || v.finish >= v.start, { path: ['finish'], message: tr('Окончание не может быть раньше начала') })", 'schema')
s = sub(s, "discipline: NONE, contractor: NONE } })", "discipline: NONE, contractor: NONE, start: '', finish: '' } })", 'defaults')
s = sub(s, "        weight: v.weight.trim() === '' ? null : Number(v.weight.replace(',', '.')),\n      }),", "        weight: v.weight.trim() === '' ? null : Number(v.weight.replace(',', '.')),\n        plannedStart: v.start || null,\n        plannedFinish: v.finish || null,\n      }),", 'save')
s = sub(s, "          <div className=\"flex flex-col gap-2\">\n            <Label htmlFor=\"i-weight\">", """          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="i-start">{tr('Начало')}</Label>
              <Input id="i-start" type="date" {...register('start')} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="i-finish">{tr('Окончание')}</Label>
              <Input id="i-finish" type="date" aria-invalid={!!errors.finish} {...register('finish')} />
              {errors.finish && <p className="text-sm text-destructive">{errors.finish.message}</p>}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="i-weight">""", 'date fields')
wr(p, s)
print('ok')
