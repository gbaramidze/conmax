import { tr } from '@/lib/tr'
import { useQuery } from '@tanstack/react-query'
import { useBlocker } from '@tanstack/react-router'
import { AlertTriangle, Pencil, Save } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FILES_BUCKET } from '@/features/activity/api'
import { versionsQuery } from '@/features/documents/api'
import type { OfficeKind } from '@/features/documents/office'
import { supabase } from '@/lib/supabase'
import { SaveVersionDialog, newerVersion } from './save-dialog'
import { SheetEditor, type SheetSource } from './sheet-editor'
import { TextEditor } from './text-editor'
import { readCsv, decodeText, type DecodedText } from './text-io'
import type { EditorHost, SaveSpec } from './types'
import { WordEditor } from './word-editor'
import { readXlsx, zipNames } from './xlsx-io'

export interface EditFile {
  key: string
  name: string
  mime: string
  size: number
}

type Init =
  | { type: 'text'; data: DecodedText; mime: string }
  | { type: 'sheets'; source: SheetSource }
  | { type: 'word'; html: string; extras: string[] }

async function loadForEdit(file: EditFile, kind: OfficeKind): Promise<Init> {
  const { data: blob, error } = await supabase.storage.from(FILES_BUCKET).download(file.key)
  if (error || !blob) throw error ?? new Error('file_not_found')
  const bytes = await blob.arrayBuffer()
  if (kind === 'excel') {
    if (/\.csv$/i.test(file.name) || file.mime === 'text/csv') {
      const { sheet, meta } = await readCsv(bytes)
      return { type: 'sheets', source: { kind: 'csv', sheet, meta } }
    }
    const { wb, sheets, lost } = await readXlsx(bytes)
    return { type: 'sheets', source: { kind: 'xlsx', wb, sheets, lost } }
  }
  if (kind === 'word') {
    const mammoth = (await import('mammoth')).default
    const result = await mammoth.convertToHtml({ arrayBuffer: bytes })
    const names = zipNames(bytes)
    const extras: string[] = []
    if (names.some((n) => /^word\/(header|footer)\d*\.xml$/.test(n))) extras.push(tr('колонтитулы'))
    if (names.includes('word/comments.xml')) extras.push(tr('комментарии'))
    if (names.some((n) => n.startsWith('word/charts/'))) extras.push(tr('диаграммы'))
    if (names.some((n) => n.startsWith('word/embeddings/'))) extras.push(tr('вложенные объекты'))
    return { type: 'word', html: result.value, extras }
  }
  return { type: 'text', data: decodeText(bytes), mime: file.mime }
}

/**
 * Правка документа на месте: тот же экран, но вместо просмотра — редактор. Результат сохраняется новой версией
 * с заметкой «что изменилось», собранной по правкам.
 */
