import { both, fullMoney, money } from './lookahead-model'

/** Короткая сумма («19,5 млн ₾»); при наведении — полная («19 545 141 ₾»). */
export function Money({ value, className }: { value: number; className?: string }) {
  return (
    <span title={fullMoney(value)} className={`tabular-nums ${className ?? ''}`}>
      {money(value)}
    </span>
  )
}

/** Фраза с короткими суммами; при наведении — та же фраза с полными суммами. */
export function Phrase({ build, as: Tag = 'span', className }: { build: (m: (n: number) => string) => string; as?: 'span' | 'p'; className?: string }) {
  const x = both(build)
  return (
    <Tag title={x.title} className={className}>
      {x.text}
    </Tag>
  )
}
