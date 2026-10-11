import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { packProblems } from '../../pack'
import { AskPanel, DEFAULT_LOOK, fullLook, lookProblems, palette } from '../../react'
import type { Look } from '../../react'
import {
  ALLOWANCE_CHOICES,
  answerProblems,
  answersText,
  installQuestions,
  listed,
  recommendedAnswers,
} from '../answers'
import type { InstallAnswers, Tone } from '../answers'
import type { AppFindings } from '../findings'
import { packFrom, packSource } from '../write'
import { greetingFor, previewTransport, previewUsage } from './preview'

const COLOURS = ['#2F6F62', '#3949AB', '#7B3F61', '#9A5B13', '#2B2B2E']
const FONTS: { title: string; font: string }[] = [
  { title: 'Figtree', font: DEFAULT_LOOK.font },
  { title: 'DM Sans', font: "'DM Sans', system-ui, sans-serif" },
  { title: 'Newsreader', font: "'Newsreader', Georgia, serif" },
  { title: 'The device’s own', font: 'system-ui, sans-serif' },
]

type Written = { source: string; problems: string[] }

/**
 * LUMANE's install page: the same five questions the coding agent asks, with a live preview of
 * Ask that follows every choice. Writing the pack here writes the real file and runs the real
 * check; the coding agent then connects the pathways, adds the panel and opens the pull request.
 */
