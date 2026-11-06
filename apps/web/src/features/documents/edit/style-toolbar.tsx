import { tr } from '@/lib/tr'
import { AlignCenter, AlignLeft, AlignRight, Baseline, Bold, Eraser, Grid2x2, Italic, PaintBucket, Strikethrough, Underline, WrapText } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useState, type ReactNode } from 'react'
import type { CellStyle, StylePatch } from '../sheet/style'

const PALETTE = [
  '#ffffff', '#f2f2f2', '#d9d9d9', '#a6a6a6', '#595959', '#000000',
  '#fce4d6', '#fff2cc', '#e2efda', '#ddebf7', '#d9e1f2', '#ede7f6',
  '#f4b183', '#ffd966', '#a9d08e', '#9dc3e6', '#8ea9db', '#c9b1e8',
  '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050',
  '#00b0f0', '#0070c0', '#002060', '#7030a0', '#ed7d31', '#4472c4',
]

const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24]

export const NUMBER_FORMATS: { label: string; fmt: string | null }[] = [
  { label: tr('Общий'), fmt: null },
  { label: tr('Число 1 234,50'), fmt: '#,##0.00' },
  { label: tr('Целое 1 234'), fmt: '#,##0' },
  { label: tr('Процент'), fmt: '0%' },
  { label: tr('Деньги, ₾'), fmt: '#,##0.00 "₾"' },
  { label: tr('Деньги, $'), fmt: '#,##0.00 "$"' },
  { label: tr('Дата'), fmt: 'dd.mm.yyyy' },
]

function Tool({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`grid size-10 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 md:size-8 [&_svg]:size-4 ${active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'}`}
    >
      {children}
    </button>
  )
}

/** Кнопка с палитрой цветов: «Цвет текста» и «Заливка» */
function ColorTool({ label, icon, current, clearLabel, onPick }: { label: string; icon: ReactNode; current: string | undefined; clearLabel: string; onPick: (color: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const pick = (c: string | null) => {
    onPick(c)
    setOpen(false)
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          onMouseDown={(e) => e.preventDefault()}
          className="relative grid size-10 shrink-0 place-items-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:size-8 [&_svg]:size-4"
        >
          {icon}
          <span className="absolute inset-x-2 bottom-1 h-[3px] rounded-sm border border-black/10" style={{ background: current ?? 'transparent' }} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} collisionPadding={8} className="z-[80] w-56 rounded-md border bg-popover p-2 text-popover-foreground shadow-md outline-none" onCloseAutoFocus={(e) => e.preventDefault()}>
          <div className="grid grid-cols-6 gap-1.5" role="group" aria-label={label}>
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                title={c}
                onClick={() => pick(c)}
                className={`size-7 rounded border outline-none focus-visible:ring-2 focus-visible:ring-ring ${current === c ? 'ring-2 ring-primary' : ''}`}
                style={{ background: c }}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-xs">
            <button type="button" className="min-h-8 rounded px-2 underline underline-offset-2 hover:bg-accent" onClick={() => pick(null)}>
              {clearLabel}
            </button>
            <label className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-2 hover:bg-accent">{tr('Другой')}<input type="color" className="size-6 cursor-pointer border-0 bg-transparent p-0" value={current ?? '#000000'} onChange={(e) => onPick(e.target.value)} aria-label={tr('{{label}}: свой цвет', { label })} />
            </label>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Панель оформления: жирный, курсив, цвета, выравнивание, границы, формат числа; действует на выделенные ячейки */
export function StyleToolbar({ style, onPatch, onReset, disabled }: { style: CellStyle; onPatch: (patch: StylePatch) => void; onReset: () => void; disabled?: boolean }) {
  const border = { style: 'thin' as const, color: '#000000' }
  const nf = NUMBER_FORMATS.find((f) => (f.fmt ?? undefined) === style.numFmt)
  return (
    <div role="toolbar" aria-label={tr('Оформление ячеек')} className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1">
      <Tool label={tr('Жирный')} active={!!style.bold} disabled={disabled} onClick={() => onPatch({ bold: !style.bold })}>
        <Bold />
      </Tool>
      <Tool label={tr('Курсив')} active={!!style.italic} disabled={disabled} onClick={() => onPatch({ italic: !style.italic })}>
        <Italic />
      </Tool>
      <Tool label={tr('Подчёркнутый')} active={!!style.underline} disabled={disabled} onClick={() => onPatch({ underline: !style.underline })}>
        <Underline />
      </Tool>
      <Tool label={tr('Зачёркнутый')} active={!!style.strike} disabled={disabled} onClick={() => onPatch({ strike: !style.strike })}>
        <Strikethrough />
      </Tool>
      <select
        aria-label={tr('Размер шрифта')}
        title={tr('Размер шрифта')}
        disabled={disabled}
        value={style.size ?? 11}
        onChange={(e) => onPatch({ size: Number(e.target.value) })}
        className="h-10 shrink-0 rounded-md border bg-background px-1 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8 md:text-xs"
      >
        {!SIZES.includes(style.size ?? 11) && <option value={style.size}>{style.size}</option>}
        {SIZES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <ColorTool label={tr('Цвет текста')} icon={<Baseline />} current={style.color} clearLabel={tr('Авто')} onPick={(c) => onPatch({ color: c })} />
      <ColorTool label={tr('Заливка')} icon={<PaintBucket />} current={style.bg} clearLabel={tr('Без заливки')} onPick={(c) => onPatch({ bg: c })} />
      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
      <Tool label={tr('По левому краю')} active={style.h === 'left'} disabled={disabled} onClick={() => onPatch({ h: style.h === 'left' ? null : 'left' })}>
        <AlignLeft />
      </Tool>
      <Tool label={tr('По центру')} active={style.h === 'center'} disabled={disabled} onClick={() => onPatch({ h: style.h === 'center' ? null : 'center' })}>
        <AlignCenter />
      </Tool>
      <Tool label={tr('По правому краю')} active={style.h === 'right'} disabled={disabled} onClick={() => onPatch({ h: style.h === 'right' ? null : 'right' })}>
        <AlignRight />
      </Tool>
      <Tool label={tr('Перенос текста')} active={!!style.wrap} disabled={disabled} onClick={() => onPatch({ wrap: !style.wrap })}>
        <WrapText />
      </Tool>
      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
      <Tool label={tr('Все границы')} disabled={disabled} onClick={() => onPatch({ borders: { t: border, r: border, b: border, l: border } })}>
        <Grid2x2 />
      </Tool>
      <Tool label={tr('Убрать границы')} disabled={disabled} onClick={() => onPatch({ borders: { t: null, r: null, b: null, l: null } })}>
        <Grid2x2 className="opacity-40" />
      </Tool>
      <select
        aria-label={tr('Формат числа')}
        title={tr('Формат числа')}
        disabled={disabled}
        value={nf ? NUMBER_FORMATS.indexOf(nf) : -1}
        onChange={(e) => onPatch({ numFmt: NUMBER_FORMATS[Number(e.target.value)].fmt })}
        className="h-10 max-w-36 shrink-0 rounded-md border bg-background px-1 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8 md:text-xs"
      >
        {!nf && <option value={-1}>{tr('Другой')}</option>}
        {NUMBER_FORMATS.map((f, i) => (
          <option key={f.label} value={i}>
            {f.label}
          </option>
        ))}
      </select>
      <Tool label={tr('Очистить оформление, которое вы применили')} disabled={disabled} onClick={onReset}>
        <Eraser />
      </Tool>
    </div>
  )
}
