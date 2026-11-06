import { tr } from '@/lib/tr'
import { useEffect, useMemo, useState } from 'react'
import { encodeText, summarizeParagraphs, type DecodedText } from './text-io'
import type { EditorHost } from './types'

/** Правка обычного текста: поле на всю область. Переводы строк и метка UTF-8 сохраняются как в файле. */
export function TextEditor({ data, name, mime, host }: { data: DecodedText; name: string; mime: string; host: EditorHost }) {
  const [text, setText] = useState(data.text)
  const changed = text !== data.text
  const lines = useMemo(() => (text === '' ? 0 : text.split('\n').length), [text])

  useEffect(() => host.setDirty(changed), [host, changed])

  host.bind(() => {
    const s = summarizeParagraphs(data.text.split('\n'), text.split('\n'), 'строк')
    return {
      changed,
      summary: s.changed ? s.text : changed ? tr('Изменены только пробелы или пустые строки.') : '',
      notes: data.converted ? [tr('Файл был в кодировке {{v1}}; новая версия сохранится в UTF-8.', { v1: data.converted === 'utf-16' ? 'UTF-16' : 'Windows-1251' })] : [],
      build: async () => encodeText(text, data, mime || 'text/plain'),
      mime: mime || 'text/plain',
    }
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label={tr('Текст файла {{name}}', { name })}
        spellCheck={/\.(txt|md)$/i.test(name)}
        wrap="soft"
        className="min-h-0 w-full flex-1 resize-none bg-card p-4 font-mono text-base leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 md:text-sm"
      />
      <p className="border-t bg-muted/40 px-3 py-1.5 text-xs tabular-nums text-muted-foreground">{tr('Строк:')}{' '}{lines}{tr('· Знаков:')}{' '}{text.length}
      </p>
    </div>
  )
}
