import type { z } from 'zod'
import type { BusinessState, Service } from './model'
import { operations } from './operations'
import { placeOf, places } from './locations'
import type { HouseRules, StudioLook, brandCommandSchemas } from './brandRulesSchema'

export type BrandCommand = z.infer<(typeof brandCommandSchemas)[number]>

export const houseRules = (s: BusinessState): HouseRules => operations(s).houseRules ?? {}
export const studioLook = (s: BusinessState): StudioLook | undefined => operations(s).look

/** The lowest and highest price a location may charge under the price band, in minor units. */
export function priceRange(houseMinor: number, bandPercent: number) {
  return {
    min: Math.ceil((houseMinor * (100 - bandPercent)) / 100),
    max: Math.floor((houseMinor * (100 + bandPercent)) / 100),
  }
}

/**
 * Why this treatment breaks a house rule, or null. Checked whenever a treatment is saved, so a
 * rule set later is met the next time each treatment changes.
 */
export function serviceRuleRefusal(
  s: BusinessState,
  service: Pick<Service, 'id' | 'priceMinor' | 'locationPrices' | 'notOfferedAt' | 'archived'>,
): string | null {
  const rules = houseRules(s)
  if (service.archived) return null
  if (rules.coreServiceIds?.includes(service.id) && service.notOfferedAt?.length)
    return 'This is a core treatment, so it stays on every location’s menu. The owner sets core treatments under Locations.'
  const band = rules.priceBandPercent
  if (band !== undefined)
    for (const row of service.locationPrices ?? []) {
      const { min, max } = priceRange(service.priceMinor, band)
      if (row.priceMinor < min || row.priceMinor > max) {
        const name = placeOf(s, row.locationId)?.name ?? 'another location'
        return band === 0
          ? `Prices are the same at every location under the house rules, so leave the price at ${name} empty.`
          : `The price at ${name} must stay within ${band}% of the house price under the house rules.`
      }
    }
  return null
}

/** What the house rules ask of this treatment, for its form, or null when they ask nothing. */
export function houseRuleNote(s: BusinessState, serviceId: string | undefined) {
  const rules = houseRules(s)
  const parts = [
    rules.priceBandPercent === 0
      ? 'House rules: the same price at every location.'
      : rules.priceBandPercent !== undefined
        ? `House rules: prices stay within ${rules.priceBandPercent}% of the house price.`
        : '',
    serviceId && rules.coreServiceIds?.includes(serviceId)
      ? 'A core treatment, offered at every location.'
      : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' ') : null
}

export type RuleBreach = { serviceId: string; service: string; problem: string }

/** Treatments that do not yet meet the house rules. Nothing is changed for them automatically. */
export function ruleBreaches(s: BusinessState): RuleBreach[] {
  const open = new Set(places(s).map((p) => p.id))
  const breaches: RuleBreach[] = []
  for (const service of s.services) {
    if (service.archived) continue
    const visible = {
      ...service,
      locationPrices: service.locationPrices?.filter((r) => open.has(r.locationId)),
      notOfferedAt: service.notOfferedAt?.filter((id) => open.has(id)),
    }
    const problem = serviceRuleRefusal(s, visible)
    if (problem) breaches.push({ serviceId: service.id, service: service.name, problem })
  }
  return breaches
}

export function runBrandCommand(next: BusinessState, command: BrandCommand) {
  const o = next.operations!
  if (command.type === 'studio-look') {
    o.look = command.look
    return 'look'
  }
  const ids = [...new Set(command.coreServiceIds)]
  const live = new Set(next.services.filter((x) => !x.archived).map((x) => x.id))
  if (ids.some((id) => !live.has(id))) throw new Error('Choose treatments that are on the menu.')
  const rules: HouseRules = {
    ...(command.priceBandPercent !== null ? { priceBandPercent: command.priceBandPercent } : {}),
    ...(ids.length ? { coreServiceIds: ids } : {}),
  }
  if (Object.keys(rules).length) o.houseRules = rules
  else delete o.houseRules
  return 'house-rules'
}
