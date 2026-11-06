import type { SVGProps } from 'react'

/** Значок WhatsApp: пузырь с трубкой (контурный, красится цветом текста). */
export function WhatsAppIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M3 21l1.65-4.9A9 9 0 1 1 8 19.4L3 21z" />
      <path d="M9 10c.5 2 2.2 3.8 4.4 4.6l1.3-1.3a.8.8 0 0 1 .8-.2l1.5.6c.4.2.6.6.5 1-.3 1-1.2 1.6-2.2 1.5-3.8-.4-7-3.6-7.4-7.4-.1-1 .5-1.9 1.5-2.2.4-.1.8.1 1 .5l.6 1.5c.1.3 0 .6-.2.8L9 10z" />
    </svg>
  )
}
