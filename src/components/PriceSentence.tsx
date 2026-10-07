import { priceSentence } from '../domain/priceSentence'
import type { PriceTax } from '../domain/priceSentence'
import type { BusinessState, Service } from '../domain/model'
import '../guest-extras.css'

/** The all-in price line on a booking page's service card. Shared by both booking pages. */
export function PriceSentence({
  service,
  organisation,
  tax,
  simulated,
}: {
  service: Pick<Service, 'priceMinor' | 'depositMinor' | 'durationMinutes'>
  organisation: Pick<BusinessState['organisation'], 'locale' | 'currency'>
  tax?: PriceTax
  simulated?: boolean
}) {
  return (
    <span className="price-sentence">
      {priceSentence(service, organisation, { tax, simulated })}
    </span>
  )
}
