import { z } from 'zod'

/** V2: links to accounting software. Kept apart so the operations schema can use them. */
const id = z.string().min(1).max(150)
const code = z.string().trim().max(30)
export const accountingProviders = ['xero', 'quickbooks'] as const
export type AccountingProvider = (typeof accountingProviders)[number]
export const accountCodesSchema = z.object({
  services: code,
  products: code,
  tax: code,
  tips: code,
  plans: code,
  rent: code,
  fees: code,
  refunds: code,
  clearing: code,
  /**
   * Stage 3: where a renter's own takings go while the studio holds them. Needed only once someone
   * rents a chair or room and their clients pay at the studio's till.
   */
  renters: code.optional(),
})
export type AccountCodes = z.infer<typeof accountCodesSchema>
export const accountingSettingsSchema = z.object({
  provider: z.enum(accountingProviders),
  codes: accountCodesSchema,
})
export const ACCOUNTING_EXPORT_LIMIT = 500
/** One batch prepared for the accounting software. In test mode nothing was sent. */
export const accountingExportSchema = z.object({
  id,
  provider: z.enum(accountingProviders),
  from: z.iso.date(),
  to: z.iso.date(),
  days: z.number().int().min(0).max(400),
  takingsMinor: z.number().int(),
  mode: z.literal('test'),
  createdAt: z.iso.datetime(),
  actor: z.string(),
})
export type AccountingExport = z.infer<typeof accountingExportSchema>
