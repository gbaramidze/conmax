-- Страница организации: реквизиты и контакты можно править из приложения, а интерфейс узнаёт, вправе ли пользователь это делать.
--
-- Организация уже есть в справочнике (название, краткое название, ИНН/налоговый номер, вид, контакты, активна). Здесь:
--  • `my_tenant_permissions()` — какие административные права компании у меня есть (для показа кнопки «Изменить»);
--  • `organization_update(...)` — правка с проверкой: право `admin.reference_data`, длины, вид, ключи контактов.
-- Контакты — словарь из ключей phone, email, website, address, note (каждое значение до 300 знаков); другие ключи отвергаются.
-- Видимость по-прежнему решает RLS: внутренний сотрудник видит все организации компании, внешний — свою и «нашу».
-- См. docs: 05-roadmap/05-backlog.md, раздел «Страница организации».

create or replace function public.my_tenant_permissions() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct rp.permission order by rp.permission), '{}')
    from public.user_tenant_roles utr
    join public.role_permissions rp on rp.role_id = utr.role_id
   where utr.user_id = auth.uid() and utr.tenant_id = private.tenant_id() and rp.permission like 'admin.%';
$$;

create or replace function public.organization_update(
  p_org uuid, p_name text, p_short_name text, p_tax_id text, p_kind text, p_contacts jsonb, p_is_active boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_short text := nullif(btrim(coalesce(p_short_name, '')), '');
  v_tax   text := nullif(btrim(coalesce(p_tax_id, '')), '');
  k       text;
  v       jsonb;
  c       jsonb := '{}'::jsonb;
begin
  if not private.has_tenant_permission('admin.reference_data') then
    raise exception 'permission denied: admin.reference_data' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations where id = p_org and tenant_id = private.tenant_id() and deleted_at is null) then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;
  if char_length(v_name) not between 1 and 200 or char_length(coalesce(v_short, '')) > 60 or char_length(coalesce(v_tax, '')) > 40
     or p_kind not in ('own', 'subcontractor', 'supplier', 'client', 'designer', 'supervision', 'other') then
    raise exception 'organization_invalid' using errcode = '22023';
  end if;
  if p_contacts is null or jsonb_typeof(p_contacts) <> 'object' then
    raise exception 'organization_invalid' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p_contacts) loop
    if k not in ('phone', 'email', 'website', 'address', 'note') or jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 300 then
      raise exception 'organization_invalid' using errcode = '22023';
    end if;
    if btrim(v #>> '{}') <> '' then c := c || jsonb_build_object(k, btrim(v #>> '{}')); end if;
  end loop;
  update public.organizations
     set name = v_name, short_name = v_short, tax_id = v_tax, kind = p_kind, contacts = c, is_active = coalesce(p_is_active, true)
   where id = p_org;
end;
$$;

revoke execute on function public.my_tenant_permissions(), public.organization_update(uuid, text, text, text, text, jsonb, boolean) from public, anon;
grant execute on function public.my_tenant_permissions(), public.organization_update(uuid, text, text, text, text, jsonb, boolean) to authenticated;
notify pgrst, 'reload schema';
