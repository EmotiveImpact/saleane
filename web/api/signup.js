// Saves a website sign-up to the Neon database (DATABASE_URL set in Vercel, never in the repo).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' })
  const url = process.env.DATABASE_URL
  if (!url) return res.status(503).json({ error: 'Sign-ups are not switched on yet' })
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
  const name = String(body.name || '')
    .trim()
    .slice(0, 120)
  const studio = String(body.studio || '')
    .trim()
    .slice(0, 160)
  const email = String(body.email || '')
    .trim()
    .toLowerCase()
    .slice(0, 200)
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Please add your name and a valid email' })
  const host = new URL(url).hostname
  const r = await fetch(`https://${host}/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': url },
    body: JSON.stringify({
      query: 'INSERT INTO signups (name, studio, email) VALUES ($1, $2, $3)',
      params: [name, studio || null, email],
    }),
  })
  if (!r.ok) return res.status(502).json({ error: 'Could not save, please try again' })
  return res.status(200).json({ ok: true })
}
