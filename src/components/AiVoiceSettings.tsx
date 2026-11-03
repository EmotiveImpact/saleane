import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { AudioLines } from 'lucide-react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import { can } from '../domain/operations'
import { STUDIO_WORDS_LIMIT, TONES } from '../domain/receptionistSchema'
import type { Tone } from '../domain/receptionistSchema'
import { TONE_CHOICES, aiVoice } from '../assistant/tone'
import { DEFAULT_VOICE, VOICES } from '../assistant/voices'
import { Button, ErrorMessage, Select } from '../design'
import { useRun } from './usePayment'
import './management.css'
import './aiVoice.css'
import { APP_NAME, ASK_NAME } from '../assistant/name'

const voiceName = (key: string) => VOICES.find((v) => v.key === key)?.label ?? key

/**
 * NEXT-16: how the studio's AI speaks for it. The tone shapes the AI receptionist's words to
 * guests and the messages Ask SALEANE drafts for clients; the voice is the one Ask SALEANE speaks
 * in for the team, unless a person chooses their own.
 */
export function AiVoiceSettings() {
  const { state, role, blocked, mode, slug, session } = useStore()
  const current = aiVoice(state)
  const [tone, setTone] = useState<Tone>(current.tone)
  const [words, setWords] = useState(current.words ?? '')
  const [voice, setVoice] = useState(current.voice ?? DEFAULT_VOICE)
  const [saved, setSaved] = useState(false)
  const [talking, setTalking] = useState(false)
  const { run, pending, error } = useRun()
  const allowed = !blocked && can(role, 'receptionist')
  const orgId = session?.workspaces.find((w) => w.slug === slug)?.id
  useEffect(() => {
    if (mode !== 'server' || !orgId) return
    api<{ talk?: boolean }>(`/api/workspaces/${encodeURIComponent(orgId)}/assistant`)
      .then((r) => setTalking(!!r.talk))
      .catch(() => {})
  }, [mode, orgId])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved(false)
    const note = words.trim()
    setSaved(
      await run({
        type: 'ai-voice',
        settings: {
          tone,
          ...(note ? { words: note } : {}),
          ...(voice !== DEFAULT_VOICE || current.voice ? { voice } : {}),
        },
      }),
    )
  }

  return (
    <section className="surface ops-panel ai-voice" aria-labelledby="ai-voice-settings">
      <header>
        <div>
          <h2 id="ai-voice-settings">How your AI speaks</h2>
          <p>
            {`Choose the tone the AI receptionist uses with your guests. ${ASK_NAME} writes the messages it prepares for your clients in the same tone. It changes how they speak, never what they may do, and they always say they are an AI.`}
          </p>
        </div>
        <AudioLines size={21} aria-hidden="true" />
      </header>
      <form onSubmit={save}>
        <fieldset className="ai-tones" disabled={!allowed}>
          <legend>Tone</legend>
          {TONES.map((key) => {
            const choice = TONE_CHOICES[key]
            return (
              <label key={key} className="ai-tone">
                <span className="ai-tone-head">
                  <input
                    type="radio"
                    name="ai-tone"
                    value={key}
                    checked={tone === key}
                    onChange={() => setTone(key)}
                  />
                  <span>
                    <strong>{choice.label}</strong>
                    <small>{choice.description}</small>
                  </span>
                </span>
                <q className="ai-tone-sample">{choice.sample}</q>
              </label>
            )
          })}
        </fieldset>
        <div className="ops-fields">
          <label className="ops-wide">
            How you like to speak (optional)
            <textarea
              rows={3}
              value={words}
              maxLength={STUDIO_WORDS_LIMIT}
              disabled={!allowed}
              aria-describedby="ai-voice-words-help"
              onChange={(e) => setWords(e.target.value)}
              placeholder="We call our treatments rituals, and we sign off with “See you soon”."
            />
            <small id="ai-voice-words-help">
              {words.length} of {STUDIO_WORDS_LIMIT} characters. A note on style only: what you call
              things, words you love or avoid. It never changes what the AI may do.
            </small>
          </label>
          <label>
            {ASK_NAME}’s voice
            <Select value={voice} disabled={!allowed} onChange={(e) => setVoice(e.target.value)}>
              {VOICES.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                  {v.key === DEFAULT_VOICE ? ` (${APP_NAME}’s own)` : ''}
                </option>
              ))}
            </Select>
            <small>
              {talking
                ? `The voice your team hears when they talk to ${ASK_NAME}. Each person can choose their own in ${ASK_NAME}. Now: ${voiceName(voice)}.`
                : `The voice your team will hear when they talk to ${ASK_NAME}. Talking is not switched on yet, so you can choose now and hear it once it is.`}
            </small>
          </label>
        </div>
        <ErrorMessage error={error} />
        {allowed && (
          <div className="ops-actions">
            <span role="status" className="ops-help">
              {saved ? 'Saved. The next answer uses it.' : ''}
            </span>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save how your AI speaks'}
            </Button>
          </div>
        )}
      </form>
    </section>
  )
}
