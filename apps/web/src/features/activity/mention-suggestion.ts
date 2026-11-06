import { tr } from '@/lib/tr'
import type { SuggestionOptions } from '@tiptap/suggestion'

export interface MentionUser {
  id: string
  label: string
}

/**
 * Подсказки для @-упоминаний. Выпадающий список — на чистом DOM (без tippy), позиционируется по каретке.
 * `getUsers` вызывается при каждом наборе, поэтому всегда видит свежий список.
 */
export function createMentionSuggestion(getUsers: () => MentionUser[]): Omit<SuggestionOptions<MentionUser>, 'editor'> {
  return {
    items: ({ query }) =>
      getUsers()
        .filter((u) => u.label.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 6),

    render: () => {
      let el: HTMLDivElement | null = null
      let items: MentionUser[] = []
      let selected = 0
      let choose: (user: MentionUser) => void = () => {}

      const draw = (rect: DOMRect | null) => {
        if (!el) return
        el.replaceChildren()
        if (items.length === 0) {
          const empty = document.createElement('div')
          empty.className = 'px-3 py-2 text-sm text-muted-foreground'
          empty.textContent = tr('Никого не нашли')
          el.append(empty)
        }
        items.forEach((user, i) => {
          const option = document.createElement('button')
          option.type = 'button'
          option.role = 'option'
          option.ariaSelected = String(i === selected)
          option.className =
            'block w-full rounded px-3 py-1.5 text-left text-sm ' + (i === selected ? 'bg-accent' : 'hover:bg-accent/60')
          option.textContent = user.label
          // mousedown, а не click: иначе редактор теряет фокус раньше выбора
          option.addEventListener('mousedown', (e) => {
            e.preventDefault()
            choose(user)
          })
          el!.append(option)
        })
        if (rect) {
          el.style.left = `${rect.left}px`
          el.style.top = `${rect.bottom + 4}px`
        }
      }

      return {
        onStart: (props) => {
          el = document.createElement('div')
          el.role = 'listbox'
          el.ariaLabel = tr('Кого упомянуть')
          el.className = 'fixed z-50 w-60 rounded-md border bg-popover p-1 text-popover-foreground shadow-md'
          document.body.append(el)
          items = props.items
          selected = 0
          choose = (user) => props.command(user)
          draw(props.clientRect?.() ?? null)
        },
        onUpdate: (props) => {
          items = props.items
          selected = 0
          choose = (user) => props.command(user)
          draw(props.clientRect?.() ?? null)
        },
        onKeyDown: ({ event }) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (items.length === 0) return true
            selected = (selected + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length
            draw(null)
            return true
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            if (items[selected]) choose(items[selected])
            return true
          }
          if (event.key === 'Escape') {
            el?.remove()
            el = null
            return true
          }
          return false
        },
        onExit: () => {
          el?.remove()
          el = null
        },
      }
    },
  }
}
