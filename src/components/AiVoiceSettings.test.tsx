import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { AiVoiceSettings } from './AiVoiceSettings'
import { seed } from '../domain/seed'
import { dispatch } from '../domain/commands'
import { operations } from '../domain/operations'
import type { Command } from '../domain/commands'
import type { BusinessState } from '../domain/model'

// NEXT-16: how the studio's AI speaks, chosen in Settings, AI and voice.
const store = vi.hoisted(() => ({
  state: null as unknown as BusinessState,
  role: 'owner' as string,
  listeners: new Set<() => void>(),
  commands: [] as unknown[],
}))
function setStudio(next: BusinessState) {
  store.state = next
  store.listeners.forEach((listener) => listener())
}
async function commit(command: Command) {
  store.commands.push(command)
  const result = dispatch(store.state, command, 'Ava Owner', '2026-10-06T09:45:00.000Z')
  if (result.ok) setStudio(result.state)
  return result
}
vi.mock('../state/context', () => ({
  useStore: () => {
    const state = useSyncExternalStore(
      (listener) => {
        store.listeners.add(listener)
        return () => store.listeners.delete(listener)
      },
      () => store.state,
    )
    return { state, role: store.role, blocked: false, commit, mode: 'demo', slug: 'atelier-house' }
  },
}))

beforeEach(() => {
  store.state = seed('UK')
  store.role = 'owner'
  store.commands = []
})

describe('how your AI speaks', () => {
  it('shows each tone with a sample answer, and saves the one chosen with the studio’s words', async () => {
    const user = userEvent.setup()
    render(<AiVoiceSettings />)
    const tones = screen.getByRole('group', { name: 'Tone' })
    const radios = within(tones).getAllByRole('radio')
    expect(radios.map((r) => r.closest('label')!.querySelector('strong')!.textContent)).toEqual([
      'Warm and friendly',
      'Calm and polished',
      'Bright and cheerful',
    ])
    expect(screen.getByRole('radio', { name: /Warm and friendly/ })).toBeChecked()
    expect(
      screen.getByText(
        'Certainly. Amara has an appointment free at 11am on Saturday. Shall I keep it for you?',
      ),
    ).toBeVisible()
    await user.click(screen.getByRole('radio', { name: /Calm and polished/ }))
    const words = screen.getByRole('textbox', { name: /How you like to speak/ })
    await user.type(words, 'We call treatments rituals.')
    expect(screen.getByText(/27 of 400 characters/)).toBeInTheDocument()
    await user.selectOptions(
      screen.getByRole('combobox', { name: /Ask SALEANE’s voice/ }),
      'willow',
    )
    expect(
      screen.getByText(/Talking is not switched on yet, so you can choose now/),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save how your AI speaks' }))
    expect(store.commands).toEqual([
      {
        type: 'ai-voice',
        settings: { tone: 'calm', words: 'We call treatments rituals.', voice: 'willow' },
      },
    ])
    expect(operations(store.state).aiVoice).toEqual({
      tone: 'calm',
      words: 'We call treatments rituals.',
      voice: 'willow',
    })
    expect(screen.getByText('Saved. The next answer uses it.')).toBeInTheDocument()
  })

  it('keeps SALEANE’s own voice unless the studio chooses another', async () => {
    const user = userEvent.setup()
    render(<AiVoiceSettings />)
    expect(screen.getByRole('combobox', { name: /Ask SALEANE’s voice/ })).toHaveDisplayValue(
      'Vesper (SALEANE’s own)',
    )
    await user.click(screen.getByRole('button', { name: 'Save how your AI speaks' }))
    expect(store.commands).toEqual([{ type: 'ai-voice', settings: { tone: 'warm' } }])
  })

  it('shows reception the choices without letting them change them', () => {
    store.role = 'reception'
    render(<AiVoiceSettings />)
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    expect(screen.getByRole('textbox', { name: /How you like to speak/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save how your AI speaks' })).toBeNull()
  })
})
