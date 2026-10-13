import { lookProblems } from '../react/look'
import type { Look } from '../react/look'
import type { AppFindings } from './findings'

/** The five answers that set LUMANE up in an app. */
export type InstallAnswers = {
  /** The app's name as Ask shows it, without "Ask": "Caleane" shows as "Ask Caleane". */
  name: string
  tone: Tone | { own: string }
  /** The names of the pathways chosen. */
  pathways: string[]
  /** What each account includes each month. */
  allowances: { typed: number; talkMinutes: number }
  look: 'own' | 'default' | 'plain'
  /** With LUMANE's default look, its four choices, so the coding agent builds what was previewed. */
  defaultLook?: Look
}

export type Tone = keyof typeof TONES

/** How the assistant can sound, each with the line its instructions carry. */
export const TONES = {
  warm: {
    title: 'Warm and friendly',
    about: 'Kind and clear, like a good receptionist.',
    line: 'Write warmly and clearly, like a kind and capable receptionist, in plain everyday words.',
  },
  calm: {
    title: 'Calm and polished',
    about: 'Quiet and precise.',
    line: 'Write calmly and precisely, in few words, without exclamation marks.',
  },
  bright: {
    title: 'Bright and cheerful',
    about: 'Upbeat, with short sentences.',
    line: 'Write brightly and cheerfully, in short sentences, while staying clear.',
  },
} as const

/** The amounts offered, as the questions show them. */
export const ALLOWANCE_CHOICES = {
  starter: { title: 'Starter amounts', typed: 300, talkMinutes: 30 },
  more: { title: 'More', typed: 1000, talkMinutes: 120 },
} as const

/** The looks offered, as the questions show them. */
export const LOOKS = {
  own: { about: 'Your colours, fonts and corners.' },
  default: { about: 'Set by four choices: a colour, a font, the corners and light or dark.' },
  plain: { about: 'No styling at all; your team dresses them.' },
} as const

/** The answers the installer recommends for an app: the first steps a person would take. */
export function recommendedAnswers(findings: AppFindings): InstallAnswers {
  const { typed, talkMinutes } = ALLOWANCE_CHOICES.starter
  return {
    name: findings.name,
    tone: 'warm',
    pathways: findings.pathways.filter((p) => p.recommended).map((p) => p.name),
    allowances: { typed, talkMinutes },
    look: findings.design ? 'own' : 'default',
  }
}

/** One of the five questions, with its options, as both the page and the coding agent ask it. */
export type Question = {
  key: 'name' | 'tone' | 'pathways' | 'allowances' | 'look'
  /** A short heading, twelve letters at most, as a coding agent's question tool needs. */
  header: string
  question: string
  hint: string
  multiple: boolean
  options: { id: string; title: string; about: string; recommended?: boolean }[]
}

