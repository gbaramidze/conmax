import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { roomTypesQuery } from '@/features/ffe/api'
import { locationsQuery } from '@/features/locations/api'
import { deleteFolder, moveFolder, type ImageEntity } from '@/features/renders/api'
import { TargetPicker } from '@/features/renders/folder-upload-dialog'
import type { Target } from '@/features/renders/match'
import { tr } from '@/lib/tr'

const clean = (v: string) => v.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

/** Переименовать папку и, если нужно, перенести её (вместе с подпапками) в другое место или тип номера. */
export function RenameMoveDialog({ projectId, entity, folder, count, onClose, onDone }: { projectId: string; entity: ImageEntity; folder: string; count: number; onClose: () => void; onDone: () => Promise<unknown> }) {
  const { data: rows = [] } = useQuery(locationsQuery(projectId))
  const { data: typeData } = useQuery(roomTypesQuery(projectId))
  const places = useMemo(() => ({ rows, types: typeData?.types ?? [] }), [rows, typeData])
  const [name, setName] = useState(folder)
  const [dest, setDest] = useState<Target | null>(null)
  const next = clean(name)
  const same = !dest && next === folder
  const save = useMutation({
    mutationFn: () => moveFolder(projectId, entity, folder, { entity: dest ? { type: dest.type, id: dest.id } : undefined, folder: next }),
    onSuccess: async (n) => {
      toast.success(dest ? tr('Папка перенесена: {{n}} изображений', { n }) : tr('Папка переименована'))
      await onDone()
      onClose()
    },
    onError: (e) => toast.error((e as { message?: string })?.message?.includes('42501') ? tr('Нет права менять рендеры.') : tr('Не удалось сохранить. Проверьте название папки.')),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Папка «{{name}}»', { name: folder.replace(/\//g, ' › ') })}</DialogTitle>
          <DialogDescription>{tr('Изображений в папке и подпапках: {{n}}. Версии переносятся вместе с ними.', { n: count })}</DialogDescription>
        </DialogHeader>
        <form
          id="folder-move"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!same && next) save.mutate()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="folder-name">{tr('Название папки')}</Label>
            <Input id="folder-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} autoFocus />
            <p className="text-xs text-muted-foreground">{tr('Подпапки пишутся через косую черту: «Спальня/Ночь». Подпапки переименуются вместе с ней.')}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="folder-dest">{tr('Перенести в другое место или тип номера')}</Label>
            <TargetPicker value={dest} places={places} onChange={setDest} />
            <p className="text-xs text-muted-foreground">
              {dest ? tr('Папка уйдёт в «{{name}}», здесь её не останется.', { name: dest.label }) : tr('Оставьте пустым, чтобы только переименовать папку здесь.')}
              {dest && (
                <button type="button" className="ml-2 underline underline-offset-2" onClick={() => setDest(null)}>
                  {tr('Не переносить')}
                </button>
              )}
            </p>
          </div>
        </form>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            {tr('Отмена')}
          </Button>
          <Button type="submit" form="folder-move" disabled={same || !next || save.isPending}>
            {dest ? tr('Перенести') : tr('Переименовать')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Удалить папку со всеми подпапками и изображениями: нужно подтверждение, откатить нельзя. */
export function DeleteFolderDialog({ projectId, entity, folder, count, onClose, onDone }: { projectId: string; entity: ImageEntity; folder: string; count: number; onClose: () => void; onDone: () => Promise<unknown> }) {
  const remove = useMutation({
    mutationFn: () => deleteFolder(projectId, entity, folder),
    onSuccess: async () => {
      toast.success(tr('Папка удалена'))
      await onDone()
      onClose()
    },
    onError: () => toast.error(tr('Не удалось удалить папку. Попробуйте ещё раз.')),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && !remove.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Удалить папку «{{name}}»?', { name: folder.replace(/\//g, ' › ') })}</DialogTitle>
          <DialogDescription>{tr('Будут удалены все изображения в этой папке и её подпапках вместе с версиями: {{n}}. Это нельзя отменить.', { n: count })}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={remove.isPending}>
            {tr('Отмена')}
          </Button>
          <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
            {remove.isPending ? tr('Удаляем…') : tr('Удалить папку')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
