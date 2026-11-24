import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NAV_GROUPS } from '@/components/app-shell/project-nav'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { ModuleMap } from '@/features/projects/module-map'
import { MODULE_KEYS, MODULE_LINKS, MODULES, moduleDef, setProjectModules, type ModuleDef, type ModuleKey } from '@/features/projects/modules'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

// Паттерн «Настройки»: модули проекта карточками с переключателями, ниже — карта связей между модулями
export const Route = createFileRoute('/_app/projects/$code/settings')({
  component: ProjectSettings,
})

/** Разделы меню, которые даёт модуль (названия — ключи shell.json) */
const sectionsOf = (key: ModuleKey) => NAV_GROUPS.find((g) => g.module === key)?.items ?? []

function ProjectSettings() {
  const { t } = useTranslation()
  const { code } = Route.useParams()
  const queryClient = useQueryClient()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const canManage = permissions.includes('project.settings.manage')
  const enabled = p.modules
  const [focus, setFocus] = useState<ModuleKey | null>(null)
  const [confirmOff, setConfirmOff] = useState<ModuleKey | null>(null)

  const save = useMutation({
    mutationFn: (v: { next: ModuleKey[]; changed: ModuleKey; on: boolean }) => setProjectModules(p.id, v.next),
    onSuccess: (modules, v) => {
      queryClient.setQueryData(projectByCodeQuery(code).queryKey, (old) => (old ? { ...old, modules } : old))
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      const name = t(moduleDef(v.changed).label)
      toast.success(v.on ? tr('Модуль «{{v1}}» включён', { v1: name }) : tr('Модуль «{{v1}}» выключен', { v1: name }))
      setConfirmOff(null)
    },
    onError: () => toast.error(tr('Не удалось сохранить модули. Попробуйте ещё раз.')),
  })

  const toggle = (key: ModuleKey, on: boolean) => {
    const next = MODULE_KEYS.filter((k) => (k === key ? on : enabled.includes(k)))
    save.mutate({ next, changed: key, on })
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight max-lg:sr-only">{tr('Настройки проекта')}</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          {tr('Модули добавляют в проект свои разделы. Выключенный модуль скрывается у всех участников, а его данные сохраняются и вернутся при включении. Почта, календарь, чат и личное пространство — не модули: они есть всегда.')}
        </p>
        {!canManage && <p className="mt-2 text-sm text-muted-foreground">{tr('Менять модули может руководитель проекта или администратор.')}</p>}
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="modules-h">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="modules-h" className="text-base font-semibold">
            {tr('Модули')}
          </h2>
          <span className="text-sm text-muted-foreground">{tr('Включено {{v1}} из {{v2}}', { v1: enabled.length, v2: MODULES.length })}</span>
        </div>
        <ul className="grid gap-3 md:grid-cols-2">
          {MODULES.map((m) => (
            <ModuleCard
              key={m.key}
              m={m}
              enabled={enabled}
              focused={focus === m.key}
              onFocus={setFocus}
              canManage={canManage}
              pending={save.isPending}
              onToggle={(on) => (on ? toggle(m.key, true) : setConfirmOff(m.key))}
            />
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="links-h">
        <div>
          <h2 id="links-h" className="text-base font-semibold">
            {tr('Связи модулей')}
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {tr('Стрелка — что один модуль передаёт другому. Пунктир — связь не действует, потому что один из модулей выключен. Наведите на модуль, чтобы увидеть только его связи.')}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3 shadow-soft sm:p-5">
          <ModuleMap enabled={enabled} focus={focus} onFocus={setFocus} projectCode={p.code} />
        </div>
      </section>

      {confirmOff && (
        <ConfirmOff
          module={confirmOff}
          enabled={enabled}
          pending={save.isPending}
          onCancel={() => setConfirmOff(null)}
          onConfirm={() => toggle(confirmOff, false)}
        />
      )}
    </div>
  )
}

function ModuleCard({
  m,
  enabled,
  focused,
  onFocus,
  canManage,
  pending,
  onToggle,
}: {
  m: ModuleDef
  enabled: readonly string[]
  focused: boolean
  onFocus: (k: ModuleKey | null) => void
  canManage: boolean
  pending: boolean
  onToggle: (on: boolean) => void
}) {
  const { t } = useTranslation()
  const on = enabled.includes(m.key)
  const out = MODULE_LINKS.filter((l) => l.from === m.key)
  const inc = MODULE_LINKS.filter((l) => l.to === m.key)
  const sections = sectionsOf(m.key)
  // разделы, которым нужен ещё какой-то модуль (например, «Освоенный объём» — графика)
  const waiting = sections.flatMap((s) => (s.needs ?? []).filter((n) => !enabled.includes(n)).map((n) => ({ s, n })))
  const titleId = `module-${m.key}`

  return (
    <li
      className={cn('flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-soft transition-colors', !on && 'bg-muted/30', focused && 'border-foreground/40')}
      onMouseEnter={() => onFocus(m.key)}
      onMouseLeave={() => onFocus(null)}
    >
      <div className="flex items-start gap-3">
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', on ? 'bg-primary text-signal' : 'bg-muted text-muted-foreground')}>
          <m.icon className="size-[18px]" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 id={titleId} className="font-medium leading-snug">
            {t(m.label)}
          </h3>
          <p className="text-sm text-muted-foreground">{m.summary}</p>
        </div>
        <Switch checked={on} disabled={!canManage || pending} labelledBy={titleId} onChange={onToggle} />
      </div>

      <div className="flex flex-wrap gap-1.5" aria-label={tr('Разделы модуля')}>
        {sections.map((s) => (
          <span key={s.id} className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs', !on && 'text-muted-foreground')}>
            <s.icon className="size-3.5 opacity-70" aria-hidden />
            {t(s.label)}
          </span>
        ))}
      </div>
      {m.extras.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {m.extras.map((x) => (
            <li key={x}>+ {x}</li>
          ))}
        </ul>
      )}
      {on && waiting.length > 0 && (
        <p className="rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
          {waiting.map(({ s, n }) => tr('«{{v1}}» появится, когда включён модуль «{{v2}}»', { v1: t(s.label), v2: t(moduleDef(n).label) })).join(' · ')}
        </p>
      )}

      {(out.length > 0 || inc.length > 0) && (
        <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 border-t pt-2.5 text-xs">
          {out.map((l) => (
            <LinkChip key={`o-${l.to}`} dir="out" other={l.to} text={l.text} live={on && enabled.includes(l.to)} />
          ))}
          {inc.map((l) => (
            <LinkChip key={`i-${l.from}`} dir="in" other={l.from} text={l.text} live={on && enabled.includes(l.from)} />
          ))}
        </div>
      )}
    </li>
  )
}

function LinkChip({ dir, other, text, live }: { dir: 'in' | 'out'; other: ModuleKey; text: string; live: boolean }) {
  const { t } = useTranslation()
  const Icon = dir === 'out' ? ArrowRight : ArrowLeft
  return (
    <span title={text} className={cn('inline-flex items-center gap-1', live ? 'text-foreground/80' : 'text-muted-foreground line-through decoration-muted-foreground/50')}>
      <Icon className="size-3" aria-label={dir === 'out' ? tr('передаёт в') : tr('получает из')} />
      {t(moduleDef(other).label)}
    </span>
  )
}

/** Переключатель: дорожка 44×24, зона нажатия не меньше 44×44 */
function Switch({ checked, disabled, labelledBy, onChange }: { checked: boolean; disabled: boolean; labelledBy: string; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group -m-2 flex size-14 shrink-0 items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className={cn('relative inline-flex h-6 w-11 items-center rounded-full border transition-colors', checked ? 'border-primary bg-primary' : 'border-input bg-muted')}>
        <span className={cn('size-[18px] rounded-full shadow-soft transition-transform', checked ? 'translate-x-[22px] bg-signal' : 'translate-x-[2px] bg-card')} />
      </span>
    </button>
  )
}

function ConfirmOff({ module, enabled, pending, onCancel, onConfirm }: { module: ModuleKey; enabled: readonly string[]; pending: boolean; onCancel: () => void; onConfirm: () => void }) {
  const { t } = useTranslation()
  const m = moduleDef(module)
  const name = t(m.label)
  const sections = sectionsOf(module).map((s) => t(s.label))
  const broken = MODULE_LINKS.filter((l) => (l.from === module && enabled.includes(l.to)) || (l.to === module && enabled.includes(l.from)))
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Выключить модуль «{{v1}}»?', { v1: name })}</DialogTitle>
          <DialogDescription>{tr('Разделы скроются у всех участников проекта. Данные модуля не удаляются — при включении всё вернётся.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <div>
            <p className="font-medium">{tr('Скроются разделы')}</p>
            <p className="text-muted-foreground">{[...sections, ...m.extras].join(' · ')}</p>
          </div>
          {broken.length > 0 && (
            <div>
              <p className="font-medium">{tr('Перестанут работать связи')}</p>
              <ul className="mt-1 flex flex-col gap-1 text-muted-foreground">
                {broken.map((l) => (
                  <li key={`${l.from}-${l.to}`}>
                    {t(moduleDef(l.from).label)} → {t(moduleDef(l.to).label)}: {l.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {tr('Оставить включённым')}
          </Button>
          <Button variant="dark" onClick={onConfirm} disabled={pending}>
            {tr('Выключить')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
