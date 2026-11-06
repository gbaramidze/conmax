// Сборка .docx из документа редактора Tiptap (заголовки, абзацы, списки, таблицы, картинки, жирный, курсив, подчёркивание, ссылки).
// Оформление исходного файла (колонтитулы, формулы, макеты) не переносится: файл собирается заново из того, что видно в редакторе.
import type { JSONContent } from '@tiptap/react'
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx'

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

type Block = Paragraph | Table
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6]
const MAX_IMAGE_WIDTH = 600
const INDENT = 360

interface Ctx {
  /** Счётчик нумерованных списков: у каждого списка свой номер, чтобы нумерация начиналась заново */
  lists: string[]
}

interface ListInfo {
  kind: 'bullet' | 'ordered'
  level: number
  reference?: string
}

function runs(nodes: JSONContent[] | undefined, images: Map<JSONContent, ParagraphChild>): ParagraphChild[] {
  const out: ParagraphChild[] = []
  for (const n of nodes ?? []) {
    if (n.type === 'text') {
      const marks = new Set((n.marks ?? []).map((m) => m.type))
      const link = (n.marks ?? []).find((m) => m.type === 'link')?.attrs?.href as string | undefined
      const run = new TextRun({
        text: n.text ?? '',
        bold: marks.has('bold') || undefined,
        italics: marks.has('italic') || undefined,
        strike: marks.has('strike') || undefined,
        underline: marks.has('underline') || link ? {} : undefined,
        color: link ? '0563C1' : undefined,
        font: marks.has('code') ? 'Consolas' : undefined,
      })
      out.push(link ? new ExternalHyperlink({ link, children: [run] }) : run)
    } else if (n.type === 'hardBreak') out.push(new TextRun({ break: 1 }))
    else if (n.type === 'image') {
      const img = images.get(n)
      if (img) out.push(img)
    }
  }
  return out
}

async function loadImage(src: string): Promise<{ data: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp'; width: number; height: number } | null> {
  if (!src.startsWith('data:')) return null
  const img = new Image()
  img.src = src
  try {
    await img.decode()
  } catch {
    return null
  }
  const w = img.naturalWidth || 300
  const h = img.naturalHeight || 200
  const mime = /^data:([^;,]+)/.exec(src)?.[1] ?? ''
  const direct = mime === 'image/png' ? 'png' : mime === 'image/jpeg' || mime === 'image/jpg' ? 'jpg' : mime === 'image/gif' ? 'gif' : mime === 'image/bmp' ? 'bmp' : null
  const base64 = src.slice(src.indexOf(',') + 1)
  let data: Uint8Array
  let type: 'png' | 'jpg' | 'gif' | 'bmp'
  if (direct && src.includes(';base64,')) {
    const bin = atob(base64)
    data = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    type = direct
  } else {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')?.drawImage(img, 0, 0)
    const png = canvas.toDataURL('image/png').split(',')[1]
    data = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
    type = 'png'
  }
  const k = Math.min(1, MAX_IMAGE_WIDTH / w)
  return { data, type, width: Math.round(w * k), height: Math.round(h * k) }
}

/** Картинки собираем заранее: загрузка асинхронная, а остальное дерево собирается синхронно */
async function collectImages(node: JSONContent, out: Map<JSONContent, ParagraphChild>): Promise<void> {
  if (node.type === 'image') {
    const src = node.attrs?.src as string | undefined
    const img = src ? await loadImage(src) : null
    if (img) out.set(node, new ImageRun({ type: img.type, data: img.data, transformation: { width: img.width, height: img.height } }))
  }
  for (const c of node.content ?? []) await collectImages(c, out)
}

function paragraph(node: JSONContent, images: Map<JSONContent, ParagraphChild>, extra: ConstructorParameters<typeof Paragraph>[0] = {}): Paragraph {
  return new Paragraph({ children: runs(node.content, images), ...(typeof extra === 'object' ? extra : {}) })
}

function listItems(node: JSONContent, level: number, ctx: Ctx, images: Map<JSONContent, ParagraphChild>, reference?: string): Block[] {
  const kind: ListInfo['kind'] = node.type === 'orderedList' ? 'ordered' : 'bullet'
  let ref = reference
  if (kind === 'ordered' && !ref) {
    ref = `ol-${ctx.lists.length}`
    ctx.lists.push(ref)
  }
  const out: Block[] = []
  for (const item of node.content ?? []) {
    let first = true
    for (const child of item.content ?? []) {
      if (child.type === 'paragraph' && first) {
        out.push(paragraph(child, images, kind === 'bullet' ? { bullet: { level } } : { numbering: { reference: ref!, level } }))
        first = false
      } else if (child.type === 'bulletList' || child.type === 'orderedList') {
        out.push(...listItems(child, level + 1, ctx, images))
        first = false
      } else {
        out.push(...blocks([child], ctx, images, { left: INDENT * (level + 1) }))
        first = false
      }
    }
  }
  return out
}

