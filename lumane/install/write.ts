import { z } from 'zod'
import type { Allowance } from '../allowance'
import { definePack } from '../pack'
import type { Pack } from '../pack'
import { SkillRefusal, actionSkill, readSkill } from '../skill'
import type { Skill } from '../skill'
import { TONES, listed } from './answers'
import type { InstallAnswers } from './answers'
import type { AppFindings, PathwayIdea } from './findings'

/** The kinds of use every installed pack counts: typed questions and seconds of talking. */
export type InstalledMeter = 'typed' | 'talkSeconds'

/** What a chosen pathway's description says when it only prepares a change. */
const ONLY_PREPARES = 'It only prepares the change: a person approves it before anything changes.'

/** Everything the pack says, worked out once from the answers, for the file and for checking. */
export function packPlan(findings: AppFindings, answers: InstallAnswers) {
  const name = answers.name.trim()
  const ask = `Ask ${name}`
  const handles = findings.handles.length ? `, which handles ${listed(findings.handles)}` : ''
  const tone = typeof answers.tone === 'object' ? answers.tone.own.trim() : TONES[answers.tone].line
  const pathways = answers.pathways
    .map((chosen) => findings.pathways.find((p) => p.name === chosen))
    .filter((p): p is PathwayIdea => !!p)
    .map((p) => ({
      name: p.name,
      title: p.title,
      kind: p.kind,
      description: p.kind === 'action' ? `${p.description} ${ONLY_PREPARES}` : p.description,
    }))
  return {
    name,
    meters: {
      typed: { label: `Questions typed to ${ask}`, unit: 'uses' as const },
      talkSeconds: { label: `Talking to ${ask}`, unit: 'seconds' as const },
    },
    team: {
      label: `The ${name} team`,
      instructions: [
        `You are ${ask}, the assistant inside ${name}${handles}.`,
        tone,
        'Lead with the answer. Keep it short: a few sentences, or a short list with one item per line. Write plain text, without Markdown.',
        'Only state facts the pathways return. Never say something was done: say what you have prepared for them to approve.',
      ],
      doorways: [
        `The ${ask} panel`,
        ...(answers.allowances.talkMinutes > 0 ? [`Talking to ${ask}`] : []),
      ],
    },
    pathways,
    allowance: allowanceFor(answers.allowances),
  }
}

/**
 * The allowance for the amounts chosen, with spending limits that keep the AI's cost inside
 * them: the starter amounts and "More" match SALEANE's included and Plus plans, and other
 * amounts scale from them. Limits are in the app's smallest money unit (pence or cents).
 */
export function allowanceFor({
  typed,
  talkMinutes,
}: InstallAnswers['allowances']): Allowance<InstalledMeter> {
  const monthly = Math.max(2000, Math.ceil((typed * 3 + talkMinutes * 25) / 100) * 100)
  return {
    monthly: { typed, talkSeconds: talkMinutes * 60 },
    dailySpendCeilingMinor: monthly <= 2000 ? 150 : Math.ceil(monthly / 15 / 50) * 50,
    monthlySpendCeilingMinor: monthly,
    perPersonHourly: 30,
    maxTalkSessionSeconds: 10 * 60,
  }
}

/** A pathway not yet connected to the app: Ask says plainly it cannot do that yet. */
const notConnected = (what: string): never => {
  throw new SkillRefusal(`${what} is not connected yet.`)
}

/**
 * The pack the answers describe, in memory: the same pack `packSource` writes, so the install
 * page can check it with `packProblems` before any file is written.
 */
export function packFrom(findings: AppFindings, answers: InstallAnswers) {
  const plan = packPlan(findings, answers)
  const skills = (): Skill<unknown, unknown>[] =>
    plan.pathways.map((p) =>
      p.kind === 'read'
        ? readSkill<unknown, { about?: string }>({
            name: p.name,
            description: p.description,
            input: z.object({ about: z.string().max(200).optional() }),
            allowed: () => true,
            run: () => notConnected(p.title),
          })
        : actionSkill<unknown, { change: string }, unknown>({
            name: p.name,
            description: p.description,
            input: z.object({ change: z.string().min(1).max(500) }),
            allowed: () => true,
            propose: () => notConnected(p.title),
          }),
    )
  const pack: Pack<InstalledMeter> = {
    name: plan.name,
    meters: plan.meters,
    audiences: {
      team: {
        label: plan.team.label,
        instructions: plan.team.instructions.join('\n'),
        skills,
        meter: 'typed',
        doorways: plan.team.doorways,
      },
    },
  }
  return pack
}

/** The pack checked as an app would start with it: throws, listing every problem, if not ready. */
export function checkedPack(findings: AppFindings, answers: InstallAnswers) {
  return definePack(packFrom(findings, answers))
}

