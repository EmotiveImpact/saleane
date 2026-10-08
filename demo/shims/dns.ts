// Browser stand-in for node:dns and node:dns/promises. The demo never looks up a name; every
// connection stays in test mode, so a lookup is reported as unreachable.
const unreachable = () =>
  Object.assign(new Error('Names are not looked up in the demo.'), { code: 'ENOTFOUND' })

export async function lookup(): Promise<never> {
  throw unreachable()
}
export default { lookup }
