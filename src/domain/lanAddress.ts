/**
 * Stage 2: where a receipt printer may be. SALEANE's server runs on the studio's own computer and
 * reaches a receipt printer over the studio's network, so an address must be on that network:
 * 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 and link-local 169.254.0.0/16, or IPv6 unique-local
 * (fc00::/7) and link-local (fe80::/10). Never the internet, never this computer itself (loopback),
 * and never an address written in an unusual way (a single decimal number, hex or octal parts, or
 * fewer than four parts), which some systems read as a different address from the one it seems.
 *
 * Pure, so the settings screen, the studio record and the server all apply the same rule. The
 * server checks again when it connects, after looking a printer's name up, and connects to the
 * address it checked.
 */

/** Receipt printers take raw print jobs on port 9100; some offer a second or third port beside it. */
export const PRINTER_PORT = 9100
export const PRINTER_PORT_LAST = 9109

/** The four parts of a dotted IPv4 address written the usual way, or null. */
export function parseIPv4(text: string): number[] | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  const bytes: number[] = []
  for (const part of parts) {
    // No leading zeros: "010" is octal to some systems and decimal to others.
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null
    const value = Number(part)
    if (value > 255) return null
    bytes.push(value)
  }
  return bytes
}

/** The eight 16-bit groups of an IPv6 address, with any zone ("%en0"), or null. */
export function parseIPv6(text: string): { groups: number[]; zone?: string } | null {
  let address = text
  let zone: string | undefined
  const percent = text.indexOf('%')
  if (percent >= 0) {
    zone = text.slice(percent + 1)
    address = text.slice(0, percent)
    if (!/^[A-Za-z0-9_.-]{1,32}$/.test(zone)) return null
  }
  // An IPv4 address may end an IPv6 one (::ffff:192.168.1.5).
  if (address.includes('.')) {
    const last = address.lastIndexOf(':')
    const tail = parseIPv4(address.slice(last + 1))
    if (last < 0 || !tail) return null
    address = `${address.slice(0, last + 1)}${((tail[0] << 8) | tail[1]).toString(16)}:${((tail[2] << 8) | tail[3]).toString(16)}`
  }
  if (!/^[0-9a-f:]+$/i.test(address)) return null
  const halves = address.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  const groups = [...left, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...right]
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null
  return { groups: groups.map((group) => parseInt(group, 16)), ...(zone ? { zone } : {}) }
}

function lanIPv4([a, b]: number[]) {
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  )
}

/** Whether an address is on the studio's own network (and not this computer or the internet). */
export function lanAddress(address: string): boolean {
  const v4 = parseIPv4(address)
  if (v4) return lanIPv4(v4)
  const v6 = parseIPv6(address)
  if (!v6) return false
  const g = v6.groups
  const linkLocal = (g[0] & 0xffc0) === 0xfe80
  // A zone only makes sense for a link-local address.
  if (v6.zone && !linkLocal) return false
  // An IPv4 address carried in IPv6 (::ffff:a.b.c.d) is judged as itself.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff)
    return lanIPv4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255])
  return linkLocal || (g[0] & 0xfe00) === 0xfc00
}

const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i

/** The address as typed, without spaces or the brackets IPv6 is sometimes written in. */
export function printerHost(raw: string) {
  return raw.trim().replace(/^\[(.*)\]$/, '$1')
}

/**
 * Why a printer address cannot be saved, or null. A name ("receipts.local") is allowed here; the
 * server looks it up when it connects and refuses it if it leads anywhere but the studio's network.
 */
export function printerHostProblem(raw: string): string | null {
  const host = printerHost(raw)
  if (!host) return 'Enter the printer’s address on your network, such as 192.168.1.50.'
  if (parseIPv4(host) || parseIPv6(host))
    return lanAddress(host)
      ? null
      : 'SALEANE only connects to a printer on your own network, such as 192.168.1.50.'
  // Numbers and dots alone, hex parts, colons or a name ending in a number (no real name does):
  // an address written in an unusual way.
  if (
    /^[0-9.]+$/.test(host) ||
    host.includes(':') ||
    host.split('.').some((label) => /^0x/i.test(label)) ||
    /(^|\.)\d+\.?$/.test(host)
  )
    return 'Write the printer’s address the usual way, with four numbers, such as 192.168.1.50.'
  if (!HOSTNAME.test(host))
    return 'Enter an address such as 192.168.1.50, or the printer’s name on your network.'
  const lower = host.toLowerCase()
  if (lower === 'localhost' || lower.endsWith('.localhost'))
    return 'That is this computer, not a printer. Enter the printer’s own address.'
  return null
}

/** Why a printer port cannot be used, or null. */
export function printerPortProblem(port: number): string | null {
  return Number.isInteger(port) && port >= PRINTER_PORT && port <= PRINTER_PORT_LAST
    ? null
    : `Receipt printers take print jobs on port ${PRINTER_PORT}. Use a port from ${PRINTER_PORT} to ${PRINTER_PORT_LAST}.`
}
