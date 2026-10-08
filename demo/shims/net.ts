// Browser stand-in for node:net: just enough to check an address against private ranges, so the demo
// refuses the same connection addresses the real server would.
function ipv4(address: string): bigint | undefined {
  const parts = address.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255))
    return undefined
  return parts.reduce((value, part) => (value << 8n) | BigInt(part), 0n)
}

function ipv6(address: string): bigint | undefined {
  if (!/^[\da-f:]+$/i.test(address) || address.split('::').length > 2) return undefined
  const [head, tail] = address.includes('::') ? address.split('::') : [address, undefined]
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const missing = 8 - left.length - right.length
  if (tail === undefined ? missing !== 0 : missing < 1) return undefined
  const groups = [...left, ...Array<string>(missing).fill('0'), ...right]
  if (groups.some((group) => !/^[\da-f]{1,4}$/i.test(group))) return undefined
  return groups.reduce((value, group) => (value << 16n) | BigInt(parseInt(group, 16)), 0n)
}

export function isIP(address: string): 0 | 4 | 6 {
  if (ipv4(address) !== undefined) return 4
  if (ipv6(address) !== undefined) return 6
  return 0
}

type Family = 'ipv4' | 'ipv6'

export class BlockList {
  private subnets: { family: Family; network: bigint; bits: number }[] = []

  addSubnet(network: string, bits: number, family: Family = 'ipv4') {
    const value = family === 'ipv4' ? ipv4(network) : ipv6(network)
    if (value === undefined) throw new TypeError(`Invalid ${family} address: ${network}`)
    this.subnets.push({ family, network: value, bits })
  }

  check(address: string, family: Family = 'ipv4') {
    const value = family === 'ipv4' ? ipv4(address) : ipv6(address)
    if (value === undefined) return false
    const width = family === 'ipv4' ? 32n : 128n
    return this.subnets.some((subnet) => {
      if (subnet.family !== family) return false
      const shift = width - BigInt(subnet.bits)
      return value >> shift === subnet.network >> shift
    })
  }
}
