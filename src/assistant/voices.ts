import type { Voice } from '../../lumane'

/**
 * Ask Saleane's shortlist of voices. These are candidates for the side-by-side trial of OpenAI
 * GPT-Live-1 (14 voices; custom voices only through OpenAI sales) and ElevenLabs (a library of
 * over 10,000 voices, plus designed and cloned voices). The accents are first impressions, to be
 * checked by ear in the trial, which confirms the final list. Nothing here is connected yet.
 */
export const VOICES: Voice[] = [
  { key: 'marin', label: 'Marin', supplier: 'openai', supplierVoice: 'marin', accent: 'American' },
  { key: 'cedar', label: 'Cedar', supplier: 'openai', supplierVoice: 'cedar', accent: 'American' },
  { key: 'coral', label: 'Coral', supplier: 'openai', supplierVoice: 'coral', accent: 'American' },
  { key: 'sage', label: 'Sage', supplier: 'openai', supplierVoice: 'sage', accent: 'American' },
  { key: 'fable', label: 'Fable', supplier: 'openai', supplierVoice: 'fable', accent: 'British' },
  { key: 'verse', label: 'Verse', supplier: 'openai', supplierVoice: 'verse', accent: 'American' },
]

/** SALEANE's signature voice until a studio chooses its own. Confirmed by the voice trial. */
export const DEFAULT_VOICE = 'marin'
