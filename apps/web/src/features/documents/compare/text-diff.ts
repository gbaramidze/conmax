// Текстовая сверка двух документов (PDF, Word, TXT) на уровне абзацев, у изменённых абзацев — с подсветкой слов.

export type TextStatus = 'added' | 'removed' | 'changed' | 'same'

export interface TextPart {
  kind: 'same' | 'add' | 'del'
  text: string
}

export interface TextBlock {
  status: TextStatus
  before: string | null
  after: string | null
  /** Для изменённых абзацев: слова с пометками «добавлено» / «удалено» */
  parts: TextPart[] | null
}

export interface TextDiff {
  blocks: TextBlock[]
  counts: Record<TextStatus, number>
  wordsBefore: number
  wordsAfter: number
  /** Документы так сильно различаются, что точное сопоставление абзацев не построено: всё показано как замена */
  coarse: boolean
}

type Op = { t: 'eq' | 'del' | 'add'; i: number; j: number } // i — индекс в a, j — индекс в b

/** Абзацы: строки текста без лишних пробелов, пустые отбрасываются. */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\r?\n+/)
    .map((p) => p.replace(/[\s ]+/g, ' ').trim())
    .filter(Boolean)
}

const countWords = (ps: string[]) => ps.reduce((n, p) => n + (p.match(/\S+/g)?.length ?? 0), 0)

/**
 * Кратчайший сценарий правок по Майерсу. Совпадающие начало и конец срезаются заранее;
 * если правок больше maxEdits, возвращает null (не строим, чтобы не зависнуть).
 */
function myers(a: string[], b: string[], maxEdits = 2000): Op[] | null {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const A = a.slice(start, endA)
  const B = b.slice(start, endB)
  const n = A.length
  const m = B.length
  const ops: Op[] = []
  for (let k = 0; k < start; k++) ops.push({ t: 'eq', i: k, j: k })

  if (n === 0 || m === 0) {
    for (let k = 0; k < n; k++) ops.push({ t: 'del', i: start + k, j: start })
    for (let k = 0; k < m; k++) ops.push({ t: 'add', i: start + n, j: start + k })
  } else {
    const max = Math.min(n + m, maxEdits)
    const size = 2 * max + 2
    const v = new Int32Array(size)
    const off = max + 1
    const trace: Int32Array[] = []
    let found = -1
    for (let d = 0; d <= max && found < 0; d++) {
      trace.push(v.slice())
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
        let y = x - k
        while (x < n && y < m && A[x] === B[y]) {
          x++
          y++
        }
        v[off + k] = x
        if (x >= n && y >= m) {
          found = d
          break
        }
      }
    }
    if (found < 0) return null
    // обратный ход по сохранённым состояниям
    const rev: Op[] = []
    let x = n
    let y = m
    for (let d = found; d > 0; d--) {
      const vv = trace[d]
      const k = x - y
      const prevK = k === -d || (k !== d && vv[off + k - 1] < vv[off + k + 1]) ? k + 1 : k - 1
      const prevX = vv[off + prevK]
      const prevY = prevX - prevK
      while (x > prevX && y > prevY) {
        x--
        y--
        rev.push({ t: 'eq', i: start + x, j: start + y })
      }
      if (x === prevX) {
        y--
        rev.push({ t: 'add', i: start + x, j: start + y })
      } else {
        x--
        rev.push({ t: 'del', i: start + x, j: start + y })
      }
    }
    while (x > 0 && y > 0) {
      x--
      y--
      rev.push({ t: 'eq', i: start + x, j: start + y })
    }
    for (let k = rev.length - 1; k >= 0; k--) ops.push(rev[k])
  }
  for (let k = 0; k < a.length - endA; k++) ops.push({ t: 'eq', i: endA + k, j: endB + k })
  return ops
}

const words = (s: string) => s.match(/\S+|\s+/g) ?? []

function similarity(x: string, y: string): number {
  const sx = new Set(x.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
  const sy = new Set(y.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
  if (sx.size === 0 || sy.size === 0) return 0
  let common = 0
  for (const w of sx) if (sy.has(w)) common++
  return common / (sx.size + sy.size - common)
}

/** Слова изменённого абзаца с пометками, что добавлено и что удалено. */
function wordParts(before: string, after: string): TextPart[] | null {
  const ops = myers(words(before), words(after), 600)
  if (!ops) return null
  const wa = words(before)
  const wb = words(after)
  const out: TextPart[] = []
  const push = (kind: TextPart['kind'], text: string) => {
    const last = out[out.length - 1]
    if (last && last.kind === kind) last.text += text
    else out.push({ kind, text })
  }
  for (const op of ops) {
    if (op.t === 'eq') push('same', wb[op.j])
    else if (op.t === 'del') push('del', wa[op.i])
    else push('add', wb[op.j])
  }
  return out
}

/** Сверка двух текстов по абзацам. */
export function compareTexts(textA: string, textB: string): TextDiff {
  const a = splitParagraphs(textA)
  const b = splitParagraphs(textB)
  const ops = myers(a, b)
  const blocks: TextBlock[] = []

  if (!ops) {
    for (const p of a) blocks.push({ status: 'removed', before: p, after: null, parts: null })
    for (const p of b) blocks.push({ status: 'added', before: null, after: p, parts: null })
  } else {
    let dels: string[] = []
    let adds: string[] = []
    const flush = () => {
      pairHunk(dels, adds, blocks)
      dels = []
      adds = []
    }
    for (const op of ops) {
      if (op.t === 'eq') {
        flush()
        blocks.push({ status: 'same', before: a[op.i], after: b[op.j], parts: null })
      } else if (op.t === 'del') dels.push(a[op.i])
      else adds.push(b[op.j])
    }
    flush()
  }

  const counts: Record<TextStatus, number> = { added: 0, removed: 0, changed: 0, same: 0 }
  for (const bl of blocks) counts[bl.status]++
  return { blocks, counts, wordsBefore: countWords(a), wordsAfter: countWords(b), coarse: !ops }
}

/** Удалённые и добавленные абзацы между двумя совпадениями: похожие пары — «изменён», остальные — удалён / добавлен. */
function pairHunk(dels: string[], adds: string[], out: TextBlock[]) {
  if (dels.length === 0 && adds.length === 0) return
  const canPair = dels.length > 0 && adds.length > 0 && dels.length * adds.length <= 40_000
  let j = 0
  for (const del of dels) {
    let hit = -1
    if (canPair) {
      let best = 0.5
      for (let k = j; k < adds.length; k++) {
        const s = similarity(del, adds[k])
        if (s >= best) {
          best = s
          hit = k
          if (s === 1) break
        }
      }
    }
    if (hit < 0) {
      out.push({ status: 'removed', before: del, after: null, parts: null })
      continue
    }
    for (; j < hit; j++) out.push({ status: 'added', before: null, after: adds[j], parts: null })
    out.push({ status: 'changed', before: del, after: adds[hit], parts: wordParts(del, adds[hit]) })
    j = hit + 1
  }
  for (; j < adds.length; j++) out.push({ status: 'added', before: null, after: adds[j], parts: null })
}
