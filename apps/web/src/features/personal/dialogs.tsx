import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pin } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { deletePersonalItem, savePersonalItem, type PersonalItem } from '@/features/personal/api'
import { tr } from '@/lib/tr'

function errorText(e: unknown): string {
  const message = (e as { message?: string })?.message ?? ''
  if (message.includes('personal_items_check')) return tr('Проверьте время: окончание должно быть позже начала.')
  return tr('Не удалось сохранить. Проверьте соединение и повторите.')
}

/** Общая часть окон: сохранить и удалить с подтверждением, обновление списков. */
function useItemActions(item: PersonalItem | null, onClose: () => void) {
  const queryClient = useQueryClient()
  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ['personal'] })
    onClose()
  }
  const save = useMutation({ mutationFn: savePersonalItem, onSuccess: done, onError: (e) => toast.error(errorText(e)) })
  const remove = useMutation({ mutationFn: () => deletePersonalItem(item!.id), onSuccess: done, onError: (e) => toast.error(errorText(e)) })
  return { save, remove }
}

function DeleteBar({ name, onConfirm, pending, onCancel }: { name: string; onConfirm: () => void; pending: boolean; onCancel: () => void }) {
  return (
    <DialogFooter>
      <p className="mr-auto text-sm">{tr('Удалить «{{name}}»? Это нельзя отменить.', { name })}</p>
      <Button type="button" variant="outline" onClick={onCancel}>
        {tr('Отмена')}
      </Button>
      <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
        {tr('Удалить')}
      </Button>
    </DialogFooter>
  )
}

/** Заметка: название, текст, закрепление. Новая — `item` не задан. */
export function NoteDialog({ item, onClose }: { item: PersonalItem | null; onClose: () => void }) {
  const [title, setTitle] = useState(item?.title ?? '')
  const [body, setBody] = useState(item?.body ?? '')
  const [pinned, setPinned] = useState(item?.pinned ?? false)
  const [confirming, setConfirming] = useState(false)
  const { save, remove } = useItemActions(item, onClose)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? tr('Заметка') : tr('Новая заметка')}</DialogTitle>
          <DialogDescription>{tr('Личная заметка видна только вам.')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (title.trim()) save.mutate({ id: item?.id, kind: 'note', title, body, pinned })
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note-title">{tr('Название')}</Label>
            <Input id="note-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus={!item} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note-body">{tr('Текст')}</Label>
            <Textarea id="note-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} rows={8} className="min-h-40" />
          </div>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-9">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            <Pin className="size-4 text-muted-foreground" /> {tr('Закрепить сверху')}
          </label>
          {confirming ? (
            <DeleteBar name={item?.title ?? ''} pending={remove.isPending} onConfirm={() => remove.mutate()} onCancel={() => setConfirming(false)} />
          ) : (
            <DialogFooter>
              {item && (
                <Button type="button" variant="ghost" className="mr-auto text-destructive" onClick={() => setConfirming(true)}>
                  {tr('Удалить')}
                </Button>
              )}
              <Button type="button" variant="outline" onClick={onClose}>
                {tr('Отмена')}
              </Button>
              <Button type="submit" disabled={!title.trim() || save.isPending}>
                {tr('Сохранить')}
              </Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Личное событие: название, дата, время (или на весь день), место, описание. Новое — `item` не задан, `date` — предложенная дата. */
export function EventDialog({ item, date, onClose }: { item: PersonalItem | null; date?: string; onClose: () => void }) {
  const [title, setTitle] = useState(item?.title ?? '')
  const [day, setDay] = useState(item?.event_date ?? date ?? '')
  const [allDay, setAllDay] = useState(item ? !item.start_time : false)
  const [start, setStart] = useState(item?.start_time?.slice(0, 5) ?? '09:00')
  const [end, setEnd] = useState(item?.end_time?.slice(0, 5) ?? '')
  const [place, setPlace] = useState(item?.place ?? '')
  const [body, setBody] = useState(item?.body ?? '')
  const [confirming, setConfirming] = useState(false)
  const { save, remove } = useItemActions(item, onClose)
  const timeInvalid = !allDay && !!end && end <= start

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? tr('Личное событие') : tr('Новое личное событие')}</DialogTitle>
          <DialogDescription>{tr('Событие видно только вам. В календарях проектов оно показывается под типом «Личное».')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (title.trim() && day && !timeInvalid)
              save.mutate({ id: item?.id, kind: 'event', title, body, event_date: day, start_time: allDay ? null : start, end_time: allDay ? null : end, place })
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ev-title">{tr('Название')}</Label>
            <Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus={!item} required />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ev-date">{tr('Дата')}</Label>
              <DatePicker id="ev-date" value={day} onChange={setDay} clearable={false} />
            </div>
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 self-end text-sm sm:min-h-9">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
              {tr('На весь день')}
            </label>
          </div>
          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ev-start">{tr('Начало')}</Label>
                <Input id="ev-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ev-end">{tr('Окончание')}</Label>
                <Input id="ev-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={timeInvalid} />
              </div>
              {timeInvalid && <p className="col-span-2 text-sm text-destructive">{tr('Окончание должно быть позже начала.')}</p>}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ev-place">{tr('Место')}</Label>
            <Input id="ev-place" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={200} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ev-body">{tr('Описание')}</Label>
            <Textarea id="ev-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} rows={3} />
          </div>
          {confirming ? (
            <DeleteBar name={item?.title ?? ''} pending={remove.isPending} onConfirm={() => remove.mutate()} onCancel={() => setConfirming(false)} />
          ) : (
            <DialogFooter>
              {item && (
                <Button type="button" variant="ghost" className="mr-auto text-destructive" onClick={() => setConfirming(true)}>
                  {tr('Удалить')}
                </Button>
              )}
              <Button type="button" variant="outline" onClick={onClose}>
                {tr('Отмена')}
              </Button>
              <Button type="submit" disabled={!title.trim() || !day || timeInvalid || save.isPending}>
                {tr('Сохранить')}
              </Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}
