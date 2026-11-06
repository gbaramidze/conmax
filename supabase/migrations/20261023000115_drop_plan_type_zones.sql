-- Зоны типов номеров на планах этажей (миграция 114) убраны: тип номера задаётся у обычной зоны помещения (карточка зоны → «Тип номера»),
-- отдельная система зон не нужна. Таблица и функции удаляются; зоны помещений (`plan_zones`) не затрагиваются.
drop function if exists public.plan_type_zones(uuid);
drop function if exists public.plan_type_zone_delete(uuid);
drop function if exists public.plan_type_zone_set(uuid, uuid, integer, uuid, jsonb, uuid);
drop table if exists public.plan_type_zones;
notify pgrst, 'reload schema';
