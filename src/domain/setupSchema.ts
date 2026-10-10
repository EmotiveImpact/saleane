import { z } from 'zod'

/**
 * "Set up your studio": the screens a new owner goes through after signing up, in order. Each
 * screen saves when the owner presses Continue, and the studio remembers the furthest screen
 * reached, so the owner can stop at any point and pick up there on any device.
 */
export const SETUP_STEPS = [
  'studio',
  'hours',
  'treatments',
  'team',
  'rooms',
  'look',
  'deposits',
  'open',
] as const
export type SetupStep = (typeof SETUP_STEPS)[number]
/** Where the owner picks up: a screen, or `done` once they have been through them all. */
export const SETUP_PLACES = [...SETUP_STEPS, 'done'] as const
export type SetupPlace = (typeof SETUP_PLACES)[number]

export const setupProgressSchema = z
  .object({
    next: z.enum(SETUP_PLACES),
    /** When the owner first went through every screen. */
    finishedAt: z.iso.datetime().optional(),
  })
  .strict()
export type SetupProgress = z.infer<typeof setupProgressSchema>

/** The changes a setup screen may make: exactly those Settings makes, each checked as it is there. */
export const SETUP_CHANGE_TYPES = [
  'organisation',
  'hours',
  'service',
  'staff',
  'resource',
  'tax',
  'protection',
  'studio-look',
] as const
/** Changes saved by one screen at most, such as a long list of treatments. */
export const SETUP_CHANGE_LIMIT = 200

/** Add a location: rooms and chairs at most, and new people who start there at most. */
export const OPENING_ROOM_LIMIT = 40
export const OPENING_NEW_TEAM_LIMIT = 30
