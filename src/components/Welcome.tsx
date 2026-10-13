import { Fragment, useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { photos } from '../design/photos'
import { motionAllowed } from '../design/motion'
import { useStore } from '../state/context'
import type { Store } from '../state/context'
import {
  markSeen,
  welcomeCanPlay,
  onWatchWelcome,
  readWelcomeMemory,
  saveWelcomeMemory,
  welcomeOff,
} from '../state/welcomeMemory'
import { businessMinutes } from '../domain/operations'
import { setupFinished } from '../domain/setup'
import { placeOf } from '../domain/locations'
import { venueDate } from '../domain/tillCount'
import {
  EVENING_FROM,
  WELCOME_LENGTH,
  dayEnds,
  chooseWelcome,
  countedVisits,
  isWelcomeScene,
  joinedOnFor,
  rememberWelcome,
  welcomeWords,
} from '../domain/welcomeScene'
import type { WelcomeScene, WelcomeWords } from '../domain/welcomeScene'
import './welcome.css'

/**
 * The welcome as SALEANE opens (see domain/welcomeScene.ts for how the moment is chosen). It lies
 * over the studio's first page, which is already drawn underneath, plays once, then fades into
 * it. A tap, a click, scrolling or any key skips it, and Skip says so for anyone who looks.
 *
 * It is the one place SALEANE moves without being asked: the owner chose it as a short film for
 * opening the app (11 October 2026). Anyone whose device asks for less motion sees its finished
 * frame fade up and away instead, and nobody who turns it off in Your preferences sees it at all.
 * The test runner, which cannot say how a device feels about motion, never plays it uninvited.
 */

type Film = { scene: WelcomeScene; words: WelcomeWords; preview: boolean }

/** Played (or passed) films, so a page that is drawn again never plays the same one twice. */
const decided = new Map<string, { film: Film | null; done: boolean }>()

const MOMENT_PHOTO: Record<Exclude<WelcomeScene, 'birthday'>, string> = {
  morning: photos.sunlitRoom,
  back: photos.hairStudio,
  evening: photos.endOfDay,
  first: photos.entrance,
}
const FILM = [
  photos.sunlitRoom,
  photos.facial,
  photos.reception,
  photos.manicure,
  photos.hairStudio,
  photos.tea,
  photos.windowLight,
  photos.towels,
]
const photosFor = (scene: WelcomeScene) => (scene === 'birthday' ? FILM : [MOMENT_PHOTO[scene]])

/** Where each spark starts (x, y in %), when (s), how long it rises (s), its size and its sway. */
const SPARKS: [number, number, number, number, number, number][] = [
  [46, 75, 4.16, 4.33, 0.28, -2.5],
  [51, 78, 3.57, 3.59, 0.34, -2.9],
  [53, 92, 2.86, 4.59, 0.42, 3.7],
  [64, 78, 0.71, 3.43, 0.22, -3.5],
  [22, 58, 0.14, 4.33, 0.42, 0.7],
  [23, 57, 1.32, 3.41, 0.22, -0.3],
  [30, 98, 4.48, 5.08, 0.34, -1.5],
  [26, 60, 0.32, 4.93, 0.42, -3.1],
  [31, 49, 0.08, 4.77, 0.28, -2.3],
  [87, 70, 4.41, 4.19, 0.22, 0.5],
  [23, 81, 1.52, 4.02, 0.22, 3.7],
  [73, 51, 1.11, 3.6, 0.22, -0.3],
  [49, 81, 0.85, 4.42, 0.28, -0.6],
  [40, 66, 4.46, 3.4, 0.34, 4.0],
  [7, 55, 4.48, 4.6, 0.22, -3.7],
  [18, 68, 0.04, 4.62, 0.34, -0.9],
  [12, 56, 2.86, 3.43, 0.34, -1.0],
  [46, 96, 2.18, 4.55, 0.42, -2.5],
  [19, 93, 3.68, 3.9, 0.28, -2.7],
  [62, 74, 3.09, 4.18, 0.42, 0.8],
  [43, 51, 0.17, 5.33, 0.28, 1.9],
  [40, 67, 4.07, 4.38, 0.28, 3.4],
  [93, 52, 2.16, 4.71, 0.22, -1.8],
  [88, 56, 0.07, 3.94, 0.42, -2.0],
  [9, 60, 2.39, 5.35, 0.22, -1.1],
  [85, 97, 2.96, 4.78, 0.28, 0.7],
  [88, 70, 1.61, 4.02, 0.22, -3.8],
  [62, 71, 3.29, 4.04, 0.22, -3.4],
  [54, 84, 4.05, 4.87, 0.28, 2.3],
  [87, 64, 3.08, 5.2, 0.42, 3.6],
  [8, 71, 0.07, 4.72, 0.42, 0.7],
  [60, 49, 2.88, 5.39, 0.42, 1.8],
  [40, 84, 2.61, 4.28, 0.22, 0.1],
  [51, 61, 0.39, 3.44, 0.22, 0],
  [60, 94, 1.15, 3.42, 0.34, -2.9],
  [60, 72, 3.39, 4.09, 0.42, 0],
  [27, 66, 1.13, 4.67, 0.28, 3.0],
  [40, 76, 1.42, 3.67, 0.42, -1.2],
  [86, 47, 0.29, 5.36, 0.28, -3.1],
  [47, 94, 3.74, 4.17, 0.42, 1.4],
  [69, 90, 2.81, 4.04, 0.22, -1.8],
  [60, 81, 1.26, 4.11, 0.22, 1.1],
  [41, 55, 3.46, 3.93, 0.28, 2.4],
  [94, 51, 0.49, 4.47, 0.34, 3.7],
]
/** The sparks begin with the thank you and are gone five seconds later, as the owner asked. */
const SPARKS_FROM = 3.1
const SPARKS_FOR = 5

const vars = (values: Record<string, string | number>) => values as CSSProperties

/**
 * Words set one letter at a time, so each letter can arrive on its own. Each word holds together,
 * so a long studio name only ever breaks between words.
 */
function Letters({ word }: { word: string }) {
  let i = 0
  return word.split(' ').map((part, w) => (
    <Fragment key={w}>
      {w > 0 && ' '}
      <span className="film-word">
        {[...part].map((ch) => (
          <span key={i} style={vars({ '--i': i++ })}>
            {ch}
          </span>
        ))}
      </span>
    </Fragment>
  ))
}

/** A number on rolling reels, like a counter, that settles on `shown` ("1,284"). */
function Odometer({ shown }: { shown: string }) {
  let reel = 0
  return (
    <span className="film-odo">
      {[...shown].map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={i} className="film-reel">
            <span
              className="film-strip"
              style={vars({ '--to': `-${10 + Number(ch)}em`, '--i': reel++ })}
            >
              {Array.from({ length: 20 }, (_, k) => (
                <span key={k}>{k % 10}</span>
              ))}
            </span>
          </span>
        ) : (
          <span key={i} className="film-comma">
            {ch}
          </span>
        ),
      )}
    </span>
  )
}

