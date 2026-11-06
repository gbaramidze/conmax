import Mention from '@tiptap/extension-mention'
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { EDITOR_CLASS } from '@/features/activity/comment-editor'

const extensions = [StarterKit, Mention.configure({ HTMLAttributes: { class: 'mention' } })]

/** Только чтение: Tiptap рендерит документ по схеме, произвольный HTML в DOM не попадает. */
export function CommentBody({ doc }: { doc: unknown }) {
  const editor = useEditor({
    extensions,
    content: doc as JSONContent,
    editable: false,
    editorProps: { attributes: { class: `${EDITOR_CLASS} text-sm` } },
  })
  return <EditorContent editor={editor} />
}
