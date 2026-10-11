import type { Meter } from './allowance'
import type { Skill } from './skill'
import type { Voice } from './voice'

/**
 * The pack is what an app hands LUMANE when it installs it: what LUMANE is called there, who meets
 * it, the pathways it may use for each of them and the kinds of use the app sells. LUMANE walks
 * only the pathways in the pack and never reaches into the app by itself. The app keeps its own
 * records, permission checks and look; a new pathway is the app's choice, never LUMANE's.
 */
export type Pack<
  M extends Meter = Meter,
  A extends Record<string, Audience<never, unknown, M>> = Record<
    string,
    Audience<never, unknown, M>
  >,
> = {
  /** The app's name as it is written on screen. Its team meets LUMANE as "Ask" and this name. */
  name: string
  /** The kinds of use the app sells, such as typed questions or talking minutes. */
  meters: Record<M, MeterLabel>
  /** Who meets the assistant, such as the team or guests, and what each of them may use. */
  audiences: A
  /** The voices the app offers and the one used when nobody has chosen. */
  voices?: { list: Voice[]; fallback: string }
}

/** How a kind of use is shown on the app's usage meter. */
export type MeterLabel = {
  /** A plain label, such as "Questions typed to Ask SALEANE". */
  label: string
  /** Whether it is counted in uses or in seconds of talking. */
  unit: 'uses' | 'seconds'
}

/** One group of people who meet the assistant, and everything it may do for them. */
export type Audience<Ctx, Effect = unknown, M extends Meter = Meter> = {
  /** Who they are, in plain words, such as "The studio team". */
  label: string
  /** Who the assistant is to them and the app's own rules. LUMANE adds its rules after these. */
  instructions: string
  /**
   * The pathways: what the assistant may look up (`read` skills) and what it may prepare for a
   * person to approve (`action` skills). Built when asked, so each request has fresh skills.
   */
  skills: () => Skill<Ctx, Effect>[]
  /** What one request from them counts against, unless the app says otherwise for a request. */
  meter: M
  /** Where they meet the assistant, in the app's own words, such as "The Ask panel". */
  doorways: string[]
}

/** The name the app's team sees: "Ask" and the app's name, such as "Ask SALEANE". */
export function askName(pack: Pick<Pack, 'name'>) {
  return `Ask ${pack.name.trim()}`
}

/** Skill names an AI supplier accepts: letters, digits, underscores and hyphens, up to 64. */
const SKILL_NAME = /^[a-zA-Z0-9_-]{1,64}$/

/**
 * Everything wrong with a pack, in plain sentences; empty when it is ready to use. An installer
 * checks a pack it has written with this before anyone relies on it.
 */
export function packProblems(pack: Pack): string[] {
  const problems: string[] = []
  const name = pack.name.trim()
  if (!name) problems.push('The pack needs the app’s name.')
  else if (/^ask\s/i.test(name))
    problems.push(
      `The name is the app’s own, without “Ask”: LUMANE adds it, so “${name}” would show as “Ask ${name}”.`,
    )
  const meters = Object.keys(pack.meters)
  if (!meters.length) problems.push('The pack needs at least one kind of use to count.')
  for (const meter of meters)
    if (!pack.meters[meter]?.label.trim())
      problems.push(`The kind of use “${meter}” needs a label.`)
  const audiences = Object.entries(pack.audiences)
  if (!audiences.length) problems.push('The pack needs at least one audience, such as the team.')
  for (const [key, audience] of audiences) {
    const who = audience.label.trim() || key
    if (!audience.label.trim()) problems.push(`The audience “${key}” needs a label.`)
    if (!audience.instructions.trim()) problems.push(`${who}: the instructions are empty.`)
    if (!meters.includes(audience.meter))
      problems.push(`${who}: counts against “${audience.meter}”, which the pack does not name.`)
    if (!audience.doorways.length) problems.push(`${who}: there is nowhere to meet the assistant.`)
    const seen = new Set<string>()
    for (const skill of audience.skills()) {
      if (!SKILL_NAME.test(skill.name))
        problems.push(`${who}: “${skill.name}” is not a name an AI supplier accepts.`)
      if (seen.has(skill.name)) problems.push(`${who}: two pathways are called “${skill.name}”.`)
      seen.add(skill.name)
      if (!skill.description.trim()) problems.push(`${who}: “${skill.name}” needs a description.`)
    }
  }
  if (pack.voices && !pack.voices.list.some((voice) => voice.key === pack.voices?.fallback))
    problems.push(`The default voice “${pack.voices.fallback}” is not on the list of voices.`)
  return problems
}

/**
 * The app's pack, checked. A pack with a problem stops the app as it starts, as a missing AI key
 * does, rather than leaving the assistant half set up.
 */
export function definePack<M extends Meter, A extends Record<string, Audience<never, unknown, M>>>(
  pack: Pack<M, A>,
): Pack<M, A> {
  const problems = packProblems(pack as unknown as Pack)
  if (problems.length) throw new Error(`The LUMANE pack is not ready:\n${problems.join('\n')}`)
  return pack
}
