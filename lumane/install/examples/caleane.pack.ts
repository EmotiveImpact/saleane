// The LUMANE pack for Caleane, written by the LUMANE installer. It says what Ask Caleane is
// called, how it sounds, the pathways it may walk and what each account includes. Until a
// pathway is connected to Caleane's own code, it tells the person plainly it cannot do that yet.
import { z } from 'zod'
import { SkillRefusal, actionSkill, definePack, readSkill } from '../..'
import type { Allowance } from '../..'

/** Who is asking, and what the pathways need to answer them. Add what Caleane needs. */
export type AskContext = { personId: string }

/** A change Ask prepared. Caleane carries it out only after a person taps Approve. */
export type AskChange = { pathway: string; change: string }

const notConnected = (what: string): never => {
  throw new SkillRefusal(`${what} is not connected yet.`)
}

/** What each account includes each month. LUMANE stops before going over. */
export const allowance: Allowance<'typed' | 'talkSeconds'> = {
  monthly: { typed: 300, talkSeconds: 30 * 60 },
  // The most the AI may cost one account, in Caleane's smallest money unit (pence or cents).
  dailySpendCeilingMinor: 150,
  monthlySpendCeilingMinor: 2000,
  perPersonHourly: 30,
  maxTalkSessionSeconds: 10 * 60,
}

export const pack = definePack({
  name: 'Caleane',
  meters: {
    typed: { label: 'Questions typed to Ask Caleane', unit: 'uses' },
    talkSeconds: { label: 'Talking to Ask Caleane', unit: 'seconds' },
  },
  audiences: {
    team: {
      label: 'The Caleane team',
      instructions: [
        'You are Ask Caleane, the assistant inside Caleane, which handles events, calendars, people, invitations and reminders.',
        'Write warmly and clearly, like a kind and capable receptionist, in plain everyday words.',
        'Lead with the answer. Keep it short: a few sentences, or a short list with one item per line. Write plain text, without Markdown.',
        'Only state facts the pathways return. Never say something was done: say what you have prepared for them to approve.',
      ].join('\n'),
      meter: 'typed',
      doorways: ['The Ask Caleane panel', 'Talking to Ask Caleane'],
      skills: () => [
        readSkill<AskContext, { about?: string }>({
          name: 'look_up_events',
          description:
            'Looks up events on the calendars this person can see, by day, person or title.',
          input: z.object({ about: z.string().max(200).optional() }),
          allowed: () => true,
          // Connect to Caleane: return what the person may see, from Caleane's own records.
          run: () => notConnected('Look up events'),
        }),
        readSkill<AskContext, { about?: string }>({
          name: 'find_free_times',
          description: 'Finds times when everyone named is free, within working hours.',
          input: z.object({ about: z.string().max(200).optional() }),
          allowed: () => true,
          // Connect to Caleane: return what the person may see, from Caleane's own records.
          run: () => notConnected('Find free times'),
        }),
        actionSkill<AskContext, { change: string }, AskChange>({
          name: 'prepare_event',
          description:
            'Prepares a new event with a title, a time and the people to invite. It only prepares the change: a person approves it before anything changes.',
          input: z.object({ change: z.string().min(1).max(500) }),
          allowed: () => true,
          // Connect to Caleane: check it can be done, change nothing, and return
          // { summary, effect } for a person to approve.
          propose: () => notConnected('Prepare a new event'),
        }),
        actionSkill<AskContext, { change: string }, AskChange>({
          name: 'prepare_move',
          description:
            'Prepares moving an event to a new time, and who to tell. It only prepares the change: a person approves it before anything changes.',
          input: z.object({ change: z.string().min(1).max(500) }),
          allowed: () => true,
          // Connect to Caleane: check it can be done, change nothing, and return
          // { summary, effect } for a person to approve.
          propose: () => notConnected('Prepare a move'),
        }),
      ],
    },
  },
})