/**
 * The opening screen's mark while a studio's records load: the name, its line drawn once with the
 * rose dot, on the same ivory the welcome starts from.
 */
export function OpeningMark() {
  return (
    <span className="opening-mark" aria-hidden="true">
      <b>SALEANE</b>
      <i />
    </span>
  )
}

function Mark() {
  return (
    <div className="film-mark">
      <b>SALEANE</b>
      <i />
    </div>
  )
}

function Progress({ steps }: { steps: WelcomeWords['steps'] }) {
  return (
    <div className="film-progress">
      <div className="film-steps">
        <span className="s1">{steps[0]}</span>
        <span className="s2">{steps[1]}</span>
        <span className="s3">{steps[2]}</span>
      </div>
      <div className="film-bar">
        <i />
      </div>
    </div>
  )
}

function Hello({ words, children }: { words: WelcomeWords; children?: ReactNode }) {
  return (
    <div className="film-hello">
      <p className="film-eyebrow">{words.eyebrow}</p>
      <h2>{words.title}</h2>
      {words.line && <p className="film-line">{words.line}</p>}
      {children}
    </div>
  )
}

function Scene({ scene, words }: { scene: WelcomeScene; words: WelcomeWords }) {
  const photo = scene === 'birthday' ? '' : MOMENT_PHOTO[scene]
  switch (scene) {
    case 'morning':
      return (
        <>
          <img className="film-photo" src={photo} alt="" />
          <div className="film-veil">
            <div className="film-big">
              <Letters word="SALEANE" />
            </div>
          </div>
          <div className="film-shade" />
          <div className="film-leak" />
          <Mark />
          <Hello words={words} />
        </>
      )
    case 'back':
      return (
        <>
          <img className="film-photo" src={photo} alt="" />
          <div className="film-shade" />
          <div className="film-sweep" />
          <div className="film-glint" />
          <Mark />
          <Hello words={words} />
        </>
      )
    case 'evening':
      return (
        <>
          <img className="film-photo" src={photo} alt="" />
          <div className="film-dusk" />
          <div className="film-sun" />
          <div className="film-shade" />
          <Mark />
          <Hello words={words}>
            {words.figure && (
              <div className="film-figure">
                <Odometer shown={words.figure.shown} />
                <span className="film-unit">
                  {words.figure.unit}
                  {words.figure.detail && (
                    <>
                      ,<br />
                      {words.figure.detail}
                    </>
                  )}
                </span>
              </div>
            )}
          </Hello>
        </>
      )
    case 'first':
      return (
        <>
          <img className="film-photo" src={photo} alt="" />
          <div className="film-shade" />
          <div className="film-door film-door-left" />
          <div className="film-door film-door-right" />
          {words.doors && (
            <div className="film-invite">
              <span className="film-by">{words.doors.by}</span>
              <span className="film-welcomes">{words.doors.welcomes}</span>
              <span className="film-name">
                <Letters word={words.doors.name} />
              </span>
            </div>
          )}
          <Mark />
          <Hello words={words} />
        </>
      )
    case 'birthday':
      return (
        <>
          <div className="film-ribbon">
            <div className="film-roll">
              {[...FILM, ...FILM].map((src, i) => (
                <figure key={i} style={vars({ '--i': i % FILM.length })}>
                  <img src={src} alt="" />
                </figure>
              ))}
            </div>
          </div>
          <Mark />
          <div className="film-tally">
            <p className="film-eyebrow">{words.eyebrow}</p>
            {words.figure && <Odometer shown={words.figure.shown} />}
            {words.figure && <span className="film-unit">{words.figure.unit}</span>}
            {words.thanks && <p className="film-thanks">{words.thanks}</p>}
          </div>
        </>
      )
  }
}

