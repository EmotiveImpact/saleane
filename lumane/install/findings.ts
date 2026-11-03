import type { Look } from '../react/look'

/**
 * What the installer found when it read the app: its name, what it handles, its design and the
 * pathways Ask could walk there. A coding agent writes this after reading the app's code; the
 * install page shows it and builds its questions and live preview from it.
 */
export type AppFindings = {
  /** The app's name as written on screen, such as "Caleane". */
  name: string
  /** A shorter name its team uses, if any, such as "Cal". */
  short?: string
  /** How many files were read. */
  files: number
  /** What the app handles, a few plain words each, such as "events" or "invitations". */
  handles: string[]
  /** Where the app's design lives, and its colour, font, corners and light or dark. */
  design?: { file: string; look: Look }
  /** What Ask could do in this app. The app opens these; LUMANE walks only those chosen. */
  pathways: PathwayIdea[]
}

/** One thing Ask could do in the app. */
export type PathwayIdea = {
  /** The pathway's name for the AI supplier: lower case letters, digits and underscores. */
  name: string
  /** The pathway's title for people, such as "Look up events". */
  title: string
  /** Whether it only looks things up, or prepares a change for a person to approve. */
  kind: 'read' | 'action'
  /** What it does, in one sentence written for the AI. */
  description: string
  /** A question someone might ask that uses it, such as "What's on tomorrow?". */
  example: string
  /** Whether the installer recommends it to begin with. */
  recommended?: boolean
  /** What the live preview answers to the example, with the change it prepares, if any. */
  preview: {
    answer: string
    change?: { summary: string; details?: { label: string; value: string }[] }
  }
}
