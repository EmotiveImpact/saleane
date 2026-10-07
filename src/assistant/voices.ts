import type { Voice } from '../../lumane'

/**
 * Ask Saleane's shortlist of voices: candidates for the side-by-side trial of OpenAI GPT-Live-1
 * and ElevenLabs (a library of over 10,000 voices, plus designed and cloned voices). The GPT-Live-1
 * names come from OpenAI's launch page; OpenAI labels only Quartz's accent, and a developer
 * report describes Vesper as British, so every accent here is to be checked by ear. The trial
 * confirms the final list. Nothing here is connected yet.
 */
const openai = (key: string, label: string, accent: string): Voice => ({
  key,
  label,
  supplier: 'openai',
  supplierVoice: key,
  accent,
})

export const VOICES: Voice[] = [
  openai('vesper', 'Vesper', 'British (reported)'),
  openai('willow', 'Willow', 'To be heard'),
  openai('meridian', 'Meridian', 'To be heard'),
  openai('beacon', 'Beacon', 'To be heard'),
  openai('quartz', 'Quartz', 'Australian influenced'),
  openai('stone', 'Stone', 'To be heard'),
]

/** SALEANE's signature voice until a studio chooses its own. Confirmed by the voice trial. */
export const DEFAULT_VOICE = 'vesper'
