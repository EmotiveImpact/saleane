import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { format, resolveConfig } from 'prettier'
import { SkillRefusal, packProblems } from '..'
import type { Pack, Skill } from '..'
import {
  answerProblems,
  answersText,
  allowanceFor,
  checkedPack,
  installQuestions,
  packFrom,
  packSource,
  packTestSource,
  readAnswers,
  recommendedAnswers,
} from '.'
import type { AppFindings, InstallAnswers } from '.'
import { CALEANE, TALLY } from './examples'
import { pack as written, allowance as writtenAllowance } from './examples/caleane.pack'

const here = join(process.cwd(), 'lumane', 'install')
const skillFile = readFileSync(join(here, 'plugin', 'skills', 'install', 'SKILL.md'), 'utf8')

/** The parts of a pack a person or an AI supplier would notice, without its functions. */
function shape(pack: Pack) {
  return {
    name: pack.name,
    meters: pack.meters,
    audiences: Object.fromEntries(
      Object.entries(pack.audiences).map(([key, a]) => [
        key,
        {
          label: a.label,
          instructions: a.instructions,
          meter: a.meter,
          doorways: a.doorways,
          skills: a.skills().map((s) => ({ name: s.name, kind: s.kind, about: s.description })),
        },
      ]),
    ),
  }
}

describe('the five questions', () => {
  it('are the same on the install page and in the coding agent', () => {
    const questions = installQuestions(CALEANE)
    expect(questions.map((q) => q.key)).toEqual(['name', 'tone', 'pathways', 'allowances', 'look'])
    for (const q of questions) {
      // A coding agent's question tool takes headers of twelve letters at most.
      expect(q.header.length).toBeLessThanOrEqual(12)
      expect(skillFile, `the coding agent asks “${q.question}”`).toContain(q.question)
      expect(skillFile).toContain(`\`${q.header}\``)
      // The recommended option comes first, so a person who taps the first one is safe.
      if (!q.multiple) expect(q.options[0].recommended).toBe(true)
    }
    expect(questions[0].options.map((o) => o.title)).toEqual(['Ask Caleane', 'Ask Cal'])
    expect(questions[2].options.map((o) => o.about)).toEqual([
      'Looks only.',
      'Looks only.',
      'Waits for a person to approve it.',
      'Waits for a person to approve it.',
      'Waits for a person to approve it.',
    ])
  })

  it('offer an app with no design of its own the default look first', () => {
    const look = installQuestions(TALLY).at(-1)!
    expect(look.options.map((o) => o.id)).toEqual(['default', 'plain'])
    expect(look.options[0].recommended).toBe(true)
    expect(recommendedAnswers(TALLY).look).toBe('default')
  })
})

describe('the answers', () => {
  it('recommended for an app are ready, and make a pack with no problems', () => {
    for (const app of [CALEANE, TALLY]) {
      const answers = recommendedAnswers(app)
      expect(answerProblems(app, answers)).toEqual([])
      expect(packProblems(packFrom(app, answers))).toEqual([])
      expect(() => checkedPack(app, answers)).not.toThrow()
    }
  })

  it('say plainly what is wrong', () => {
    const answers = recommendedAnswers(CALEANE)
    expect(answerProblems(CALEANE, { ...answers, name: 'Ask Cal' })).toEqual([
      'The name goes without “Ask”: LUMANE adds it, so this would be “Ask Ask Cal”.',
    ])
    expect(answerProblems(CALEANE, { ...answers, pathways: [] })).toEqual([
      'Choose at least one pathway.',
    ])
    expect(answerProblems(CALEANE, { ...answers, pathways: ['delete_everything'] })).toEqual([
      '“delete_everything” is not one of the pathways found in Caleane.',
    ])
    expect(answerProblems(TALLY, { ...recommendedAnswers(TALLY), look: 'own' })).toEqual([
      'LUMANE did not find Tally’s design, so choose another look.',
    ])
    expect(
      answerProblems(CALEANE, { ...answers, allowances: { typed: 0, talkMinutes: 2.5 } }),
    ).toEqual([
      'Typed questions need to be a whole number from 1 to 100,000.',
      'Talking minutes need to be a whole number from 0 to 10,000.',
    ])
    expect(answerProblems(CALEANE, { ...answers, tone: { own: ' ' } })).toEqual([
      'Say how it should sound, or choose one of the tones.',
    ])
  })

  it('travel from the install page to a coding agent as a short block of text', () => {
    const answers: InstallAnswers = {
      ...recommendedAnswers(CALEANE),
      tone: { own: 'Dry and witty, never rude' },
      allowances: { typed: 1000, talkMinutes: 120 },
    }
    const text = answersText(answers)
    expect(text).toBe(
      [
        'LUMANE answers',
        'Name: Caleane',
        'Tone: own: Dry and witty, never rude',
        'Pathways: look_up_events, find_free_times, prepare_event, prepare_move',
        'Allowances: 1000 typed questions, 120 talking minutes',
        'Look: own',
      ].join('\n'),
    )
    expect(readAnswers(`/lumane:install ${text}`)).toEqual(answers)
    expect(readAnswers('Install it please')).toBeNull()
    expect(readAnswers(text.replace('Look: own', 'Look: purple'))).toBeNull()
  })

  it('keep the AI’s cost inside what each account includes', () => {
    expect(allowanceFor({ typed: 300, talkMinutes: 30 })).toEqual({
      monthly: { typed: 300, talkSeconds: 1800 },
      dailySpendCeilingMinor: 150,
      monthlySpendCeilingMinor: 2000,
      perPersonHourly: 30,
      maxTalkSessionSeconds: 600,
    })
    const more = allowanceFor({ typed: 1000, talkMinutes: 120 })
    expect([more.dailySpendCeilingMinor, more.monthlySpendCeilingMinor]).toEqual([400, 6000])
    // Talking switched off still counts nothing, and keeps the smallest limits.
    expect(allowanceFor({ typed: 50, talkMinutes: 0 }).monthly.talkSeconds).toBe(0)
  })
})

