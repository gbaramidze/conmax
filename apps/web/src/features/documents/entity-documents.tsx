import { tr } from '@/lib/tr'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { BellRing, FileText, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { addLink, documentsQuery, entityDocumentsQuery, removeLink } from '@/features/documents/api'
import { UploadDocumentDialog } from '@/features/documents/upload-dialog'
import { myPermissionsQuery } from '@/features/projects/api'

/**
 * Документы, привязанные к месту или задаче. Для места можно передать вышестоящие места (`inherited`):
 * план корпуса виден и на его этажах.
 */
export function EntityDocuments({
  entity,
  inherited = [],
  projectId,
  code,
  title = tr('Документы'),
}: {
  entity: { type: 'location' | 'task' | 'ffe_item' | 'room_type'; id: string }
  inherited?: { type: 'location' | 'task' | 'ffe_item' | 'room_type'; id: string }[]
  projectId: string
  code: string
  title?: string
}) {
  const queryClient = useQueryClient()
  const { data: permissions } = useQuery(myPermissionsQuery(projectId))
  const canUpload = !!permissions?.includes('document.upload')
  const { data } = useQuery(entityDocumentsQuery([entity, ...inherited]))
  const { data: all } = useQuery({ ...documentsQuery(projectId), enabled: canUpload })
  const [uploading, setUploading] = useState(false)
  const [pick, setPick] = useState('')

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['entity-documents'] }),
      queryClient.invalidateQueries({ queryKey: ['documents'] }),
      entity.type === 'ffe_item' ? queryClient.invalidateQueries({ queryKey: ['ffe', 'docs'] }) : Promise.resolve(),
    ])

  const link = useMutation({
    mutationFn: (docId: string) => addLink(docId, entity.type, entity.id),
    onSuccess: async () => {
      setPick('')
      await refresh()
    },
    onError: () => toast.error(tr('Не удалось привязать документ. Привязывать может автор или выпускающий.')),
  })
  const unlink = useMutation({
    mutationFn: (linkId: string) => removeLink(linkId),
    onSuccess: refresh,
    onError: () => toast.error(tr('Не удалось убрать привязку.')),
  })

  const docs = data?.docs ?? []
  const own = new Map((data?.links ?? []).filter((l) => l.entity_type === entity.type && l.entity_id === entity.id).map((l) => [l.document_id, l.id]))
  // документы, пришедшие от типа номера (а не от самого места или вышестоящих мест)
  const typePlanIds = new Set((data?.links ?? []).filter((l) => l.entity_type === 'room_type' && entity.type !== 'room_type').map((l) => l.document_id))
  const linkable = (all ?? []).filter((d) => !(data?.links ?? []).some((l) => l.document_id === d.id && l.entity_type === entity.type && l.entity_id === entity.id))

  if (docs.length === 0 && !canUpload) return null

  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="size-4 text-muted-foreground" aria-hidden /> {title}
          {docs.length > 0 ? ` · ${docs.length}` : ''}
        </h3>
        {canUpload && (
          <Button type="button" size="sm" variant="outline" onClick={() => setUploading(true)}>
            <Plus />{tr('Загрузить')}</Button>
        )}
      </div>

      {docs.length > 0 ? (
        <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card">
          {docs.map((d) => {
            const linkId = own.get(d.id)
            return (
              <li key={d.id} className="flex min-h-12 items-center gap-2 px-3">
                <Link to="/projects/$code/document/$id" params={{ code, id: d.id }} className="flex min-w-0 flex-1 flex-col py-1.5 hover:underline">
                  <span className="truncate text-sm font-medium">{d.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {d.code ? `${d.code} · ` : ''}
                    {d.current_revision ? tr('ревизия {{current_revision}}', { current_revision: d.current_revision }) : d.current_version_id ? tr('выпущен') : tr('черновик')}
                    {!linkId ? (typePlanIds.has(d.id) ? tr(' · общий для типа номера') : tr(' · относится к вышестоящему месту')) : ''}
                  </span>
                </Link>
                {d.ack_pending && <BellRing className="size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-label={tr('Требуется ознакомление')} />}
                {linkId && canUpload && (
                  <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={tr('Убрать документ {{title}}', { title: d.title })} onClick={() => unlink.mutate(linkId)}>
                    <X />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{tr('Документов нет. Загрузите или привяжите существующий.')}</p>
      )}

      {canUpload && linkable.length > 0 && (
        <div className="flex gap-2">
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger aria-label={tr('Привязать существующий документ')} className="min-w-0 flex-1">
              <SelectValue placeholder={tr('Привязать существующий документ')} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {linkable.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.code ? `${d.code} · ` : ''}
                  {d.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" disabled={!pick || link.isPending} onClick={() => link.mutate(pick)}>{tr('Привязать')}</Button>
        </div>
      )}

      {uploading && (
        <UploadDocumentDialog
          projectId={projectId}
          presetLocationId={entity.type === 'location' ? entity.id : undefined}
          presetTaskId={entity.type === 'task' ? entity.id : undefined}
          presetFfeItemId={entity.type === 'ffe_item' ? entity.id : undefined}
          presetRoomTypeId={entity.type === 'room_type' ? entity.id : undefined}
          onClose={() => setUploading(false)}
        />
      )}
    </section>
  )
}
