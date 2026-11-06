import Mention from '@tiptap/extension-mention'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import { createMentionSuggestion, type MentionUser } from '@/features/activity/mention-suggestion'
import { tenantUsersQuery } from '@/features/projects/api'

export const EDITOR_CLASS = 'prose-comment'

interface EditorProps {
  placeholder: string
  ariaLabel: string
  onChange: (doc: JSONContent, isEmpty: boolean) => void
  onSubmit: () => void
  /** Меняется, чтобы очистить редактор после публикации */
  resetKey: number
}

/** Редактор комментария: Tiptap + @упоминания коллег. Ctrl/⌘+Enter — отправить. */
export function CommentEditor({ placeholder, ariaLabel, onChange, onSubmit, resetKey }: EditorProps) {
  const { data: users } = useQuery(tenantUsersQuery)
  const usersRef = useRef<MentionUser[]>([])
  usersRef.current = (users ?? []).map((u) => ({ id: u.id, label: u.full_name }))

  const submitRef = useRef(onSubmit)
  submitRef.current = onSubmit

  const extensions = useMemo(
    () => [
      StarterKit,
      Placeholder.configure({ placeholder }),
      Mention.configure({
        HTMLAttributes: { class: 'mention' },
        suggestion: createMentionSuggestion(() => usersRef.current),
      }),
    ],
    [placeholder],
  )

  const editor = useEditor({
    extensions,
    editorProps: {
      attributes: {
        class: `${EDITOR_CLASS} min-h-24 rounded-lg border bg-card px-3 py-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:text-sm`,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': ariaLabel,
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          submitRef.current()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON(), editor.isEmpty),
  })

  useEffect(() => {
    if (resetKey > 0) editor?.commands.clearContent(true)
  }, [resetKey, editor])

  return <EditorContent editor={editor} />
}
