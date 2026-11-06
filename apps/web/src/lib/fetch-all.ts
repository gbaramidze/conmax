/**
 * Читает таблицу страницами: сервер отдаёт не больше 1000 строк за запрос (max_rows), поэтому длинные списки
 * (помещения, мебель по номерам) нужно докачивать. `page(from, to)` — запрос с `.range(from, to)`.
 */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>, size = 1000, max = 100_000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += size) {
    const { data, error } = await page(from, from + size - 1)
    if (error) throw error
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < size) break
  }
  return out
}
