/* global console, process, fetch */
// A smoke test of bookings by message, for the private runner (Maritime) or a computer.
// It makes at most three requests that change anything and uses fictional guests only.
// Run only with the owner's go-ahead. Nothing here is a secret: the key comes from the
// environment and is never printed.
//
//   SALEANE_URL=https://saleane-app.vercel.app \
//   SALEANE_GATEWAY_KEY=… SALEANE_LINE=keiki:imessage:<route> SALEANE_STUDIO=<booking page name> \
//   node scripts/gateway-smoke.mjs
//
// Steps: 1 choose the studio for a fictional guest; 2 find the first free time for the first
// treatment; 3 book it with guest_confirmed; then read-only checks that asking again returns the
// same visit (the retry case) and that a made-up location is refused.
const base = process.env.SALEANE_URL ?? 'https://saleane-app.vercel.app'
const key = process.env.SALEANE_GATEWAY_KEY ?? ''
const line = process.env.SALEANE_LINE ?? ''
const studio = process.env.SALEANE_STUDIO ?? ''
const customer = process.env.SALEANE_CUSTOMER ?? '+44 7700 900777'
if (key.length < 32 || !line || !studio) {
  console.error('Set SALEANE_GATEWAY_KEY, SALEANE_LINE and SALEANE_STUDIO.')
  process.exit(2)
}
let id = 0
async function call(name, args) {
  const response = await fetch(`${base}/api/gateway/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
      'saleane-line': line,
      'saleane-customer': customer,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++id,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.error)
    throw new Error(`${name}: ${response.status} ${body.error?.message ?? ''}`)
  return body.result
}
const say = (step, result) =>
  console.log(
    `${result.isError ? 'REFUSED' : 'OK'} ${step}: ${result.content?.[0]?.text?.split('\n')[0] ?? ''}`,
  )

say('choose the studio', await call('choose_studio', { booking_page: studio }))
const treatments = await call('list_treatments', {})
const treatment = treatments.structuredContent?.treatments?.[0]
if (!treatment) throw new Error('The studio has no treatment that can be booked by message.')
const free = await call('find_free_times', { treatment_id: treatment.id })
const day = free.structuredContent?.days?.find((d) => d.times.length)
if (!day) throw new Error('No free time in the next week.')
const asked = {
  treatment_id: treatment.id,
  date: day.date,
  start: day.times[0],
  guest_name: 'Smoke Test Fictional',
  guest_email: 'smoke-test@example.com',
  guest_confirmed: true,
}
const booked = await call('book_time', asked)
say(`book ${treatment.name} on ${day.date} at ${day.times[0]}`, booked)
const again = await call('book_time', asked)
say('the same booking again returns the same visit', again)
const elsewhere = await call('find_free_times', {
  treatment_id: treatment.id,
  location_id: 'made-up',
})
say('a made-up location is refused', elsewhere)
console.log(
  JSON.stringify({
    booked: booked.structuredContent?.visit ?? null,
    retryAnswered: !again.isError,
    madeUpLocationRefused: !!elsewhere.isError,
    check: "In the studio's calendar there must be exactly one visit for Smoke Test Fictional.",
  }),
)