export function OfficeEditor({
  projectId,
  documentId,
  baseVersionId: baseVersionProp,
  file: fileProp,
  kind: kindProp,
  onClose,
}: {
  projectId: string
  documentId: string
  baseVersionId: string | null
  file: EditFile
  kind: OfficeKind
  onClose: () => void
}) {
  // файл и версия фиксируются в момент открытия: если за время правки выйдет новая версия, правим всё равно прежнюю
  const [start] = useState(() => ({ file: fileProp, kind: kindProp, baseVersionId: baseVersionProp }))
  const { file, kind, baseVersionId } = start
  const [init, setInit] = useState<Init | null>(null)
  const [failed, setFailed] = useState(false)
  const [dirty, setDirtyState] = useState(false)
  const dirtyRef = useRef(false)
  const getSave = useRef<(() => SaveSpec) | null>(null)
  const [spec, setSpec] = useState<SaveSpec | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)

  const host = useMemo<EditorHost>(
    () => ({
      setDirty: (d) => {
        dirtyRef.current = d
        setDirtyState(d)
      },
      bind: (get) => {
        getSave.current = get
      },
    }),
    [],
  )

  useEffect(() => {
    let alive = true
    loadForEdit(file, kind)
      .then((i) => alive && setInit(i))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [file, kind])

  // пока правили, могла появиться новая версия
  const { data: versions } = useQuery({ ...versionsQuery(documentId), refetchInterval: 30_000 })
  const newer = newerVersion(versions, baseVersionId)

  // уход со страницы и закрытие вкладки с несохранёнными правками
  const blocker = useBlocker({ shouldBlockFn: () => dirtyRef.current, enableBeforeUnload: () => dirtyRef.current, withResolver: true })

  const close = () => {
    dirtyRef.current = false
    onClose()
  }

  const lostNotice =
    init?.type === 'sheets' && init.source.kind === 'xlsx' && init.source.lost.length > 0
      ? tr('В файле есть {{v1}}: при сохранении они пропадут.', { v1: init.source.lost.join(', ') })
      : init?.type === 'word' && init.extras.length > 0
        ? tr('В файле есть {{v1}}: при сохранении они пропадут.', { v1: init.extras.join(', ') })
        : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b bg-muted/40 px-2 py-1">
        <Pencil className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium" title={kind === 'excel' && !/\.csv$/i.test(file.name) ? tr('Оформление, ширины колонок, рисунки и формулы сохраняются; значения формул пересчитываются по ходу правки.') : undefined}>{tr('Правка')}</span>
        <span className={`text-xs ${dirty ? 'font-medium text-amber-700 dark:text-amber-400' : 'sr-only'}`} aria-live="polite">
          {dirty ? tr('Есть несохранённые изменения') : tr('Изменений нет')}
        </span>
        {kind === 'word' && (
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground" title={tr('Оформление Word упрощается: сложные элементы (колонтитулы, формулы, макеты) могут не сохраниться. Для точного вида правьте файл в Word.')}>
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{tr('Оформление Word упрощается')}</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-9 md:h-8" onClick={() => (dirty ? setConfirmCancel(true) : close())}>{tr('Отмена')}</Button>
          <Button
            size="sm"
            className="h-9 md:h-8"
            disabled={!init || !dirty}
            title={dirty ? undefined : tr('Нечего сохранять: вы ничего не изменили')}
            onClick={() => {
              const s = getSave.current?.()
              if (!s?.changed) return toast.info(tr('Вы ничего не изменили.'))
              setSpec(s)
            }}
          >
            <Save /> <span className="sm:hidden">{tr('Сохранить')}</span>
            <span className="hidden sm:inline">{tr('Сохранить как новую версию')}</span>
          </Button>
        </div>
      </div>

      {newer && (
        <p role="status" className="flex items-start gap-2 border-b border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <span>{tr('Пока вы правите, появилась новая версия (ревизия')}{' '}{newer.revision || `№${newer.version_no}`}{tr('). Ваши правки сделаны на прежней: сохранить можно, но изменения из новой версии в файл не попадут.')}</span>
        </p>
      )}
      {lostNotice && (
        <p role="alert" className="flex items-start gap-2 border-b border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{lostNotice}</span>
        </p>
      )}

      <div className="min-h-0 flex-1">
        {failed && <p className="grid h-full min-h-40 place-items-center p-6 text-center text-sm text-muted-foreground">{tr('Не удалось открыть файл для правки. Он может быть повреждён или защищён паролем: скачайте его и исправьте в программе.')}</p>}
        {!failed && !init && <p className="grid h-full min-h-40 place-items-center text-sm text-muted-foreground">{tr('Открываем файл для правки…')}</p>}
        {init?.type === 'text' && <TextEditor data={init.data} name={file.name} mime={init.mime} host={host} />}
        {init?.type === 'sheets' && <SheetEditor source={init.source} host={host} />}
        {init?.type === 'word' && <WordEditor html={init.html} extras={init.extras} host={host} />}
      </div>

      {spec && (
        <SaveVersionDialog
          spec={spec}
          documentId={documentId}
          projectId={projectId}
          baseVersionId={baseVersionId}
          fileName={file.name}
          onClose={() => setSpec(null)}
          onSaved={() => {
            setSpec(null)
            close()
          }}
        />
      )}

      <DiscardDialog
        open={confirmCancel || blocker.status === 'blocked'}
        leaving={blocker.status === 'blocked'}
        onKeep={() => {
          setConfirmCancel(false)
          if (blocker.status === 'blocked') blocker.reset()
        }}
        onDiscard={() => {
          setConfirmCancel(false)
          dirtyRef.current = false
          if (blocker.status === 'blocked') blocker.proceed()
          else close()
        }}
      />
    </div>
  )
}

function DiscardDialog({ open, leaving, onKeep, onDiscard }: { open: boolean; leaving: boolean; onKeep: () => void; onDiscard: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onKeep()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Отбросить изменения?')}</DialogTitle>
          <DialogDescription>{leaving ? tr('Вы не сохранили правки. Если уйти со страницы, они пропадут.') : tr('Вы не сохранили правки. Если закрыть правку, они пропадут.')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onDiscard}>{tr('Отбросить')}</Button>
          <Button onClick={onKeep}>{tr('Продолжить правку')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
