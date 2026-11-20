import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronLeft, Clock, Download, Eye, Loader2, Mail, Plus, Printer, Search, ShieldCheck, Signature, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FileTypeIcon } from '@/components/file-type-icon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/features/auth/auth-provider'
import { PdfView } from '@/features/mail/attachment-viewer'
import {
  deleteMySignature,
  downloadSigned,
  mySignaturesQuery,
  mySignedQuery,
  pendingForMeQuery,
  saveMySignature,
  signErrorText,
  type MySigned,
} from '@/features/signatures/api'
import { SignaturePadDialog } from '@/features/signatures/signature-pad'
import { currentLocale } from '@/lib/i18n'
import { printPdf } from '@/lib/print-file'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

/**
 * «Мои подписи» (из профиля): сохранённые образцы подписи, документы, которые ждут моей подписи, и всё, что я подписал —
 * с датами, страницами штампов и самими подписанными файлами (документ проекта — версия после моей подписи,
 * PDF из письма — личная копия).
 */
export const Route = createFileRoute('/_app/signatures')({ component: MySignaturesPage })

const when = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const cardClass = 'flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-soft sm:p-5'

type Filter = 'all' | 'document' | 'mail'

function MySignaturesPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link to="/profile" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden />
          {tr('Профиль')}
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Signature className="size-6 text-primary" aria-hidden />
          {tr('Мои подписи')}
        </h1>
        <p className="text-sm text-muted-foreground">{tr('Образцы вашей подписи и всё, что вы подписали: даты, страницы со штампами и сами файлы.')}</p>
      </div>
      <SamplesSection />
      <PendingSection />
      <SignedSection />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Образцы подписи
