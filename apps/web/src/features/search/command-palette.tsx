import { tr } from '@/lib/tr'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Bell, Building2, FileText, FolderKanban, ListChecks, MapPin, Search, Sun, TextSearch, Users, GanttChart, MapPinned } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { DocThumb, type ThumbDoc } from '@/features/documents/doc-thumb'
import { DEFAULT_TASK_SEARCH } from '@/features/tasks/api'
import { supabase } from '@/lib/supabase'

const OPEN_EVENT = 'buildos:open-search'

/** Открыть поиск из любого места (кнопка в шапке, боковой панели). */
export function openSearch() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

interface Hit {
  kind: 'project' | 'task' | 'document' | 'document_text' | 'location'
  id: string
  title: string
  subtitle: string | null
  project_code: string
  ref: string
  snippet: string | null
}

const KIND_LABEL: Record<Hit['kind'], string> = {
  project: tr('Проекты'),
  task: tr('Задачи'),
  document: tr('Документы'),
  document_text: tr('В тексте документов'),
  location: tr('Места'),
}
const KIND_ICON: Record<Hit['kind'], ReactNode> = {
  project: <Building2 className="size-4" aria-hidden />,
  task: <ListChecks className="size-4" aria-hidden />,
  document: <FileText className="size-4" aria-hidden />,
  document_text: <TextSearch className="size-4" aria-hidden />,
  location: <MapPin className="size-4" aria-hidden />,
}

interface Shortcut {
  id: string
  title: string
  icon: ReactNode
  go: () => void
}

