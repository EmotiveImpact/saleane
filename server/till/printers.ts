import { createConnection, isIP } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'
import {
  lanAddress,
  printerHost,
  printerHostProblem,
  printerPortProblem,
} from '../../src/domain/lanAddress'

/**
 * Stage 2: how a print job reaches a receipt printer, behind one small interface so the test
 * printer and a real one are swapped without the rest of SALEANE knowing, as with messages and
 * card payments.
 *
 * The network printer speaks raw TCP (port 9100) from SALEANE's server on the studio's computer.
 * It connects only to an address on the studio's own network, looks a printer's name up first and
 * refuses it if any answer leads elsewhere, then connects to the address it checked, so a name
 * cannot change its answer in between. A short timeout means a switched-off printer never holds
 * up the till.
 */
export type PrintJob = { host: string; port: number; bytes: Uint8Array }
export type PrintOutcome = { ok: true } | { ok: false; detail: string }
export type PrinterTransport = {
  name: 'network' | 'test'
  send: (job: PrintJob) => Promise<PrintOutcome>
}

type Lookup = (host: string) => Promise<{ address: string }[]>
const systemLookup: Lookup = (host) => dnsLookup(host, { all: true, verbatim: true })

function failure(error: unknown, host: string) {
  const code = (error as { code?: string })?.code
  if (code === 'ECONNREFUSED')
    return `The printer at ${host} refused the connection. Check it is switched on and its address and port are right.`
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH')
    return `SALEANE could not reach ${host} from this computer. Check both are on the studio’s network.`
  return `The printer at ${host} could not be reached.`
}

export function networkPrinter(
  options: {
    timeoutMs?: number
    lookup?: Lookup
    /** Which resolved addresses may be connected to. Tests add this computer; nothing else should. */
    allow?: (address: string) => boolean
  } = {},
): PrinterTransport {
  const timeoutMs = options.timeoutMs ?? 3000
  const lookup = options.lookup ?? systemLookup
  const allow = options.allow ?? lanAddress
  const seconds = Math.round(timeoutMs / 1000)
  return {
    name: 'network',
    async send(job) {
      const host = printerHost(job.host)
      const port = printerPortProblem(job.port)
      if (port) return { ok: false, detail: port }
      let addresses: string[]
      if (isIP(host)) addresses = [host]
      else {
        // An address written in an unusual way, or this computer by name, is never looked up.
        const refused = printerHostProblem(host)
        if (refused) return { ok: false, detail: refused }
        try {
          const found = await Promise.race([
            lookup(host),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), timeoutMs).unref?.(),
            ),
          ])
          addresses = found.map((a) => a.address)
        } catch {
          addresses = []
        }
        if (!addresses.length)
          return {
            ok: false,
            detail: `SALEANE could not find a printer called ${host} on the studio’s network.`,
          }
      }
      if (addresses.some((address) => !allow(address)))
        return {
          ok: false,
          detail: isIP(host)
            ? (printerHostProblem(host) ??
              'SALEANE only connects to a printer on your own network.')
            : `${host} leads outside the studio’s network, so SALEANE did not connect to it.`,
        }
      const address = addresses[0]
      return new Promise<PrintOutcome>((resolve) => {
        let settled = false
        const socket = createConnection({ host: address, port: job.port })
        const done = (outcome: PrintOutcome) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          socket.destroy()
          resolve(outcome)
        }
        const timer = setTimeout(
          () =>
            done({
              ok: false,
              detail: `The printer at ${host} did not answer within ${seconds} seconds. Check it is switched on.`,
            }),
          timeoutMs,
        )
        timer.unref?.()
        socket.on('connect', () => socket.end(job.bytes))
        // Every byte is handed to the network: the printer has it. Whether paper came out, or the
        // drawer opened, only someone at the till can see.
        socket.on('finish', () => done({ ok: true }))
        socket.on('error', (error) => done({ ok: false, detail: failure(error, host) }))
      })
    },
  }
}

/**
 * The test printer: keeps each job so it can be shown, and sends nothing anywhere. It never says
 * anything was printed or that a drawer opened.
 */
export function testPrinter(): PrinterTransport & { jobs: PrintJob[] } {
  const jobs: PrintJob[] = []
  return {
    name: 'test',
    jobs,
    async send(job) {
      jobs.push(job)
      return { ok: true }
    },
  }
}
