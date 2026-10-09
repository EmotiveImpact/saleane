import { useEffect, useState } from 'react'
import { useStore } from '../state/context'
import { api } from '../state/api'
import type { MessageKind, OutboxChannel, OutboxStatus } from '../domain/reminders'

export type SentMessage = {
  id: string
  appointmentId: string
  clientId: string
  kind: MessageKind
  channel: OutboxChannel
  recipient: string
  subject: string
  body: string
  status: OutboxStatus
  provider: string | null
  detail: string | null
  createdAt: string
  updatedAt: string
  /** V1.5: for a message written in the inbox, its id in the studio record. */
  messageId?: string
  /** V4: for an answer on a social app, its id in the studio record. */
  answerId?: string
}
type ProviderMode = { name: string; live: boolean }
export type OutboxReply = {
  messages: SentMessage[]
  providers: { email: ProviderMode; sms: ProviderMode }
}

export const kindLabel: Record<MessageKind, string> = {
  confirmation: 'Booking confirmation',
  changed: 'New time',
  reminder: 'Reminder',
  cancelled: 'Cancellation',
  feedback: 'How was your visit?',
  patch_test: 'Patch test needed',
  aftercare: 'Aftercare',
  due_back: 'Due back',
  birthday: 'Birthday',
  miss_you: 'We miss you',
  missed_call: 'Missed call',
  message: 'Written in the inbox',
  receptionist: 'AI receptionist',
  social: 'Answered by the team',
  plan_reminder: 'Membership payment reminder',
  plan_declined: 'Membership payment not taken',
  receipt: 'Receipt',
}
/** The outbox for one studio, or one client. Reads only; staff can ask a failed message to go again. */
export function useSentMessages(
  clientId?: string,
  options: { limit?: number; skip?: boolean } = {},
) {
  const { limit, skip = false } = options
  const { mode, state, session } = useStore()
  const [reply, setReply] = useState<OutboxReply | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const orgId = state.organisation.id
  const signedIn = mode === 'server' && !!session && !skip
  useEffect(() => {
    if (!signedIn) return
    let active = true
    const query = new URLSearchParams({
      ...(clientId ? { clientId } : {}),
      ...(limit ? { limit: String(limit) } : {}),
    }).toString()
    api<OutboxReply>(
      `/api/workspaces/${encodeURIComponent(orgId)}/outbox${query ? `?${query}` : ''}`,
    )
      .then((next) => {
        if (!active) return
        setReply(next)
        setError('')
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Sent messages could not be loaded.')
      })
    return () => {
      active = false
    }
  }, [orgId, clientId, limit, signedIn, state.revision, refresh])
  return { reply, error, load: () => setRefresh((n) => n + 1), available: signedIn }
}
