/**
 * The house photographs: AI-generated, fictional rooms and details chosen by
 * the owner on 7 October 2026, and a second set made for particular screens
 * on 10 October 2026 (docs/photo-prompts.md). They set the mood of the demo
 * and sample studios and are never presented as a real studio's premises or
 * people. A live studio supplies its own photographs.
 */
const library = '/images/library'

export const photos = {
  sunlitRoom: `${library}/rooms/sunlit-treatment-room.webp`,
  endOfDay: `${library}/rooms/end-of-day-warm.webp`,
  reception: `${library}/rooms/reception-morning.webp`,
  hairStudio: `${library}/rooms/hair-studio-daylight.webp`,
  entrance: `${library}/rooms/studio-exterior.webp`,
  calmStudio: `${library}/moments/all-in-hand.webp`,
  windowLight: `${library}/details/window-light.webp`,
  towels: `${library}/details/towels-stacked.webp`,
  tea: `${library}/details/tea-moment.webp`,
  facial: `${library}/treatments/signature-facial.webp`,
  blowDry: `${library}/treatments/hair-blowdry.webp`,
  manicure: `${library}/treatments/manicure.webp`,
  // Made for one place each: the eight setup screens, the team welcome and the screens they name.
  setupStudio: `${library}/setup/setup-studio.webp`,
  setupHours: `${library}/setup/setup-hours.webp`,
  setupTreatments: `${library}/setup/setup-treatments.webp`,
  setupTeam: `${library}/setup/setup-team.webp`,
  setupRooms: `${library}/setup/setup-rooms.webp`,
  setupLook: `${library}/setup/setup-look.webp`,
  setupDeposits: `${library}/setup/setup-deposits.webp`,
  setupOpen: `${library}/setup/setup-open.webp`,
  welcomeHello: `${library}/welcome/welcome-hello.webp`,
  welcomeDay: `${library}/welcome/welcome-day.webp`,
  welcomeSafe: `${library}/welcome/welcome-safe.webp`,
  signIn: `${library}/screens/sign-in.webp`,
  bookingPage: `${library}/screens/booking-page.webp`,
  guestVisit: `${library}/screens/guest-visit.webp`,
  today: `${library}/screens/today.webp`,
  calendar: `${library}/screens/calendar.webp`,
  clients: `${library}/screens/clients.webp`,
  stock: `${library}/screens/stock.webp`,
  closingUp: `${library}/screens/closing-up.webp`,
  waitlist: `${library}/screens/waitlist.webp`,
  nextVisit: `${library}/screens/next-visit.webp`,
} as const

const byCategory: Record<string, { src: string; position: string }[]> = {
  Skin: [{ src: photos.facial, position: 'center' }],
  Hair: [
    { src: photos.blowDry, position: 'center' },
    { src: photos.hairStudio, position: 'center' },
  ],
  Nails: [{ src: photos.manicure, position: 'center' }],
  Body: [
    { src: photos.sunlitRoom, position: 'center' },
    { src: photos.calmStudio, position: '88% center' },
  ],
}

/**
 * A photograph for a kind of treatment, for menus and booking previews. The
 * nth treatment of a kind takes the next photograph, so neighbours differ.
 */
export function treatmentPhoto(category: string, nth = 0) {
  const choices = byCategory[category] ?? byCategory.Body
  return choices[nth % choices.length]
}
