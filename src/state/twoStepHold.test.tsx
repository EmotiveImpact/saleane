import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { StoreProvider } from './StoreProvider'
import { useStore } from './context'
import type { Store } from './context'
import { api, ApiError, onTwoStepHold } from './api'

// Stage 6: a studio that asks everyone for two-step sign-in refuses someone without it with a
// code; the app notices and shows "Protect your account" for that studio.
const fetchMock = vi.fn<typeof fetch>()
const refusal = (code?: string) =>
  new Response(
    JSON.stringify({
      error: 'Fernleaf Rooms asks everyone to use two-step sign-in. Set it up to open the studio.',
      ...(code ? { code } : {}),
    }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  )
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

test('a studio’s refusal with the two-step code tells the app which studio holds them', async () => {
  const heard = vi.fn()
  const stop = onTwoStepHold(heard)
  fetchMock.mockResolvedValueOnce(refusal('two_step_required'))
  const error = await api('/api/workspaces/studio-1/day-sheet').catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ApiError)
  expect((error as ApiError).code).toBe('two_step_required')
  expect(heard).toHaveBeenCalledWith({
    workspaceId: 'studio-1',
    message: 'Fernleaf Rooms asks everyone to use two-step sign-in. Set it up to open the studio.',
  })
  // Any other refusal, or one that is not about a studio, holds nobody.
  fetchMock.mockResolvedValueOnce(refusal())
  await api('/api/workspaces/studio-1').catch(() => {})
  fetchMock.mockResolvedValueOnce(refusal('two_step_required'))
  await api('/api/session').catch(() => {})
  expect(heard).toHaveBeenCalledTimes(1)
  stop()
})

test('the store keeps the hold until it is released, and forgets it on signing out', async () => {
  let store!: Store
  function Consumer() {
    const current = useStore()
    useEffect(() => {
      store = current
    }, [current])
    return <output data-testid="hold">{current.hold?.workspaceId ?? 'none'}</output>
  }
  render(
    <StoreProvider>
      <Consumer />
    </StoreProvider>,
  )
  fetchMock.mockResolvedValueOnce(refusal('two_step_required'))
  await act(async () => {
    await store.openWorkspace('studio-1').catch(() => {})
  })
  expect(screen.getByTestId('hold')).toHaveTextContent('studio-1')
  act(() => store.releaseHold?.())
  expect(screen.getByTestId('hold')).toHaveTextContent('none')
  fetchMock.mockResolvedValueOnce(refusal('two_step_required'))
  await act(async () => {
    await store.openWorkspace('studio-1').catch(() => {})
  })
  expect(screen.getByTestId('hold')).toHaveTextContent('studio-1')
  fetchMock.mockResolvedValueOnce(
    new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  )
  await act(async () => {
    await store.logout()
  })
  await waitFor(() => expect(screen.getByTestId('hold')).toHaveTextContent('none'))
})
