/* global URLSearchParams, location, document, history, window */
const params = new URLSearchParams(location.search)
let direction = ['quiet-luxury', 'modern-editorial', 'after-dark'].includes(params.get('direction'))
  ? params.get('direction')
  : 'quiet-luxury'
let screen = ['today', 'calendar', 'client', 'checkout', 'intelligence'].includes(
  params.get('screen'),
)
  ? params.get('screen')
  : 'today'
let market = params.get('market') === 'US' ? 'US' : 'UK'
let guestConfirmed = false
let rebookTime = '09:00'
let tip = 0,
  paid = false,
  rebooked = false,
  hiddenCompleted = false
const main = document.querySelector('main')
const dialog = document.querySelector('dialog')
const labels = {
  today: 'Today',
  calendar: 'Calendar',
  client: 'Clients',
  checkout: 'Checkout',
  intelligence: 'Business',
}
const descriptions = {
  'quiet-luxury': 'A · Quiet Luxury · Warmth held within a substantial operating structure.',
  'modern-editorial':
    'B · Modern Editorial · Clear type, compact rhythm and institutional confidence.',
  'after-dark': 'C · After Dark · A guest-facing expression; not the primary operator UI.',
}
const visits = [
  ['09:00', 'Olivia James', 'Lymphatic Massage', 'Sophia', 'Completed', 120, 'OJ', 'blue'],
  ['09:00', 'Ellie Brooks', 'Signature Cut & Finish', 'Theo', 'Completed', 75, 'EB', 'sand'],
  ['09:30', 'Amelia Carter', 'Skin Renewal Facial', 'Maya', 'Arrived', 95, 'AC', ''],
  ['11:00', 'Noor Ahmed', 'Skin Renewal Facial', 'Maya', 'Upcoming', 95, 'NA', ''],
  ['11:00', 'Ava Williams', 'Lymphatic Massage', 'Sophia', 'Upcoming', 120, 'AW', 'blue'],
  ['11:00', 'Grace Chen', 'Signature Cut & Finish', 'Theo', 'Upcoming', 75, 'GC', 'sand'],
  ['13:30', 'Zoe Miller', 'Skin Renewal Facial', 'Maya', 'Upcoming', 95, 'ZM', ''],
  ['14:00', 'Nina Patel', 'Deep Restore Massage', 'Sophia', 'Upcoming', 90, 'NP', 'blue'],
  ['15:00', 'Ruby Taylor', 'Deep Restore Massage', 'Maya', 'Upcoming', 90, 'RT', ''],
  ['16:00', 'Isabel Wilson', 'Skin Renewal Facial', 'Sophia', 'Upcoming', 95, 'IW', 'blue'],
  ['16:00', 'Sophie Martin', 'Signature Cut & Finish', 'Theo', 'Upcoming', 75, 'SM', 'sand'],
  ['14:00', 'Luca Evans', 'Signature Cut & Finish', 'Theo', 'Upcoming', 75, 'LE', 'sand'],
]
visits.sort((a, b) => a[0].localeCompare(b[0]))
function money(value) {
  return new Intl.NumberFormat(market === 'UK' ? 'en-GB' : 'en-US', {
    style: 'currency',
    currency: market === 'UK' ? 'GBP' : 'USD',
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value)
}
function servicePrice() {
  return market === 'UK' ? 95 : 125
}
function valueFor(value) {
  return market === 'UK' ? value : Math.round((value * 1.3) / 5) * 5
}
function time(value) {
  if (market === 'UK') return value
  const [h, m] = value.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
function heading(title, subtitle, action, callback, date = 'Tuesday 6 October') {
  return `<div class="page-heading"><div><span class="date">${market === 'UK' ? date : date.replace('6 October', 'October 6')}</span><h1>${title}</h1><p>${subtitle}</p></div>${action ? `<button class="primary" data-action="${callback}">${action}</button>` : ''}</div>`
}
function metric(label, value, detail) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong><small>${detail}</small></div>`
}
function todayMetrics() {
  return `<div class="metrics">${metric('Booked for today', money(visits.reduce((total, visit) => total + valueFor(visit[5]), 0)), 'Service value, before tips')}${metric('Appointments', '12', `${paid ? '3' : '2'} complete · ${paid ? '9' : '10'} still to come`)}${metric('Time well filled', '46%', 'Of professional hours')}${metric('Ready to return', '3', 'With no next visit')}</div>`
}
function visitRows() {
  return visits
    .filter((v) => !hiddenCompleted || v[4] !== 'Completed')
    .map(
      (v) =>
        `<button class="visit" data-visit="${v[1]}"><span class="visit-time">${time(v[0])}<small>${v[2].includes('Lymphatic') ? '75' : '60'} min</small></span><span class="person"><span class="avatar ${v[7]}">${v[6]}</span><span><strong>${v[1]}</strong><small>${v[2]}</small></span></span><span class="professional">${v[3]}</span><span class="status ${v[4] === 'Arrived' ? 'arrived' : ''}">${v[1] === 'Amelia Carter' && paid ? 'Completed' : v[4]}</span><span class="visit-value">${money(valueFor(v[5]))}</span></button>`,
    )
    .join('')
}
function agenda() {
  return `<section class="panel"><div class="panel-head"><div><h2>The day ahead</h2><p>A welcome, a little care, a reason to come back.</p></div><button class="text-button" data-screen="calendar">Open calendar</button></div><div class="panel-strip"><span>${paid ? '0' : '1'} in the studio</span><label><input type="checkbox" id="hide-completed" ${hiddenCompleted ? 'checked' : ''}> Hide completed</label></div><div class="table-head"><span>Time</span><span>Client & service</span><span class="professional">Professional</span><span>Status</span><span>Value</span></div>${visitRows()}</section>`
}
function support() {
  return `<aside class="support"><section class="notice"><div class="notice-label"><span aria-hidden="true">◌</span> Saleane noticed</div><h2>Make room for a familiar face.</h2><p>Three clients last visited at least four weeks ago and haven’t booked their next visit.</p><div class="next-slot"><span>Tomorrow with Maya</span><strong>${time('09:00')} available</strong><small>Skin Renewal Facial · 60 minutes</small></div><button data-action="return">Review a return visit</button><p class="evidence">Based on visit history and available time. No message has been sent.</p></section><section class="team"><h2>Your people today</h2>${[
    ['ML', 'Maya', '44', ''],
    ['SR', 'Sophia', '50', 'blue'],
    ['TB', 'Theo', '44', 'sand'],
  ]
    .map(
      (t) =>
        `<div class="team-row"><span class="avatar ${t[3]}">${t[0]}</span><div class="team-detail"><div><strong>${t[1]}</strong><small>4 visits · ${t[2]}%</small></div><div class="meter"><i style="width:${t[2]}%"></i></div></div></div>`,
    )
    .join('')}</section></aside>`
}
function today() {
  return (
    heading(
      'Good morning, Maya.',
      'Everything you need to give today your best.',
      '+ New appointment',
      'new',
    ) +
    todayMetrics() +
    `<div class="today-grid">${agenda()}${support()}</div>`
  )
}
function client() {
  return (
    heading(
      'The whole relationship.',
      'Preferences, people and visits, kept together.',
      'Book Amelia',
      'rebook',
      'Client relationship',
    ) +
    `<div class="profile-grid"><aside class="panel profile-summary"><span class="avatar profile-avatar">AC</span><h2>Amelia Carter</h2><p>With Atelier House since June 2025</p><div class="profile-stats"><div><strong>14</strong><span>Completed visits</span></div><div><strong>${money(valueFor(1320))}</strong><span>Service spend</span></div></div><div class="preference"><strong>A little thing to remember</strong>Prefers a quiet appointment and a morning with Maya.</div><p class="info-label">Familiar professional</p><div class="person"><span class="avatar">ML</span><span><strong>Maya Lewis</strong><small>11 visits together</small></span></div><p class="info-label">Connected through</p><div class="person"><span class="avatar sand">EB</span><span><strong>Ellie Brooks</strong><small>Referred Amelia in June 2025</small></span></div></aside><section class="panel"><div class="panel-head"><div><h2>Amelia’s timeline</h2><p>The details that make the next visit better.</p></div></div><div class="upcoming"><span>${paid ? 'Today’s visit completed' : 'In the studio now'}</span><strong>Skin Renewal Facial</strong><p>Today, ${time('09:30')} · Maya · Treatment room 1</p><button class="primary" data-screen="checkout">${paid ? 'View receipt' : 'Continue to checkout'}</button></div><div class="timeline">${rebooked ? `<article class="event"><div class="event-date"><strong>Next visit</strong>3 November</div><div class="event-content"><h3>A place for the next visit</h3><p>Skin Renewal Facial with Maya at ${time(rebookTime)}. Linked to today’s appointment.</p></div></article>` : ''}<article class="event"><div class="event-date"><strong>8 Sep</strong>2026</div><div class="event-content"><h3>Skin Renewal Facial</h3><p>With Maya · ${money(servicePrice())} paid · Rebooked for today</p><button class="secondary" data-action="historic-receipt">View receipt</button></div></article><article class="event"><div class="event-date"><strong>11 Aug</strong>2026</div><div class="event-content"><h3>Morning appointments work best</h3><p>Maya added a preference: prefers a quiet appointment and an early start.</p></div></article><article class="event"><div class="event-date"><strong>11 Aug</strong>2026</div><div class="event-content"><h3>Skin Renewal Facial</h3><p>With Maya · ${money(servicePrice())} paid</p></div></article><article class="event"><div class="event-date"><strong>17 Jun</strong>2025</div><div class="event-content"><h3>A relationship began</h3><p>Amelia was introduced by Ellie Brooks. First appointment booked with Maya.</p></div></article></div></section></div>`
  )
}
function checkout() {
  const price = servicePrice(),
    tipValue = (price * tip) / 100
  return (
    heading(
      paid ? 'A good finish. A next beginning.' : 'Finish the visit with care.',
      'Amelia Carter · Skin Renewal Facial with Maya',
      'View relationship',
      'client',
      'Today, ' + time('09:30'),
    ) +
    `<div class="checkout-grid"><section class="panel checkout-main">${paid ? `<div class="success" role="status"><h2>Visit completed</h2><p>A simulated payment of ${money(price + tipValue - 25)} has been recorded in this study.</p></div>` : ''}<div class="checkout-client"><span class="avatar profile-avatar">AC</span><div><h2>Amelia Carter</h2><p>14 visits · Usually returns every four weeks</p></div></div><div class="line-item"><div><h3>Skin Renewal Facial</h3><p>Maya Lewis · 60 minutes</p></div><strong>${money(price)}</strong></div><div class="tip-section"><h3>A thank you for Maya</h3><p>Optional. The client can choose the amount.</p><div class="tip-options">${[0, 10, 15, 20].map((t) => `<button data-tip="${t}" aria-pressed="${tip === t}" ${paid ? 'disabled' : ''}>${t === 0 ? 'No tip' : t + '%'}</button>`).join('')}</div></div>${paid ? `<div class="line-item"><div><h3>${rebooked ? 'Amelia’s next visit is in place.' : 'Make space for the next visit.'}</h3><p>${rebooked ? '3 November · ' + time(rebookTime) + ' · Maya' : 'Same service. A familiar professional.'}</p></div></div><button class="primary" style="margin-top:20px;width:100%" data-action="rebook">${rebooked ? 'Review next visit' : 'Rebook Amelia'}</button>` : ''}</section><aside class="panel settlement"><h2>${paid ? 'Receipt summary' : 'Settle the visit'}</h2><div class="amount-line"><span>Service</span><strong>${money(price)}</strong></div><div class="amount-line"><span>Gratuity</span><strong>${money(tipValue)}</strong></div><div class="amount-line"><span>Deposit<small>Already paid at booking</small></span><strong>−${money(25)}</strong></div><div class="balance"><span>${paid ? 'Balance paid' : 'Remaining to pay'}</span><strong>${money(price + tipValue - 25)}</strong></div>${paid ? '<button class="secondary" data-screen="intelligence">See business intelligence</button>' : '<button class="primary" data-action="pay">Record simulated payment</button>'}<p>Design study only. No money is taken. Tax treatment is outside this visual comparison.</p></aside></div>`
  )
}
function calendar() {
  return (
    heading(
      'A place for every promise.',
      'People, rooms and time held together.',
      '+ New appointment',
      'new',
    ) +
    `<section class="panel"><div class="panel-head"><div><h2>Tuesday’s appointments</h2><p>Three professionals · Treatment rooms 1 and 2 · Styling chair</p></div></div><div class="calendar-lanes">${[
      'Maya',
      'Sophia',
      'Theo',
    ]
      .map(
        (name) =>
          `<section class="lane"><h3>${name}</h3>${visits
            .filter((v) => v[3] === name)
            .map(
              (v) =>
                `<button class="calendar-visit" data-visit="${v[1]}"><span>${time(v[0])} · ${v[4]}</span><strong>${v[1]}</strong><small>${v[2]}</small><small>${name === 'Theo' ? 'Styling chair' : 'Treatment room ' + (name === 'Maya' ? '1' : '2')}</small></button>`,
            )
            .join('')}</section>`,
      )
      .join('')}</div></section>`
  )
}
function intelligence() {
  return (
    heading(
      'Know what is moving.',
      'A clear view of the relationships behind your numbers.',
      null,
      null,
      '9 September – 6 October',
    ) +
    `<div class="metrics">${metric('Service revenue', money(valueFor(18240)), 'Completed services, before tips')}${metric('Completed visits', '192', 'Across three professionals')}${metric('Rebooked', '68%', 'Completed visits with a next visit')}${metric('Returning clients', '82%', 'Of clients who visited')}</div><div class="today-grid"><section class="panel"><div class="panel-head"><div><h2>Revenue follows the relationship</h2><p>Completed service value, by week</p></div></div><div class="chart" role="img" aria-label="Illustrative weekly service revenue: ${[3800, 4200, 4800, 5440].map((v) => money(valueFor(v))).join(', ')}.">${[3800, 4200, 4800, 5440].map((v, i) => `<div class="chart-column"><strong>${money(valueFor(v))}</strong><i style="height:${v / 65}%"></i><span>Week ${i + 1}</span></div>`).join('')}</div><div class="definitions"><p><strong>What changed?</strong> More completed visits, with a consistent rebooking rhythm. Review the source appointments before deciding what to do next.</p><p>These figures are a controlled visual fixture. They are not a live business report.</p></div></section>${support()}</div>`
  )
}
function guest() {
  return `<div class="guest-brand"><span class="guest-monogram">AH</span><div><strong>Atelier House</strong><span>${market === 'UK' ? 'Marylebone, London' : 'SoHo, New York'}</span></div><span class="guest-attribution">With SALEANE</span></div><div class="guest-layout"><section class="guest-introduction"><span class="date">A little time, entirely yours.</span><h1>${guestConfirmed ? 'We will keep a place for you.' : 'Feel like yourself again.'}</h1><p>Considered treatments. Familiar hands. A quieter part of your day.</p><div class="guest-art" aria-hidden="true"><span class="arch arch-one"></span><span class="arch arch-two"></span><span class="art-word">Atelier<br>House.</span><span class="art-foot">Care, with continuity.</span></div><p class="guest-footnote">A proposed guest expression of SALEANE. The business keeps its own identity.</p></section><section class="guest-booking">${guestConfirmed ? `<div class="guest-step">Your appointment</div><h2>A moment in the diary.</h2><p>Amelia, your study appointment is confirmed.</p><div class="guest-service"><strong>Skin Renewal Facial</strong><span>Tuesday 3 November · ${time('09:00')}</span><span>Maya Lewis · 60 minutes</span></div><div class="guest-summary"><span>Simulated deposit</span><strong>${money(25)}</strong></div><p class="guest-terms">No appointment or payment was created outside this visual study.</p><button class="primary" data-action="guest-review">Review appointment</button>` : `<div class="guest-step"><span>Service</span><span>Time</span><strong>Review</strong></div><h2>Your next good hour.</h2><p>A familiar treatment, with someone who knows you.</p><div class="guest-service"><span class="service-number">60 minutes</span><strong>Skin Renewal Facial</strong><span>With Maya Lewis</span><p>A restorative facial, thoughtfully adapted to your everyday preferences.</p></div><div class="guest-date"><span>Tuesday 3 November</span><strong>${time('09:00')}</strong><small>${market === 'UK' ? 'London' : 'New York'} local time</small></div><div class="guest-summary"><span>Service total</span><strong>${money(servicePrice())}</strong></div><div class="guest-summary"><span>Deposit to reserve</span><strong>${money(25)}</strong></div><p class="guest-terms">Your deposit is part of your total. The balance is due after your visit. Appointment terms would be shown before a real confirmation.</p><button class="primary" data-action="guest-review">Review appointment</button><p class="guest-study">Design study · Fictional guest · No payment is taken</p>`}</section></div>`
}
function syncUrl() {
  const query = new URLSearchParams({ direction, screen, market })
  history.replaceState({}, '', `?${query}`)
}
function render() {
  document.body.dataset.direction = direction
  document.body.className = direction
  document
    .querySelectorAll('.directions button')
    .forEach((b) => b.setAttribute('aria-pressed', b.dataset.direction === direction))
  document.querySelector('#direction-summary').textContent = descriptions[direction]
  document
    .querySelectorAll('.app-nav button')
    .forEach((b) =>
      b.classList.toggle(
        'active',
        b.dataset.screen === screen || (screen === 'checkout' && b.dataset.screen === 'client'),
      ),
    )
  document.querySelector('#crumb').textContent = labels[screen]
  document.querySelector('#place').textContent =
    market === 'UK' ? 'Marylebone, London' : 'SoHo, New York'
  document.querySelector('#footer-locale').textContent =
    market === 'UK' ? 'London · GBP · Europe/London' : 'New York · USD · America/New_York'
  document.querySelector('#market').value = market
  main.innerHTML =
    direction === 'after-dark'
      ? guest()
      : { today, calendar, client, checkout, intelligence }[screen]()
  syncUrl()
}
let dialogTrigger = null
function showDialog(title, body) {
  dialog.classList.toggle(
    'appointment-preview',
    title === 'Amelia’s appointment' || title === 'Appointment context',
  )
  dialogTrigger = document.activeElement
  document.querySelector('#dialog-title').textContent = title
  document.querySelector('#dialog-body').innerHTML = body
  dialog.showModal()
}
function go(next) {
  if (dialog.open) dialog.close()
  screen = next
  render()
  main.focus()
  window.scrollTo({ top: 0, behavior: 'instant' })
}
function action(type) {
  if (type === 'inbox')
    return showDialog(
      'Inbox · Proposed workspace',
      '<h3>Conversations belong to the relationship.</h3><p>This screen is reserved in the recovered navigation architecture. Channel delivery, consent, assignment and reply states need a separate product contract before implementation.</p><p>No messages or automated actions are shown as sent in this visual study.</p>',
    )
  if (type === 'guest-confirm') {
    guestConfirmed = true
    dialog.close()
    render()
    return
  }
  if (type === 'guest-review') {
    guestConfirmed = false
    showDialog(
      'Review your appointment',
      `<h3>Skin Renewal Facial</h3><p>With Maya Lewis · Tuesday 3 November at ${time('09:00')}.</p><div class="amount-line"><span>Service</span><strong>${money(servicePrice())}</strong></div><div class="amount-line"><span>Deposit today</span><strong>${money(25)}</strong></div><p>Amelia Carter · Fictional guest. No real booking or payment is made.</p><button class="primary" data-action="guest-confirm">Confirm study appointment</button>`,
    )
    return
  }
  if (type === 'client') return go('client')
  if (type === 'new')
    return showDialog(
      'A dependable appointment',
      '<h3>Choose the person first.</h3><p>This controlled study follows Amelia’s visit so the three visual directions can be compared on the same task.</p><button class="search-result" data-visit="Amelia Carter"><span class="person"><span class="avatar">AC</span><span><strong>Amelia Carter</strong><small>Today, ' +
        time('09:30') +
        ' · Skin Renewal Facial</small></span></span></button>',
    )
  if (type === 'pay') {
    paid = true
    render()
    return
  }
  if (type === 'rebook')
    return showDialog(
      rebooked ? 'Amelia’s next visit' : 'Give the next visit a place',
      `<h3>Skin Renewal Facial with Maya</h3><p>Tuesday 3 November · Treatment room 1 · ${money(servicePrice())}</p><div class="slot-buttons"><button data-slot="09:00" aria-pressed="${rebookTime === '09:00'}">${time('09:00')}</button><button data-slot="11:00" aria-pressed="${rebookTime === '11:00'}">${time('11:00')}</button></div><p>Illustrative availability for the visual study.</p><button class="primary" data-action="confirm-rebook">${rebooked ? 'Keep this appointment' : 'Confirm simulated rebooking'}</button>`,
    )
  if (type === 'confirm-rebook') {
    rebooked = true
    dialog.close()
    go('client')
    return
  }
  if (type === 'return')
    return showDialog(
      'A reason to return',
      '<h3>Three relationships to review</h3><p>At least four weeks since their last visit, with no next appointment. A suggestion is a starting point for the owner’s judgement.</p><p><strong>Isabel Wilson</strong> · Last visit 1 September<br><strong>Luca Evans</strong> · Last visit 3 September<br><strong>Ruby Taylor</strong> · Last visit 8 September</p><button class="primary" data-screen="intelligence">Review the business context</button>',
    )
  if (type === 'historic-receipt')
    return showDialog(
      'Receipt · 8 September',
      `<h3>Amelia Carter</h3><div class="amount-line"><span>Skin Renewal Facial</span><strong>${money(servicePrice())}</strong></div><div class="amount-line"><span>Paid</span><strong>${money(servicePrice())}</strong></div><p>Illustrative historical receipt. No payment is processed.</p>`,
    )
}
document.addEventListener('click', (event) => {
  const b = event.target.closest('button')
  if (!b) return
  if (b.dataset.direction) {
    direction = b.dataset.direction
    render()
  } else if (b.dataset.screen) go(b.dataset.screen)
  else if (b.dataset.action) action(b.dataset.action)
  else if (b.dataset.tip !== undefined) {
    tip = Number(b.dataset.tip)
    render()
    document.querySelector(`[data-tip="${tip}"]`).focus()
  } else if (b.dataset.visit) {
    if (dialog.open) dialog.close()
    showDialog(
      b.dataset.visit === 'Amelia Carter' ? 'Amelia’s appointment' : 'Appointment context',
      `<h3>${b.dataset.visit}</h3><p>${b.dataset.visit === 'Amelia Carter' ? 'Skin Renewal Facial · Maya · ' + time('09:30') : 'This visual study uses Amelia’s relationship and checkout as its controlled journey.'}</p><p>Today’s appointment stays connected to the person’s history and the receipt.</p><button class="secondary" data-screen="client">Open client relationship</button><button class="primary" data-screen="checkout">${paid ? 'View Amelia’s receipt' : 'Continue to Amelia’s checkout'}</button>`,
    )
  } else if (b.hasAttribute('data-slot')) {
    rebookTime = b.dataset.slot
    document
      .querySelectorAll('[data-slot]')
      .forEach((slot) => slot.setAttribute('aria-pressed', slot === b))
  }
})
document.querySelector('#market').addEventListener('change', (e) => {
  market = e.target.value
  tip = 0
  paid = false
  rebooked = false
  render()
})
document.addEventListener('change', (e) => {
  if (e.target.id === 'hide-completed') {
    hiddenCompleted = e.target.checked
    render()
    document.querySelector('#hide-completed').focus()
  }
})
document.querySelector('#dialog-close').addEventListener('click', () => dialog.close())
dialog.addEventListener('close', () => {
  if (dialogTrigger?.isConnected) dialogTrigger.focus()
})
document
  .querySelector('#find-client')
  .addEventListener('click', () =>
    showDialog(
      'Find a client',
      '<p>The controlled relationship used in all three directions.</p><button class="search-result" data-screen="client"><span class="person"><span class="avatar">AC</span><span><strong>Amelia Carter</strong><small>14 visits · Familiar professional: Maya</small></span></span></button>',
    ),
  )
document
  .querySelector('#about-open')
  .addEventListener('click', () =>
    showDialog(
      'Three expressions of SALEANE',
      '<div class="comparison"><section><h3>A · Quiet Luxury</h3><p>Warm ivory, stone, deep espresso and soft sage. A substantial rail and restrained generosity turn the original hospitality expression into an operating environment.</p><a href="?direction=quiet-luxury&screen=today">Inspect Quiet Luxury</a></section><section><h3>B · Modern Editorial</h3><p>Almost white, charcoal and muted nude. Strong typography, a compact horizontal workspace and clear financial rhythm. Recommended as the operator starting point, pending user review.</p><a href="?direction=modern-editorial&screen=today">Inspect Modern Editorial</a></section><section><h3>C · After Dark</h3><p>Near-black brown, warm cream and champagne. An atmospheric guest-booking expression, intentionally excluded from primary operator use.</p><a href="?direction=after-dark&screen=today">Inspect After Dark</a></section></div><p>These recover the three directions in the original conversation. No direction is approved. A and B use identical operator content; C demonstrates the original guest-facing boundary.</p>',
    ),
  )
render()
