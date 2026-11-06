import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { FileSpreadsheet, FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { EntityDocuments } from '@/features/documents/entity-documents'
import {
  deleteItem,
  ffeDocsQuery,
  ffeError,
  ffeItemsQuery,
  IMPORT_ITEM_HEADER,
  importItems,
  itemsFromTable,
  roomFfeQuery,
  roomTypesQuery,
  upsertItem,
  type FfeItem,
  type ImportItemRow,
} from '@/features/ffe/api'
import { readTable } from '@/features/volumes/api'
import { tr } from '@/lib/tr'

/** Каталог мебели и оборудования: код, название, категория, чертёж. Загружается из Excel или добавляется вручную. */
export function CatalogTab({ projectId, code, canEdit }: { projectId: string; code: string; canEdit: boolean }) {
  const { data: items } = useSuspenseQuery(ffeItemsQuery(projectId))
  const { data: rows } = useSuspenseQuery(roomFfeQuery(projectId))
  const { data: typeData } = useSuspenseQuery(roomTypesQuery(projectId))
  const { data: docsByItem } = useSuspenseQuery(ffeDocsQuery(projectId))
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [editing, setEditing] = useState<FfeItem | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [removing, setRemoving] = useState<FfeItem | null>(null)

  const used = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.item_id, (m.get(r.item_id) ?? 0) + r.qty)
    return m
  }, [rows])
  const inTypes = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of typeData.items) m.set(r.item_id, (m.get(r.item_id) ?? 0) + 1)
    return m
  }, [typeData.items])
  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)), [items])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((i) => (!category || i.category === category) && (!q || i.code.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)))
  }, [items, query, category])

  const remove = useMutation({
    mutationFn: (i: FfeItem) => deleteItem(projectId, i.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ffe'] })
      toast.success(tr('Позиция удалена'))
      setRemoving(null)
    },
    onError: (e) => toast.error(ffeError(e)),
  })

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-full sm:w-64" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Код или название')} aria-label={tr('Поиск по каталогу')} />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label={tr('Категория')}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">{tr('Все категории')}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">{tr('Позиций: {{n}}', { n: visible.length })}</span>
        {canEdit && (
          <span className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
              <FileSpreadsheet /> {tr('Из Excel')}
            </Button>
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus /> {tr('Добавить позицию')}
            </Button>
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
          <p className="font-medium">{tr('Каталог пока пуст')}</p>
          <p className="max-w-prose text-sm text-muted-foreground">
            {tr('Загрузите таблицу: код, название, категория, единица и шифр чертежа — или добавляйте позиции по одной. Эти коды потом назначаются типам номеров.')}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card shadow-soft">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{tr('Код')}</th>
                <th className="px-3 py-2 font-medium">{tr('Название')}</th>
                <th className="px-3 py-2 font-medium">{tr('Категория')}</th>
                <th className="px-3 py-2 font-medium">{tr('Чертежи и файлы')}</th>
                <th className="px-3 py-2 text-right font-medium">{tr('В номерах')}</th>
                {canEdit && <th className="w-24" />}
              </tr>
            </thead>
            <tbody>
              {visible.map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="ident px-3 py-2">{i.code}</td>
                  <td className="px-3 py-2">{i.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{i.category ?? '—'}</td>
                  <td className="px-3 py-2">
                    <DocChips docs={docsByItem.get(i.id) ?? []} code={code} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {used.get(i.id) ?? 0} {i.unit}
                    {inTypes.get(i.id) ? <span className="block text-xs text-muted-foreground">{tr('в типах: {{n}}', { n: inTypes.get(i.id) })}</span> : null}
                  </td>
                  {canEdit && (
                    <td className="px-2 py-1 text-right">
                      <Button size="icon" variant="ghost" aria-label={tr('Изменить {{name}}', { name: i.name })} onClick={() => setEditing(i)}>
                        <Pencil />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label={tr('Удалить {{name}}', { name: i.name })} onClick={() => setRemoving(i)}>
                        <Trash2 />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <ItemDialog projectId={projectId} code={code} item={editing === 'new' ? null : editing} categories={categories} onClose={() => setEditing(null)} />}
      {importing && <ImportDialog projectId={projectId} onClose={() => setImporting(false)} />}
      {removing && (
        <Dialog open onOpenChange={(o) => !o && setRemoving(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{tr('Удалить «{{name}}»?', { name: removing.name })}</DialogTitle>
              <DialogDescription>{tr('Позицию, которая уже стоит в номерах или типах, удалить нельзя.')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRemoving(null)}>{tr('Отмена')}</Button>
              <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(removing)}>{tr('Удалить')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}

function ItemDialog({ projectId, code: projectCode, item, categories, onClose }: { projectId: string; code: string; item: FfeItem | null; categories: string[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [code, setCode] = useState(item?.code ?? '')
  const [name, setName] = useState(item?.name ?? '')
  const [category, setCategory] = useState(item?.category ?? '')
  const [unit, setUnit] = useState(item?.unit ?? 'шт')
  const [note, setNote] = useState(item?.note ?? '')
  // новая позиция после сохранения остаётся открытой: к ней сразу можно приложить файлы
  const [savedId, setSavedId] = useState<string | null>(item?.id ?? null)

  const save = useMutation({
    mutationFn: () => upsertItem({ projectId, id: savedId, code: code.trim(), name: name.trim(), category: category.trim(), unit: unit.trim(), note: note.trim() }),
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['ffe'] })
      toast.success(tr('Позиция сохранена'))
      if (item || savedId) onClose()
      else setSavedId(id)
    },
    onError: (e) => toast.error(ffeError(e)),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="flex max-h-[90svh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? tr('Позиция {{code}}', { code: item.code }) : tr('Новая позиция')}</DialogTitle>
          <DialogDescription>{tr('Мебель или оборудование с кодом из чертежей: кровать, тумбочка, шкаф…')}</DialogDescription>
        </DialogHeader>
        <form
          id="ffe-item-form"
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
          onSubmit={(e) => {
            e.preventDefault()
            if (code.trim() && name.trim() && !save.isPending) save.mutate()
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="fi-code">{tr('Код')}</Label>
              <Input id="fi-code" value={code} maxLength={60} autoFocus onChange={(e) => setCode(e.target.value)} placeholder="FF-101" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fi-unit">{tr('Единица')}</Label>
              <Input id="fi-unit" value={unit} maxLength={20} onChange={(e) => setUnit(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="fi-name">{tr('Название')}</Label>
            <Input id="fi-name" value={name} maxLength={300} onChange={(e) => setName(e.target.value)} placeholder={tr('Например, кровать King 180×200')} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="fi-cat">{tr('Категория')}</Label>
            <Input id="fi-cat" list="fi-cats" value={category} maxLength={80} onChange={(e) => setCategory(e.target.value)} placeholder={tr('Кровати, тумбочки, шкафы…')} />
            <datalist id="fi-cats">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="fi-note">{tr('Примечание')}</Label>
            <Textarea id="fi-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {savedId ? (
            <EntityDocuments entity={{ type: 'ffe_item', id: savedId }} projectId={projectId} code={projectCode} title={tr('Чертежи и файлы')} />
          ) : (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{tr('Сохраните позицию — после этого к ней можно приложить чертежи и файлы.')}</p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>{savedId && !item ? tr('Готово') : tr('Отмена')}</Button>
          <Button type="submit" form="ffe-item-form" disabled={!code.trim() || !name.trim() || save.isPending}>
            {save.isPending ? tr('Сохраняем…') : item || savedId ? tr('Сохранить') : tr('Сохранить и добавить файлы')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Файлы позиции: до трёх ссылок на документы и счётчик остальных. */
function DocChips({ docs, code }: { docs: { id: string; code: string | null; title: string }[]; code: string }) {
  if (docs.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {docs.slice(0, 3).map((d) => (
        <Link key={d.id} to="/projects/$code/plan/$id" params={{ code, id: d.id }} search={{}} title={d.title} className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
          <FileText className="size-3.5" aria-hidden /> {d.code ?? d.title}
        </Link>
      ))}
      {docs.length > 3 && <span className="text-xs text-muted-foreground">{tr('ещё {{n}}', { n: docs.length - 3 })}</span>}
    </span>
  )
}

function ImportDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<ImportItemRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)

  const run = useMutation({
    mutationFn: () => importItems(projectId, rows ?? []),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ['ffe'] })
      toast.success(tr('Загружено позиций: новых {{created}}, обновлено {{updated}}', { created: r.created, updated: r.updated }))
      if (r.unknown_documents > 0) toast.warning(tr('Чертежей не найдено по шифру: {{n}}', { n: r.unknown_documents }))
      onClose()
    },
    onError: (e) => setError(ffeError(e)),
  })

  const pick = async (file: File | undefined) => {
    if (!file) return
    setReading(true)
    setError(null)
    try {
      const table = await readTable(file)
      const parsed = itemsFromTable(table)
      if (parsed.missing.length > 0) setError(tr('В файле нет колонок: {{v1}}. Скачайте шаблон и заполните его.', { v1: parsed.missing.join(', ') }))
      else if (parsed.rows.length === 0) setError(tr('В файле нет строк с данными.'))
      else if (parsed.rows.length > 3000) setError(tr('Не больше 3000 строк за раз.'))
      else if (parsed.rows.some((r) => !r.code || !r.name)) setError(tr('У каждой строки должны быть код и название.'))
      else setRows(parsed.rows)
    } catch {
      setError(tr('Не удалось прочитать файл. Подойдут .xlsx и .csv.'))
    } finally {
      setReading(false)
    }
  }

  const template = () => {
    const csv = '﻿' + [IMPORT_ITEM_HEADER, ['FF-101', 'Кровать King 180×200', 'Кровати', 'шт', 'A-101']].map((r) => r.join(';')).join('\r\n') + '\r\n'
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'ffe-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !run.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Загрузить каталог из Excel')}</DialogTitle>
          <DialogDescription>{tr('Колонки: код, название, категория, ед. изм., шифр чертежа. Позиции с уже существующим кодом обновляются.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Button type="button" variant="link" className="self-start px-0" onClick={template}>
            {tr('Скачать шаблон')}
          </Button>
          <input type="file" accept=".xlsx,.csv" aria-label={tr('Выбрать файл (.xlsx или .csv)')} onChange={(e) => void pick(e.target.files?.[0])} className="text-sm" />
          {reading && <p className="text-sm text-muted-foreground">{tr('Читаем файл…')}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {rows && <p className="text-sm">{tr('Готово к загрузке: {{n}}', { n: rows.length })}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button disabled={!rows || run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? tr('Загружаем…') : tr('Загрузить')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
