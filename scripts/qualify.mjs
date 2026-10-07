/* global process, console, window, document, getComputedStyle, sessionStorage */
// LOCAL-05 qualification sweep. Drives the built app in Chromium: axe (WCAG 2.2 A/AA rules),
// reflow at 320px, keyboard focus visibility and console errors, in browser demo mode and in a
// signed-in local sample studio. Evidence only; it is not part of `npm run check`.
//
//   npm run build && PORT=5173 DB_PATH=work/qualify.sqlite npm start   (in another terminal)
//   node scripts/qualify.mjs [baseUrl] [outFile]
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const playwright = require(
  require.resolve('playwright', { paths: [process.cwd(), '/opt/node-tools/node_modules'] }),
)
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
const base = process.argv[2] ?? 'http://127.0.0.1:5173'
const out = process.argv[3] ?? 'docs/evidence/LOCAL-05-sweep.json'
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
const widths = [1280, 390, 320]

const demoRoutes = [
  '/today',
  '/calendar',
  '/clients',
  '/clients/client-1',
  '/inbox',
  '/waitlist',
  '/business',
  '/business/money',
  '/settings',
  '/settings?section=messages',
  '/settings?section=payments',
  '/settings?section=switching',
  '/settings?section=plans',
  '/business/feedback',
  '/business/stock',
  '/business/pay',
  '/business/rota',
  '/business/accounts',
  '/business/gift-cards',
  '/booking',
  '/design-language',
  '/account',
  '/pricing',
]

async function axe(page) {
  await page.addScriptTag({ content: axeSource })
  return page.evaluate(async (runOnly) => {
    const result = await window.axe.run(document, {
      runOnly: { type: 'tag', values: runOnly },
      resultTypes: ['violations'],
    })
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
      count: v.nodes.length,
    }))
  }, tags)
}

async function reflow(page) {
  return page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }))
}

/** Tabs through the page and reports any focused element without a visible focus indicator. */
async function keyboard(page, steps = 60) {
  const missing = []
  const seen = new Set()
  await page.evaluate(() => document.activeElement?.blur())
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      const style = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      const visible =
        (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
        (style.boxShadow && style.boxShadow !== 'none') ||
        style.textDecorationLine.includes('underline') ||
        // A search input inside a pill shows its ring on the pill around it.
        (() => {
          const field = el.closest('.search-field')
          if (!field) return false
          const ring = getComputedStyle(field)
          return ring.outlineStyle !== 'none' && parseFloat(ring.outlineWidth) > 0
        })()
      const label = (
        el.getAttribute('aria-label') ||
        el.textContent ||
        el.getAttribute('name') ||
        el.tagName
      )
        .trim()
        .slice(0, 50)
      return {
        key: `${el.tagName}:${label}:${Math.round(rect.top)}`,
        label: `${el.tagName.toLowerCase()} "${label}"`,
        visible,
        onScreen: rect.width > 0 && rect.height > 0,
      }
    })
    if (!info) continue
    if (seen.has(info.key)) break
    seen.add(info.key)
    if (!info.visible || !info.onScreen) missing.push(info.label)
  }
  return { focusable: seen.size, missing }
}

async function sweep(context, routes, label) {
  const results = []
  for (const width of widths) {
    const page = await context.newPage()
    await page.setViewportSize({ width, height: 900 })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    for (const route of routes) {
      errors.length = 0
      await page.goto(base + route, { waitUntil: 'networkidle' })
      await page.waitForTimeout(250)
      const entry = {
        mode: label,
        route,
        width,
        violations: await axe(page),
        ...(await reflow(page)),
      }
      if (width === 1280) entry.keyboard = await keyboard(page)
      entry.errors = [...errors]
      results.push(entry)
    }
    await page.close()
  }
  return results
}

