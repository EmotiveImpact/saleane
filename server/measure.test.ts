// @vitest-environment node
// LOCAL-05 measurement. Skipped in `npm test`; run with
//   MEASURE=1 npx vitest run --config server/vitest.config.ts server/measure.test.ts
// It inflates a sample studio to a realistic load, then times reads, writes, availability and a
// backup/verify/restore drill on this machine. Results are printed and written to work/measure.json.
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApiHandler } from './app'
import { backupDatabase, restoreDatabase, validateDatabase } from './backup'
import type { BusinessState } from '../src/domain/model'
import { addDays } from '../src/domain/format'

const origin = 'http://127.0.0.1:5173'
const enabled = !!process.env.MEASURE
const loads = (process.env.MEASURE_LOADS ?? '5000:2000,30000:8000')
  .split(',')
  .map((pair) => pair.split(':').map(Number) as [number, number])
const directory = mkdtempSync(join(tmpdir(), 'saleane-measure-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))])
}
async function timed(runs: number, run: () => Promise<void>) {
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const started = performance.now()
    await run()
    times.push(performance.now() - started)
  }
  return { p50: percentile(times, 50), p95: percentile(times, 95), runs }
}

/** Adds clients and a year of visits around the sample date without touching the money ledger. */
function inflate(state: BusinessState, appointments: number, clients: number) {
  const base = state.appointments[0]
  for (let i = 0; i < clients; i++)
    state.clients.push({
      ...state.clients[0],
      id: `load-client-${i}`,
      name: `Load Client ${i}`,
      email: `load-${i}@example.invalid`,
    })
  for (let i = 0; i < appointments; i++) {
    const offset = (i % 425) - 365
    const staff = state.staff[i % state.staff.length]
    const service = state.services.find((s) => staff.serviceIds.includes(s.id))!
    const resource = state.resources.find((r) => r.type === service.resourceType)!
    state.appointments.push({
      ...base,
      id: `load-visit-${i}`,
      clientId: `load-client-${i % clients}`,
      serviceId: service.id,
      staffId: staff.id,
      resourceId: resource.id,
      date: addDays('2026-10-06', offset),
      startMinutes: 540 + (Math.floor(i / 425) % 16) * 30,
      status: offset < 0 ? 'completed' : 'confirmed',
      source: 'desk',
      rebookedFromId: undefined,
      bookedPriceMinor: service.priceMinor,
      bookedDepositMinor: 0,
      bookedDurationMinutes: service.durationMinutes,
      bookedBufferMinutes: service.bufferMinutes,
      bookedResourceType: service.resourceType,
      bookedServiceName: service.name,
    })
    state.events.push({
      id: `load-event-${i}`,
      organisationId: state.organisation.id,
      clientId: `load-client-${i % clients}`,
      appointmentId: `load-visit-${i}`,
      type: 'booked',
      title: 'Visit booked',
      detail: service.name,
      occurredAt: '2026-01-01T09:00:00.000Z',
      actor: 'Load fixture',
    })
  }
}

describe.skipIf(!enabled)('LOCAL-05 measured local performance and recovery', () => {
  const results: unknown[] = []
  afterAll(() => {
    mkdirSync('work', { recursive: true })
    writeFileSync('work/measure.json', JSON.stringify(results, null, 2) + '\n')
  })

  for (const [appointments, clients] of loads)
    it(`${appointments} visits and ${clients} clients`, { timeout: 600_000 }, async () => {
      const path = join(directory, `studio-${appointments}.sqlite`)
      const api = createApiHandler({ origin, databasePath: path, turnstile: null })
      const registration = await api.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          name: 'Measure Owner',
          email: `measure-${appointments}@example.invalid`,
          password: 'Fictional measure password!',
          workspace: { name: 'Measure Studio', locationName: 'London', region: 'UK', sample: true },
        },
      })
      expect(registration.statusCode, registration.body).toBe(201)
      const { csrf, orgId } = registration.json<{ csrf: string; orgId: string }>()
      const headers = {
        cookie: String(registration.headers['set-cookie']).split(';')[0],
        'x-csrf-token': csrf,
      }
      const first = await api.inject({ url: `/api/workspaces/${orgId}`, headers })
      const { state, slug } = first.json<{ state: BusinessState; slug: string }>()
      inflate(state, appointments, clients)
      state.revision += 1
      api.database.run(
        'UPDATE organisations SET state=?,revision=? WHERE id=?',
        JSON.stringify(state),
        state.revision,
        orgId,
      )
      let revision = state.revision
      const read = await timed(20, async () => {
        const response = await api.inject({ url: `/api/workspaces/${orgId}`, headers })
        expect(response.statusCode).toBe(200)
      })
      const payloadBytes = Buffer.byteLength(
        (await api.inject({ url: `/api/workspaces/${orgId}`, headers })).body,
      )
      let n = 0
      const note = await timed(20, async () => {
        const response = await api.inject({
          method: 'POST',
          url: `/api/workspaces/${orgId}/commands`,
          headers: { ...headers, 'idempotency-key': `measure-note-${appointments}-${n++}` },
          payload: {
            revision,
            command: { type: 'note', clientId: 'load-client-1', text: 'Measured note' },
          },
        })
        expect(response.statusCode, response.body).toBe(200)
        revision = response.json<{ state: BusinessState }>().state.revision
      })
      const staff = state.staff[0]
      const service = state.services.find((s) => staff.serviceIds.includes(s.id))!
      let slot = 0
      const book = await timed(10, async () => {
        const response = await api.inject({
          method: 'POST',
          url: `/api/workspaces/${orgId}/commands`,
          headers: { ...headers, 'idempotency-key': `measure-book-${appointments}-${slot}` },
          payload: {
            revision,
            command: {
              type: 'book',
              input: {
                serviceId: service.id,
                staffId: staff.id,
                date: addDays('2027-03-01', slot++),
                startMinutes: 600,
                clientId: 'load-client-2',
                source: 'desk',
              },
            },
          },
        })
        expect(response.statusCode, response.body).toBe(200)
        revision = response.json<{ state: BusinessState }>().state.revision
      })
      const availability = await timed(20, async () => {
        const response = await api.inject({
          url: `/api/public/${slug}/availability?serviceId=${service.id}&staffId=any&date=2026-10-20`,
        })
        expect(response.statusCode, response.body).toBe(200)
      })
      api.close()
      const backup = join(directory, `backup-${appointments}.sqlite`)
      const restored = join(directory, `restored-${appointments}.sqlite`)
      const clock = (run: () => void) => {
        const started = performance.now()
        run()
        return Math.round(performance.now() - started)
      }
      const drill = {
        backupMs: clock(() => backupDatabase(path, backup)),
        verifyMs: clock(() => validateDatabase(backup)),
        restoreMs: clock(() => restoreDatabase(backup, restored)),
        databaseBytes: statSync(backup).size,
      }
      const reopened = createApiHandler({ origin, databasePath: restored, turnstile: null })
      const after = reopened.database.get<{ revision: number }>(
        'SELECT revision FROM organisations WHERE id=?',
        orgId,
      )
      reopened.close()
      expect(after?.revision).toBe(revision)
      const result = {
        appointments: state.appointments.length,
        clients: state.clients.length,
        payloadBytes,
        readMs: read,
        noteCommandMs: note,
        bookCommandMs: book,
        publicAvailabilityMs: availability,
        drill,
      }
      results.push(result)
      console.log(JSON.stringify(result))
    })
})