export function InstallPage({ apps, pause }: { apps: AppFindings[]; pause?: number }) {
  const [appIndex, setAppIndex] = useState(0)
  const findings = apps[appIndex]
  const [answers, setAnswers] = useState<InstallAnswers>(() => recommendedAnswers(findings))
  const [look, setLook] = useState<Look>(() => startingLook(findings))
  const [ownName, setOwnName] = useState(false)
  const [written, setWritten] = useState<Written | null>(null)
  const [copied, setCopied] = useState('')
  const questions = installQuestions(findings)

  const change = (next: Partial<InstallAnswers>) => {
    setAnswers((now) => ({ ...now, ...next }))
    setWritten(null)
  }
  const switchApp = (index: number) => {
    setAppIndex(index)
    setAnswers(recommendedAnswers(apps[index]))
    setLook(startingLook(apps[index]))
    setOwnName(false)
    setWritten(null)
  }

  const problems = [
    ...answerProblems(findings, answers),
    ...(answers.look === 'default' ? lookProblems(look) : []),
  ]
  const shownLook =
    answers.look === 'plain' ? 'plain' : answers.look === 'own' ? findings.design?.look : look
  const tone = typeof answers.tone === 'object' ? 'own' : answers.tone
  // The preview starts afresh when what Ask can do changes; a new look keeps the conversation.
  const conversationKey = [
    findings.name,
    answers.name,
    tone,
    answers.pathways.join(),
    answers.allowances.typed,
    answers.allowances.talkMinutes,
  ].join('|')
  const transport = useMemo(
    () => previewTransport(findings, answers, { pause }),
    // A new pretend app only when the conversation starts afresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversationKey, pause],
  )
  const chosen = findings.pathways.filter((p) => answers.pathways.includes(p.name))
  const ask = `Ask ${answers.name.trim() || findings.name}`

  function write() {
    const source = packSource(findings, answers)
    setWritten({ source, problems: packProblems(packFrom(findings, answers)) })
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
    } catch {
      setCopied('')
    }
  }

  return (
    <div className="install">
      <header className="install-top">
        <p className="install-brand">
          LUMANE <span>Install</span>
        </p>
        <div className="install-apps" role="group" aria-label="Try it with">
          <span>Try it with</span>
          {apps.map((app, i) => (
            <button
              key={app.name}
              type="button"
              className="chip"
              aria-pressed={i === appIndex}
              onClick={() => switchApp(i)}
            >
              {app.name}
            </button>
          ))}
        </div>
      </header>
      <main className="install-main">
        <section className="install-choices" aria-labelledby="install-title">
          <div className="install-found">
            <p>
              I read {findings.name}: {findings.files} files. It handles {listed(findings.handles)}
              {findings.design
                ? `, and its design lives in ${findings.design.file}.`
                : ', and has no design system of its own.'}{' '}
              Choose below and the preview follows your choices.
            </p>
          </div>
          <div className="install-card">
            <h1 id="install-title">Set up LUMANE in {findings.name}</h1>
            <p className="install-quiet">
              Nothing changes in {findings.name} until you approve the pull request.
            </p>

            <Choice title="Name" hint={questions[0].hint}>
              {questions[0].options.map((o) => (
                <Chip
                  key={o.id}
                  on={!ownName && answers.name === o.id}
                  onClick={() => {
                    setOwnName(false)
                    change({ name: o.id })
                  }}
                >
                  {o.title}
                  {o.recommended && <small>recommended</small>}
                </Chip>
              ))}
              <Chip on={ownName} onClick={() => setOwnName(true)}>
                Type your own
              </Chip>
              {ownName && (
                <label className="install-field">
                  <span>The name after “Ask”</span>
                  <input
                    value={answers.name}
                    maxLength={40}
                    onChange={(e) => change({ name: e.target.value })}
                  />
                </label>
              )}
            </Choice>

            <Choice title="How it sounds" hint={questions[1].hint}>
              {questions[1].options.map((o) => (
                <Chip key={o.id} on={tone === o.id} onClick={() => change({ tone: o.id as Tone })}>
                  {o.title}
                  <small>{o.about}</small>
                </Chip>
              ))}
            </Choice>

            <Choice title="Pathways" hint={questions[2].hint}>
              {questions[2].options.map((o) => {
                const on = answers.pathways.includes(o.id)
                return (
                  <Chip
                    key={o.id}
                    on={on}
                    onClick={() =>
                      change({
                        pathways: on
                          ? answers.pathways.filter((p) => p !== o.id)
                          : findings.pathways
                              .map((p) => p.name)
                              .filter((p) => p === o.id || answers.pathways.includes(p)),
                      })
                    }
                  >
                    {o.title}
                    <small>{o.about}</small>
                  </Chip>
                )
              })}
            </Choice>

            <Choice title="Each account includes" hint={questions[3].hint}>
              {(['starter', 'more'] as const).map((id) => {
                const choice = ALLOWANCE_CHOICES[id]
                const on =
                  answers.allowances.typed === choice.typed &&
                  answers.allowances.talkMinutes === choice.talkMinutes
                return (
                  <Chip
                    key={id}
                    on={on}
                    onClick={() =>
                      change({
                        allowances: { typed: choice.typed, talkMinutes: choice.talkMinutes },
                      })
                    }
                  >
                    {choice.title}
                    <small>
                      {choice.typed.toLocaleString('en-GB')} questions, {choice.talkMinutes} minutes
                      of talking
                    </small>
                  </Chip>
                )
              })}
            </Choice>

            <Choice title="Look" hint={questions[4].hint}>
              <div className="install-looks">
                {questions[4].options.map((o) => {
                  const id = o.id as InstallAnswers['look']
                  const swatch =
                    id === 'own' ? findings.design?.look : id === 'default' ? look : undefined
                  return (
                    <button
                      key={id}
                      type="button"
                      className="look-card"
                      aria-pressed={answers.look === id}
                      onClick={() => change({ look: id })}
                    >
                      <Swatches look={swatch} />
                      <strong>{o.title}</strong>
                      <span>{o.about}</span>
                    </button>
                  )
                })}
              </div>
              {answers.look === 'default' && <LookChoices look={look} onChange={setLook} />}
            </Choice>

            {problems.length > 0 && (
              <ul className="install-problems" role="alert">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {!written ? (
              <button type="button" className="go" disabled={problems.length > 0} onClick={write}>
                Write the pack
              </button>
            ) : (
              <div className="install-written" role="status">
                {written.problems.length === 0 ? (
                  <>
                    <p className="tick">Wrote the pack: src/lumane.pack.ts</p>
                    <p className="tick">Checked it: no problems found.</p>
                  </>
                ) : (
                  <>
                    <p>The pack is not ready:</p>
                    <ul>
                      {written.problems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </>
                )}
                <details>
                  <summary>Show the pack</summary>
                  <pre>{written.source}</pre>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => void copy(written.source, 'pack')}
                  >
                    {copied === 'pack' ? 'Copied' : 'Copy the pack'}
                  </button>
                </details>
                <p>
                  Next, in your coding agent, run this. It connects each pathway to {findings.name}
                  ’s own code, adds the {ask} button and panel
                  {answers.look === 'own' ? ` in ${findings.name}’s own design` : ''}, and opens a
                  pull request for your yes.
                </p>
                <pre className="install-handover">{`/lumane:install\n${answersText(answers)}`}</pre>
                <div className="install-row">
                  <button
                    type="button"
                    className="go"
                    onClick={() => void copy(`/lumane:install\n${answersText(answers)}`, 'answers')}
                  >
                    {copied === 'answers' ? 'Copied' : 'Copy for the coding agent'}
                  </button>
                  <button type="button" className="quiet" onClick={() => setWritten(null)}>
                    Change something
                  </button>
                </div>
              </div>
            )}
          </div>
          <p className="install-quiet install-foot">
            A preview with a pretend app. Nothing here changes a real app.
          </p>
        </section>

        <section className="install-preview" aria-label="Live preview">
          <p className="install-preview-label">Live preview</p>
          <div className="install-window">
            <AskPanel
              key={conversationKey}
              name={ask}
              about="AI assistant"
              greeting={greetingFor(answers)}
              starters={chosen.map((p) => p.example)}
              usage={previewUsage(answers)}
              transport={transport}
              look={shownLook}
              placeholder={
                findings.handles.length
                  ? `Ask about your ${findings.handles[0]}`
                  : `Ask about ${findings.name}`
              }
              words={{ done: 'Done. In the app, this is saved now.' }}
            />
          </div>
          {answers.look === 'plain' && (
            <p className="install-quiet">
              Plain parts carry no look at all. {findings.name}’s team dresses them.
            </p>
          )}
        </section>
      </main>
    </div>
  )
}

function startingLook(findings: AppFindings): Look {
  return findings.design ? { ...DEFAULT_LOOK, colour: findings.design.look.colour } : DEFAULT_LOOK
}

function Choice({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <fieldset className="choice">
      <legend>{title}</legend>
      <p className="install-quiet">{hint}</p>
      <div className="choice-options">{children}</div>
    </fieldset>
  )
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" className="chip" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  )
}

function Swatches({ look }: { look?: Look }) {
  if (!look) return <span className="swatches swatches-plain" aria-hidden="true" />
  const c = palette(fullLook(look))
  return (
    <span className="swatches" aria-hidden="true">
      <span style={{ background: c.accent }} />
      <span style={{ background: c.soft }} />
      <span style={{ background: c.surface }} />
    </span>
  )
}

/** The default look's four choices: a colour, a font, the corners, and light or dark. */
function LookChoices({ look, onChange }: { look: Look; onChange: (look: Look) => void }) {
  const set = (next: Partial<Look>) => onChange({ ...look, ...next })
  return (
    <div className="look-choices">
      <div role="group" aria-label="Colour" className="look-row">
        <span>Colour</span>
        {COLOURS.map((colour) => (
          <button
            key={colour}
            type="button"
            className="colour"
            aria-label={colour}
            aria-pressed={look.colour.toLowerCase() === colour.toLowerCase()}
            style={{ background: colour }}
            onClick={() => set({ colour })}
          />
        ))}
        <label className="install-field install-hex">
          <span className="install-hidden">Your own colour, as a hex code</span>
          <input
            value={look.colour}
            maxLength={7}
            spellCheck={false}
            onChange={(e) => set({ colour: e.target.value.trim() })}
          />
        </label>
      </div>
      <div role="group" aria-label="Font" className="look-row">
        <span>Font</span>
        {FONTS.map((f) => (
          <Chip key={f.title} on={look.font === f.font} onClick={() => set({ font: f.font })}>
            <span style={{ fontFamily: f.font }}>{f.title}</span>
          </Chip>
        ))}
      </div>
      <div role="group" aria-label="Corners" className="look-row">
        <span>Corners</span>
        {(['square', 'soft', 'round'] as const).map((corners) => (
          <Chip key={corners} on={look.corners === corners} onClick={() => set({ corners })}>
            {corners === 'square' ? 'Square' : corners === 'soft' ? 'Soft' : 'Round'}
          </Chip>
        ))}
      </div>
      <div role="group" aria-label="Light or dark" className="look-row">
        <span>Light or dark</span>
        {(['light', 'dark'] as const).map((scheme) => (
          <Chip key={scheme} on={look.scheme === scheme} onClick={() => set({ scheme })}>
            {scheme === 'light' ? 'Light' : 'Dark'}
          </Chip>
        ))}
      </div>
    </div>
  )
}
