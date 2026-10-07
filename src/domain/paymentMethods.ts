import { z } from 'zod'

/**
 * How money was taken. `card` means a payment provider processed it (PILOT-02) and always carries
 * the provider's reference and whether it was a test; the others are recorded by hand.
 * `previous_system` is a deposit the guest paid to the studio's old booking system before it
 * switched to SALEANE (PILOT-03). It arrives only through a reviewed import, never at the till.
 */
export const paymentMethods = [
  'demo_card',
  'demo_cash',
  'cash',
  'external_card',
  'card',
  'previous_system',
] as const
export const paymentMethodSchema = z.enum(paymentMethods)
export const processorSchema = z
  .object({ provider: z.string().min(1).max(40), live: z.boolean() })
  .strict()
