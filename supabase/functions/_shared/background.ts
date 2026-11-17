// Долгая работа воркера (почта, тексты документов, погода) — в фоне, ответ базе сразу.
// Зачем: pg_net отправляет запросы пачками и не берёт новые, пока не закончились все запросы пачки. Если воркер держит
// соединение 20–55 секунд, все запросы, попавшие в ту же пачку, ждут его — в том числе push-уведомления.
// Задачи из очередей забираются заранее (claim_* с блокировкой), поэтому параллельный запуск не берёт одно и то же дважды.
type Runtime = { waitUntil(p: Promise<unknown>): void }

export function inBackground(name: string, work: () => Promise<unknown>): Response {
  const task = work().then(
    (result) => console.log(`${name}: ${JSON.stringify(result)}`),
    (e) => console.error(`${name} failed`, e instanceof Error ? e.message : e),
  )
  // Edge Runtime держит воркер живым, пока фоновая задача не закончится
  ;(globalThis as { EdgeRuntime?: Runtime }).EdgeRuntime?.waitUntil(task)
  return Response.json({ accepted: true }, { status: 202 })
}