/** The gold and rose sparks of a birthday, on a layer of their own so they outlast the film. */
function Sparks() {
  return (
    <div className="film-sparks" aria-hidden="true">
      {SPARKS.map(([x, y, d, dur, s, sway], i) => (
        <i
          key={i}
          style={vars({
            '--x': `${x}%`,
            '--y': `${y}%`,
            '--d': `${d}s`,
            '--dur': `${dur}s`,
            '--s': `${s * 1.7}em`,
            '--sway': `${sway}vmin`,
            '--c': i % 2 ? 'var(--welcome-rose)' : 'var(--welcome-gold)',
          })}
        />
      ))}
    </div>
  )
}

type Phase = 'ready' | 'play' | 'leave'

/**
 * One film: ivory while its photographs load (a second and a half at most), then the film, then a
 * fade into the app. `still` shows the finished frame instead, for anyone who asks for less motion.
 */
export function WelcomeFilm({
  scene,
  words,
  still,
  onDone,
}: {
  scene: WelcomeScene
  words: WelcomeWords
  still: boolean
  onDone: () => void
}) {
  const [phase, setPhase] = useState<Phase>('ready')
  const [sparks, setSparks] = useState(false)
  // Load the photographs first, so the film never plays over an empty frame.
  useEffect(() => {
    let live = true
    const loads = photosFor(scene).map(
      (src) =>
        new Promise<void>((done) => {
          const image = new Image()
          image.onload = image.onerror = () => done()
          image.src = src
        }),
    )
    const cap = new Promise<void>((done) => setTimeout(done, 1500))
    void Promise.race([Promise.all(loads), cap]).then(() => {
      if (live) setPhase((p) => (p === 'ready' ? 'play' : p))
    })
    return () => {
      live = false
    }
  }, [scene])
  // The film runs its length, holds a moment on its last frame, then fades into the app.
  useEffect(() => {
    if (phase !== 'play') return
    const length = still ? (scene === 'back' ? 1.6 : 2.4) : WELCOME_LENGTH[scene] + 0.5
    const leave = setTimeout(() => setPhase('leave'), length * 1000)
    const sparkTimer =
      scene === 'birthday' && !still ? setTimeout(() => setSparks(true), SPARKS_FROM * 1000) : 0
    return () => {
      clearTimeout(leave)
      if (sparkTimer) clearTimeout(sparkTimer)
    }
  }, [phase, scene, still])
  useEffect(() => {
    if (phase !== 'leave') return
    const done = setTimeout(onDone, 650)
    return () => clearTimeout(done)
  }, [phase, onDone])
  // Sparks carry on past the film into the app, for five seconds at most, then go.
  useEffect(() => {
    if (!sparks) return
    const end = setTimeout(() => setSparks(false), SPARKS_FOR * 1000)
    return () => clearTimeout(end)
  }, [sparks])
  // Any key skips, as a tap or click does. Nothing is held back: the key still does its own job.
  useEffect(() => {
    if (phase === 'leave') return
    const skip = () => {
      setSparks(false)
      setPhase('leave')
    }
    window.addEventListener('keydown', skip)
    return () => window.removeEventListener('keydown', skip)
  }, [phase])
  const skip = () => {
    setSparks(false)
    setPhase('leave')
  }
  return (
    <>
      <div
        className={`welcome-film${phase !== 'ready' ? ' is-playing' : ''}`}
        data-scene={scene}
        data-phase={phase}
        data-still={still || undefined}
        onPointerDown={skip}
        onWheel={skip}
      >
        <p className="sr-only" role="status">
          {words.said}
        </p>
        <div className="film-scene" aria-hidden="true">
          <Scene scene={scene} words={words} />
          <Progress steps={words.steps} />
          <div className="film-grain" />
        </div>
        <button
          type="button"
          className="film-skip"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={skip}
        >
          Skip
        </button>
      </div>
      {sparks && phase !== 'ready' && <Sparks />}
    </>
  )
}