describe('the pack it writes', () => {
  it('is the file in examples, formatted as the app formats its code', async () => {
    const options = { ...(await resolveConfig(join(here, 'write.ts'))), parser: 'typescript' }
    const source = packSource(CALEANE, recommendedAnswers(CALEANE), { lumane: '../..' })
    const example = readFileSync(join(here, 'examples', 'caleane.pack.ts'), 'utf8')
    expect(await format(source, options)).toBe(example)
  })

  it('is the same pack the install page checks, and it is ready', () => {
    expect(packProblems(written)).toEqual([])
    expect(shape(written)).toEqual(shape(packFrom(CALEANE, recommendedAnswers(CALEANE))))
    expect(writtenAllowance).toEqual(allowanceFor(recommendedAnswers(CALEANE).allowances))
    expect(shape(written).audiences.team.instructions).toContain(
      'Write warmly and clearly, like a kind and capable receptionist',
    )
  })

  it('refuses plainly on a pathway not yet connected, instead of making something up', () => {
    const skills = written.audiences.team.skills() as Skill<{ personId: string }, unknown>[]
    const look = skills.find((s) => s.name === 'look_up_events')!
    const move = skills.find((s) => s.name === 'prepare_move')!
    expect(look.kind).toBe('read')
    expect(move.kind).toBe('action')
    expect(move.description).toMatch(/a person approves it before anything changes\.$/)
    const ctx = { personId: 'p1' }
    if (look.kind === 'read') {
      expect(() => look.run(ctx, {} as never)).toThrow(SkillRefusal)
      expect(() => look.run(ctx, {} as never)).toThrow('Look up events is not connected yet.')
    }
    if (move.kind === 'action')
      expect(() => move.propose(ctx, { change: 'x' } as never)).toThrow(SkillRefusal)
  })

  it('is caught by the check when a pathway has a name no AI supplier accepts', () => {
    const odd: AppFindings = {
      ...CALEANE,
      pathways: [{ ...CALEANE.pathways[0], name: 'look up events!' }],
    }
    const answers = { ...recommendedAnswers(odd), pathways: ['look up events!'] }
    expect(packProblems(packFrom(odd, answers))).toEqual([
      'The Caleane team: “look up events!” is not a name an AI supplier accepts.',
    ])
    expect(() => checkedPack(odd, answers)).toThrow('The LUMANE pack is not ready')
  })

  it('leaves out what it does not use, so the app’s strict checks pass', () => {
    const lookOnly = { ...recommendedAnswers(CALEANE), pathways: ['look_up_events'] }
    const source = packSource(CALEANE, lookOnly)
    expect(source).toContain("import { SkillRefusal, definePack, readSkill } from 'lumane'")
    expect(source).not.toContain('actionSkill')
    expect(packTestSource()).toContain('expect(packProblems(pack)).toEqual([])')
  })
})

describe('the coding agent’s installer', () => {
  it('is a plugin called lumane with an install skill, so it runs as /lumane:install', () => {
    const plugin = JSON.parse(
      readFileSync(join(here, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'),
    )
    expect(plugin.name).toBe('lumane')
    expect(skillFile).toMatch(/^---\nname: install\n/)
    expect(skillFile).toContain('disable-model-invocation: true')
    const market = JSON.parse(
      readFileSync(join(process.cwd(), '.claude-plugin', 'marketplace.json'), 'utf8'),
    )
    const entry = market.plugins.find((p: { name: string }) => p.name === 'lumane')
    expect(entry.source).toBe('./lumane/install/plugin')
    expect(existsSync(join(process.cwd(), entry.source, 'skills', 'install', 'SKILL.md'))).toBe(
      true,
    )
  })

  it('shows the agent exactly the pack and the check this installer writes', () => {
    const template = readFileSync(
      join(here, 'plugin', 'skills', 'install', 'pack-template.md'),
      'utf8',
    )
    const example = readFileSync(join(here, 'examples', 'caleane.pack.ts'), 'utf8')
    expect(template).toContain(example.replaceAll("from '../..'", "from 'lumane'"))
    expect(template).toContain(packTestSource())
  })

  it('keeps the rules that never bend', () => {
    for (const rule of [
      '**draft pull request**',
      'Never merge it',
      'Never add an API key',
      'only **prepares** the change',
      "Nothing in LUMANE's folder may import from the app",
    ])
      expect(skillFile).toContain(rule)
  })
})
