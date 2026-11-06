import { tr } from '@/lib/tr'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/auth-provider'
import { addVersion, DOC_ERROR_TEXT, DocumentError, nextRevision, versionsQuery } from '@/features/documents/api'
import { myPermissionsQuery } from '@/features/projects/api'
import type { SaveSpec } from './types'

/** Список версий, где есть более новая, чем та, что правили */
export function newerVersion(versions: { id: string; version_no: number; revision: string }[] | undefined, baseId: string | null) {
  if (!versions || versions.length === 0) return null
  const base = versions.find((v) => v.id === baseId)
  const top = versions.reduce((a, b) => (b.version_no > a.version_no ? b : a))
  return base && top.version_no > base.version_no ? top : null
}

/** Окно «Сохранить как новую версию»: ревизия, заметка «что изменилось» (уже заполнена по правкам), выпуск сразу или черновик. */
export function SaveVersionDialog({
  spec,
  documentId,
  projectId,
  baseVersionId,
  fileName,
  onClose,
  onSaved,
}: {
  spec: SaveSpec
  documentId: string
  projectId: string
  baseVersionId: string | null
  fileName: string
  onClose: () => void
  onSaved: () => void
}) {
  const { tenantId } = useAuth()
  const queryClient = useQueryClient()
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(projectId))
  const canPublish = permissions.includes('document.publish')
  // свежий список версий: пока правили, кто-то мог выпустить новую
  const { data: versions, isFetching } = useQuery({ ...versionsQuery(documentId), staleTime: 0, refetchOnMount: 'always' })
  const newer = newerVersion(versions, baseVersionId)
  const base = versions?.find((v) => v.id === baseVersionId)

  // ревизия предлагается по самой свежей версии, а если пользователь её поменял — берём его
  const [typedRevision, setTypedRevision] = useState<string | null>(null)
  const [note, setNote] = useState(spec.summary)
  const [publish, setPublish] = useState(canPublish)
  const [forced, setForced] = useState(false)
  const [acked, setAcked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = !!versions && !isFetching
  const top = versions && versions.length > 0 ? versions.reduce((a, b) => (b.version_no > a.version_no ? b : a)) : null
  const revision = typedRevision ?? nextRevision((newer ? top : (base ?? top))?.revision)

  const save = useMutation({
    mutationFn: async () => {
      const blob = await spec.build()
      const file = new File([blob], fileName, { type: spec.mime })
      await addVersion({ documentId, projectId, tenantId: tenantId!, file, revision: revision.trim(), note: note.trim(), publish: publish && canPublish })
    },
    onSuccess: async () => {
      await Promise.all(['documents', 'document', 'document-versions', 'entity-documents', 'activity', 'office-file'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })))
      toast.success(publish && canPublish ? tr('Новая версия выпущена') : tr('Версия сохранена как черновик'))
      onSaved()
    },
    onError: (e) => setError(e instanceof DocumentError ? (DOC_ERROR_TEXT[e.code] ?? tr('Не удалось сохранить версию. Попробуйте ещё раз.')) : tr('Не удалось собрать или загрузить файл. Попробуйте ещё раз.')),
  })

  const blocked = !ready || save.isPending || (!!newer && !forced) || (!!spec.ack && !acked)

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Сохранить как новую версию')}</DialogTitle>
          <DialogDescription>{tr('Прежние версии останутся, файл «')}{fileName}{tr('» сохранится под тем же именем.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {newer && (
            <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium">{tr('Пока вы правили, появилась новая версия (ревизия')}{' '}{newer.revision || `№${newer.version_no}`}).</p>
              <p className="mt-1 text-muted-foreground">{tr('Ваш файл собран из прежней версии: правки из новой в нём не будут. Лучше сохранить свои изменения как черновик и сверить версии.')}</p>
              <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3">
                <input type="checkbox" className="size-5 md:size-4" checked={forced} onChange={(e) => setForced(e.target.checked)} />{tr('Всё равно сохранить следующей версией')}</label>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="e-rev">{tr('Ревизия')}</Label>
            <Input
              id="e-rev"
              value={revision}
              maxLength={20}
              onChange={(e) => setTypedRevision(e.target.value)}
              className="text-base sm:w-40 md:text-sm"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="e-note">{tr('Что изменилось')}</Label>
            <Textarea id="e-note" rows={5} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} className="text-base md:text-sm" />
            <p className="text-xs text-muted-foreground">{tr('Заметка собрана автоматически по вашим правкам. Её можно дополнить.')}</p>
          </div>
          {canPublish && (
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" className="size-5 md:size-4" checked={publish} onChange={(e) => setPublish(e.target.checked)} />{tr('Сразу выпустить и уведомить команду')}</label>
          )}
          {!canPublish && <p className="text-xs text-muted-foreground">{tr('Версия сохранится как черновик: выпустить её может ответственный за документы.')}</p>}
          {spec.notes.map((n) => (
            <p key={n} className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              {n}
            </p>
          ))}
          {spec.ack && (
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-5 shrink-0 md:size-4" checked={acked} onChange={(e) => setAcked(e.target.checked)} />
              {spec.ack}
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={save.isPending} onClick={onClose}>{tr('Вернуться к правке')}</Button>
          <Button
            disabled={blocked}
            onClick={() => {
              setError(null)
              save.mutate()
            }}
          >
            {save.isPending ? tr('Сохраняем…') : !ready ? tr('Проверяем версии…') : publish && canPublish ? tr('Сохранить и выпустить') : tr('Сохранить версию')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
