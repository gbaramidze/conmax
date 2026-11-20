import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, Check, CircleSlash, Clock, Loader2, Search, Signature, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/auth-provider'
import { projectMembersQuery } from '@/features/projects/api'
import {
  canSignNow,
  cancelSignatureRequest,
  createSignatureRequest,
  declineSignatureRequest,
  downloadProjectFile,
  signatureRequestsQuery,
  signErrorText,
  SignError,
  submitRequestSignature,
  type SignatureRequest,
  type SignerRow,
} from '@/features/signatures/api'
import { SignPdfDialog } from '@/features/signatures/sign-pdf-dialog'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

/**
 * Подписи документа в боковой панели: «Отправить на подпись», чья очередь, «Подписать» / «Отказаться» для подписанта,
 * «Отозвать» для автора запроса, история прошлых запросов.
 */

const when = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const STATUS_TEXT: Record<SignatureRequest['status'], () => string> = {
  pending: () => tr('Идёт подписание'),
  completed: () => tr('Подписан всеми'),
  declined: () => tr('Отказ в подписи'),
  cancelled: () => tr('Запрос отозван'),
}

export function SignaturePanel({
  documentId,
  projectId,
  canRequest,
  canManage,
  isPdf,
  onChanged,
}: {
  documentId: string
  projectId: string
  /** право загружать документы — отправлять на подпись */
  canRequest: boolean
  /** может править документ — отзывать чужие запросы */
  canManage: boolean
  /** действующая версия — PDF (подписывают только PDF) */
  isPdf: boolean
  onChanged: () => Promise<unknown>
}) {
  const { session, tenantId } = useAuth()
  const uid = session!.user.id
  const queryClient = useQueryClient()
  const { data: requests = [] } = useQuery(signatureRequestsQuery(documentId))
  const open = requests.find((r) => r.status === 'pending') ?? null
  const history = requests.filter((r) => r.status !== 'pending').slice(0, 3)
  const [sending, setSending] = useState(false)
  const [signing, setSigning] = useState<{ request: SignatureRequest; blob: Blob } | null>(null)
  const [declining, setDeclining] = useState(false)
  const [loadingFile, setLoadingFile] = useState(false)

  const refresh = () =>
    // и списки на странице «Мои подписи» (подписанное мной, ждут моей подписи)
    Promise.all([queryClient.invalidateQueries({ queryKey: ['signature-requests'] }), queryClient.invalidateQueries({ queryKey: ['signatures'] }), onChanged()])

  async function startSigning(r: SignatureRequest) {
    if (!r.file) return
    setLoadingFile(true)
    try {
      setSigning({ request: r, blob: await downloadProjectFile(r.file.storage_key) })
    } catch {
      toast.error(tr('Не удалось загрузить файл для подписи. Попробуйте ещё раз.'))
    } finally {
      setLoadingFile(false)
    }
  }

  const cancel = useMutation({
    mutationFn: (id: string) => cancelSignatureRequest(id),
    onSuccess: async () => {
      await refresh()
      toast.success(tr('Запрос на подпись отозван'))
    },
    onError: (e) => toast.error(signErrorText(e)),
  })

  const myTurn = open && canSignNow(open, uid)
  const iAmWaiting = open && !myTurn && open.signers.some((s) => s.user_id === uid && s.status === 'pending')

  if (!open && history.length === 0 && !(canRequest && isPdf)) return null
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-soft" aria-label={tr('Подписи')}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Signature className="size-4 text-primary" aria-hidden />
          {tr('Подписи')}
        </h2>
        {canRequest && isPdf && !open && (
          <Button size="sm" variant="outline" onClick={() => setSending(true)}>
            {tr('Отправить на подпись')}
          </Button>
        )}
      </div>

      {canRequest && !isPdf && !open && <p className="text-xs text-muted-foreground">{tr('На подпись можно отправить только PDF.')}</p>}

      {myTurn && (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/10 p-3">
          <p className="text-sm font-medium">{tr('{{name}} просит вас подписать этот документ', { name: open.creator?.full_name ?? '' })}</p>
          {open.message && <p className="whitespace-pre-wrap text-sm text-muted-foreground">«{open.message}»</p>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={loadingFile} onClick={() => void startSigning(open)}>
              {loadingFile ? <Loader2 className="animate-spin" /> : <Signature />}
              {tr('Подписать')}
            </Button>
            <Button variant="outline" onClick={() => setDeclining(true)}>
              {tr('Отказаться')}
            </Button>
          </div>
        </div>
      )}
      {iAmWaiting && <p className="rounded-md bg-muted px-3 py-2 text-sm">{tr('Вы в списке подписантов — подпишете, когда дойдёт очередь.')}</p>}

      {open && <RequestCard request={open} uid={uid} canCancel={open.created_by === uid || canManage} onCancel={() => cancel.mutate(open.id)} cancelling={cancel.isPending} />}
      {history.map((r) => (
        <RequestCard key={r.id} request={r} uid={uid} compact />
      ))}

      {sending && <SendDialog documentId={documentId} projectId={projectId} onClose={() => setSending(false)} onSent={refresh} />}
      {declining && open && <DeclineDialog requestId={open.id} onClose={() => setDeclining(false)} onDone={refresh} />}
      {signing && (
        <SignPdfDialog
          blob={signing.blob}
          fileName={signing.request.file?.name ?? 'document.pdf'}
          note={signing.request.message ? tr('Сообщение: «{{text}}»', { text: signing.request.message }) : undefined}
          onClose={() => setSigning(null)}
          onSigned={async (signed) => {
            try {
              const res = await submitRequestSignature({ request: signing.request, tenantId: tenantId!, signed })
              setSigning(null)
              await refresh()
              toast.success(res.completed ? tr('Подписано. Все подписали — подписанный файл стал новой версией документа.') : tr('Подписано. Документ ушёл следующему подписанту.'))
            } catch (e) {
              if (e instanceof SignError && e.code === 'stale_copy') {
                setSigning(null)
                await refresh()
              }
              throw e
            }
          }}
        />
      )}
    </section>
  )
}

