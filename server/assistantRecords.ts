import { randomUUID } from 'node:crypto'
import type { PendingProposal, TurnResult } from '../lumane'
import { commandSchema } from '../src/domain/commandSchema'
import type { SocialChannel } from '../src/domain/inboxSchema'
import { digest } from './auth'
import type { Context } from './context'
import { canonical } from './http'

/**
 * LUMANE's records in SALEANE's database (migration 38): each change prepared for a person to
 * approve, each conversation's last few lines, and what each turn did. None of these opens its own
 * transaction, so each is written in the same transaction as the turn's settled cost.
 */

/** Who a record belongs to: the team, by their account, or a guest, by their visit to the page. */
export type Audience = 'team' | 'guests'
/** Where a turn came in: Ask's panel or a talk, or the receptionist's chat, texts, social or phone. */
export type Doorway = 'panel' | 'talk' | 'chat' | 'sms' | SocialChannel | 'phone'

/** An hour after its last message a conversation is forgotten, and the next starts afresh. */
export const CHAT_IDLE_MS = 60 * 60_000
/** A prepared change is kept for a day after it runs out, then removed. */
const KEEP_PROPOSALS_MS = 24 * 60 * 60_000
/** What each turn did is kept for 90 days. */
const KEEP_TURNS_MS = 90 * 24 * 60 * 60_000

export type ProposalStatus = 'waiting' | 'approved' | 'applied' | 'declined' | 'expired'
export type KeptProposal<Effect> = PendingProposal<Effect> & { status: ProposalStatus }

type ProposalRow = {
  id: string
  skill: string
  summary: string
  effect: string
  status: ProposalStatus
  proposed_at: number
  expires_at: number
}

/**
 * The fingerprint the command route takes of a change as it arrives: the same change, sent as
 * JSON and read by the same schema. A suggestion is known as applied when a change with its
 * fingerprint saves.
 */
export function commandFingerprint(command: unknown): string {
  const parsed = commandSchema.safeParse(JSON.parse(JSON.stringify(command)))
  return digest(canonical(parsed.success ? parsed.data : command))
}

/** Keeps each change a turn prepared, waiting for the person who asked to decide. */
export function keepProposals<Effect>(
  ctx: Context,
  orgId: string,
  audience: Audience,
  person: string,
  proposals: PendingProposal<Effect>[],
  fingerprint: (effect: Effect) => string,
) {
  ctx.db.run('DELETE FROM assistant_proposals WHERE expires_at<?', ctx.now() - KEEP_PROPOSALS_MS)
  for (const proposal of proposals)
    ctx.db.run(
      `INSERT INTO assistant_proposals(id,organisation_id,audience,person,skill,summary,effect,fingerprint,status,proposed_at,expires_at)
       VALUES(?,?,?,?,?,?,?,?,'waiting',?,?)`,
      proposal.id,
      orgId,
      audience,
      person,
      proposal.skill,
      proposal.summary,
      JSON.stringify(proposal.effect),
      fingerprint(proposal.effect),
      Date.parse(proposal.proposedAt),
      Date.parse(proposal.expiresAt),
    )
}