/** Подсветка слов в «ёлочках» во фрагменте найденного текста. */
function Snippet({ text }: { text: string }) {
  return (
    <span className="line-clamp-2 text-xs text-muted-foreground">
      {text.split(/(«[^»]*»)/g).map((p, i) =>
        p.startsWith('«') ? (
          <mark key={i} className="rounded bg-signal/40 px-0.5 text-foreground">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  )
}

/** Поиск и переходы по Ctrl+K (⌘K): проекты, задачи, документы (в том числе по тексту), места. */
export function CommandPalette() {
  const navigate = useNavigate()
  const { code } = useParams({ strict: false }) as { code?: string }
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(OPEN_EVENT, onOpen)
    }
  }, [])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setDebounced('')
    }
  }, [open])
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])

  const { data: hits = [], isFetching } = useQuery({
    queryKey: ['global-search', debounced],
    enabled: open && debounced.length >= 2,
    staleTime: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('global_search', { p_query: debounced })
      if (error) throw error
      return data as unknown as Hit[]
    },
  })

  const close = () => setOpen(false)
  const shortcuts: Shortcut[] = useMemo(() => {
    const list: Shortcut[] = [
      { id: 'today', title: tr('Мой день'), icon: <Sun className="size-4" aria-hidden />, go: () => void navigate({ to: '/today' }) },
      { id: 'projects', title: tr('Проекты'), icon: <Building2 className="size-4" aria-hidden />, go: () => void navigate({ to: '/projects' }) },
      { id: 'inbox', title: tr('Уведомления'), icon: <Bell className="size-4" aria-hidden />, go: () => void navigate({ to: '/inbox', search: { tab: 'all' } }) },
    ]
    if (code) {
      list.push(
        { id: 'tasks', title: tr('Задачи {{code}}', { code }), icon: <ListChecks className="size-4" aria-hidden />, go: () => void navigate({ to: '/projects/$code/tasks', params: { code }, search: DEFAULT_TASK_SEARCH }) },
        { id: 'docs', title: tr('Документы {{code}}', { code }), icon: <FileText className="size-4" aria-hidden />, go: () => void navigate({ to: '/projects/$code/documents', params: { code }, search: {} }) },
        { id: 'plans', title: tr('Планы {{code}}', { code }), icon: <MapPinned className="size-4" aria-hidden />, go: () => void navigate({ to: '/projects/$code/plans', params: { code } }) },
        { id: 'schedule', title: tr('График {{code}}', { code }), icon: <GanttChart className="size-4" aria-hidden />, go: () => void navigate({ to: '/projects/$code/schedule', params: { code } }) },
        { id: 'meetings', title: tr('Совещания {{code}}', { code }), icon: <Users className="size-4" aria-hidden />, go: () => void navigate({ to: '/projects/$code/meetings', params: { code }, search: {} }) },
        { id: 'volumes', title: tr('Объёмы {{code}}', { code }), icon: <FolderKanban className="size-4" aria-hidden />, go: () => void navigate({ to: '/projects/$code/volumes', params: { code } }) },
      )
    }
    return list
  }, [code, navigate])

  const showShortcuts = debounced.length < 2
  // миниатюры найденных документов: одним запросом по их id
  const docIds = useMemo(() => [...new Set(hits.filter((h) => h.kind === 'document' || h.kind === 'document_text').map((h) => h.id))].slice(0, 30), [hits])
  const { data: thumbs } = useQuery({
    queryKey: ['global-search-thumbs', docIds.join(',')],
    enabled: open && docIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('documents_overview').select('id, thumb_file_id, thumb_source_key, thumb_source_mime, has_thumb, file_name, file_mime').in('id', docIds)
      if (error) throw error
      return new Map((data as unknown as (ThumbDoc & { id: string })[]).map((d) => [d.id, d]))
    },
  })

  const count = showShortcuts ? shortcuts.length : hits.length
  useEffect(() => setActive(0), [debounced, open])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const goHit = (h: Hit) => {
    close()
    switch (h.kind) {
      case 'project':
        return void navigate({ to: '/projects/$code', params: { code: h.project_code } })
      case 'task':
        return void navigate({ to: '/projects/$code/task/$key', params: { code: h.project_code, key: h.ref } })
      case 'document':
      case 'document_text':
        return void navigate({ to: '/projects/$code/document/$id', params: { code: h.project_code, id: h.id }, search: h.kind === 'document_text' ? { q: debounced } : {} })
      case 'location':
        return void navigate({ to: '/projects/$code/locations/$path', params: { code: h.project_code, path: h.ref } })
    }
  }

  const activate = (i: number) => {
    if (showShortcuts) {
      close()
      shortcuts[i]?.go()
    } else if (hits[i]) goHit(hits[i])
  }

  let lastKind: string | null = null
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">{tr('Поиск')}</DialogTitle>
        <DialogDescription className="sr-only">{tr('Найдите проект, задачу, документ или место. Стрелки — выбор, Enter — открыть.')}</DialogDescription>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="search-results"
            aria-label={tr('Поиск')}
            placeholder={tr('Задача, документ, место, слово из документа…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => (count ? (a + 1) % count : 0))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => (count ? (a - 1 + count) % count : 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                activate(active)
              }
            }}
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border px-1.5 py-0.5 text-xs text-muted-foreground sm:block">Esc</kbd>
        </div>

        <ul id="search-results" ref={listRef} role="listbox" className="max-h-[60svh] overflow-y-auto p-1.5">
          {showShortcuts &&
            shortcuts.map((s, i) => (
              <li key={s.id} role="option" aria-selected={active === i} data-index={i}>
                <button
                  type="button"
                  onClick={() => activate(i)}
                  onMouseMove={() => setActive(i)}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm ${active === i ? 'bg-muted' : ''}`}
                >
                  <span className="text-muted-foreground">{s.icon}</span> {s.title}
                </button>
              </li>
            ))}

          {!showShortcuts &&
            hits.map((h, i) => {
              const header = h.kind !== lastKind ? KIND_LABEL[h.kind] : null
              lastKind = h.kind
              return (
                <li key={`${h.kind}-${h.id}`} role="option" aria-selected={active === i} data-index={i}>
                  {header && <p className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">{header}</p>}
                  <button
                    type="button"
                    onClick={() => activate(i)}
                    onMouseMove={() => setActive(i)}
                    className={`flex min-h-11 w-full items-start gap-3 rounded-md px-3 py-2 text-left ${active === i ? 'bg-muted' : ''}`}
                  >
                    {(h.kind === 'document' || h.kind === 'document_text') && thumbs?.get(h.id) ? (
                      <DocThumb d={thumbs.get(h.id)!} canGenerate className="h-14 w-11 shrink-0" />
                    ) : (
                      <span className="mt-0.5 text-muted-foreground">{KIND_ICON[h.kind]}</span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{h.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        <span className="ident">{h.project_code}</span>
                        {h.subtitle && h.kind !== 'project' ? ` · ${h.subtitle}` : ''}
                      </span>
                      {h.snippet && <Snippet text={h.snippet} />}
                    </span>
                  </button>
                </li>
              )
            })}

          {!showShortcuts && hits.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">{isFetching ? tr('Ищем…') : tr('Ничего не найдено. Попробуйте другое слово или часть названия.')}</li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
