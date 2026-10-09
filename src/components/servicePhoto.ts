import type { BusinessState } from '../domain/model'
import { treatmentPhoto } from '../design'

/**
 * The photograph for one of the studio's treatments, chosen as Business Overview chooses it: by
 * kind of treatment, with the second of a kind taking the next photograph, so a treatment looks
 * the same wherever it appears.
 */
export function servicePhoto(services: BusinessState['services'], serviceId: string) {
  const index = services.findIndex((service) => service.id === serviceId)
  const service = services[index]
  if (!service) return treatmentPhoto('Body')
  const nth = services.slice(0, index).filter((other) => other.category === service.category).length
  return treatmentPhoto(service.category, nth)
}
