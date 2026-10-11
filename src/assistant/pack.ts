import { definePack } from '../../lumane'
import { APP_NAME, ASK_NAME } from './name'
import { RECEPTION_INSTRUCTIONS, receptionistSkills } from './receptionist'
import { INSTRUCTIONS, askSaleaneSkills } from './saleane'
import { DEFAULT_VOICE, VOICES } from './voices'

/** A reply saying the assistant itself moved money, which it never does. */
const MONEY_CLAIM =
  /\bI(?:['’]ve|\s+have)?\s+(?:(?:just|now|already)\s+)*(?:refunded|charged|paid|taken\s+(?:the\s+|a\s+|your\s+)?(?:payment|deposit)|took\s+(?:the\s+|a\s+|your\s+)?(?:payment|deposit))\b/i

/**
 * SALEANE's pack for LUMANE: everything SALEANE hands the assistant engine. The studio team meets
 * it as Ask SALEANE and guests meet the studio's AI receptionist, each with their own pathways.
 * SALEANE keeps its records, permission checks and approvals; LUMANE uses only what is listed
 * here. A new pathway is added to the skills for the people who should have it.
 */
export const SALEANE_PACK = definePack({
  name: APP_NAME,
  meters: {
    typed: { label: `Questions typed to ${ASK_NAME}`, unit: 'uses' },
    talkSeconds: { label: `Talking to ${ASK_NAME}`, unit: 'seconds' },
    guestChats: { label: 'Guest chats with the AI receptionist', unit: 'uses' },
    phoneSeconds: { label: 'Minutes of calls answered by the AI receptionist', unit: 'seconds' },
  },
  audiences: {
    team: {
      label: 'Owners, managers and reception',
      instructions: INSTRUCTIONS,
      skills: askSaleaneSkills,
      meter: 'typed',
      doorways: [`The ${ASK_NAME} panel`, `Talking to ${ASK_NAME}`],
      // Money is SALEANE's own: the assistant never refunds, charges or takes a payment.
      reply: { claims: [MONEY_CLAIM] },
    },
    guests: {
      label: 'Guests',
      instructions: RECEPTION_INSTRUCTIONS,
      skills: receptionistSkills,
      meter: 'guestChats',
      doorways: [
        'Chat on the booking page',
        'Texts to the studio',
        'Instagram and Facebook messages',
        'Calls the desk misses, with the phone receptionist',
      ],
      reply: {
        claims: [MONEY_CLAIM],
        notes: {
          prepared: 'Nothing is booked or sent until you choose it.',
          unprepared: 'I cannot book or change anything myself, so nothing has changed.',
        },
      },
    },
  },
  voices: { list: VOICES, fallback: DEFAULT_VOICE },
})

/** The kinds of use SALEANE sells, as the pack names them. */
export type SaleaneMeter = keyof typeof SALEANE_PACK.meters
