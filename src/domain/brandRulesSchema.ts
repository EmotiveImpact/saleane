import { z } from 'zod'

const id = z.string().min(1).max(150)

/**
 * V5: the studio's look, kept with the studio so every location, device and guest sees the same
 * colours. The first colour leads buttons and selections; the second marks the now line and
 * clients ready to return.
 */
export const firstColours = [
  { name: 'Sage', value: '#5f8471' },
  { name: 'Heather', value: '#7a6690' },
  { name: 'Slate', value: '#557089' },
  { name: 'Teal', value: '#3f7f80' },
  { name: 'Clay', value: '#a35f4b' },
  { name: 'Rosewood', value: '#a5566d' },
] as const

export const secondColours = [
  { name: 'Soft rose', value: '#c27286' },
  { name: 'Apricot', value: '#c98a5e' },
  { name: 'Lavender', value: '#9a86b8' },
  { name: 'Sky', value: '#6f9cbc' },
  { name: 'Olive', value: '#8c9a5b' },
] as const

const firstValues = firstColours.map((c) => c.value) as [string, ...string[]]
const secondValues = secondColours.map((c) => c.value) as [string, ...string[]]

export const lookSchema = z
  .object({ first: z.enum(firstValues), second: z.enum(secondValues) })
  .strict()
export type StudioLook = z.infer<typeof lookSchema>

/** The most a location's price may differ from the house price under a price rule. */
export const MAX_PRICE_BAND = 50
export const CORE_LIMIT = 200

/**
 * V5: house rules every location follows, set by the owner. With a price band, a treatment's
 * price at another location stays within that many per cent of the house price (0 means the same
 * price everywhere). A core treatment is on every location's menu.
 */
export const houseRulesSchema = z
  .object({
    priceBandPercent: z.number().int().min(0).max(MAX_PRICE_BAND).optional(),
    coreServiceIds: z.array(id).max(CORE_LIMIT).optional(),
  })
  .strict()
export type HouseRules = z.infer<typeof houseRulesSchema>

export const brandCommandSchemas = [
  z.object({ type: z.literal('studio-look'), look: lookSchema }).strict(),
  z
    .object({
      type: z.literal('house-rules'),
      priceBandPercent: z.number().int().min(0).max(MAX_PRICE_BAND).nullable(),
      coreServiceIds: z.array(id).max(CORE_LIMIT),
    })
    .strict(),
] as const