type Opening = Pick<Store, 'state' | 'session' | 'role' | 'branch' | 'today'>

/**
 * The words for a film, from the studio as the person sees it now. Closing up watched as a preview
 * earlier in the day is shown at the time today's last visit ends, as it will look then.
 */
function wordsFor(
  scene: WelcomeScene,
  { state, session, role, branch, today }: Opening,
  preview = false,
) {
  const workspace = session?.workspaces.find((w) => w.id === state.organisation.id)
  const now = businessMinutes(state)
  const closes = Math.max(dayEnds(countedVisits(state.appointments, today)) ?? 0, EVENING_FROM)
  return welcomeWords(scene, {
    state,
    today,
    minutes: preview && scene === 'evening' ? Math.max(now, Math.min(closes, 23 * 60 + 59)) : now,
    firstName: session?.user.name.split(' ')[0],
    place: role === 'general' && branch ? placeOf(state, branch)?.name : undefined,
    settingUp: role === 'owner' && !setupFinished(state),
    joinedOn: joinedOnFor(state, workspace?.openedAt),
  })
}

/** The film for this moment, if any, remembering that the moment has come. */
function chooseOnOpen(opening: Opening): Film | null {
  if (!welcomeCanPlay()) return null
  const { state, session, today } = opening
  const asked = new URLSearchParams(window.location.search).get('welcome')
  if (isWelcomeScene(asked))
    return { scene: asked, words: wordsFor(asked, opening, true), preview: true }
  const userId = session?.user.id
  const studioId = state.organisation.id
  const workspace = session?.workspaces.find((w) => w.id === studioId)
  const memory = readWelcomeMemory(userId, studioId)
  const now = Date.now()
  const moment = {
    now,
    // The day as the calendar on the wall has it, so a sample studio, whose diary stands still on
    // one day, still has a first open each real day.
    today: venueDate(state.organisation.timeZone, new Date(now).toISOString()),
    minutes: businessMinutes(state),
    day: countedVisits(state.appointments, today),
    joinedOn: joinedOnFor(state, workspace?.openedAt),
    studioMadeAt: workspace?.openedAt,
    accountMadeAt: session?.user.joinedAt,
    memory,
  }
  const scene = welcomeOff(userId) ? null : chooseWelcome(moment)
  saveWelcomeMemory(userId, studioId, rememberWelcome(memory, scene, moment))
  return scene ? { scene, words: wordsFor(scene, opening), preview: false } : null
}

/**
 * Chooses the welcome once as a studio opens and plays it over the page. Also plays any welcome
 * on request from Your preferences, or from `?welcome=morning` (and the others) in the address,
 * as a preview that changes nothing it remembers.
 */
export function Welcome() {
  const store = useStore()
  const { state, session, role, branch, today } = store
  const userId = session?.user.id
  const studioId = state.organisation.id
  const [film, setFilm] = useState<Film | null>(() => {
    const k = `${userId ?? 'demo'}:${studioId}`
    const known = decided.get(k)
    if (known) return known.done ? null : known.film
    const choice = chooseOnOpen(store)
    decided.set(k, { film: choice, done: false })
    return choice
  })
  const [still] = useState(() => !motionAllowed())
  // "Welcome back" counts from the last time SALEANE was open and in view here.
  useEffect(() => {
    const seen = () => markSeen(userId, studioId)
    const hidden = () => {
      if (document.visibilityState === 'hidden') seen()
    }
    const beat = setInterval(
      () => {
        if (document.visibilityState === 'visible') seen()
      },
      5 * 60 * 1000,
    )
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', seen)
    return () => {
      clearInterval(beat)
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', seen)
    }
  }, [userId, studioId])
  // A preview asked for from Your preferences, in the studio as it is at that moment.
  useEffect(
    () =>
      onWatchWelcome((scene) => {
        if (welcomeCanPlay())
          setFilm({
            scene,
            words: wordsFor(scene, { state, session, role, branch, today }, true),
            preview: true,
          })
      }),
    [state, session, role, branch, today],
  )
  const finish = useCallback(() => {
    const known = decided.get(`${userId ?? 'demo'}:${studioId}`)
    if (known) known.done = true
    setFilm(null)
  }, [userId, studioId])
  if (!film) return null
  return (
    <WelcomeFilm
      key={`${film.scene}-${film.preview}`}
      scene={film.scene}
      words={film.words}
      still={still}
      onDone={finish}
    />
  )
}