// ---------------------------------------------------------------------------
function SamplesSection() {
  const queryClient = useQueryClient()
  const { data: saved = [], isPending } = useQuery(mySignaturesQuery)
  const [drawing, setDrawing] = useState(false)
  const remove = useMutation({
    mutationFn: deleteMySignature,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mySignaturesQuery.queryKey }),
    onError: () => toast.error(tr('Не удалось удалить подпись. Попробуйте ещё раз.')),
  })
  return (
    <section className={cardClass} aria-labelledby="samples-title">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 id="samples-title" className="text-base font-semibold">
            {tr('Образцы подписи')}
          </h2>
          <p className="text-sm text-muted-foreground">{tr('Из них выбираете при подписании. Можно держать несколько — например, полную подпись и инициалы.')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setDrawing(true)} disabled={saved.length >= 10}>
          <Plus />
          {tr('Добавить')}
        </Button>
      </div>
      {isPending ? (
        <p className="text-sm text-muted-foreground">{tr('Загружаем…')}</p>
      ) : saved.length === 0 ? (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">{tr('Сохранённых подписей пока нет. Добавьте здесь или при первом подписании.')}</p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {saved.map((s) => (
            <li key={s.id} className="relative">
              <span className="flex h-20 w-44 items-center justify-center rounded-lg border bg-white p-2">
                <img src={s.image} alt={tr('Сохранённая подпись')} className="max-h-full max-w-full object-contain" />
              </span>
              <button
                type="button"
                aria-label={tr('Удалить подпись')}
                title={tr('Удалить подпись')}
                disabled={remove.isPending}
                onClick={() => remove.mutate(s.id)}
                className="absolute -right-2 -top-2 flex size-7 items-center justify-center rounded-full border bg-white text-muted-foreground shadow-sm hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {drawing && (
        <SignaturePadDialog
          onClose={() => setDrawing(false)}
          onDone={async (png) => {
            try {
              await saveMySignature(png)
              await queryClient.invalidateQueries({ queryKey: mySignaturesQuery.queryKey })
              toast.success(tr('Подпись сохранена в «Мои подписи»'))
              setDrawing(false)
            } catch (e) {
              toast.error(signErrorText(e))
            }
          }}
        />
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Ждут моей подписи
// ---------------------------------------------------------------------------
function PendingSection() {
  const { session } = useAuth()
  const uid = session?.user.id
  const { data: pending = [] } = useQuery(pendingForMeQuery)
  if (pending.length === 0) return null
  return (
    <section className={cn(cardClass, 'border-primary/40')} aria-labelledby="pending-title">
      <h2 id="pending-title" className="flex items-center gap-2 text-base font-semibold">
        <Clock className="size-4 text-primary" aria-hidden />
        {tr('Ждут вашей подписи · {{n}}', { n: pending.length })}
      </h2>
      <ul className="flex flex-col divide-y">
        {pending.map(({ request: r }) => {
          if (!r) return null
          const first = [...r.signers].sort((a, b) => a.position - b.position).find((s) => s.status === 'pending')
          const myTurn = !r.sequential || first?.user_id === uid
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{r.document?.title ?? '—'}</span>
                <span className="block text-xs text-muted-foreground">
                  {r.project?.code} · {r.creator?.full_name}, {when.format(new Date(r.created_at))}
                </span>
              </span>
              <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', myTurn ? 'bg-primary/15 text-foreground' : 'bg-muted text-muted-foreground')}>
                {myTurn ? tr('Ваша очередь') : tr('Ждёт очереди')}
              </span>
              {r.document && r.project && (
                <Button asChild size="sm" variant={myTurn ? 'default' : 'outline'}>
                  <Link to="/projects/$code/plan/$id" params={{ code: r.project.code, id: r.document.id }}>
                    {myTurn ? tr('Подписать') : tr('Открыть')}
                  </Link>
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Подписанное мной
// ---------------------------------------------------------------------------
function SignedSection() {
  const { data: rows = [], isPending, isError } = useQuery(mySignedQuery)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [viewing, setViewing] = useState<{ row: MySigned; blob: Blob } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return rows.filter((r) => {
      if (filter !== 'all' && r.source !== filter) return false
      const hay = `${r.file_name} ${r.document_title ?? ''} ${r.project_code ?? ''} ${r.codes.join(' ')}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [rows, q, filter])

  async function load(r: MySigned, then: (blob: Blob) => void) {
    setBusy(r.batch_id)
    try {
      then(await downloadSigned(r))
    } catch {
      toast.error(tr('Не удалось открыть файл. Попробуйте ещё раз.'))
    } finally {
      setBusy(null)
    }
  }
  const save = (r: MySigned, blob: Blob) => {
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = r.file_name.replace(/\.pdf$/i, '') + ' (signed).pdf'
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 10_000)
  }

  const counts = { all: rows.length, document: rows.filter((r) => r.source === 'document').length, mail: rows.filter((r) => r.source === 'mail').length }
  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: tr('Все') },
    { id: 'document', label: tr('Документы проектов') },
    { id: 'mail', label: tr('Из писем') },
  ]

  return (
    <section className={cardClass} aria-labelledby="signed-title">
      <h2 id="signed-title" className="text-base font-semibold">
        {tr('Подписанные мной')}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Найти по файлу, документу или коду')} aria-label={tr('Поиск по подписанному')} className="pl-8" />
        </div>
        <div role="radiogroup" aria-label={tr('Что показывать')} className="flex gap-1 rounded-lg bg-muted p-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn('rounded-md px-2.5 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring', filter === f.id ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              {f.label} <span className="tabular-nums text-muted-foreground">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {isPending && <p className="text-sm text-muted-foreground">{tr('Загружаем…')}</p>}
      {isError && <p className="text-sm text-destructive">{tr('Не удалось загрузить список. Обновите страницу.')}</p>}
      {!isPending && rows.length === 0 && <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">{tr('Вы ещё ничего не подписывали.')}</p>}
      {!isPending && rows.length > 0 && shown.length === 0 && <p className="text-sm text-muted-foreground">{tr('Ничего не нашли.')}</p>}

      <ul className="flex flex-col divide-y">
        {shown.map((r) => {
          const hasFile = !!(r.file_path || r.storage_key)
          const pages = [...new Set(r.pages.filter((p): p is number => p != null))]
          return (
            <li key={r.batch_id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <FileTypeIcon name={r.file_name} className="h-10 w-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={r.file_name}>
                    {r.file_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {when.format(new Date(r.signed_at))}
                    {pages.length > 0 &&
                      ` · ${r.marks > 1 ? tr('штампов: {{n}}, стр. {{pages}}', { n: r.marks, pages: pages.join(', ') }) : tr('стр. {{pages}}', { pages: pages.join(', ') })}`}
                  </p>
                  <p className="truncate text-xs">
                    {r.source === 'mail' ? (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Mail className="size-3" aria-hidden />
                        {tr('Вложение письма')}
                      </span>
                    ) : r.document_id && r.project_code ? (
                      <Link to="/projects/$code/plan/$id" params={{ code: r.project_code, id: r.document_id }} className="text-primary underline-offset-2 hover:underline">
                        {r.project_code} · {r.document_title}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{tr('Документ проекта (нет доступа)')}</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 max-sm:pl-11">
                <Button size="sm" variant="outline" disabled={!hasFile || busy === r.batch_id} onClick={() => void load(r, (blob) => setViewing({ row: r, blob }))} title={hasFile ? undefined : tr('Файл не сохранился')}>
                  {busy === r.batch_id ? <Loader2 className="animate-spin" /> : <Eye />}
                  {tr('Открыть')}
                </Button>
                <Button size="icon-sm" variant="ghost" disabled={!hasFile || busy === r.batch_id} aria-label={tr('Скачать')} title={tr('Скачать')} onClick={() => void load(r, (blob) => save(r, blob))}>
                  <Download />
                </Button>
                <Button asChild size="icon-sm" variant="ghost" aria-label={tr('Проверить подпись')} title={tr('Проверить подпись')}>
                  <Link to="/verify" search={{ code: r.codes[0] }}>
                    <ShieldCheck />
                  </Link>
                </Button>
              </div>
            </li>
          )
        })}
      </ul>

      {viewing && <SignedViewer row={viewing.row} blob={viewing.blob} onDownload={() => save(viewing.row, viewing.blob)} onClose={() => setViewing(null)} />}
    </section>
  )
}

function SignedViewer({ row, blob, onDownload, onClose }: { row: MySigned; blob: Blob; onDownload: () => void; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[100svh] max-h-[100svh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[94svh] sm:max-h-[94svh] sm:w-[94vw] sm:max-w-none sm:rounded-xl"
      >
        <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
          <FileTypeIcon name={row.file_name} className="ml-1 size-7" />
          <DialogTitle className="min-w-0 flex-1 truncate px-1.5 text-sm font-medium">{row.file_name}</DialogTitle>
          <DialogDescription className="sr-only">{tr('Подписанный вами файл')}</DialogDescription>
          <Button type="button" variant="ghost" size="sm" onClick={() => void printPdf(blob)}>
            <Printer />
            <span className="max-md:sr-only">{tr('Печать')}</span>
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onDownload}>
            <Download />
            <span className="max-md:sr-only">{tr('Скачать')}</span>
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={tr('Закрыть')} onClick={onClose}>
            <X />
          </Button>
        </div>
        <div className="relative min-h-0 flex-1 bg-muted/40">
          <PdfView blob={blob} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
