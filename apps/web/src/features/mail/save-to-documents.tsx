import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Check, Folder, FolderOpen, FolderPlus, Loader2 } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { FileTypeIcon } from '@/components/file-type-icon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/features/auth/auth-provider'
import { createDocument, DOC_ERROR_TEXT, DOC_TYPE_LABELS, DocumentError, titleFromFileName, type DocType } from '@/features/documents/api'
import { buildFolderTree, createFolder, folderErrorText, foldersQuery } from '@/features/documents/folders-api'
import { fetchAttachment, mailErrorText, MailError, type MailAttachment } from '@/features/mail/api'
import { myPermissionsQuery, projectsQuery } from '@/features/projects/api'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

/**
 * Вложение письма → документ проекта: выбрать проект и папку (или сразу создать новую) и сохранить. Файл берётся
 * через функцию почты (или из уже открытого просмотра) и загружается как обычный документ — с версией «A», виден своим.
 */

const LAST_PROJECT = 'mail-save-project'
const ROOT = '__root__'

const readLast = () => {
  try {
    return localStorage.getItem(LAST_PROJECT)
  } catch {
    return null
  }
}

/** Тип документа по файлу: чертёж для DWG/DXF, договор/отчёт не угадать — «Другое». */
const guessType = (name: string): DocType => (/\.(dwg|dxf)$/i.test(name) ? 'drawing' : /\.(jpe?g|png|heic|webp)$/i.test(name) ? 'photo' : 'other')