const listed = (items: string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

/** The five questions for this app, in the order they are asked. */
export function installQuestions(findings: AppFindings): Question[] {
  const app = findings.name
  return [
    {
      key: 'name',
      header: 'Name',
      question: 'What should the assistant be called?',
      hint: 'Your team meets it by this name. LUMANE always adds “Ask”.',
      multiple: false,
      options: [
        {
          id: app,
          title: `Ask ${app}`,
          about: '“Ask” and your app’s own name.',
          recommended: true,
        },
        ...(findings.short
          ? [{ id: findings.short, title: `Ask ${findings.short}`, about: 'A shorter name.' }]
          : []),
      ],
    },
    {
      key: 'tone',
      header: 'Tone',
      question: 'How should it sound?',
      hint: 'Used in everything it writes, and when it talks out loud.',
      multiple: false,
      options: (Object.keys(TONES) as Tone[]).map((id) => ({
        id,
        title: TONES[id].title,
        about: TONES[id].about,
        recommended: id === 'warm',
      })),
    },
    {
      key: 'pathways',
      header: 'Pathways',
      question: 'Which pathways should it have?',
      hint: 'Looking things up is safe. Anything that changes something waits for a person to tap Approve.',
      multiple: true,
      options: findings.pathways.map((p) => ({
        id: p.name,
        title: p.title,
        about: p.kind === 'read' ? 'Looks only.' : 'Waits for a person to approve it.',
        recommended: !!p.recommended,
      })),
    },
    {
      key: 'allowances',
      header: 'Allowances',
      question: 'How much should each account include each month?',
      hint: 'LUMANE stops before going over, so it never costs more than you planned.',
      multiple: false,
      options: (['starter', 'more'] as const).map((id) => {
        const choice = ALLOWANCE_CHOICES[id]
        return {
          id,
          title: choice.title,
          about: `${choice.typed.toLocaleString('en-GB')} typed questions and ${choice.talkMinutes} minutes of talking.`,
          recommended: id === 'starter',
        }
      }),
    },
    {
      key: 'look',
      header: 'Look',
      question: 'How should it look?',
      hint: findings.design
        ? `LUMANE found ${app}’s colours, fonts and corners in ${findings.design.file}, so it can match them.`
        : `LUMANE did not find ${app}’s design, so it offers its default look or plain parts.`,
      multiple: false,
      options: [
        ...(findings.design
          ? [{ id: 'own', title: `${app}’s own design`, about: LOOKS.own.about, recommended: true }]
          : []),
        {
          id: 'default',
          title: 'LUMANE’s default look',
          about: LOOKS.default.about,
          recommended: !findings.design,
        },
        { id: 'plain', title: 'Plain parts only', about: LOOKS.plain.about },
      ],
    },
  ]
}

/** Anything wrong with a set of answers, in plain sentences; empty when they are ready. */
export function answerProblems(findings: AppFindings, answers: InstallAnswers): string[] {
  const problems: string[] = []
  const name = answers.name.trim()
  if (!name) problems.push('The assistant needs a name.')
  else if (/^ask\s/i.test(name))
    problems.push(`The name goes without “Ask”: LUMANE adds it, so this would be “Ask ${name}”.`)
  if (typeof answers.tone === 'object' && !answers.tone.own.trim())
    problems.push('Say how it should sound, or choose one of the tones.')
  if (!answers.pathways.length) problems.push('Choose at least one pathway.')
  for (const chosen of answers.pathways)
    if (!findings.pathways.some((p) => p.name === chosen))
      problems.push(`“${chosen}” is not one of the pathways found in ${findings.name}.`)
  const { typed, talkMinutes } = answers.allowances
  if (!Number.isInteger(typed) || typed < 1 || typed > 100_000)
    problems.push('Typed questions need to be a whole number from 1 to 100,000.')
  if (!Number.isInteger(talkMinutes) || talkMinutes < 0 || talkMinutes > 10_000)
    problems.push('Talking minutes need to be a whole number from 0 to 10,000.')
  if (answers.look === 'own' && !findings.design)
    problems.push(`LUMANE did not find ${findings.name}’s design, so choose another look.`)
  if (answers.look === 'default' && answers.defaultLook)
    problems.push(...lookProblems(answers.defaultLook))
  return problems
}

/**
 * The answers as a short block of text, which the install page gives the person to paste into
 * their coding agent after `/lumane:install`, and `readAnswers` reads back.
 */
export function answersText(answers: InstallAnswers) {
  const tone = typeof answers.tone === 'object' ? `own: ${answers.tone.own}` : answers.tone
  return [
    'LUMANE answers',
    `Name: ${answers.name}`,
    `Tone: ${tone}`,
    `Pathways: ${answers.pathways.join(', ')}`,
    `Allowances: ${answers.allowances.typed} typed questions, ${answers.allowances.talkMinutes} talking minutes`,
    `Look: ${lookText(answers)}`,
  ].join('\n')
}

/** "own", "plain", or "default" with its four choices, which no font name can confuse. */
function lookText({ look, defaultLook }: InstallAnswers) {
  if (look !== 'default' || !defaultLook) return look
  const { colour, font, corners, scheme } = defaultLook
  return `default (colour ${colour}; font ${font}; corners ${corners}; scheme ${scheme})`
}

const LOOK_TEXT =
  /^default \(colour (#[0-9a-f]{3}|#[0-9a-f]{6}); font ([^;]+); corners (square|soft|round); scheme (light|dark)\)$/i

/** Reads a block written by `answersText`; `null` when it is not one. */
export function readAnswers(text: string): InstallAnswers | null {
  const lines = text.slice(text.indexOf('LUMANE answers')).split('\n')
  if (!text.includes('LUMANE answers')) return null
  const field = (label: string) =>
    lines
      .find((line) => line.startsWith(`${label}:`))
      ?.slice(label.length + 1)
      .trim()
  const name = field('Name')
  const tone = field('Tone')
  const pathways = field('Pathways')
  const allowances = field('Allowances')?.match(/^(\d+) typed questions, (\d+) talking minutes$/)
  const lookLine = field('Look')
  if (!name || !tone || pathways === undefined || !allowances || !lookLine) return null
  const chosen = lookLine.match(LOOK_TEXT)
  const look = chosen ? 'default' : lookLine
  if (look !== 'own' && look !== 'default' && look !== 'plain') return null
  const ownTone = tone.startsWith('own: ') ? { own: tone.slice(5) } : null
  if (!ownTone && !(tone in TONES)) return null
  return {
    name,
    tone: ownTone ?? (tone as Tone),
    pathways: pathways ? pathways.split(',').map((p) => p.trim()) : [],
    allowances: { typed: Number(allowances[1]), talkMinutes: Number(allowances[2]) },
    look,
    ...(chosen && {
      defaultLook: {
        colour: chosen[1],
        font: chosen[2].trim(),
        corners: chosen[3].toLowerCase() as Look['corners'],
        scheme: chosen[4].toLowerCase() as Look['scheme'],
      },
    }),
  }
}

export { listed }
