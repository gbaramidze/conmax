import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pin } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
export function useItemActions(item: PersonalItem | null, onClose: () => void) {
  const queryClient = useQueryClient()
  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ['personal'] })
    onClose()
  }
  const save = useMutation({ mutationFn: savePersonalItem, onSuccess: done, onError: (e) => toast.error(errorText(e)) })
  const remove = useMutation({ mutationFn: () => deletePersonalItem(item!.id), onSuccess: done, onError: (e) => toast.error(errorText(e)) })
  return { save, remove }
}

export function DeleteBar({ name, onConfirm, pending, onCancel }: { name: string; onConfirm: () => void; pending: boolean; onCancel: () => void }) {
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
