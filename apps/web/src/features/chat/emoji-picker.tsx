import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react'
import i18n from '@/lib/i18n'
import { tr } from '@/lib/tr'

// Названия и поиск эмодзи по-русски; для других языков остаётся английский набор (грузинского у библиотеки нет)
const loadRussian = () => import('emoji-picker-react/data/emojis-ru')

/** Полный выбор эмодзи с поиском, категориями, недавними и оттенками кожи. Грузится отдельным куском, только когда его открыли. */
export default function ChatEmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const dark = document.documentElement.classList.contains('dark')
  return (
    <EmojiPicker
      onEmojiClick={(d) => onPick(d.emoji)}
      theme={dark ? Theme.DARK : Theme.LIGHT}
      emojiStyle={EmojiStyle.NATIVE}
      emojiData={i18n.language === 'ru' ? loadRussian : undefined}
      width="min(22rem, calc(100vw - 2rem))"
      height={380}
      autoFocusSearch={false}
      lazyLoadEmojis
      previewConfig={{ showPreview: false }}
      labels={{ searchPlaceholder: tr('Поиск эмодзи'), searchLabel: tr('Поиск эмодзи'), searchClear: tr('Очистить поиск') }}
    />
  )
}
