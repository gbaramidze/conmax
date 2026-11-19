import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Building2, Check, Copy, Mail, MessageCircle, Phone, UserRound } from 'lucide-react'
import { HoverCard } from 'radix-ui'
import { useState, type ReactNode } from 'react'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'
import { peopleDirectoryQuery, type DirectoryPerson } from '@/features/people/api'
import { UserAvatar } from '@/features/profile/avatar'
import { OUTLOOK_COMPOSE_URL, type MailAddress } from '@/features/mail/api'

/**
 * Карточка человека при наведении на имя в письме (как в Outlook, но коротко).
 * Если адрес принадлежит сотруднику или контакту в CONMAX — его аватар, должность, организация, телефон и «Написать в чат».
 * Иначе — только то, что есть в письме: имя, адрес и компания по домену, и «Написать письмо» в Outlook.
 * Ищем в справочнике людей (people_directory): видно только тех, кого вам и так разрешено видеть.
 * На телефоне наведения нет — карточка открывается по нажатию.
 */
export function PersonCard({ person, children, className }: { person: MailAddress; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <HoverCard.Root open={open} onOpenChange={setOpen} openDelay={350} closeDelay={150}>
      <HoverCard.Trigger asChild>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn('rounded text-left underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring', className)}
        >
          {children}
        </button>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-[60] w-[19rem] max-w-[calc(100vw-1rem)] rounded-xl bg-popover p-4 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          {open && <CardBody person={person} />}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  )
}

/** Человек из справочника CONMAX по адресу письма (или undefined) — для аватарки отправителя */
export function useKnownPerson(address: string | null | undefined): DirectoryPerson | undefined {
  const { data: people } = useQuery(peopleDirectoryQuery)
  const a = address?.toLowerCase()
  return a ? people?.find((p) => p.email?.toLowerCase() === a) : undefined
}

const domainOf = (address: string) => address.split('@')[1]?.toLowerCase() ?? ''

function CardBody({ person }: { person: MailAddress }) {
  const { data: people, isPending } = useQuery(peopleDirectoryQuery)
  const address = person.address.toLowerCase()
  const known: DirectoryPerson | undefined = address ? people?.find((p) => p.email?.toLowerCase() === address) : undefined
  const name = known?.full_name || person.name || person.address
  const subtitle = [known?.job_title, known?.organization_name].filter(Boolean).join(' · ')
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(person.address)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* буфер обмена недоступен — адрес и так виден */
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <UserAvatar name={name} path={known?.avatar_path} className="size-12 text-base" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold leading-tight">{name}</p>
          {subtitle ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{subtitle}</p>
          ) : (
            !isPending && domainOf(person.address) && <p className="mt-0.5 truncate text-xs text-muted-foreground">{domainOf(person.address)}</p>
          )}
        </div>
      </div>

      <ul className="flex flex-col gap-1.5 text-[13px]">
        {person.address && (
          <li className="flex items-center gap-2">
            <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <a href={`mailto:${person.address}`} className="min-w-0 flex-1 truncate text-mail-ink hover:underline">
              {person.address}
            </a>
            <button
              type="button"
              onClick={() => void copy()}
              aria-label={tr('Скопировать адрес')}
              title={tr('Скопировать адрес')}
              className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
          </li>
        )}
        {known?.phone && (
          <li className="flex items-center gap-2">
            <Phone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <a href={`tel:${known.phone.replace(/[^\d+]/g, '')}`} className="truncate hover:underline">
              {known.phone}
            </a>
          </li>
        )}
        {!known && !isPending && (
          <li className="flex items-center gap-2 text-muted-foreground">
            <Building2 className="size-4 shrink-0" aria-hidden />
            {tr('Нет в CONMAX — внешний адрес')}
          </li>
        )}
      </ul>

      <div className="flex gap-2 border-t pt-3">
        {known ? (
          <>
            <Link
              to="/chat"
              search={{ with: known.id }}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-mail px-3 text-[13px] font-semibold text-mail-foreground outline-none hover:bg-mail/90 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MessageCircle className="size-4" aria-hidden />
              {tr('Написать в чат')}
            </Link>
            <Link
              to="/people"
              search={{ q: known.email }}
              className="flex h-9 items-center justify-center gap-1.5 rounded-md border px-3 text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <UserRound className="size-4" aria-hidden />
              {tr('Профиль')}
            </Link>
          </>
        ) : (
          <a
            href={`${OUTLOOK_COMPOSE_URL}?to=${encodeURIComponent(person.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-mail px-3 text-[13px] font-semibold text-mail-foreground outline-none hover:bg-mail/90 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Mail className="size-4" aria-hidden />
            {tr('Написать письмо')}
          </a>
        )}
      </div>
    </div>
  )
}
