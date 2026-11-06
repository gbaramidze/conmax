import { useTranslation } from 'react-i18next'
import { NavLink } from '@/components/app-shell/nav-link'
import { visibleNav } from '@/components/app-shell/project-nav'

/** Плитки всех разделов проекта на обзоре: крупные, по три в ряд на телефоне. Тот же список, что в боковой панели и в «Ещё». */
export function SectionTiles({ code, perms }: { code: string; perms: readonly string[] }) {
  const { t } = useTranslation()
  const groups = visibleNav(perms)
  return (
    <nav aria-label={t('projectSections')} className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t('projectSections')}</h2>
      {groups.map((g) => (
        <section key={g.id} aria-label={t(g.title)} className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">{t(g.title)}</h3>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
            {g.items.map((it) => (
              <li key={it.id}>
                <NavLink
                  to={it.to}
                  params={{ code }}
                  search={it.search}
                  className="flex min-h-[4.75rem] flex-col items-center justify-center gap-1.5 rounded-xl border bg-card px-1.5 py-2 text-center text-[12.5px] leading-tight shadow-soft outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <it.icon className="size-[22px] text-foreground/70" aria-hidden />
                  <span className="line-clamp-2 break-words">{t(it.label)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  )
}