export function SaveToDocumentsDialog({
  messageId,
  attachment,
  blob,
  subject,
  onClose,
}: {
  messageId: string
  attachment: MailAttachment
  /** Файл уже скачан (открыт в просмотре) — второй раз не качаем */
  blob?: Blob
  /** Тема письма — в примечание к документу */
  subject?: string
  onClose: () => void
}) {
  const { tenantId } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data: projects, isPending: projectsPending } = useQuery(projectsQuery)
  const active = useMemo(() => (projects ?? []).filter((p) => p.status !== 'archived'), [projects])

  const [picked, setProjectId] = useState<string | null>(null)
  // проект по умолчанию — куда сохраняли в прошлый раз, иначе единственный
  const [last] = useState(readLast)
  const projectId = picked ?? active.find((p) => p.id === last)?.id ?? (active.length === 1 ? active[0].id : null)
  const project = active.find((p) => p.id === projectId) ?? null

  const { data: perms, isPending: permsPending } = useQuery({ ...myPermissionsQuery(projectId ?? undefined), enabled: !!projectId })
  const canUpload = !!perms?.includes('document.upload')
  const canPublish = !!perms?.includes('document.publish')
  const { data: folderRows, isPending: foldersPending } = useQuery({ ...foldersQuery(projectId ?? ''), enabled: !!projectId && canUpload })
  const folders = useMemo(() => buildFolderTree(folderRows ?? []).flat, [folderRows])

  const [folder, setFolder] = useState<string>(ROOT)
  const [title, setTitle] = useState(() => titleFromFileName(attachment.name))
  const [docType, setDocType] = useState<DocType>(() => guessType(attachment.name))
  const [newName, setNewName] = useState<string | null>(null)

  const pickProject = (id: string) => {
    setProjectId(id)
    setFolder(ROOT)
    setNewName(null)
  }

  const addFolder = useMutation({
    mutationFn: async (name: string) => createFolder(projectId!, folder === ROOT ? null : folder, name),
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['document-folders', projectId] })
      setFolder(id)
      setNewName(null)
    },
    onError: (e) => toast.error(folderErrorText(e, tr('Не удалось создать папку.'))),
  })

  const save = useMutation({
    mutationFn: async () => {
      const data = blob ?? (await fetchAttachment(messageId, attachment))
      const file = new File([data], attachment.name, { type: attachment.content_type || data.type || 'application/octet-stream' })
      return createDocument({
        projectId: projectId!,
        tenantId: tenantId!,
        file,
        title: title.trim() || titleFromFileName(attachment.name),
        code: '',
        docType,
        disciplineId: null,
        visibility: 'internal',
        requiresAck: false,
        revision: 'A',
        note: subject ? tr('Из письма: {{subject}}', { subject }) : tr('Из письма'),
        locationIds: [],
        orgIds: [],
        publish: canPublish,
        folderId: folder === ROOT ? null : folder,
      })
    },
    onSuccess: (documentId) => {
      try {
        localStorage.setItem(LAST_PROJECT, projectId!)
      } catch {
        /* не запомнили — не страшно */
      }
      void Promise.all(['documents', 'document-folders', 'entity-documents'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })))
      const code = project!.code
      const where = folder === ROOT ? project!.name : (folders.find((f) => f.id === folder)?.path ?? project!.name)
      toast.success(tr('Сохранено в документы: {{where}}', { where }), {
        action: { label: tr('Открыть'), onClick: () => void navigate({ to: '/projects/$code/document/$id', params: { code, id: documentId } }) },
      })
      onClose()
    },
    onError: (e) =>
      toast.error(
        e instanceof MailError ? mailErrorText(e) : e instanceof DocumentError ? (DOC_ERROR_TEXT[e.code] ?? tr('Не удалось сохранить документ.')) : tr('Не удалось сохранить документ.'),
      ),
  })

  const submitFolder = (e: FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const name = (newName ?? '').trim()
    if (name) addFolder.mutate(name)
  }

  const ready = !!project && canUpload && !!tenantId && !save.isPending
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Сохранить в документы')}</DialogTitle>
          <DialogDescription>{tr('Файл из письма станет документом проекта — его увидят участники проекта.')}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-2.5">
          <FileTypeIcon name={attachment.name} mime={attachment.content_type} className="size-9" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{attachment.name}</span>
        </div>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          <div className="grid gap-1.5">
            <Label htmlFor="save-doc-project">{tr('Проект')}</Label>
            <Select value={projectId ?? undefined} onValueChange={pickProject} disabled={projectsPending}>
              <SelectTrigger id="save-doc-project" className="w-full">
                <SelectValue placeholder={projectsPending ? tr('Загружаем…') : tr('Выберите проект')} />
              </SelectTrigger>
              <SelectContent>
                {active.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="font-mono text-xs text-muted-foreground">{p.code}</span> {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {project && !permsPending && !canUpload && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {tr('В этом проекте у вас нет права загружать документы. Выберите другой проект или попросите доступ у руководителя.')}
            </p>
          )}

          {project && canUpload && (
            <>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span id="save-doc-folder" className="text-sm font-medium">
                    {tr('Папка')}
                  </span>
                  {newName === null && (
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setNewName('')}>
                      <FolderPlus />
                      {tr('Новая папка')}
                    </Button>
                  )}
                </div>
                <div role="radiogroup" aria-labelledby="save-doc-folder" className="max-h-56 overflow-y-auto rounded-lg border p-1">
                  <FolderOption id={ROOT} label={tr('Без папки')} depth={0} selected={folder === ROOT} onSelect={setFolder} />
                  {foldersPending && <p className="px-2 py-1.5 text-xs text-muted-foreground">{tr('Загружаем папки…')}</p>}
                  {folders.map((f) => (
                    <FolderOption key={f.id} id={f.id} label={f.name} depth={f.depth + 1} selected={folder === f.id} onSelect={setFolder} />
                  ))}
                </div>
                {newName !== null && (
                  <form onSubmit={submitFolder} className="flex items-center gap-2">
                    <Input
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.stopPropagation()
                          setNewName(null)
                        }
                      }}
                      placeholder={folder === ROOT ? tr('Название новой папки') : tr('Новая папка внутри «{{name}}»', { name: folders.find((f) => f.id === folder)?.name ?? '' })}
                      aria-label={tr('Название новой папки')}
                      className="h-9"
                      maxLength={120}
                    />
                    <Button type="submit" size="sm" disabled={!newName.trim() || addFolder.isPending}>
                      {addFolder.isPending ? <Loader2 className="animate-spin" /> : <Check />}
                      {tr('Создать')}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setNewName(null)}>
                      {tr('Отмена')}
                    </Button>
                  </form>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
                <div className="grid gap-1.5">
                  <Label htmlFor="save-doc-title">{tr('Название документа')}</Label>
                  <Input id="save-doc-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="save-doc-type">{tr('Тип')}</Label>
                  <Select value={docType} onValueChange={(v) => setDocType(v as DocType)}>
                    <SelectTrigger id="save-doc-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(DOC_TYPE_LABELS) as DocType[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {DOC_TYPE_LABELS[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
            {tr('Отмена')}
          </Button>
          <Button type="button" disabled={!ready} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="animate-spin" />}
            {save.isPending ? tr('Сохраняем…') : tr('Сохранить')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FolderOption({ id, label, depth, selected, onSelect }: { id: string; label: string; depth: number; selected: boolean; onSelect: (id: string) => void }) {
  const Icon = selected ? FolderOpen : Folder
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(id)}
      style={{ paddingLeft: 8 + depth * 16 }}
      className={cn(
        'flex min-h-9 w-full items-center gap-2 rounded-md pr-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'bg-primary/10 font-medium text-foreground' : 'hover:bg-muted',
      )}
    >
      <Icon className={cn('size-4 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
    </button>
  )
}
