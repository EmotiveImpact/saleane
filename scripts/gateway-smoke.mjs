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
// To check the saved diary as well, which a full pass needs, also set SALEANE_ORG (the studio's
// id) and SALEANE_OWNER_SESSION (an owner's session cookie value, kept out of logs), and
// SALEANE_LOCATION when the visit belongs at a location other than the studio's main one.
// Exit codes: 0 every check passed; 1 a check failed; 3 booked and retried correctly, but the
// diary was not read, so the run is incomplete.
//
// Steps: 1 choose the studio for a fictional guest; 2 find the first free time for the first
// treatment; 3 book it with guest_confirmed; then read-only checks that asking again returns the
// same visit (the retry case) and that a made-up location is refused.
const base = process.env.SALEANE_URL ?? 'https://saleane-app.vercel.app'
const key = process.env.SALEANE_GATEWAY_KEY ?? ''
const line = process.env.SALEANE_LINE ?? ''
const studio = process.env.SALEANE_STUDIO ?? ''
const customer = process.env.SALEANE_CUSTOMER ?? '+44 7700 900777'
const org = process.env.SALEANE_ORG ?? ''
const session = process.env.SALEANE_OWNER_SESSION ?? ''
const failures = []
const check = (ok, words) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${words}`)
  if (!ok) failures.push(words)
}
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
const reference = booked.structuredContent?.visit?.reference
check(!booked.isError && !!reference, 'the confirmed message booked a visit with a reference')
const again = await call('book_time', asked)
say('the same booking again', again)
const retried = again.structuredContent?.visit?.reference
check(!again.isError && retried === reference, 'the retry returned the same visit reference')
const elsewhere = await call('find_free_times', {
  treatment_id: treatment.id,
  location_id: 'made-up',
})
say('a made-up location', elsewhere)
check(!!elsewhere.isError, 'a made-up location was refused')
let diary = 'not read'
if (org && session) {
  const response = await fetch(`${base}/api/workspaces/${encodeURIComponent(org)}`, {
    headers: { cookie: `saleane_session=${session}` },
  })
  check(response.ok, `the saved diary was read afresh (${response.status})`)
  const state = response.ok ? (await response.json()).state : null
  if (state) {
    const matching = state.appointments.filter(
      (a) => a.date === day.date && a.serviceId === treatment.id && a.channel !== undefined,
    )
    const found = state.appointments.filter((a) => a.id === reference)
    const where = process.env.SALEANE_LOCATION || state.organisation.locationId
    check(found.length === 1, 'the saved diary holds the booked visit exactly once')
    check(
      matching.filter((a) => a.id !== reference && a.startMinutes === found[0]?.startMinutes)
        .length === 0,
      'no second visit was saved for the same treatment and time',
    )
    check(found[0]?.locationId === where, 'the visit is at the intended location')
    check(found[0]?.status === 'confirmed', 'the visit is confirmed')
    diary = 'read'
  }
}
console.log(
  JSON.stringify({
    reference: reference ?? null,
    retrySameReference: retried === reference,
    madeUpLocationRefused: !!elsewhere.isError,
    diary,
    failures,
  }),
)
if (failures.length) process.exit(1)
if (diary !== 'read') {
  console.log('INCOMPLETE the saved diary was not read. Set SALEANE_ORG and SALEANE_OWNER_SESSION.')
  process.exit(3)
}
