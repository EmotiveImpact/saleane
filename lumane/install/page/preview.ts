import type { AskTransport, UsageItem } from '../../react'
import type { InstallAnswers } from '../answers'
import type { AppFindings, PathwayIdea } from '../findings'

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))
/** Words too common to say which pathway a question is about. */
const COMMON = new Set(
  'the and for you your can could what whats who how are any all with this that please tell me'.split(
    ' ',
  ),
)
const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[’']/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !COMMON.has(w)),
  )

/** The chosen pathway a question is most like, by the words it shares with its example. */
export function pathwayFor(question: string, pathways: PathwayIdea[]) {
  const asked = words(question)
  let best: { pathway: PathwayIdea; score: number } | null = null
  for (const pathway of pathways) {
    const known = words(`${pathway.example} ${pathway.title}`)
    const score = [...asked].filter((w) => known.has(w)).length
    if (score > (best?.score ?? 0)) best = { pathway, score }
  }
  return best?.pathway ?? null
}

/** The usage line for the amounts chosen, with a few questions already asked. */
export function previewUsage(answers: InstallAnswers, typed = 3): UsageItem[] {
  const { allowances } = answers
  return [
    { used: typed, allowance: allowances.typed, unit: 'uses', noun: 'questions' },
    ...(allowances.talkMinutes > 0
      ? [
          {
            used: 0,
            allowance: allowances.talkMinutes * 60,
            unit: 'seconds' as const,
            noun: 'talking minutes',
          },
        ]
      : []),
  ]
}

/** How the assistant opens, in the tone chosen. */
export function greetingFor(answers: InstallAnswers) {
  if (typeof answers.tone === 'object') return 'Hello. How can I help?'
  return {
    warm: 'Hello. What can I help you with today?',
    calm: 'Good day. How can I help?',
    bright: 'Hi there! What shall we get done today?',
  }[answers.tone]
}

/**
 * A pretend app behind the live preview. It answers the examples of the chosen pathways with
 * what the installer found, prepares their changes for approval and counts the questions, as the
 * installed panel will; nothing leaves the page and nothing real changes.
 */
export function previewTransport(
  findings: AppFindings,
  answers: InstallAnswers,
  { pause = 600 }: { pause?: number } = {},
): AskTransport {
  const chosen = findings.pathways.filter((p) => answers.pathways.includes(p.name))
  let asked = 3
  let changes = 0
  return {
    ask: async (question) => {
      await wait(pause)
      asked += 1
      const usage = previewUsage(answers, asked)
      const pathway = pathwayFor(question, chosen)
      if (!pathway)
        return {
          text: `In this preview I can answer the examples below. Once installed, Ask ${answers.name} answers from ${findings.name}’s own records.`,
          proposals: [],
          usage,
        }
      const { answer, change } = pathway.preview
      return {
        text: answer,
        proposals: change ? [{ id: `${pathway.name}-${++changes}`, ...change }] : [],
        usage,
      }
    },
    decide: async (_id, approve) => {
      await wait(pause)
      return approve ? 'done' : 'declined'
    },
    ...(answers.allowances.talkMinutes > 0
      ? {
          talk: {
            start: async () => {
              await wait(pause)
              return { seconds: Math.min(10, answers.allowances.talkMinutes) * 60 }
            },
            stop: async () => {},
          },
        }
      : {}),
  }
}