/** Opens the main dialogs and checks them while open, including focus containment. */
async function dialogs(context, label) {
  const page = await context.newPage()
  await page.setViewportSize({ width: 1280, height: 900 })
  const results = []
  const check = async (name, open) => {
    await page.goto(base + '/today', { waitUntil: 'networkidle' })
    try {
      await open()
      await page.waitForSelector('[role="dialog"]', { timeout: 3000 })
    } catch (error) {
      results.push({ mode: label, dialog: name, skipped: String(error.message).slice(0, 120) })
      return
    }
    const violations = await axe(page)
    let escaped = false
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      escaped ||= await page.evaluate(
        () =>
          !document.activeElement?.closest('[role="dialog"]') &&
          document.activeElement !== document.body,
      )
    }
    await page.keyboard.press('Escape')
    const closed = await page
      .waitForSelector('[role="dialog"]', { state: 'detached', timeout: 2000 })
      .then(() => true)
      .catch(() => false)
    results.push({
      mode: label,
      dialog: name,
      violations,
      focusEscaped: escaped,
      escapeCloses: closed,
    })
  }
  await check('search', () => page.getByRole('button', { name: 'Find a client' }).click())
  await check('appointment', () => page.locator('.agenda-row').first().click())
  await check('new appointment', () =>
    page.getByRole('button', { name: 'New appointment' }).click(),
  )
  await check('measure definition', () => page.locator('.definition-trigger').first().click())
  await page.close()
  return results
}

/** Tabs forward until the focused element's text matches, then returns whether it was found. */
async function tabTo(page, pattern, limit = 120) {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab')
    const text = await page.evaluate(() => {
      const el = document.activeElement
      return el ? `${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}` : ''
    })
    if (pattern.test(text)) return true
  }
  return false
}

/** The daily loop using only the keyboard: open a visit, welcome, check out, see rebooking. */
async function keyboardLoop(context, label) {
  const page = await context.newPage()
  await page.setViewportSize({ width: 1280, height: 900 })
  const steps = []
  const step = async (name, run) => {
    const ok = await run().catch(() => false)
    steps.push({ step: name, ok })
    return ok
  }
  await page.goto(base + '/today', { waitUntil: 'networkidle' })
  await step('reach an upcoming visit with Tab', () => tabTo(page, /Upcoming/))
  await page.keyboard.press('Enter')
  await step('dialog opens with focus inside', () =>
    page
      .waitForFunction(() => !!document.activeElement?.closest('[role="dialog"]'), null, {
        timeout: 3000,
      })
      .then(() => true),
  )
  if (await step('reach Welcome client', () => tabTo(page, /^\s*Welcome client/, 40))) {
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
  }
  if (await step('reach Continue to checkout', () => tabTo(page, /Continue to checkout/, 40))) {
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
  }
  if (await step('reach Record payment', () => tabTo(page, /Record (demo )?payment/, 60))) {
    await page.keyboard.press('Enter')
    await page.waitForTimeout(600)
  }
  await step('rebooking offered after payment', () =>
    page.getByRole('button', { name: 'Rebook this client' }).isVisible(),
  )
  await page.keyboard.press('Escape')
  await step('focus returns to the page after closing', () =>
    page
      .waitForFunction(
        () =>
          document.activeElement &&
          document.activeElement !== document.body &&
          !document.activeElement.closest('[role="dialog"]'),
        null,
        { timeout: 3000 },
      )
      .then(() => true),
  )
  await page.close()
  return { mode: label, steps }
}

