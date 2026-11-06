-- Типы объектов: добавлены гостиница, офисное здание, многофункциональный комплекс и общественное здание.
alter table public.projects drop constraint projects_kind_check;
alter table public.projects add constraint projects_kind_check
  check (kind in ('residential','commercial','hotel','office','mixed','public','industrial','renovation','design_only'));