const quote = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const titleWord = (title: string) => title.charAt(0).toUpperCase() + title.slice(1)

/**
 * The pack as a file for the app, `src/lumane.pack.ts`. `lumane` is how the app imports LUMANE,
 * such as `'lumane'` for a package or `'../lumane'` for a copied folder. Each pathway is written
 * not yet connected, so it refuses plainly until the installer connects it to the app's code.
 */
export function packSource(
  findings: AppFindings,
  answers: InstallAnswers,
  { lumane = 'lumane' }: { lumane?: string } = {},
) {
  const plan = packPlan(findings, answers)
  const reads = plan.pathways.some((p) => p.kind === 'read')
  const actions = plan.pathways.some((p) => p.kind === 'action')
  const imports = [
    'SkillRefusal',
    ...(actions ? ['actionSkill'] : []),
    'definePack',
    ...(reads ? ['readSkill'] : []),
  ]
  const a = plan.allowance
  const skill = (p: (typeof plan.pathways)[number]) =>
    p.kind === 'read'
      ? `        readSkill<AskContext, { about?: string }>({
          name: ${quote(p.name)},
          description: ${quote(p.description)},
          input: z.object({ about: z.string().max(200).optional() }),
          allowed: () => true,
          // Connect to ${plan.name}: return what the person may see, from ${plan.name}'s own records.
          run: () => notConnected(${quote(titleWord(p.title))}),
        }),`
      : `        actionSkill<AskContext, { change: string }, AskChange>({
          name: ${quote(p.name)},
          description: ${quote(p.description)},
          input: z.object({ change: z.string().min(1).max(500) }),
          allowed: () => true,
          // Connect to ${plan.name}: check it can be done, change nothing, and return
          // { summary, effect } for a person to approve.
          propose: () => notConnected(${quote(titleWord(p.title))}),
        }),`
  return `// The LUMANE pack for ${plan.name}, written by the LUMANE installer. It says what Ask ${plan.name} is
// called, how it sounds, the pathways it may walk and what each account includes. Until a
// pathway is connected to ${plan.name}'s own code, it tells the person plainly it cannot do that yet.
import { z } from 'zod'
import { ${imports.join(', ')} } from ${quote(lumane)}
import type { Allowance } from ${quote(lumane)}

/** Who is asking, and what the pathways need to answer them. Add what ${plan.name} needs. */
export type AskContext = { personId: string }

/** A change Ask prepared. ${plan.name} carries it out only after a person taps Approve. */
export type AskChange = { pathway: string; change: string }

const notConnected = (what: string): never => {
  throw new SkillRefusal(\`\${what} is not connected yet.\`)
}

/** What each account includes each month. LUMANE stops before going over. */
export const allowance: Allowance<'typed' | 'talkSeconds'> = {
  monthly: { typed: ${a.monthly.typed}, talkSeconds: ${a.monthly.talkSeconds / 60} * 60 },
  // The most the AI may cost one account, in ${plan.name}'s smallest money unit (pence or cents).
  dailySpendCeilingMinor: ${a.dailySpendCeilingMinor},
  monthlySpendCeilingMinor: ${a.monthlySpendCeilingMinor},
  perPersonHourly: ${a.perPersonHourly},
  maxTalkSessionSeconds: ${a.maxTalkSessionSeconds / 60} * 60,
}

export const pack = definePack({
  name: ${quote(plan.name)},
  meters: {
    typed: { label: ${quote(plan.meters.typed.label)}, unit: 'uses' },
    talkSeconds: { label: ${quote(plan.meters.talkSeconds.label)}, unit: 'seconds' },
  },
  audiences: {
    team: {
      label: ${quote(plan.team.label)},
      instructions: [
${plan.team.instructions.map((line) => `        ${quote(line)},`).join('\n')}
      ].join('\\n'),
      meter: 'typed',
      doorways: [${plan.team.doorways.map(quote).join(', ')}],
      skills: () => [
${plan.pathways.map(skill).join('\n')}
      ],
    },
  },
})
`
}

/** The check that stays in the app's tests: the pack is ready, or the tests say what is not. */
export function packTestSource({
  lumane = 'lumane',
  test = 'vitest',
}: { lumane?: string; test?: string } = {}) {
  return `import { describe, expect, it } from ${quote(test)}
import { packProblems } from ${quote(lumane)}
import { pack } from './lumane.pack'

describe('the LUMANE pack', () => {
  it('is ready: nothing missing, and every pathway named as an AI supplier accepts', () => {
    expect(packProblems(pack)).toEqual([])
  })
})
`
}