/** Heading outline and landmarks as exposed to assistive technology (not a screen reader run). */
async function outline(context, routes, label) {
  const page = await context.newPage()
  await page.setViewportSize({ width: 1280, height: 900 })
  const pages = []
  for (const route of routes) {
    await page.goto(base + route, { waitUntil: 'networkidle' })
    pages.push({
      mode: label,
      route,
      ...(await page.evaluate(() => ({
        title: document.title,
        lang: document.documentElement.lang,
        h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
        headings: [...document.querySelectorAll('h1,h2,h3')]
          .slice(0, 12)
          .map((h) => `${h.tagName} ${h.textContent.trim().slice(0, 40)}`),
        landmarks: [
          ...document.querySelectorAll(
            'main,nav,aside,header,footer,section[aria-label],[role="region"]',
          ),
        ].map(
          (l) =>
            `${l.tagName.toLowerCase()}${l.getAttribute('aria-label') ? ' ' + l.getAttribute('aria-label') : ''}`,
        ),
      }))),
    })
  }
  await page.close()
  return pages
}

const browser = await playwright.chromium.launch()
const report = {
  environment: `Chromium ${browser.version()} / ${base}`,
  recordedAt: new Date().toISOString(),
  results: [],
  dialogs: [],
  keyboard: [],
  outline: [],
}

const demo = await browser.newContext({ bypassCSP: true })
report.results.push(...(await sweep(demo, demoRoutes, 'demo')))
report.dialogs.push(...(await dialogs(demo, 'demo')))
report.keyboard.push(await keyboardLoop(demo, 'demo'))
report.outline.push(...(await outline(demo, demoRoutes, 'demo')))
await demo.close()

const server = await browser.newContext({ bypassCSP: true })
const stamp = Date.now()
const register = await server.request.post(base + '/api/auth/register', {
  headers: { origin: base, 'content-type': 'application/json' },
  data: {
    name: 'Qualification Owner',
    email: `qualify-${stamp}@example.test`,
    password: 'qualification-pass-1',
    workspace: { name: 'Qualify Studio', region: 'UK', locationName: 'Marylebone', sample: true },
  },
})
if (!register.ok())
  throw new Error(`Registration failed: ${register.status()} ${await register.text()}`)
const { orgId } = await register.json()
const record = await (await server.request.get(`${base}/api/workspaces/${orgId}`)).json()
await server.addInitScript((id) => sessionStorage.setItem('saleane.workspace', id), orgId)
const firstClient = record.state.clients[0]?.id
const serverRoutes = demoRoutes
  .filter((r) => !['/booking', '/design-language', '/account'].includes(r))
  .map((r) => (r === '/clients/client-1' && firstClient ? `/clients/${firstClient}` : r))
serverRoutes.push(`/book/${record.slug}`, '/account')
report.results.push(...(await sweep(server, serverRoutes, 'local studio')))
report.dialogs.push(...(await dialogs(server, 'local studio')))
report.keyboard.push(await keyboardLoop(server, 'local studio'))
report.outline.push(...(await outline(server, serverRoutes, 'local studio')))
await server.close()
await browser.close()

const summary = {
  pages: report.results.length,
  withViolations: report.results.filter((r) => r.violations.length).length,
  overflowing: report.results.filter((r) => r.document > r.viewport).length,
  focusMissing: report.results.filter((r) => r.keyboard?.missing.length).length,
  withErrors: report.results.filter((r) => r.errors.length).length,
}
report.summary = summary
writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(summary))
for (const r of report.results)
  if (
    r.violations.length ||
    r.document > r.viewport ||
    r.keyboard?.missing.length ||
    r.errors.length
  )
    console.log(
      r.mode,
      r.route,
      r.width,
      r.violations.map((v) => `${v.id}(${v.count})`).join(' '),
      r.document > r.viewport ? `overflow ${r.document}` : '',
      r.keyboard?.missing.length ? `nofocus: ${r.keyboard.missing.join(' | ')}` : '',
      r.errors.join(' | ').slice(0, 200),
    )
for (const k of report.keyboard) console.log('keyboard', k.mode, JSON.stringify(k.steps))
for (const o of report.outline)
  if (o.h1.length !== 1) console.log('h1', o.mode, o.route, JSON.stringify(o.h1))
for (const d of report.dialogs)
  console.log('dialog', d.mode, d.dialog, JSON.stringify(d).slice(0, 300))
