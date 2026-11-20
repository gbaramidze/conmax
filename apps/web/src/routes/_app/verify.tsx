import { useMutation } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CheckCircle2, FileSearch, Loader2, Search, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { verifySignature, type VerifiedSignature } from '@/features/signatures/api'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'

/**
 * Проверка электронной подписи: по коду из штампа «eSigned by» (кто и когда подписал) или по самому файлу —
 * если контрольная сумма совпала с записью журнала, файл после подписи не меняли.
 */
export const Route = createFileRoute('/_app/verify')({
  validateSearch: z.object({ code: z.string().optional().catch(undefined) }),
  component: VerifyPage,
})

const when = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

type Result = { by: 'code' | 'file'; rows: VerifiedSignature[] }

function VerifyPage() {
  const search = Route.useSearch()
  const [code, setCode] = useState(search.code ?? '')
  const fileInput = useRef<HTMLInputElement>(null)

  const check = useMutation({
    mutationFn: async (input: { code?: string; file?: File }): Promise<Result> => {
      if (input.file) {
        const { sha256 } = await import('@/features/signatures/stamp')
        return { by: 'file', rows: await verifySignature({ hash: await sha256(await input.file.arrayBuffer()) }) }
      }
      return { by: 'code', rows: await verifySignature({ code: input.code }) }
    },
  })

  // ссылка с кодом — проверяем сразу
  const auto = useRef(false)
  useEffect(() => {
    const c = search.code?.match(UUID)?.[0]
    if (c && !auto.current) {
      auto.current = true
      check.mutate({ code: c.toLowerCase() })
    }
  }, [search.code, check])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const c = code.match(UUID)?.[0]
    if (c) check.mutate({ code: c.toLowerCase() })
  }
  const valid = UUID.test(code)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <ShieldCheck className="size-5 text-primary" aria-hidden />
          {tr('Проверка подписи')}
        </h1>
        <p className="text-sm text-muted-foreground">{tr('Введите код из штампа «eSigned by» или выберите подписанный PDF — покажем, кто и когда подписал и не меняли ли файл после подписи.')}</p>
      </header>

      <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg border bg-card p-4 shadow-soft">
        <label htmlFor="verify-code" className="text-sm font-medium">
          {tr('Код подписи')}
        </label>
        <div className="flex gap-2">
          <Input id="verify-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="80a6c827-16e7-4eb7-b1a2-46b…" className="font-mono" autoComplete="off" />
          <Button type="submit" disabled={!valid || check.isPending}>
            <Search />
            {tr('Проверить')}
          </Button>
        </div>
        <div className="flex items-center gap-3 pt-2 text-sm text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          {tr('или')}
          <span className="h-px flex-1 bg-border" />
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) check.mutate({ file: f })
          }}
        />
        <Button type="button" variant="outline" onClick={() => fileInput.current?.click()} disabled={check.isPending}>
          <FileSearch />
          {tr('Проверить файл PDF')}
        </Button>
      </form>

      {check.isPending && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {tr('Проверяем…')}
        </p>
      )}
      {check.isError && <p className="text-sm text-destructive">{tr('Не удалось проверить. Попробуйте ещё раз.')}</p>}
      {check.data && <Outcome result={check.data} />}
    </div>
  )
}

function Outcome({ result }: { result: Result }) {
  if (result.rows.length === 0)
    return (
      <div role="status" className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
        <div className="text-sm">
          <p className="font-medium">{result.by === 'file' ? tr('Этот файл не найден среди подписанных') : tr('Подпись с таким кодом не найдена')}</p>
          <p className="mt-1 text-muted-foreground">
            {result.by === 'file'
              ? tr('Файл могли изменить после подписи (даже пересохранение меняет его), или подпись поставлена не в нашей системе.')
              : tr('Проверьте код. Подписи другой компании здесь не видны.')}
          </p>
        </div>
      </div>
    )
  return (
    <div role="status" className="flex flex-col gap-3">
      <div className="flex gap-3 rounded-lg border border-green-600/40 bg-green-500/10 p-4">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-green-600" aria-hidden />
        <p className="text-sm font-medium">
          {result.by === 'file' ? tr('Файл подлинный: он совпадает с подписанным и после подписи не менялся.') : tr('Подпись найдена в журнале.')}
        </p>
      </div>
      <ul className="flex flex-col divide-y rounded-lg border bg-card">
        {result.rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-1 p-4 text-sm">
            <span className="font-semibold">{r.signer_name}</span>
            <span className="text-muted-foreground">{when.format(new Date(r.signed_at))}</span>
            <span>
              {tr('Файл:')} {r.file_name}
              {r.source === 'mail' && <span className="text-muted-foreground"> · {tr('вложение письма')}</span>}
            </span>
            {result.by === 'code' && r.page && (
              <span className="text-muted-foreground">
                {r.marks > 1 ? tr('Штамп на странице {{page}} · штампов в этом подписании: {{n}}', { page: r.page, n: r.marks }) : tr('Штамп на странице {{page}}', { page: r.page })}
              </span>
            )}
            {result.by === 'file' && r.marks > 1 && <span className="text-muted-foreground">{tr('Штампов в этом подписании: {{n}}', { n: r.marks })}</span>}
            {r.document_title && r.project_code && r.document_id && (
              <Link to="/projects/$code/plan/$id" params={{ code: r.project_code, id: r.document_id }} className="w-fit text-primary underline underline-offset-2">
                {r.project_code} · {r.document_title}
              </Link>
            )}
            <span className="break-all font-mono text-[11px] text-muted-foreground">
              {tr('Код:')} {r.id}
            </span>
            <span className="break-all font-mono text-[11px] text-muted-foreground">SHA-256: {r.hash_after}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
