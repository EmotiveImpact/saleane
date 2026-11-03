import { z } from 'zod'

/**
 * Stage 2: how a location's receipts print, and whether its cash drawer opens by itself.
 *
 * - `browser`: the computer's own print window, with any receipt printer installed on it. The
 *   default. A browser cannot open a cash drawer.
 * - `network`: a receipt printer on the studio's network, reached by SALEANE's server on the
 *   studio's computer. Its drawer port opens the cash drawer.
 * - `test`: a pretend printer. SALEANE keeps what it would have printed so it can be looked at,
 *   and says plainly that nothing was printed and no drawer opened.
 */
const id = z.string().min(1).max(150)
export const printModes = ['browser', 'network', 'test'] as const
export type PrintMode = (typeof printModes)[number]
/** Till roll widths in millimetres. */
export const paperWidths = ['80', '58'] as const
export type PaperWidth = (typeof paperWidths)[number]
/** Locations a studio can have, plus room to spare; see LOCATION_LIMIT in operations. */
const PRINTER_LIMIT = 25
/** A VAT number or tax ID as printed: letters, numbers, spaces and the usual marks. */
export const TAX_NUMBER = /^[A-Za-z0-9][A-Za-z0-9 .\-/]{0,39}$/

export const tillPrinterInputSchema = z
  .object({
    mode: z.enum(printModes),
    paper: z.enum(paperWidths),
    /** A network printer's address on the studio's network, or its name there. */
    host: z.string().trim().max(253).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    /** Open the cash drawer when cash is taken. Only a network or test printer can. */
    drawer: z.boolean(),
  })
  .strict()
export type TillPrinterInput = z.infer<typeof tillPrinterInputSchema>
export const tillPrinterSchema = tillPrinterInputSchema
  .extend({
    /** The location this printer serves. Absent means the main location. */
    locationId: id.optional(),
  })
  .strict()
export type TillPrinter = z.infer<typeof tillPrinterSchema>

export const tillSettingsSchema = z
  .object({
    printers: z.array(tillPrinterSchema).max(PRINTER_LIMIT),
    /** The studio's VAT number (UK) or tax ID (US), printed on every receipt when set. */
    taxNumber: z.string().max(40).optional(),
  })
  .strict()
export type TillSettings = z.infer<typeof tillSettingsSchema>

export const tillCommandSchemas = [
  z
    .object({
      type: z.literal('till-settings'),
      /** The location whose printer this is. Absent means the main location. */
      locationId: id.optional(),
      printer: tillPrinterInputSchema,
      /** Empty removes it; absent leaves it as it is. */
      taxNumber: z.string().trim().max(40).optional(),
    })
    .strict(),
] as const
