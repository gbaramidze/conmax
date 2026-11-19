-- Приглашения на личное событие обычным письмом: участники хранятся в событии, приглашение (iCalendar) уходит
-- с почты владельца через Outlook (право Mail.Send), без доступа к календарю Outlook. Номер версии приглашения растёт
-- при каждом изменении — так у участников обновляется уже принятая встреча, а отмена её убирает.

alter table public.personal_items
  add column attendees  jsonb not null default '[]'
    check (jsonb_typeof(attendees) = 'array' and jsonb_array_length(attendees) <= 100),
  add column invite_seq integer not null default 0 check (invite_seq >= 0),
  add column invited_at timestamptz;

grant insert (attendees, invite_seq, invited_at) on public.personal_items to authenticated;
grant update (attendees, invite_seq, invited_at) on public.personal_items to authenticated;
