import { tr } from '@/lib/tr'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { reasonCodesQuery, TRANSITION_ERROR_TEXT, TransitionError } from '@/features/tasks/api'

/** Диалог перехода, которому нужна причина и/или комментарий. Общий для карточки и канбана. */
export function TransitionDialog({
  name,
  requiresReason,
  requiresComment,
  onClose,
  onConfirm,
}: {
  name: string
  requiresReason: boolean
  requiresComment: boolean
  onClose: () => void
  onConfirm: (reasonCode: string | undefined, comment: string | undefined) => Promise<void>
}) {
  const { data: reasons } = useQuery(reasonCodesQuery)
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const commentRequired = requiresComment || reason === 'other'

  async function submit() {
    setError(null)
    if (requiresReason && !reason) return setError(TRANSITION_ERROR_TEXT.reason_required)
    if (commentRequired && !comment.trim()) return setError(TRANSITION_ERROR_TEXT.comment_required)
    setBusy(true)
    try {
      await onConfirm(requiresReason ? reason : undefined, comment.trim() || undefined)
    } catch (e) {
      const code = e instanceof TransitionError ? e.code : ''
      setError(
        code === 'forbidden'
          ? tr('У вас нет права на этот переход.')
          : (TRANSITION_ERROR_TEXT[code] ?? tr('Не удалось сменить статус. Попробуйте ещё раз.')),
      )
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>
            {requiresReason ? tr('Укажите причину — по ним строится аналитика срывов.') : tr('Комментарий попадёт в обсуждение задачи.')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {requiresReason && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="reason">{tr('Причина')}</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="reason" className="w-full">
                  <SelectValue placeholder={tr('Выберите причину')} />
                </SelectTrigger>
                <SelectContent>
                  {(reasons ?? []).map((r) => (
                    <SelectItem key={r.code} value={r.code}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="transition-comment">{tr('Комментарий')}{commentRequired ? '' : tr(' (необязательно)')}</Label>
            <Textarea id="transition-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {name}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
