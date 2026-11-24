import { Link } from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { tr } from '@/lib/tr'
import { moduleDef, type ModuleKey } from '@/features/projects/modules'

/**
 * Вместо страницы выключенного модуля: что это за модуль и где его включить. Данные модуля при этом не тронуты.
 * noAccess — модуль включён, но руководитель открыл его не всем, и текущему пользователю он закрыт.
 */
export function ModuleOff({ module, code, canManage, noAccess = false }: { module: ModuleKey; code: string; canManage: boolean; noAccess?: boolean }) {
  const { t } = useTranslation()
  const m = moduleDef(module)
  if (noAccess)
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 shadow-soft">
        <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Lock className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="font-medium">{tr('Модуль «{{v1}}» вам закрыт', { v1: t(m.label) })}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">{tr('Руководитель проекта открыл этот модуль только некоторым участникам. Если он нужен вам для работы — попросите руководителя проекта дать доступ.')}</p>
        </div>
        <Link to="/projects/$code" params={{ code }} className="text-sm font-medium underline underline-offset-4">
          {tr('К обзору проекта')}
        </Link>
      </div>
    )
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 shadow-soft">
      <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <m.icon className="size-5" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <h1 className="font-medium">{tr('Модуль «{{v1}}» выключен в этом проекте', { v1: t(m.label) })}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{m.summary}</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          {canManage
            ? tr('Включите модуль в настройках проекта — данные, внесённые раньше, сохранились и снова станут видны.')
            : tr('Включить модуль может руководитель проекта в настройках проекта.')}
        </p>
      </div>
      <div className="flex flex-wrap gap-3 text-sm font-medium">
        {canManage && (
          <Link to="/projects/$code/settings" params={{ code }} className="underline underline-offset-4">
            {tr('Открыть настройки проекта')}
          </Link>
        )}
        <Link to="/projects/$code" params={{ code }} className="underline underline-offset-4">
          {tr('К обзору проекта')}
        </Link>
      </div>
    </div>
  )
}
