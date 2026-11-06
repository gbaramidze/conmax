import { tr } from '@/lib/tr'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Code, Heading2, Italic, Link2, List, ListOrdered, Pencil, Quote } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CommentBody } from '@/features/activity/comment-body'
import { EDITOR_CLASS } from '@/features/activity/comment-editor'

/** Документ без текста: null или одни пустые абзацы. */
export function isEmptyDoc(doc: unknown): boolean {
  const d = doc as JSONContent | null | undefined
  if (!d || !Array.isArray(d.content)) return true
  return d.content.every((n) => n.type === 'paragraph' && !(n.content && n.content.length > 0))
}

const extensions = [
  StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
  Placeholder.configure({ placeholder: tr('Что нужно сделать, как проверить результат, что важно знать исполнителю…') }),
]

/**
 * Описание задачи: в покое — отрисованный текст, по нажатию открывается редактор с панелью форматирования.
 * Сохраняется по кнопке «Сохранить» (или Ctrl+Enter), чтобы случайный клик не менял задачу.
 */
export function DescriptionEditor({
  doc,
  canEdit,
  saving,
  onSave,
}: {
  doc: unknown
  canEdit: boolean
  saving: boolean
  onSave: (doc: JSONContent | null) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const empty = isEmptyDoc(doc)

  if (editing) {
    return (
      <Editing
        doc={doc}
        saving={saving}
        onCancel={() => setEditing(false)}
        onSave={async (d) => {
          await onSave(d)
          setEditing(false)
        }}
      />
    )
  }

  if (empty) {
    return canEdit ? (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="min-h-20 w-full rounded-lg border border-dashed px-3 py-3 text-left text-sm text-muted-foreground outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
      >{tr('Добавить описание…')}</button>
    ) : (
      <p className="text-sm text-muted-foreground">{tr('Описание не заполнено.')}</p>
    )
  }

  return (
    <div className="group relative rounded-lg">
      <CommentBody doc={doc} />
      {canEdit && (
        <Button type="button" size="sm" variant="ghost" className="mt-1" onClick={() => setEditing(true)}>
          <Pencil />{tr('Редактировать')}</Button>
      )}
    </div>
  )
}

/** Поле описания с панелью форматирования для форм создания: отдаёт документ при каждом изменении (null — пусто). */
export function DescriptionInput({ onChange }: { onChange: (doc: JSONContent | null) => void }) {
  const editor = useEditor({
    extensions,
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? null : e.getJSON()),
    editorProps: {
      attributes: {
        class: `${EDITOR_CLASS} min-h-32 rounded-b-lg border border-t-0 bg-card px-3 py-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:text-sm`,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': tr('Описание задачи'),
      },
    },
  })
  return (
    <div className="flex flex-col">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}

function Editing({
  doc,
  saving,
  onCancel,
  onSave,
}: {
  doc: unknown
  saving: boolean
  onCancel: () => void
  onSave: (doc: JSONContent | null) => Promise<void>
}) {
  const editor = useEditor({
    extensions,
    content: isEmptyDoc(doc) ? undefined : (doc as JSONContent),
    autofocus: 'end',
    editorProps: {
      attributes: {
        class: `${EDITOR_CLASS} min-h-32 rounded-b-lg border border-t-0 bg-card px-3 py-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:text-sm`,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': tr('Описание задачи'),
      },
    },
  })

  const save = () => {
    if (!editor || saving) return
    void onSave(editor.isEmpty ? null : editor.getJSON())
  }

  return (
    <div
      className="flex flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          save()
        }
        if (e.key === 'Escape') onCancel()
      }}
    >
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" disabled={saving || !editor} onClick={save} title="Ctrl+Enter">
          {saving ? tr('Сохраняем…') : tr('Сохранить')}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancel}>{tr('Отмена')}</Button>
      </div>
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor | null }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: !!e?.isActive('bold'),
      italic: !!e?.isActive('italic'),
      h2: !!e?.isActive('heading', { level: 2 }),
      bullet: !!e?.isActive('bulletList'),
      ordered: !!e?.isActive('orderedList'),
      quote: !!e?.isActive('blockquote'),
      code: !!e?.isActive('code'),
      link: !!e?.isActive('link'),
    }),
  })
  if (!editor || !active) return null

  const setLink = () => {
    const prev = (editor.getAttributes('link').href as string | undefined) ?? ''
    const url = window.prompt(tr('Адрес ссылки (пусто — убрать ссылку)'), prev)
    if (url === null) return
    if (url.trim() === '') editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
  }

  const items: { label: string; icon: React.ReactNode; on: boolean; run: () => void }[] = [
    { label: tr('Жирный'), icon: <Bold />, on: active.bold, run: () => editor.chain().focus().toggleBold().run() },
    { label: tr('Курсив'), icon: <Italic />, on: active.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { label: tr('Заголовок'), icon: <Heading2 />, on: active.h2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: tr('Маркированный список'), icon: <List />, on: active.bullet, run: () => editor.chain().focus().toggleBulletList().run() },
    { label: tr('Нумерованный список'), icon: <ListOrdered />, on: active.ordered, run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: tr('Цитата'), icon: <Quote />, on: active.quote, run: () => editor.chain().focus().toggleBlockquote().run() },
    { label: tr('Код'), icon: <Code />, on: active.code, run: () => editor.chain().focus().toggleCode().run() },
    { label: tr('Ссылка'), icon: <Link2 />, on: active.link, run: setLink },
  ]

  return (
    <div role="toolbar" aria-label={tr('Форматирование')} className="flex flex-wrap gap-0.5 rounded-t-lg border bg-muted/40 p-1">
      {items.map((i) => (
        <Button
          key={i.label}
          type="button"
          size="icon"
          variant={i.on ? 'secondary' : 'ghost'}
          aria-label={i.label}
          aria-pressed={i.on}
          title={i.label}
          className="md:size-8"
          onMouseDown={(e) => e.preventDefault()}
          onClick={i.run}
        >
          {i.icon}
        </Button>
      ))}
    </div>
  )
}