function blocks(nodes: JSONContent[] | undefined, ctx: Ctx, images: Map<JSONContent, ParagraphChild>, indent?: { left: number }): Block[] {
  const out: Block[] = []
  for (const n of nodes ?? []) {
    switch (n.type) {
      case 'paragraph':
        out.push(paragraph(n, images, indent ? { indent } : {}))
        break
      case 'heading':
        out.push(paragraph(n, images, { heading: HEADINGS[Math.min(6, Math.max(1, Number(n.attrs?.level ?? 1))) - 1], ...(indent ? { indent } : {}) }))
        break
      case 'bulletList':
      case 'orderedList':
        out.push(...listItems(n, 0, ctx, images))
        break
      case 'blockquote':
        out.push(...blocks(n.content, ctx, images, { left: (indent?.left ?? 0) + INDENT }))
        break
      case 'codeBlock':
        for (const line of (n.content?.map((c) => c.text ?? '').join('') ?? '').split('\n'))
          out.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', size: 20 })], ...(indent ? { indent } : {}) }))
        break
      case 'horizontalRule':
        out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } } }))
        break
      case 'table':
        out.push(table(n, ctx, images))
        break
      case 'image':
        out.push(new Paragraph({ children: runs([n], images) }))
        break
      default:
        if (n.content) out.push(...blocks(n.content, ctx, images, indent))
    }
  }
  return out
}

function table(node: JSONContent, ctx: Ctx, images: Map<JSONContent, ParagraphChild>): Table {
  const rows = (node.content ?? []).map(
    (row) =>
      new TableRow({
        tableHeader: (row.content ?? []).every((c) => c.type === 'tableHeader') || undefined,
        children: (row.content ?? []).map((cell) => {
          const content = blocks(cell.content, ctx, images)
          return new TableCell({
            columnSpan: Number(cell.attrs?.colspan ?? 1) > 1 ? Number(cell.attrs?.colspan) : undefined,
            rowSpan: Number(cell.attrs?.rowspan ?? 1) > 1 ? Number(cell.attrs?.rowspan) : undefined,
            shading: cell.type === 'tableHeader' ? { fill: 'EEEEEE' } : undefined,
            children: content.length > 0 ? content : [new Paragraph({})],
          })
        }),
      }),
  )
  return new Table({ rows: rows.length > 0 ? rows : [new TableRow({ children: [new TableCell({ children: [new Paragraph({})] })] })], width: { size: 100, type: WidthType.PERCENTAGE } })
}

/** Нумерованные списки: на каждый список своя настройка нумерации (чтобы счёт начинался с единицы) */
function numbering(lists: string[]) {
  return {
    config: lists.map((reference) => ({
      reference,
      levels: Array.from({ length: 6 }, (_, level) => ({
        level,
        format: LevelFormat.DECIMAL,
        text: `%${level + 1}.`,
        alignment: AlignmentType.START,
        style: { paragraph: { indent: { left: INDENT * (level + 1), hanging: INDENT } } },
      })),
    })),
  }
}

export async function buildDocx(doc: JSONContent): Promise<Blob> {
  const images = new Map<JSONContent, ParagraphChild>()
  await collectImages(doc, images)
  const ctx: Ctx = { lists: [] }
  const children = blocks(doc.content, ctx, images)
  const file = new Document({
    creator: 'BuildOS',
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: numbering(ctx.lists),
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: children.length > 0 ? children : [new Paragraph({})] }],
  })
  return Packer.toBlob(file)
}

/** Абзацы документа для сверки: текст каждого абзаца, заголовка, пункта списка и ячейки таблицы */
export function docParagraphs(doc: JSONContent): string[] {
  const out: string[] = []
  const text = (n: JSONContent): string => (n.type === 'text' ? (n.text ?? '') : n.type === 'hardBreak' ? ' ' : (n.content ?? []).map(text).join(''))
  const walk = (n: JSONContent) => {
    if (n.type === 'paragraph' || n.type === 'heading') out.push(text(n))
    else if (n.type === 'codeBlock') out.push(...text(n).split('\n'))
    else (n.content ?? []).forEach(walk)
  }
  walk(doc)
  return out
}
