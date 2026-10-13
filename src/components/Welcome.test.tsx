import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Welcome, WelcomeFilm } from './Welcome'
import { StoreContext } from '../state/context'
import type { Store } from '../state/context'
import { seed } from '../domain/seed'
import { DEMO_DATE } from '../domain/model'
import { welcomeWords } from '../domain/welcomeScene'
import { readWelcomeMemory, setWelcomeOff } from '../state/welcomeMemory'

/** A browser that can say how it feels about motion; this one asks for less. */
function withBrowser() {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as typeof window.matchMedia
}

function store(id: string): Store {
  const state = seed('UK')
  return {
    state: { ...state, organisation: { ...state.organisation, id } },
    session: null,
    role: 'owner',
    today: DEMO_DATE,
    mode: 'demo',
  } as unknown as Store
}

describe('the welcome as SALEANE opens', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    // @ts-expect-error the test runner has no matchMedia of its own
    delete window.matchMedia
  })

  it('never plays where no browser can say how it feels about motion', () => {
    const { container } = render(
      <StoreContext.Provider value={store('org_welcome_none')}>
        <Welcome />
      </StoreContext.Provider>,
    )
    expect(container.querySelector('.welcome-film')).toBeNull()
  })

  it('plays the first open of the day once, says it to screen readers and remembers', async () => {
    withBrowser()
    const value = store('org_welcome_once')
    const { container, unmount } = render(
      <StoreContext.Provider value={value}>
        <Welcome />
      </StoreContext.Provider>,
    )
    expect(container.querySelector('.welcome-film')).toHaveAttribute('data-scene', 'morning')
    expect(screen.getByRole('status')).toHaveTextContent(/^Good morning\. .*visits today/)
    // The finished frame, as this browser asks for less motion.
    expect(container.querySelector('.welcome-film')).toHaveAttribute('data-still', 'true')
    expect(readWelcomeMemory(undefined, 'org_welcome_once')).toMatchObject({ opened: true })
    // It plays out and leaves by itself.
    for (const step of [1500, 2400, 700])
      await act(async () => {
        await vi.advanceTimersByTimeAsync(step)
      })
    expect(container.querySelector('.welcome-film')).toBeNull()
    unmount()
    // Drawn again in the same visit, it does not play twice.
    const again = render(
      <StoreContext.Provider value={value}>
        <Welcome />
      </StoreContext.Provider>,
    )
    expect(again.container.querySelector('.welcome-film')).toBeNull()
  })

  it('plays nothing for someone who turned it off', () => {
    withBrowser()
    setWelcomeOff(undefined, true)
    const { container } = render(
      <StoreContext.Provider value={store('org_welcome_off')}>
        <Welcome />
      </StoreContext.Provider>,
    )
    expect(container.querySelector('.welcome-film')).toBeNull()
    setWelcomeOff(undefined, false)
  })

  it('skips at once with Skip, a tap or any key', async () => {
    const s = seed('UK')
    const words = welcomeWords('back', { state: s, today: DEMO_DATE, minutes: 14 * 60 })
    for (const skip of [
      () => fireEvent.click(screen.getByRole('button', { name: 'Skip' })),
      () => fireEvent.pointerDown(document.querySelector('.welcome-film')!),
      () => fireEvent.keyDown(window, { key: 'Escape' }),
    ]) {
      const done = vi.fn()
      const { container, unmount } = render(
        <WelcomeFilm scene="back" words={words} still={false} onDone={done} />,
      )
      expect(screen.getByRole('status')).toHaveTextContent('Welcome back.')
      skip()
      expect(container.querySelector('.welcome-film')).toHaveAttribute('data-phase', 'leave')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700)
      })
      expect(done).toHaveBeenCalledOnce()
      unmount()
    }
  })

  it('keeps the film itself away from screen readers', () => {
    const s = seed('UK')
    const words = welcomeWords('birthday', {
      state: s,
      today: DEMO_DATE,
      minutes: 9 * 60,
      joinedOn: '2025-10-06',
    })
    const { container } = render(
      <WelcomeFilm scene="birthday" words={words} still={false} onDone={() => {}} />,
    )
    expect(container.querySelector('.film-scene')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(/^One year of .* on SALEANE\./)
  })
})
