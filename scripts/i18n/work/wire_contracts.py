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


# route
p = 'routes/_app/projects/$code.ffe.tsx'
s = rd(p)
s = sub(s, "import { ffeDocsQuery, ffeItemsQuery, roomFfeQuery,", "import { ContractsTab } from '@/features/ffe/contracts-tab'\nimport { ffeContractsQuery, ffeDocsQuery, ffeItemsQuery, ffePricesQuery, ffeScopesQuery, roomFfeQuery,", 'route import')
s = sub(s, "z.enum(['bill', 'catalog', 'types'])", "z.enum(['bill', 'catalog', 'types', 'contracts'])", 'enum')
s = sub(s, "      queryClient.ensureQueryData(ffeDocsQuery(project.id)),", "      queryClient.ensureQueryData(ffeDocsQuery(project.id)),\n      queryClient.ensureQueryData(ffeContractsQuery(project.id)),\n      queryClient.ensureQueryData(ffeScopesQuery(project.id)),\n      queryClient.ensureQueryData(ffePricesQuery(project.id)),", 'loader')
s = sub(s, "  ['types', tr('Типы номеров')],\n", "  ['types', tr('Типы номеров')],\n  ['contracts', tr('Договоры')],\n", 'tabs')
s = sub(s, "  const canEdit = permissions.includes('location.manage') || permissions.includes('schedule.edit')\n", "  const canEdit = permissions.includes('location.manage') || permissions.includes('schedule.edit')\n  const canBudget = permissions.includes('budget.view')\n", 'canBudget')
old = "{tab === 'catalog' ? <CatalogTab projectId={p.id} code={code} canEdit={canEdit} /> : tab === 'types' ? <TypesTab projectId={p.id} canEdit={canEdit} /> : <BillTab projectId={p.id} code={code} canEdit={canEdit} />}"
new = """{tab === 'catalog' ? (
          <CatalogTab projectId={p.id} code={code} canEdit={canEdit} />
        ) : tab === 'types' ? (
          <TypesTab projectId={p.id} canEdit={canEdit} />
        ) : tab === 'contracts' ? (
          <ContractsTab projectId={p.id} canEdit={canEdit} canBudget={canBudget} />
        ) : (
          <BillTab projectId={p.id} code={code} canEdit={canEdit} canBudget={canBudget} />
        )}"""
s = sub(s, old, new, 'tab switch')
s = sub(s, "типы номеров и ведомость со статусом каждой позиции", "типы номеров, договоры с подрядчиками и ведомость со статусом каждой позиции", 'intro')
wr(p, s)

# bill
p = 'features/ffe/bill.tsx'
s = rd(p)
s = sub(s, "import { ExportButton } from '@/features/export/export-button'", "import { fmtMoney } from '@/features/budget/api'\nimport { ExportButton } from '@/features/export/export-button'\nimport { contractorName, useContractsModel } from '@/features/ffe/contracts-model'", 'bill imports')
s = sub(s, "export function BillTab({ projectId, code, canEdit }: { projectId: string; code: string; canEdit: boolean }) {", "export function BillTab({ projectId, code, canEdit, canBudget }: { projectId: string; code: string; canEdit: boolean; canBudget: boolean }) {\n  const model = useContractsModel(projectId)", 'bill sig')
s = sub(s, "  const [query, setQuery] = useState('')\n  const [open,", "  const [query, setQuery] = useState('')\n  const [contractFilter, setContractFilter] = useState('')\n  const [open,", 'state')
s = sub(s, "      if (status && r.status !== status) return false\n", "      if (status && r.status !== status) return false\n      if (contractFilter) {\n        const c = model.contractAt(loc.path)\n        if (contractFilter === '__none__' ? !!c : c?.id !== contractFilter) return false\n      }\n", 'filter')
s = sub(s, "  }, [rows, locById, scopeNode, status, query, itemById])", "  }, [rows, locById, scopeNode, status, query, itemById, contractFilter, model])", 'deps')
s = sub(s, "  const totals = useMemo(() => statusTotals(filtered), [filtered])", """  const totals = useMemo(() => statusTotals(filtered), [filtered])
  const money = useMemo(() => filtered.reduce((sum, r) => sum + (model.lineAmount(r) ?? 0), 0), [filtered, model])
  const contractLabel = (locationId: string) => {
    const path = locById.get(locationId)?.path
    const c = path ? model.contractAt(path) : undefined
    return c ? contractorName(c) : ''
  }""", 'totals')
s = sub(s, "<div className=\"grid grid-cols-2 gap-2 sm:grid-cols-5\">", "<div className=\"grid grid-cols-2 gap-2 sm:grid-cols-5\">", 'grid')
s = sub(s, "      <div className=\"flex flex-wrap items-center gap-2\">\n        <div role=\"group\" aria-label={tr('Вид ведомости')}", """      {canBudget && model.contracts.length > 0 && (
        <p className="text-sm text-muted-foreground">{tr('Стоимость показанной мебели по договорам: {{sum}}', { sum: fmtMoney(money) })}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={tr('Вид ведомости')}""", 'money line')
