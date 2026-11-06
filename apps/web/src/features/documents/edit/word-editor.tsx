import { tr } from '@/lib/tr'
import Image from '@tiptap/extension-image'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Columns3, Italic, List, ListOrdered, Redo2, Rows3, Strikethrough, Table2, Trash2, Underline, Undo2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import { buildDocx, docParagraphs, DOCX_MIME } from './docx-export'
import { summarizeParagraphs } from './text-io'
import type { EditorHost } from './types'

const extensions = [
  StarterKit.configure({ link: { openOnClick: false, autolink: true }, heading: { levels: [1, 2, 3] } }),
  Image.configure({ allowBase64: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
]

const PAGE_CLASS =
  'mx-auto min-h-full max-w-3xl px-5 py-6 text-base leading-relaxed outline-none md:text-sm [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_li]:ml-5 [&_li_p]:mb-1 [&_ol]:mb-3 [&_ol]:list-decimal [&_p]:mb-3 [&_table]:my-4 [&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse [&_td]:relative [&_td]:border [&_td]:p-2 [&_td]:align-top [&_td_p]:mb-0 [&_th]:relative [&_th]:border [&_th]:bg-muted [&_th]:p-2 [&_th]:text-left [&_th_p]:mb-0 [&_ul]:mb-3 [&_ul]:list-disc [&_.selectedCell]:bg-primary/15 [&_a]:text-primary [&_a]:underline'

function Tool({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      // кнопка не уводит фокус из текста, иначе выделение теряется
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`grid size-9 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 [&_svg]:size-4 ${active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'}`}
    >
      {children}
    </button>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      inTable: e.isActive('table'),
      block: e.isActive('heading', { level: 1 }) ? 'h1' : e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : 'p',
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })
  const chain = () => editor.chain().focus()
  return (
    <div role="toolbar" aria-label={tr('Форматирование')} className="flex flex-wrap items-center gap-0.5 border-b p-1.5">
      <Tool label={tr('Отменить')} disabled={!s.canUndo} onClick={() => chain().undo().run()}>
        <Undo2 />
      </Tool>
      <Tool label={tr('Вернуть')} disabled={!s.canRedo} onClick={() => chain().redo().run()}>
        <Redo2 />
      </Tool>
      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
      <select
        aria-label={tr('Стиль абзаца')}
        value={s.block}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'p') chain().setParagraph().run()
          else chain().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run()
        }}
        className="h-9 shrink-0 rounded-md border bg-background px-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
      >
        <option value="p">{tr('Обычный текст')}</option>
        <option value="h1">{tr('Заголовок 1')}</option>
        <option value="h2">{tr('Заголовок 2')}</option>
        <option value="h3">{tr('Заголовок 3')}</option>
      </select>
      <Tool label={tr('Жирный (Ctrl+B)')} active={s.bold} onClick={() => chain().toggleBold().run()}>
        <Bold />
      </Tool>
      <Tool label={tr('Курсив (Ctrl+I)')} active={s.italic} onClick={() => chain().toggleItalic().run()}>
        <Italic />
      </Tool>
      <Tool label={tr('Подчёркнутый (Ctrl+U)')} active={s.underline} onClick={() => chain().toggleUnderline().run()}>
        <Underline />
      </Tool>
      <Tool label={tr('Зачёркнутый')} active={s.strike} onClick={() => chain().toggleStrike().run()}>
        <Strikethrough />
      </Tool>
      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
      <Tool label={tr('Маркированный список')} active={s.bullet} onClick={() => chain().toggleBulletList().run()}>
        <List />
      </Tool>
      <Tool label={tr('Нумерованный список')} active={s.ordered} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrdered />
      </Tool>
      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
      <Tool label={tr('Вставить таблицу 3×3')} disabled={s.inTable} onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <Table2 />
      </Tool>
      {s.inTable && (
        <>
          <Tool label={tr('Добавить строку под текущей')} onClick={() => chain().addRowAfter().run()}>
            <Rows3 />
          </Tool>
          <Tool label={tr('Удалить строку таблицы')} onClick={() => chain().deleteRow().run()}>
            <Trash2 />
            <span className="sr-only">{tr('строку')}</span>
          </Tool>
          <Tool label={tr('Добавить столбец справа')} onClick={() => chain().addColumnAfter().run()}>
            <Columns3 />
          </Tool>
          <Tool label={tr('Удалить столбец таблицы')} onClick={() => chain().deleteColumn().run()}>
            <Columns3 className="text-destructive" />
          </Tool>
          <Tool label={tr('Удалить всю таблицу')} onClick={() => chain().deleteTable().run()}>
            <Table2 className="text-destructive" />
          </Tool>
        </>
      )}
    </div>
  )
}

/** Правка документа Word: текст, заголовки, списки, таблицы, жирный, курсив. Файл собирается заново, поэтому оформление упрощается. */
export function WordEditor({ html, host, extras }: { html: string; host: EditorHost; extras: string[] }) {
  const base = useRef<{ json: string; paragraphs: string[] } | null>(null)
  const [changed, setChanged] = useState(false)

  const editor = useEditor({
    extensions,
    content: html,
    onCreate: ({ editor: e }) => {
      const json = e.getJSON()
      base.current = { json: JSON.stringify(json), paragraphs: docParagraphs(json) }
    },
    onUpdate: ({ editor: e }) => {
      const c = !!base.current && JSON.stringify(e.getJSON()) !== base.current.json
      setChanged(c)
      host.setDirty(c)
    },
    editorProps: { attributes: { class: PAGE_CLASS, role: 'textbox', 'aria-multiline': 'true', 'aria-label': tr('Текст документа') } },
  })

  host.bind(() => {
    const json: JSONContent = editor?.getJSON() ?? { type: 'doc', content: [] }
    const s = summarizeParagraphs(base.current?.paragraphs ?? [], docParagraphs(json), 'абзацев')
    return {
      changed,
      summary: s.changed ? s.text : changed ? tr('Изменено оформление текста (слова не менялись).') : '',
      notes: [],
      ack: extras.length > 0 ? tr('Понимаю, что в новой версии не сохранятся: {{v1}}.', { v1: extras.join(', ') }) : undefined,
      mime: DOCX_MIME,
      build: () => buildDocx(json),
    }
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      {editor && <Toolbar editor={editor} />}
      <div className="min-h-0 flex-1 overflow-y-auto bg-card">
        <EditorContent editor={editor} className="min-h-full" />
      </div>
    </div>
  )
}
