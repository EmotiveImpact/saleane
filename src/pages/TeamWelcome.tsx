import { useId, useState } from 'react'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { Button, ErrorMessage, WizardFooter, WizardSteps, useWizardStep } from '../design'
import { photos } from '../design/photos'
import { roleNames, studioRole } from '../domain/operations'
import type { Role } from '../domain/operations'
import { welcomeFor } from '../domain/welcome'
import { TwoStepSettings } from '../components/TwoStepSettings'
import { useStore } from '../state/context'
import '../components/accessPanel.css'
import './studioSetup.css'
import './teamWelcome.css'

const STEPS = ['hello', 'day', 'safe'] as const
type Step = (typeof STEPS)[number]
const STORY: Record<Step, { photo: string; position: string; line: string }> = {
  hello: { photo: photos.welcomeHello, position: '45% 62%', line: 'Good to have you with us.' },
  day: { photo: photos.welcomeDay, position: '45% 62%', line: 'Where your day starts.' },
  safe: {
    photo: photos.welcomeSafe,
    position: '60% 70%',
    line: 'Guests trust you with their details.',
  },
}

/**
 * Three short screens for someone who has just joined a studio from an invitation: what their
 * role does, where they will work from, and keeping their sign-in safe. They can turn on two-step
 * sign-in here (or later on their account page), and skip the rest at any point. When the studio
 * asks everyone to use it, the last screen says so, and skipping leads to "Protect your account".
 * Nothing on these screens changes the studio.
 */
export function TeamWelcome({
  studio,
  role,
  place,
  name,
  required,
  pending,
  error,
  onOpen,
}: {
  studio: string
  role: Role
  /** The location a general manager runs, or the region a regional manager looks after. */
  place?: string
  name: string
  /** Stage 6: the studio asks everyone to use two-step sign-in, so it is not optional here. */
  required?: boolean
  pending: boolean
  error: string
  onOpen: () => void
}) {
  const store = useStore()
  // Stage 6: the studio asks for two-step sign-in and it is not on yet, so setting it up is the
  // main job of the last screen and opening the studio steps back.
  const mustSetUp = !!required && !store.session?.user.twoStep
  const [index, setIndex] = useState(0)
  // While two-step sign-in is being set up, that is the main job and the footer steps back.
  const [settingUp, setSettingUp] = useState(false)
  const step = STEPS[index]
  const heading = useWizardStep(index)
  const headingId = useId()
  const welcome = welcomeFor(role, place)
  const first = name.trim().split(/\s+/)[0] ?? ''
  const article = /^[AEIOU]/.test(roleNames[role]) ? 'an' : 'a'
  const last = index === STEPS.length - 1
  return (
    <div className="setup-layout team-welcome">
      <aside className="setup-story">
        <span className="wordmark">SALEANE</span>
        <div>
          <p className="eyebrow">Joining</p>
          <p className="setup-story-title">{studio}</p>
          <p>{STORY[step].line}</p>
        </div>
        <img src={STORY[step].photo} alt="" style={{ objectPosition: STORY[step].position }} />
      </aside>
      <main className="setup-main" aria-labelledby={headingId}>
        <div className="setup-top">
          <p className="date-caption">
            Step {index + 1} of {STEPS.length}
          </p>
          <Button variant="quiet" disabled={pending} onClick={onOpen}>
            Skip the welcome
          </Button>
        </div>
        <WizardSteps
          steps={['Welcome', welcome.day.heading, 'Your sign-in']}
          current={index + 1}
          label="Your welcome"
        />
        <section key={step} className="setup-screen settle">
          <h1 id={headingId} ref={heading} tabIndex={-1} className="wizard-heading setup-heading">
            {
              {
                hello: `Welcome to ${studio}`,
                day: welcome.day.heading,
                safe: 'Keep your sign-in safe',
              }[step]
            }
          </h1>
          {step === 'hello' && (
            <>
              <p className="setup-intro">
                {first ? `Hello ${first}. ` : ''}You have joined as {article}{' '}
                {roleNames[role].toLowerCase()}
                {place ? (role === 'regional' ? ` for ${place}` : ` at ${place}`) : ''}. Here is
                what you can do.
              </p>
              <ul className="welcome-list" aria-label="What you can do">
                {welcome.does.map((line) => (
                  <li key={line}>
                    <span className="welcome-mark" aria-hidden="true">
                      <Check size={14} />
                    </span>
                    {line}
                  </li>
                ))}
              </ul>
            </>
          )}
          {step === 'day' && (
            <>
              <p className="setup-intro">Three places you will use most.</p>
              <ol className="welcome-places">
                {welcome.day.places.map((spot, n) => (
                  <li key={spot.name}>
                    <span className="welcome-mark" aria-hidden="true">
                      {n + 1}
                    </span>
                    <span>
                      <strong>{spot.name}</strong>
                      <small>{spot.detail}</small>
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
          {step === 'safe' && (
            <>
              <p className="setup-intro">
                {required
                  ? `Your sign-in opens guests’ private details. ${studio} asks everyone to use two-step sign-in, so set it up now before you open the studio.`
                  : 'Your sign-in opens guests’ private details, so keep your password to yourself and think about turning on two-step sign-in now.'}
              </p>
              <TwoStepSettings startOpen onBusy={setSettingUp} lead={mustSetUp} />
              {!required && (
                <p className="ops-help">
                  {studioRole(role)
                    ? 'You can also turn it on later in Settings, under Team, or on your account page.'
                    : 'You can also turn it on later on your account page.'}
                </p>
              )}
            </>
          )}
          <ErrorMessage error={error} />
        </section>
        <WizardFooter>
          {index > 0 ? (
            <Button
              variant="quiet"
              disabled={pending}
              onClick={() => {
                setSettingUp(false)
                setIndex(index - 1)
              }}
            >
              <ArrowLeft size={16} />
              Back
            </Button>
          ) : (
            <span />
          )}
          <Button
            variant={last && (settingUp || mustSetUp) ? 'secondary' : 'primary'}
            disabled={pending}
            onClick={() => (last ? onOpen() : setIndex(index + 1))}
          >
            {pending ? 'Opening…' : last ? welcome.open : 'Continue'}
            {!pending && <ArrowRight size={17} />}
          </Button>
        </WizardFooter>
      </main>
    </div>
  )
}
