/**
 * Voices for talking. The voice is separate from the brain, so a studio can change how the
 * assistant sounds without changing how it thinks. Each app offers a short list; a studio picks
 * the voice guests hear, and each person may pick their own for talking to the assistant.
 */
export type VoiceSupplier = 'openai' | 'elevenlabs'

export type Voice = {
  /** The app's own name for the voice, stable even if the supplier changes. */
  key: string
  label: string
  supplier: VoiceSupplier
  /** The supplier's voice id. */
  supplierVoice: string
  accent: string
}

export type VoiceChoices = {
  /** The voice guests hear when they call or talk to the studio. */
  studio?: string
  /** Each person's own voice for talking to the assistant, by person id. */
  people?: Record<string, string>
}

/**
 * The voice to use. A person's own choice applies only to their own conversations; guests always
 * hear the studio's voice. A choice no longer on the list falls back to the default.
 */
export function voiceFor(
  list: Voice[],
  fallback: string,
  choices: VoiceChoices,
  listener: { kind: 'guest' } | { kind: 'person'; personId: string },
): Voice {
  const find = (key?: string) => (key ? list.find((v) => v.key === key) : undefined)
  const chosen =
    (listener.kind === 'person' ? find(choices.people?.[listener.personId]) : undefined) ??
    find(choices.studio) ??
    find(fallback)
  if (!chosen) throw new Error(`The default voice ${fallback} is not on the list.`)
  return chosen
}
