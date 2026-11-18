import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { Check, ChevronLeft, ChevronRight, Download, ExternalLink, Eye, FileText, Search } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { signedUrlQuery } from '@/features/activity/api'
import { projectFilesQuery, type CatalogItem, type CatalogKind } from '@/features/boards/api'
import { searchDocumentsQuery } from '@/features/documents/api'
import { DocThumb } from '@/features/documents/doc-thumb'
import { myPermissionsQuery } from '@/features/projects/api'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

// Окно «Файлы проекта»: всё, что можно прикрепить к карточке, — документы, чертежи и схемы, мебель (FF&E), рендеры, фото.
// Разделы вкладками; поиск — как главный: по названию, шифру, имени файла и подписи, а с 3 символов ещё и по тексту внутри
// документов (search_documents — извлечённый текст PDF, Word, Excel), с фрагментом найденного; миниатюры — как в реестре документов
// (первая страница PDF или уменьшенная картинка; если её ещё нет, рисуется при показе). Можно выбрать несколько файлов сразу,
// в том числе на разных страницах.

/** Файлов на странице: на широком экране — два ряда по четыре */
const PAGE = 8

const KINDS: { id: 'all' | CatalogKind; label: () => string }[] = [
  { id: 'all', label: () => tr('Все') },
  { id: 'document', label: () => tr('Документы') },
  { id: 'plan', label: () => tr('Чертежи и схемы') },
  { id: 'ffe', label: () => tr('Мебель') },
  { id: 'render', label: () => tr('Рендеры') },
  { id: 'photo', label: () => tr('Фото') },
]

