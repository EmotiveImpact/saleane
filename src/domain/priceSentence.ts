import { money } from './format'
import type { BusinessState, Service } from './model'

type Organisation = Pick<BusinessState['organisation'], 'locale' | 'currency'>
type ServicePrice = Pick<Service, 'priceMinor' | 'depositMinor' | 'durationMinutes'>
/** The studio's checkout tax, as configured in Manage studio. */
export type PriceTax = { label: string; rateBps: number; inclusive: boolean } | null | undefined

/**
 * Tax a guest must pay on top of the listed price. Zero when prices already include tax.
 * Rounded the same way checkout rounds it, so the sentence and the receipt agree.
 */
export function addedTaxMinor(priceMinor: number, tax: PriceTax) {
  if (!tax || tax.inclusive || tax.rateBps <= 0) return 0
  return Math.round((priceMinor * tax.rateBps) / 10000)
}

/** The full mandatory price of a service: what the guest pays in total, including any added tax. */
export function fullPriceMinor(service: Pick<Service, 'priceMinor'>, tax?: PriceTax) {
  return service.priceMinor + addedTaxMinor(service.priceMinor, tax)
}

/** "VAT" stays as written; "Sales tax" reads as "sales tax" mid-sentence. */
function taxName(label: string) {
  const clean = label.trim()
  if (!clean) return 'tax'
  return clean === clean.toUpperCase() ? clean : clean[0].toLowerCase() + clean.slice(1)
}

/**
 * One plain sentence with the full price, the length and the deposit, for example
 * "£85 for 60 minutes. £20 deposit when you book, the rest at the studio."
 *
 * UK rules on drip pricing mean the first figure is always the full mandatory price, so any tax
 * added at checkout is already inside it. `simulated` marks a sample studio's deposit, which is
 * never really taken.
 */
export function priceSentence(
  service: ServicePrice,
  organisation: Organisation,
  options: { tax?: PriceTax; simulated?: boolean } = {},
) {
  const { tax, simulated = false } = options
  const total = fullPriceMinor(service, tax)
  const added = addedTaxMinor(service.priceMinor, tax)
  const amount = (minor: number) => money(minor, organisation)
  const length = `${service.durationMinutes} ${service.durationMinutes === 1 ? 'minute' : 'minutes'}`
  const headline = total === 0 ? `No charge for ${length}` : `${amount(total)} for ${length}`
  const taxNote = added
    ? `, including ${amount(added)} ${taxName(tax!.label)}`
    : tax?.inclusive && tax.rateBps > 0 && total > 0
      ? `, including ${taxName(tax.label)}`
      : ''
  const deposit = Math.min(service.depositMinor, total)
  const kind = simulated ? 'simulated deposit' : 'deposit'
  if (total === 0) return `${headline}.`
  if (!deposit) return `${headline}${taxNote}, paid at the studio.`
  if (deposit >= total)
    return `${headline}${taxNote}. ${simulated ? 'Simulated payment' : 'Paid'} in full when you book.`
  return `${headline}${taxNote}. ${amount(deposit)} ${kind} when you book, the rest at the studio.`
}
