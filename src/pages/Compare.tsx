import { useEffect, useState } from 'react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { operations } from '../domain/operations'
import {
  BENCHMARK_DAYS,
  BENCHMARK_MIN_STUDIOS,
  BENCHMARK_MIN_VISITS,
  measureLabel,
} from '../domain/benchmark'
import type { Comparison } from '../domain/benchmark'
import { dateLabel } from '../domain/format'
import { Button, ErrorMessage, PageHeader } from '../design'
import '../components/management.css'
import '../components/compare.css'

type View = {
  sharing: boolean
  since?: string | null
  enoughVisits?: boolean
  comparison?: Comparison[] | null
}

const positionLabel: Record<Comparison['position'], string> = {
  ahead: 'Ahead of most',
  typical: 'Typical',
  behind: 'Behind most',
}

/**
 * V5: how the studio compares with similar studios. The owner chooses to share; only rates and
 * averages leave the studio, and only the spread of other studios comes back, once enough share.
 */
export function Compare() {
  const { state, role, mode, session, commit, blocked } = useStore()
  const org = state.organisation
  const sharing = operations(state).benchmark?.sharing === true
  const server = mode === 'server' && !!session
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState('')
  useEffect(() => {
    if (!server) return
    let current = true
    api<View>(`/api/workspaces/${encodeURIComponent(org.id)}/benchmark`)
      .then((next) => {
        if (current) setView(next)
      })
      .catch((e: unknown) => {
        if (current)
          setError(e instanceof Error ? e.message : 'The comparison could not be loaded.')
      })
    return () => {
      current = false
    }
  }, [server, org.id, sharing])

  async function toggle() {
    setPending(true)
    setError('')
    setSaved('')
    try {
      const result = await commit({ type: 'benchmark-sharing', share: !sharing })
      if (result.ok) {
        setSaved(
          sharing
            ? 'Sharing stopped. This studio is no longer in anyone’s comparison.'
            : 'Sharing started.',
        )
      } else setError(result.error)
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setPending(false)
    }
  }

  const word = org.region === 'UK' ? 'in the UK' : 'in the US'
  return (
    <div className="compare-page">
      <PageHeader
        eyebrow="Business"
        title="How you compare."
        description={`Your studio against similar studios ${word}, over the last ${BENCHMARK_DAYS} days. No one sees another studio’s name or figures.`}
      />
      <section className="surface ops-panel compare-sharing" aria-labelledby="compare-sharing">
        <header>
          <div>
            <h2 id="compare-sharing">Sharing</h2>
            <p>
              {sharing
                ? `This studio shares anonymously${
                    operations(state).benchmark?.since
                      ? ` since ${dateLabel(operations(state).benchmark!.since!, org.locale, true)}`
                      : ''
                  }.`
                : 'This studio does not share. Only studios that share can compare.'}
            </p>
          </div>
        </header>
        <ul className="compare-shared">
          <li>
            What leaves the studio: four figures, the average treatment sale and three percentages.
          </li>
          <li>Never names, clients, team, receipts, totals or how busy you are.</li>
          <li>
            A comparison appears only once at least {BENCHMARK_MIN_STUDIOS} other studios share, and
            stopping takes this studio out of everyone’s comparison at once.
          </li>
        </ul>
        {role === 'owner' ? (
          <Button
            variant={sharing ? 'secondary' : 'primary'}
            disabled={pending || blocked || !server}
            onClick={() => void toggle()}
          >
            {pending ? 'Saving…' : sharing ? 'Stop sharing' : 'Share anonymously'}
          </Button>
        ) : (
          !sharing && <p className="subtle">The owner can turn sharing on.</p>
        )}
        <p className="ops-save-note" role="status">
          {saved}
        </p>
        <ErrorMessage error={error} />
      </section>
      {!server ? (
        <p className="subtle">
          Comparing needs a saved local account, so the browser demo cannot show it.
        </p>
      ) : (
        sharing &&
        view?.sharing && (
          <section className="surface ops-panel" aria-labelledby="compare-figures">
            <header>
              <div>
                <h2 id="compare-figures">Against similar studios</h2>
                <p>
                  The shaded band is where the middle half of other studios sit; the line is the
                  middle studio; the dot is you.
                </p>
              </div>
            </header>
            {!view.enoughVisits ? (
              <p>
                Your studio needs at least {BENCHMARK_MIN_VISITS} completed visits in the last{' '}
                {BENCHMARK_DAYS} days before it can be compared.
              </p>
            ) : !view.comparison ? (
              <p>
                Not enough similar studios share yet. A comparison appears once at least{' '}
                {BENCHMARK_MIN_STUDIOS} do.
              </p>
            ) : (
              <ul className="compare-list">
                {view.comparison.map((c) => (
                  <ComparisonRow key={c.key} c={c} org={org} />
                ))}
              </ul>
            )}
          </section>
        )
      )}
    </div>
  )
}

function ComparisonRow({
  c,
  org,
}: {
  c: Comparison
  org: { locale: 'en-GB' | 'en-US'; currency: 'GBP' | 'USD' }
}) {
  // Percentages run from 0 to 100%; the average sale runs to a little past the highest figure.
  const top = c.key === 'averageVisit' ? Math.max(c.own, c.high) * 1.25 || 1 : 1
  const at = (v: number) => `${Math.min(100, (v / top) * 100)}%`
  return (
    <li>
      <div className="compare-row-head">
        <strong>{c.label}</strong>
        <span className={`compare-tag compare-${c.position}`}>{positionLabel[c.position]}</span>
      </div>
      <p>
        You: <strong>{measureLabel(c.key, c.own, org)}</strong>.{' '}
        {measureLabel(c.key, c.low, org) === measureLabel(c.key, c.high, org)
          ? `Most similar studios: ${measureLabel(c.key, c.median, org)}.`
          : `Most similar studios: ${measureLabel(c.key, c.low, org)} to ${measureLabel(c.key, c.high, org)}, middle ${measureLabel(c.key, c.median, org)}.`}
      </p>
      <div className="compare-scale" aria-hidden="true">
        <span
          className="compare-band"
          style={{ left: at(c.low), width: `calc(${at(c.high)} - ${at(c.low)})` }}
        />
        <span className="compare-median" style={{ left: at(c.median) }} />
        <span className="compare-you" style={{ left: at(c.own) }} />
      </div>
    </li>
  )
}