export function ProjectFilePicker({
  projectId,
  open,
  onOpenChange,
  taken,
  onPick,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Ключи уже прикреплённого (`doc:<id>` / `file:<id>`) — их не даём выбрать повторно */
  taken: Set<string>
  onPick: (items: CatalogItem[]) => Promise<void>
}) {
  const { data: items, isLoading, isError } = useQuery({ ...projectFilesQuery(projectId), enabled: open })
  const { data: perms } = useQuery(myPermissionsQuery(projectId))
  const canGenerate = !!perms?.includes('comment.create')
  const [kind, setKind] = useState<'all' | CatalogKind>('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [picked, setPicked] = useState<Map<string, CatalogItem>>(new Map())
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<CatalogItem | null>(null)

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of items ?? []) m.set(i.kind, (m.get(i.kind) ?? 0) + 1)
    return m
  }, [items])

  // Поиск по тексту внутри документов — с небольшой задержкой, чтобы не спрашивать базу на каждую букву
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])
  const { data: textHits, isFetching: searchingText } = useQuery({
    ...searchDocumentsQuery(projectId, debounced),
    enabled: open && debounced.length >= 3,
  })
  const hits = useMemo(() => new Map((debounced.length >= 3 ? (textHits ?? []) : []).map((h) => [h.document_id, h])), [textHits, debounced])

  // Совпадения по названию — первыми, за ними найденные только в тексте (по релевантности)
  const filtered = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const inKind = (items ?? []).filter((i) => kind === 'all' || i.kind === kind)
    if (!words.length) return inKind
    const byName: CatalogItem[] = []
    const byText: CatalogItem[] = []
    for (const i of inKind) {
      const hay = `${i.title} ${i.subtitle ?? ''} ${i.file_name ?? ''}`.toLowerCase()
      if (words.every((w) => hay.includes(w))) byName.push(i)
      else if (i.document_id && hits.has(i.document_id)) byText.push(i)
    }
    byText.sort((a, b) => hits.get(b.document_id!)!.rank - hits.get(a.document_id!)!.rank)
    return [...byName, ...byText]
  }, [items, kind, q, hits])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const current = Math.min(page, pages - 1)
  const from = current * PAGE

  const reset = () => {
    setKind('all')
    setQ('')
    setPage(0)
    setPicked(new Map())
    setPreview(null)
  }
  const toggle = (i: CatalogItem) =>
    setPicked((m) => {
      const next = new Map(m)
      if (next.has(i.key)) next.delete(i.key)
      else next.set(i.key, i)
      return next
    })

  const submit = async () => {
    if (!picked.size) return
    setBusy(true)
    try {
      await onPick([...picked.values()])
      reset()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-[calc(100%-1rem)] flex-col gap-0 p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 gap-3 border-b px-4 pb-3 pt-4 sm:px-5">
          <DialogTitle>{tr('Файлы проекта')}</DialogTitle>
          <DialogDescription className="sr-only">{tr('Выберите файлы проекта, чтобы прикрепить их к карточке.')}</DialogDescription>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(0)
              }}
              placeholder={tr('Название, шифр, имя файла, тип номера…')}
              aria-label={tr('Поиск по файлам проекта')}
              className="pl-8"
            />
          </div>
          <div role="tablist" aria-label={tr('Раздел')} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
            {KINDS.map((k) => {
              const n = k.id === 'all' ? (items?.length ?? 0) : (counts.get(k.id) ?? 0)
              if (k.id !== 'all' && !n) return null
              return (
                <button
                  key={k.id}
                  type="button"
                  role="tab"
                  aria-selected={kind === k.id}
                  onClick={() => {
                    setKind(k.id)
                    setPage(0)
                  }}
                  className={cn(
                    'shrink-0 rounded-full px-3 py-1 text-sm transition-colors',
                    kind === k.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
                  )}
                >
                  {k.label()} <span className="tabular-nums opacity-70">{n}</span>
                </button>
              )
            })}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {isLoading ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <li key={i} className="aspect-[4/3] animate-pulse rounded-lg bg-muted" />
              ))}
            </ul>
          ) : isError ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{tr('Не удалось загрузить файлы проекта. Попробуйте ещё раз.')}</p>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {!q ? tr('В проекте нет доступных файлов') : searchingText || q.trim() !== debounced ? tr('Ищем в тексте документов…') : tr('Ничего не нашли')}
            </p>
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {filtered.slice(from, from + PAGE).map((i) => {
                  const done = taken.has(i.document_id ? `doc:${i.document_id}` : `file:${i.file_id}`)
                  const on = picked.has(i.key)
                  const hit = q.trim() && i.document_id ? hits.get(i.document_id) : undefined
                  return (
                    <li key={i.key} className="group/tile relative">
                      <button
                        type="button"
                        aria-pressed={on}
                        disabled={done || busy}
                        onClick={() => toggle(i)}
                        title={i.title}
                        className={cn(
                          'group relative flex w-full flex-col overflow-hidden rounded-lg border bg-card text-left outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring',
                          on ? 'border-primary ring-2 ring-primary' : 'hover:shadow-md',
                          done && 'cursor-default opacity-50',
                        )}
                      >
                        <DocThumb d={i} canGenerate={canGenerate} className="aspect-[4/3] w-full rounded-none border-0 border-b" />
                        <span className="flex min-w-0 flex-col px-2.5 py-2">
                          <span className="line-clamp-2 text-sm font-medium leading-snug">{i.title}</span>
                          <span className="truncate text-xs text-muted-foreground">{done ? tr('Уже прикреплено') : i.subtitle || i.file_name}</span>
                          {hit && (
                            <span className="mt-1 line-clamp-3 text-xs leading-snug text-muted-foreground" title={tr('Найдено в тексте документа')}>
                              <Snippet text={hit.snippet} />
                            </span>
                          )}
                        </span>
                        {(on || done) && (
                          <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground shadow" aria-hidden>
                            <Check className="size-4" strokeWidth={3} />
                          </span>
                        )}
                      </button>
                      {/* Просмотр перед прикреплением — отдельная кнопка поверх миниатюры (на телефоне видна всегда) */}
                      <button
                        type="button"
                        onClick={() => setPreview(i)}
                        aria-label={tr('Просмотреть {{name}}', { name: i.title })}
                        title={tr('Просмотреть')}
                        className="absolute left-2 top-2 flex h-7 items-center gap-1 rounded-full bg-background/90 px-2 text-xs font-medium shadow outline-none transition-opacity hover:bg-background focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover/tile:opacity-100"
                      >
                        <Eye className="size-3.5" aria-hidden /> {tr('Просмотр')}
                      </button>
                    </li>
                  )
                })}
              </ul>
              {pages > 1 && (
                <nav aria-label={tr('Страницы')} className="mt-4 flex items-center justify-center gap-2">
                  <Button type="button" variant="outline" size="icon-sm" aria-label={tr('Предыдущая страница')} disabled={current === 0} onClick={() => setPage(current - 1)}>
                    <ChevronLeft />
                  </Button>
                  <span className="min-w-28 text-center text-sm tabular-nums text-muted-foreground" aria-live="polite">
                    {tr('{{from}}–{{to}} из {{n}}', { from: from + 1, to: Math.min(from + PAGE, filtered.length), n: filtered.length })}
                  </span>
                  <Button type="button" variant="outline" size="icon-sm" aria-label={tr('Следующая страница')} disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                    <ChevronRight />
                  </Button>
                </nav>
              )}
            </>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 flex-row flex-wrap items-center justify-end gap-2 border-t px-4 py-3 sm:px-5">
          <span className="basis-full text-xs text-muted-foreground sm:mr-auto sm:basis-auto sm:text-sm">{picked.size ? tr('Выбрано: {{n}}', { n: picked.size }) : tr('Отметьте один или несколько файлов')}</span>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {tr('Отмена')}
          </Button>
          <Button type="button" disabled={!picked.size || busy} onClick={() => void submit()}>
            {busy ? tr('Прикрепляем…') : tr('Прикрепить')}
          </Button>
        </DialogFooter>
        {preview && (
          <FilePreview
            item={preview}
            picked={picked.has(preview.key)}
            done={taken.has(preview.document_id ? `doc:${preview.document_id}` : `file:${preview.file_id}`)}
            onToggle={() => toggle(preview)}
            onClose={() => setPreview(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Просмотр файла перед прикреплением — поверх окна выбора: картинка или PDF прямо здесь; остальное (Excel, Word, DWG) —
 * миниатюра и ссылка открыть документ на его странице в новой вкладке (там свой просмотрщик) или скачать файл.
 */
function FilePreview({
  item,
  picked,
  done,
  onToggle,
  onClose,
}: {
  item: CatalogItem
  picked: boolean
  done: boolean
  onToggle: () => void
  onClose: () => void
}) {
  const { code } = useParams({ strict: false }) as { code?: string }
  const { data: url, isLoading, isError } = useQuery({ ...signedUrlQuery(item.storage_key ?? ''), enabled: !!item.storage_key })
  const mime = item.file_mime ?? ''
  const isImage = mime.startsWith('image/')
  const isPdf = mime === 'application/pdf'
  const docPage = item.document_id && code ? `/projects/${code}/document/${item.document_id}` : null

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] max-w-[calc(100%-1rem)] flex-col gap-0 p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12 sm:px-5">
          <DialogTitle className="truncate text-base">{item.title}</DialogTitle>
          <DialogDescription className="truncate">{[item.subtitle, item.file_name].filter(Boolean).join(' · ')}</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-muted/40">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{tr('Загружаем…')}</p>
          ) : isError || !url ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{tr('Не удалось открыть файл.')}</p>
          ) : isImage ? (
            <img src={url} alt={item.title} className="max-h-full max-w-full object-contain" />
          ) : isPdf ? (
            <iframe src={url} title={item.title} className="size-full border-0 bg-white" />
          ) : (
            <div className="flex max-w-sm flex-col items-center gap-4 p-6 text-center">
              <DocThumb d={item} canGenerate={false} className="h-56 w-44" />
              <p className="text-sm text-muted-foreground">{tr('Этот формат браузер не показывает. Откройте документ на его странице или скачайте файл.')}</p>
            </div>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 flex-row flex-wrap items-center justify-end gap-2 border-t px-4 py-3 sm:px-5">
          {docPage && (
            <Button asChild variant="ghost" className="sm:mr-auto">
              <a href={docPage} target="_blank" rel="noopener" aria-label={tr('Страница документа')} title={tr('Страница документа')}>
                <FileText /> <span className="hidden sm:inline">{tr('Страница документа')}</span>
              </a>
            </Button>
          )}
          {url && (
            <Button asChild variant="ghost" className={docPage ? '' : 'sm:mr-auto'}>
              <a
                href={url}
                target="_blank"
                rel="noopener"
                download={isImage || isPdf ? undefined : (item.file_name ?? true)}
                aria-label={isImage || isPdf ? tr('В новой вкладке') : tr('Скачать')}
                title={isImage || isPdf ? tr('В новой вкладке') : tr('Скачать')}
              >
                {isImage || isPdf ? <ExternalLink /> : <Download />} <span className="hidden sm:inline">{isImage || isPdf ? tr('В новой вкладке') : tr('Скачать')}</span>
              </a>
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={onClose}>
            {tr('Назад к списку')}
          </Button>
          <Button
            type="button"
            disabled={done}
            variant={picked ? 'outline' : 'default'}
            onClick={() => {
              onToggle()
              if (!picked) onClose()
            }}
          >
            {done ? tr('Уже прикреплено') : picked ? tr('Снять выбор') : tr('Выбрать')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Фрагмент найденного текста: слова из запроса (в «…» от ts_headline) подсвечены. */
function Snippet({ text }: { text: string }): ReactNode {
  return text.split(/«([^«»]*)»/g).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-sm bg-signal/40 px-0.5 text-foreground">
        {part}
      </mark>
    ) : (
      part
    ),
  )
}
