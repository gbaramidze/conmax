import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'
import { saveRequest, type RequestLine } from './api'

export const field = 'rounded-md border bg-background px-3 text-sm disabled:opacity-70'
const emptyLine = (): RequestLine => ({ name: '', unit: '', qty: 1, est_price: null, note: '' })

export interface RequestDraft {
  id: string
  key: string
  title: string
  cbs_item_id: string | null
  needed_by: string | null
  note: string
  urgent: boolean
  lines: RequestLine[]
}

/**
 * Создание заявки и правка черновика. Инициатор только перечисляет, что нужно, сколько и к какой дате:
 * цену находит отдел закупок, статью бюджета ставят руководитель проекта или закупщик в карточке заявки.
 */
export function RequestForm({ projectId, request, onClose, onSaved }: { projectId: string; request: RequestDraft | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(request?.title ?? '')
  const [neededBy, setNeededBy] = useState(request?.needed_by ?? '')
  const [note, setNote] = useState(request?.note ?? '')
  const [urgent, setUrgent] = useState(request?.urgent ?? false)
  const [lines, setLines] = useState<RequestLine[]>(request?.lines.length ? request.lines.map((l) => ({ ...l })) : [emptyLine()])
  const setLine = (i: number, patch: Partial<RequestLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const valid = title.trim() && lines.every((l) => l.name.trim() && l.qty > 0)
  const save = useMutation({
    // статья бюджета и цены, если их уже проставили, сохраняются как были
    mutationFn: () => saveRequest(projectId, { id: request?.id, title: title.trim(), cbsItem: request?.cbs_item_id ?? null, neededBy: neededBy || null, note, urgent, lines: lines.map((l) => ({ ...l, name: l.name.trim() })) }),
    onSuccess: async (id) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['requests'] }), queryClient.invalidateQueries({ queryKey: ['request', id] }), queryClient.invalidateQueries({ queryKey: ['activity'] })])
      toast.success(request ? tr('Заявка сохранена') : tr('Заявка записана'))
      onSaved?.(id)
      onClose()
    },
    onError: (e) => toast.error((e as { code?: string })?.code === '42501' ? tr('Нет права создавать заявки.') : tr('Не удалось сохранить заявку. Проверьте поля и позиции.')),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{request ? `${request.key} · ${tr('правка')}` : tr('Новая заявка на закупку')}</DialogTitle>
          <DialogDescription>{tr('Перечислите, что нужно, сколько и к какой дате. Цены и статью бюджета заполнять не нужно — это сделают отдел закупок и руководитель.')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) save.mutate()
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <div className="flex flex-col gap-1">
              <label htmlFor="pr-title" className="text-xs text-muted-foreground">
                {tr('Название заявки')}
              </label>
              <input id="pr-title" value={title} maxLength={200} required autoFocus={!request} placeholder={tr('Например: арматура на 5 этаж')} onChange={(e) => setTitle(e.target.value)} className={cn(field, 'h-10')} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="pr-needed" className="text-xs text-muted-foreground">
                {tr('Нужно на площадке до')}
              </label>
              <DatePicker id="pr-needed" value={neededBy} onChange={setNeededBy} />
            </div>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs text-muted-foreground">{tr('Что нужно')}</legend>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_5rem_5rem_auto] items-center gap-2">
                <input aria-label={tr('Наименование')} placeholder={tr('Наименование, марка, размер')} value={l.name} maxLength={300} onChange={(e) => setLine(i, { name: e.target.value })} className={cn(field, 'h-10')} />
                <input aria-label={tr('Количество')} placeholder={tr('Кол-во')} inputMode="decimal" value={l.qty || ''} onChange={(e) => setLine(i, { qty: Number(e.target.value.replace(',', '.')) || 0 })} className={cn(field, 'h-10 tabular-nums')} />
                <input aria-label={tr('Единица')} placeholder={tr('Ед.')} value={l.unit} maxLength={20} onChange={(e) => setLine(i, { unit: e.target.value })} className={cn(field, 'h-10')} />
                <button type="button" aria-label={tr('Убрать позицию')} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
                <Plus /> {tr('Добавить позицию')}
              </Button>
            </div>
          </fieldset>

          <div className="flex flex-col gap-1">
            <label htmlFor="pr-note" className="text-xs text-muted-foreground">
              {tr('Зачем нужно и требования: цвет, модель, размер, бренд, куда доставить')}
            </label>
            <textarea id="pr-note" rows={3} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} className={cn(field, 'py-2')} />
          </div>
          <label className="flex min-h-10 cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm has-[:checked]:border-amber-500/60 has-[:checked]:bg-amber-400/10">
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="mt-0.5 size-4 accent-amber-600" />
            <span className="flex flex-col">
              <span className="font-medium">{tr('Срочно')}</span>
              <span className="text-xs text-muted-foreground">{tr('Работа на площадке стоит. Отдел закупок получит уведомление с высоким приоритетом — вместо звонка или WhatsApp.')}</span>
            </span>
          </label>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {tr('Отмена')}
            </Button>
            <Button type="submit" disabled={save.isPending || !valid}>
              {tr('Сохранить черновик')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
