import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { queryWords } from '@/features/plans/pdf-text-search'
import { tr } from '@/lib/tr'

const MAX_MARKS = 2000
const SKIP = 'mark,script,style,button,input,textarea,select,[role=tablist],[data-no-hl]'

/** Слова запроса (от двух знаков) и проверка «есть ли хоть одно в тексте» — для выбора листа и счётчиков. */
export const docWords = (q: string | undefined): string[] => (q ? queryWords(q) : [])
export const hasWords = (text: string, words: string[]) => {
  const t = text.toLowerCase()
  return words.some((w) => t.includes(w))
}

export function unwrap(marks: HTMLElement[]) {
  const parents = new Set<Node>()
  for (const m of marks) {
    const p = m.parentNode
    if (!p) continue
    p.replaceChild(document.createTextNode(m.textContent ?? ''), m)
    parents.add(p)
  }
  parents.forEach((p) => p.normalize())
}

/** Оборачивает совпадения в тексте внутри `root` элементами <mark class="doc-hit">; возвращает их в порядке чтения. */
export function wrapMatches(root: HTMLElement, words: string[]): HTMLElement[] {
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'giu')
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (!n.nodeValue || !n.nodeValue.trim() || n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  const nodes: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)
  const marks: HTMLElement[] = []
  for (const node of nodes) {
    if (marks.length >= MAX_MARKS) break
    const text = node.nodeValue!
    re.lastIndex = 0
    if (!re.test(text)) continue
    re.lastIndex = 0
    const frag = document.createDocumentFragment()
    let last = 0
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m[0] === '') {
        re.lastIndex++
        continue
      }
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)))
      const mark = document.createElement('mark')
      mark.className = 'doc-hit'
      mark.textContent = m[0]
      frag.appendChild(mark)
      marks.push(mark)
      last = m.index + m[0].length
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
    node.parentNode!.replaceChild(frag, node)
  }
  return marks
}

/**
 * Подсветка слов запроса в уже нарисованном содержимом (Word, текст, таблицы Excel): находит слова, красит их,
 * подводит к первому и листает по кнопкам. Следит за изменениями содержимого (другой лист, подгрузка строк) и красит заново.
 * `startAt` — с какого совпадения начинать после перерисовки: «первого» или «последнего» (когда листаем назад через лист).
 */
export function useDomHighlight(ref: RefObject<HTMLElement | null>, q: string | undefined, resetKey: unknown = null) {
  const words = docWords(q)
  const wordsKey = words.join(' ')
  const [enabled, setEnabled] = useState(true)
  const [count, setCount] = useState(0)
  const [active, setActive] = useState(0)
  const marks = useRef<HTMLElement[]>([])
  const startAt = useRef<'first' | 'last'>('first')
  const scroll = useRef(true)
  const activeRef = useRef(0)

  useEffect(() => setEnabled(true), [wordsKey])

  useEffect(() => {
    const root = ref.current
    if (!root || !enabled || words.length === 0) return
    let timer: number | undefined
    const run = () => {
      observer.disconnect()
      unwrap(marks.current)
      marks.current = wrapMatches(root, words)
      const last = Math.max(0, marks.current.length - 1)
      const next = startAt.current === 'last' ? last : Math.min(activeRef.current, last)
      startAt.current = 'first'
      activeRef.current = next
      setCount(marks.current.length)
      setActive(next)
      // новые элементы <mark> ещё без выделения активного: красим сразу, не дожидаясь смены состояния
      marks.current.forEach((m, i) => m.classList.toggle('doc-hit-active', i === next))
      marks.current[next]?.scrollIntoView({ block: 'center', inline: 'center' })
      scroll.current = false
      observer.observe(root, { childList: true, subtree: true, characterData: true })
    }
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(run, 120)
    })
    timer = window.setTimeout(run, 60)
    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
      unwrap(marks.current)
      marks.current = []
      setCount(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, wordsKey, enabled, resetKey])

  // активное совпадение выделяется сильнее, и окно подводится к нему
  useEffect(() => {
    activeRef.current = active
    marks.current.forEach((m, i) => m.classList.toggle('doc-hit-active', i === active))
    const el = marks.current[active]
    if (el && scroll.current) el.scrollIntoView({ block: 'center', inline: 'center' })
    scroll.current = false
  }, [active, count])

  const go = useCallback(
    (i: number) => {
      if (count === 0) return
      scroll.current = true
      setActive(((i % count) + count) % count)
    },
    [count],
  )
  return { words, count, active, go, enabled, disable: () => setEnabled(false), startAt }
}

/** Полоса «слово: 3 из 12» с переходом по совпадениям; не показывается, если искать нечего. */
export function HitBar({
  words,
  count,
  active,
  onGo,
  onClose,
  note,
}: {
  words: string[]
  count: number
  active: number
  onGo: (dir: 1 | -1) => void
  onClose: () => void
  /** Дополнение: «ещё на листах: Итоги, Смета» */
  note?: string
}) {
  if (words.length === 0) return null
  return (
    <div data-no-hl className="absolute right-3 top-2 z-30 flex max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-lg border bg-card/95 p-1 pl-3 text-xs shadow" role="status">
      <span className="min-w-0 py-1 tabular-nums">
        {count > 0 ? tr('«{{q}}»: {{i}} из {{n}}', { q: words.join(' '), i: active + 1, n: count }) : tr('«{{q}}» здесь не найдено', { q: words.join(' ') })}
        {note ? <span className="text-muted-foreground"> · {note}</span> : null}
      </span>
      {count > 0 && (
        <>
          <Button size="icon" variant="ghost" className="size-8" aria-label={tr('Предыдущее совпадение')} onClick={() => onGo(-1)}>
            <ChevronLeft />
          </Button>
          <Button size="icon" variant="ghost" className="size-8" aria-label={tr('Следующее совпадение')} onClick={() => onGo(1)}>
            <ChevronRight />
          </Button>
        </>
      )}
      <Button size="icon" variant="ghost" className="size-8" aria-label={tr('Убрать подсветку')} onClick={onClose}>
        <X />
      </Button>
    </div>
  )
}