function SignerIcon({ s }: { s: SignerRow }) {
  if (s.status === 'signed') return <Check className="size-4 text-green-600" aria-label={tr('Подписал(а)')} />
  if (s.status === 'declined') return <CircleSlash className="size-4 text-destructive" aria-label={tr('Отказ')} />
  return <Clock className="size-4 text-muted-foreground" aria-label={tr('Ждём подписи')} />
}

function RequestCard({
  request: r,
  uid,
  compact,
  canCancel,
  onCancel,
  cancelling,
}: {
  request: SignatureRequest
  uid: string
  compact?: boolean
  canCancel?: boolean
  onCancel?: () => void
  cancelling?: boolean
}) {
  const [confirm, setConfirm] = useState(false)
  return (
    <div className={cn('flex flex-col gap-2 rounded-lg border p-3', compact && 'bg-muted/30')}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span
          className={cn(
            'rounded-md px-2 py-0.5 font-medium',
            r.status === 'completed' && 'bg-green-500/10 text-green-700 dark:text-green-300',
            r.status === 'pending' && 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
            (r.status === 'declined' || r.status === 'cancelled') && 'bg-muted text-muted-foreground',
          )}
        >
          {STATUS_TEXT[r.status]()}
        </span>
        <span>
          {r.creator?.full_name}, {when.format(new Date(r.created_at))}
          {r.sequential && r.signers.length > 1 ? ` · ${tr('по очереди')}` : ''}
        </span>
      </div>
      {!compact && r.message && <p className="whitespace-pre-wrap text-sm">«{r.message}»</p>}
      <ol className="flex flex-col gap-1">
        {r.signers.map((s) => (
          <li key={s.user_id} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5">
              <SignerIcon s={s} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn(s.user_id === uid && 'font-medium')}>{s.user?.full_name ?? '—'}</span>
              {s.decided_at && <span className="text-xs text-muted-foreground"> · {when.format(new Date(s.decided_at))}</span>}
              {s.signature_id && (
                <Link to="/verify" search={{ code: s.signature_id }} className="ml-1.5 text-xs text-primary underline underline-offset-2">
                  {tr('проверить')}
                </Link>
              )}
              {s.decline_reason && <span className="block text-xs text-destructive">{s.decline_reason}</span>}
            </span>
          </li>
        ))}
      </ol>
      {canCancel && (
        <div className="flex justify-end gap-2">
          {confirm ? (
            <>
              <Button size="sm" variant="destructive" disabled={cancelling} onClick={onCancel}>
                {tr('Отозвать запрос')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                {tr('Нет')}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
              {tr('Отозвать')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/** Кому и как отправить на подпись: участники проекта по порядку, «по очереди» или «все сразу», сообщение. */
function SendDialog({ documentId, projectId, onClose, onSent }: { documentId: string; projectId: string; onClose: () => void; onSent: () => Promise<unknown> }) {
  const { data: members = [], isPending } = useQuery(projectMembersQuery(projectId))
  const people = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; hint: string }>()
    for (const m of members) {
      const u = m.user as { id: string; full_name: string; status: string } | null
      if (!u || u.status === 'blocked' || seen.has(u.id)) continue
      const org = (m.organization as { name: string } | null)?.name
      seen.set(u.id, { id: u.id, name: u.full_name, hint: [m.title || (m.role as { name: string } | null)?.name, org].filter(Boolean).join(' · ') })
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, currentLocale()))
  }, [members])
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [sequential, setSequential] = useState(true)
  const [message, setMessage] = useState('')
  const byId = new Map(people.map((p) => [p.id, p]))
  const shown = people.filter((p) => !picked.includes(p.id) && `${p.name} ${p.hint}`.toLowerCase().includes(q.trim().toLowerCase()))
  const move = (i: number, d: number) =>
    setPicked((list) => {
      const next = [...list]
      const j = i + d
      if (j < 0 || j >= next.length) return list
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const send = useMutation({
    mutationFn: () => createSignatureRequest({ documentId, signers: picked, sequential, message }),
    onSuccess: async () => {
      await onSent()
      toast.success(picked.length > 1 && sequential ? tr('Отправлено на подпись. Первым подпишет {{name}}.', { name: byId.get(picked[0])?.name ?? '' }) : tr('Отправлено на подпись'))
      onClose()
    },
    onError: (e) => toast.error(signErrorText(e)),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && !send.isPending && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Отправить на подпись')}</DialogTitle>
          <DialogDescription>{tr('Подписанты получат уведомление. Когда подпишут все, подписанный PDF станет новой версией документа.')}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          {picked.length > 0 && (
            <ol className="flex flex-col gap-1 rounded-lg border p-1">
              {picked.map((id, i) => (
                <li key={id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted">
                  {sequential && <span className="w-5 text-xs tabular-nums text-muted-foreground">{i + 1}.</span>}
                  <span className="min-w-0 flex-1 truncate">{byId.get(id)?.name}</span>
                  {sequential && picked.length > 1 && (
                    <>
                      <Button type="button" size="icon-sm" variant="ghost" aria-label={tr('Выше')} disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp />
                      </Button>
                      <Button type="button" size="icon-sm" variant="ghost" aria-label={tr('Ниже')} disabled={i === picked.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown />
                      </Button>
                    </>
                  )}
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={tr('Убрать')} onClick={() => setPicked((l) => l.filter((x) => x !== id))}>
                    <X />
                  </Button>
                </li>
              ))}
            </ol>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="sign-who">{tr('Кто подписывает')}</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input id="sign-who" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Найти участника проекта')} className="pl-8" />
            </div>
            <ul className="max-h-48 overflow-y-auto rounded-lg border p-1">
              {isPending && <li className="px-2 py-1.5 text-xs text-muted-foreground">{tr('Загружаем…')}</li>}
              {!isPending && shown.length === 0 && <li className="px-2 py-1.5 text-xs text-muted-foreground">{tr('Никого не нашли')}</li>}
              {shown.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setPicked((l) => [...l, p.id])}
                    className="flex w-full flex-col rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="text-sm">{p.name}</span>
                    {p.hint && <span className="text-xs text-muted-foreground">{p.hint}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {picked.length > 1 && (
            <div role="radiogroup" aria-label={tr('Порядок подписания')} className="grid grid-cols-2 gap-2">
              {[
                { v: true, label: tr('По очереди'), hint: tr('следующий получает документ после подписи предыдущего') },
                { v: false, label: tr('Все сразу'), hint: tr('все получают документ одновременно') },
              ].map((o) => (
                <button
                  key={String(o.v)}
                  type="button"
                  role="radio"
                  aria-checked={sequential === o.v}
                  onClick={() => setSequential(o.v)}
                  className={cn('flex flex-col rounded-lg border p-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring', sequential === o.v ? 'border-primary bg-primary/10' : 'hover:bg-muted')}
                >
                  <span className="text-sm font-medium">{o.label}</span>
                  <span className="text-xs text-muted-foreground">{o.hint}</span>
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="sign-msg">{tr('Сообщение (необязательно)')}</Label>
            <Textarea id="sign-msg" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={2} placeholder={tr('Например: проверьте объёмы в разделе 3')} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={send.isPending}>
            {tr('Отмена')}
          </Button>
          <Button type="button" disabled={picked.length === 0 || send.isPending} onClick={() => send.mutate()}>
            {send.isPending && <Loader2 className="animate-spin" />}
            {tr('Отправить')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeclineDialog({ requestId, onClose, onDone }: { requestId: string; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [reason, setReason] = useState('')
  const decline = useMutation({
    mutationFn: () => declineSignatureRequest(requestId, reason),
    onSuccess: async () => {
      await onDone()
      toast.success(tr('Вы отказались подписывать. Автор запроса получил уведомление.'))
      onClose()
    },
    onError: (e) => toast.error(signErrorText(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && !decline.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Отказаться подписывать')}</DialogTitle>
          <DialogDescription>{tr('Запрос закроется, автор получит уведомление с вашей причиной.')}</DialogDescription>
        </DialogHeader>
        <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={3} placeholder={tr('Причина: что исправить')} aria-label={tr('Причина отказа')} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={decline.isPending}>
            {tr('Отмена')}
          </Button>
          <Button type="button" variant="destructive" disabled={!reason.trim() || decline.isPending} onClick={() => decline.mutate()}>
            {tr('Отказаться')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