s = sub(s, "        <div className=\"flex min-w-0 items-center gap-1 sm:w-72\">", """        {model.contracts.length > 0 && (
          <select value={contractFilter} onChange={(e) => setContractFilter(e.target.value)} aria-label={tr('Подрядчик')} className="h-9 max-w-52 rounded-md border bg-background px-2 text-sm">
            <option value="">{tr('Все подрядчики')}</option>
            {model.contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {contractorName(c)} · {c.number ?? c.title}
              </option>
            ))}
            <option value="__none__">{tr('Без подрядчика')}</option>
          </select>
        )}
        <div className="flex min-w-0 items-center gap-1 sm:w-72">""", 'select')
s = sub(s, "onStatus={(s) => change([l.id], s)} path={locById.get(l.location_id)?.path ?? ''} />", "onStatus={(s) => change([l.id], s)} path={locById.get(l.location_id)?.path ?? ''} contractor={contractLabel(l.location_id)} amount={canBudget ? model.lineAmount(l) : null} />", 'line1')
s = sub(s, "onStatus={(s) => change([l.id], s)} path={locById.get(l.location_id)?.path ?? ''} noLink />", "onStatus={(s) => change([l.id], s)} path={locById.get(l.location_id)?.path ?? ''} noLink contractor={contractLabel(l.location_id)} amount={canBudget ? model.lineAmount(l) : null} />", 'line2')
s = sub(s, "function LineRow({ code, line, title, place, unit, canEdit, onStatus, path, noLink }: { code: string; line: RoomFfe; title: string; place: string; unit: string; canEdit: boolean; onStatus: (s: FfeStatus) => void; path: string; noLink?: boolean }) {", "function LineRow({ code, line, title, place, unit, canEdit, onStatus, path, noLink, contractor, amount }: { code: string; line: RoomFfe; title: string; place: string; unit: string; canEdit: boolean; onStatus: (s: FfeStatus) => void; path: string; noLink?: boolean; contractor: string; amount: number | null }) {", 'LineRow sig')
s = sub(s, "        {line.source === 'manual' && <span className=\"ml-2 text-xs text-muted-foreground\">{tr('своя правка')}</span>}\n      </span>", """        {line.source === 'manual' && <span className="ml-2 text-xs text-muted-foreground">{tr('своя правка')}</span>}
        {contractor && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">{contractor}</span>}
      </span>
      {amount !== null && <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{fmtMoney(amount)}</span>}""", 'LineRow body')
s = sub(s, "tr('Количество'), tr('Статус')],", "tr('Количество'), tr('Статус'), tr('Подрядчик'), ...(canBudget ? [tr('Сумма')] : [])],", 'export headers')
s = sub(s, "itemById.get(l.item_id)?.name ?? '', l.qty, FFE_STATUS_LABELS[l.status]]),", "itemById.get(l.item_id)?.name ?? '', l.qty, FFE_STATUS_LABELS[l.status], contractLabel(r.locationId), ...(canBudget ? [model.lineAmount(l) ?? ''] : [])]),", 'export rows')
wr(p, s)

# room spec
p = 'features/ffe/room-spec.tsx'
s = rd(p)
s = sub(s, "import { tr } from '@/lib/tr'", "import { fmtMoney } from '@/features/budget/api'\nimport { contractorName, useContractsModel } from '@/features/ffe/contracts-model'\nimport { tr } from '@/lib/tr'", 'rs imports')
s = sub(s, "export function RoomSpec({ projectId, code, loc, canEdit }: { projectId: string; code: string; loc: LocationRow; canEdit: boolean }) {", "export function RoomSpec({ projectId, code, loc, canEdit, canBudget }: { projectId: string; code: string; loc: LocationRow; canEdit: boolean; canBudget: boolean }) {\n  const model = useContractsModel(projectId)\n  const contract = model.contractAt(loc.path)", 'rs sig')
s = sub(s, "      <div className=\"flex items-center justify-between gap-2 pt-1\">\n        <h4 className=\"text-sm font-medium\">{tr('Мебель и оборудование')}</h4>", """      {contract && (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">
          {tr('Подрядчик: {{name}}', { name: contractorName(contract) })} · {contract.number ? `№ ${contract.number}` : contract.title}
          {contract.signed_on ? ` · ${tr('подписан {{d}}', { d: new Date(`${contract.signed_on}T00:00:00`).toLocaleDateString() })}` : ''}
          {contract.signer ? ` · ${contract.signer.full_name}` : ''}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <h4 className="text-sm font-medium">{tr('Мебель и оборудование')}</h4>""", 'rs contract')
s = sub(s, "                {canEdit ? (\n                  <Input\n                    key={`${l.id}-${l.qty}`}", """                {canBudget && model.lineAmount(l) !== null && <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{fmtMoney(model.lineAmount(l) ?? 0)}</span>}
                {canEdit ? (
                  <Input
                    key={`${l.id}-${l.qty}`}""", 'rs amount')
wr(p, s)

# location sheet
p = 'routes/_app/projects/$code.locations.$path.tsx'
s = rd(p)
s = sub(s, "canEdit={permissions.includes('location.manage') || permissions.includes('schedule.edit')} />", "canEdit={permissions.includes('location.manage') || permissions.includes('schedule.edit')} canBudget={permissions.includes('budget.view')} />", 'sheet')
wr(p, s)
print('done')
