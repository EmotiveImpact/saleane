import { ArrowUpRight } from 'lucide-react'
import { useStore } from '../state/context'
import type { Appointment } from '../domain/model'
import { money, timeLabel } from '../domain/format'
import { Avatar, Empty, Status } from '../design'

export function Agenda({
  appointments,
  onOpen,
  selectedId,
}: {
  appointments: Appointment[]
  onOpen: (id: string) => void
  selectedId?: string
}) {
  const { state } = useStore()
  if (!appointments.length)
    return (
      <Empty title="A little breathing room">
        No appointments on this day. Add a visit to get started.
      </Empty>
    )
  return (
    <div className="agenda-list">
      <div className="agenda-labels" aria-hidden="true">
        <span>Time</span>
        <span>Client & service</span>
        <span>Professional</span>
        <span>Status</span>
        <span>Value</span>
      </div>
      {appointments.map((a) => {
        const client = state.clients.find((c) => c.id === a.clientId)!
        const staff = state.staff.find((s) => s.id === a.staffId)!
        const service = state.services.find((s) => s.id === a.serviceId)!
        return (
          <button
            key={a.id}
            className="agenda-row"
            data-selected={selectedId === a.id ? '' : undefined}
            aria-haspopup="dialog"
            aria-expanded={selectedId === a.id}
            onClick={() => onOpen(a.id)}
          >
            <span className="agenda-time">
              {timeLabel(a.startMinutes, state.organisation.locale)}{' '}
              <small>{a.bookedDurationMinutes} min</small>
            </span>{' '}
            <span className="agenda-client">
              <Avatar small identity={client.id} name={client.name} tone={staff.tone} />
              <span>
                <strong>{client.name}</strong> <small>{service.name}</small>
              </span>
            </span>{' '}
            <span className="agenda-professional">{staff.name.split(' ')[0]}</span>{' '}
            <Status status={a.status} />{' '}
            <span className="agenda-value">
              {money(a.bookedPriceMinor, state.organisation)}
              <ArrowUpRight size={15} />
            </span>
          </button>
        )
      })}
    </div>
  )
}
