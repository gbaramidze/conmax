import { tr } from '@/lib/tr'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fileTextQuery } from '@/features/documents/api'

const MAX_SHOWN = 300_000

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Текст документа, извлечённый из файла: можно прочитать и найти слово внутри (с подсветкой и переходом по совпадениям).
 * Слова запроса ищутся как есть, без учёта регистра; морфологию (формы слова) даёт поиск по реестру.
 */
export function DocumentText({ fileId, initialQuery = '' }: { fileId: string; initialQuery?: string }) {
  // свёрнут и при переходе из поиска: главное — сам документ с подсветкой, а текст открывается по кнопке (слово из поиска уже вписано)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(initialQuery)
  const [current, setCurrent] = useState(0)
  const { data, isPending } = useQuery(fileTextQuery(fileId, open))
  const box = useRef<HTMLDivElement>(null)

  const text = (data?.text ?? '').slice(0, MAX_SHOWN)
  const truncated = (data?.text?.length ?? 0) > MAX_SHOWN

  const words = useMemo(() => query.trim().split(/\s+/).filter((w) => w.length >= 2), [query])
  const parts = useMemo(() => {
    if (words.length === 0 || !text) return null
    const re = new RegExp(`(${words.map(escapeRe).join('|')})`, 'giu')
    return text.split(re)
  }, [text, words])
  const matches = parts ? Math.floor(parts.length / 2) : 0

  // к первому найденному месту — при вводе; к следующему — по кнопкам
  useEffect(() => setCurrent(0), [query, fileId])
  useEffect(() => {
    if (matches === 0) return
    box.current?.querySelector(`[data-hit="${current}"]`)?.scrollIntoView({ block: 'center' })
  }, [current, matches, query])

  let hit = -1
  return (
    <section className="flex flex-col gap-2" aria-label={tr('Текст документа')}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 items-center justify-between gap-2 rounded-lg border bg-card px-4 text-left text-base font-semibold outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
      >{tr('Читать текст документа')}{open ? <ChevronUp className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
      </button>

      {open && (
        <div className="flex flex-col gap-2">
          {isPending ? (
            <p className="text-sm text-muted-foreground">{tr('Загружаем текст…')}</p>
          ) : !data || !data.text ? (
            <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{tr('Текст из этого файла не извлечён: чертёж, скан или формат, который пока не читается. Откройте файл кнопкой «Открыть».')}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1 sm:max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    aria-label={tr('Найти в тексте документа')}
                    placeholder={tr('Найти в тексте')}
                    className="pl-9"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && matches > 0) setCurrent((c) => (c + (e.shiftKey ? -1 : 1) + matches) % matches)
                    }}
                  />
                </div>
                {words.length > 0 && (
                  <>
                    <span className="text-sm text-muted-foreground tabular-nums">{matches === 0 ? tr('Не найдено') : tr('{{v1}} из {{matches}}', { v1: current + 1, matches })}</span>
                    <Button type="button" size="icon" variant="outline" className="md:size-9" aria-label={tr('Предыдущее совпадение')} disabled={matches === 0} onClick={() => setCurrent((c) => (c - 1 + matches) % matches)}>
                      <ChevronUp />
                    </Button>
                    <Button type="button" size="icon" variant="outline" className="md:size-9" aria-label={tr('Следующее совпадение')} disabled={matches === 0} onClick={() => setCurrent((c) => (c + 1) % matches)}>
                      <ChevronDown />
                    </Button>
                  </>
                )}
              </div>

              <div ref={box} className="max-h-[32rem] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-card p-4 text-sm leading-relaxed" tabIndex={0}>
                {parts
                  ? parts.map((part, i) => {
                      if (i % 2 === 0) return <span key={i}>{part}</span>
                      hit += 1
                      return (
                        <mark key={i} data-hit={hit} className={`rounded px-0.5 text-foreground ${hit === current ? 'bg-signal' : 'bg-signal/35'}`}>
                          {part}
                        </mark>
                      )
                    })
                  : text}
                {truncated && <p className="mt-3 text-xs text-muted-foreground">{tr('Показано начало документа. Полный текст — в исходном файле.')}</p>}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