/** A kept change, only for the person it was prepared for, in the studio it was prepared in. */
export function keptProposal<Effect>(
  ctx: Context,
  orgId: string,
  audience: Audience,
  person: string,
  id: string,
): KeptProposal<Effect> | undefined {
  const row = ctx.db.get<ProposalRow>(
    'SELECT id,skill,summary,effect,status,proposed_at,expires_at FROM assistant_proposals WHERE id=? AND organisation_id=? AND audience=? AND person=?',
    id,
    orgId,
    audience,
    person,
  )
  if (!row) return undefined
  return {
    id: row.id,
    skill: row.skill,
    summary: row.summary,
    effect: JSON.parse(row.effect) as Effect,
    status: row.status,
    proposedAt: new Date(row.proposed_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  }
}

/** Records what the person decided, or that it ran out first. Applied is set by `proposalApplied`. */
export function settleProposal(
  ctx: Context,
  id: string,
  status: Exclude<ProposalStatus, 'waiting'>,
) {
  const at = ctx.now()
  ctx.db.run(
    `UPDATE assistant_proposals SET status=?, decided_at=COALESCE(decided_at,?),
       applied_at=CASE WHEN ?='applied' THEN ? ELSE applied_at END WHERE id=?`,
    status,
    at,
    status,
    at,
    id,
  )
}

/**
 * Called as a change saves through the command route: the person's oldest approved suggestion with
 * the same fingerprint is now applied. Returns its id, so the change record can say so.
 */
export function proposalApplied(
  ctx: Context,
  orgId: string,
  accountId: string,
  fingerprint: string,
): string | undefined {
  const row = ctx.db.get<{ id: string }>(
    `SELECT id FROM assistant_proposals WHERE organisation_id=? AND person=? AND fingerprint=?
       AND status='approved' AND audience='team' ORDER BY decided_at, rowid LIMIT 1`,
    orgId,
    accountId,
    fingerprint,
  )
  if (row) settleProposal(ctx, row.id, 'applied')
  return row?.id
}

/** A conversation's id, its last few lines, and whether it carries on from earlier ones. */
export type Chat<Turn> = { id: string; turns: Turn[]; continuing: boolean }

/**
 * The conversation with this id, when it is this person's, in this studio, and still open;
 * otherwise a new one. Earlier lines come only from here, never from the browser. With `adopt`,
 * a new conversation takes the id the browser chose when no conversation has it, so the panel can
 * name its conversation before the first answer (a talk can start first).
 */
export function openChat<Turn>(
  ctx: Context,
  orgId: string,
  audience: Audience,
  person: string,
  id: string | undefined,
  options: { adopt?: boolean } = {},
): Chat<Turn> {
  const row = id
    ? ctx.db.get<{ turns: string; mine: number }>(
        'SELECT turns, (organisation_id=? AND audience=? AND person=? AND expires_at>?) AS mine FROM assistant_chats WHERE id=?',
        orgId,
        audience,
        person,
        ctx.now(),
        id,
      )
    : undefined
  if (row?.mine) return { id: id!, turns: JSON.parse(row.turns) as Turn[], continuing: true }
  return { id: options.adopt && id && !row ? id : randomUUID(), turns: [], continuing: false }
}

/**
 * Adds the latest lines to a conversation, keeping only the last `keep`, open for another hour.
 * A conversation with this id that is someone else's is left as it is.
 */
export function keepChat<Turn>(
  ctx: Context,
  orgId: string,
  audience: Audience,
  person: string,
  id: string,
  said: Turn[],
  keep: number,
) {
  const now = ctx.now()
  ctx.db.run('DELETE FROM assistant_chats WHERE expires_at<=?', now)
  // Read again inside the transaction, so two answers arriving together both keep their lines.
  const row = ctx.db.get<{ turns: string; mine: number }>(
    'SELECT turns, (organisation_id=? AND audience=? AND person=?) AS mine FROM assistant_chats WHERE id=?',
    orgId,
    audience,
    person,
    id,
  )
  if (row && !row.mine) return
  const turns = JSON.stringify(
    [...(row ? (JSON.parse(row.turns) as Turn[]) : []), ...said].slice(-keep),
  )
  if (row)
    ctx.db.run(
      'UPDATE assistant_chats SET turns=?, expires_at=? WHERE id=?',
      turns,
      now + CHAT_IDLE_MS,
      id,
    )
  else
    ctx.db.run(
      'INSERT INTO assistant_chats(id,organisation_id,audience,person,turns,started_at,expires_at) VALUES(?,?,?,?,?,?,?)',
      id,
      orgId,
      audience,
      person,
      turns,
      now,
      now + CHAT_IDLE_MS,
    )
}

/**
 * A record of what one turn did, without any words: whether it answered, why it ended, how many
 * calls to the AI, how long, what it cost, how many sentences the reply check took out, how many
 * changes it prepared and each pathway it used. Kept for 90 days.
 */
export function recordTurn(
  ctx: Context,
  orgId: string,
  audience: Audience,
  doorway: Doorway,
  accountId: string | null,
  model: string,
  result: TurnResult,
) {
  const at = ctx.now()
  ctx.db.run('DELETE FROM assistant_turns WHERE at<?', at - KEEP_TURNS_MS)
  ctx.db.run(
    `INSERT INTO assistant_turns(id,organisation_id,audience,doorway,account_id,status,reason,ended,steps,ms,cost_minor,corrected,prepared,skills,model,at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    randomUUID(),
    orgId,
    audience,
    doorway,
    accountId,
    result.status,
    result.status === 'answered' ? null : result.reason,
    result.report.ended,
    result.report.steps,
    Math.max(0, Math.round(result.report.ms)),
    result.status === 'refused' ? 0 : result.costMinor,
    result.report.corrected,
    result.status === 'answered' ? result.proposals.length : 0,
    JSON.stringify(result.report.skills),
    model,
    at,
  )
}

/** The model a turn used, for its record: the supplier's model, or the test-mode brain. */
export const modelOf = (ctx: Context, live: boolean) =>
  live ? (ctx.ai.model ?? ctx.ai.name) : 'test'
