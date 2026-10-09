import { Users } from 'lucide-react'
import type { Role } from '../domain/operations'
import './invitationSummary.css'

/** What the join page may read about an invitation before anyone signs in. */
export type InvitationPreview = {
  studio: string
  role: Role
  /** The location a general manager runs. */
  location?: string
  /** The region a regional manager looks after. */
  region?: string
  email: string
}

const roles: Record<Role, { name: string; note: string }> = {
  owner: { name: 'Owner', note: 'Runs the whole studio.' },
  manager: {
    name: 'Manager',
    note: 'Runs the studio day to day, from the diary and clients to the team and money.',
  },
  reception: {
    name: 'Reception',
    note: 'Looks after bookings, clients and checkout.',
  },
  practitioner: {
    name: 'Practitioner',
    note: 'Sees their own visits and the notes that help them look after each client.',
  },
  general: {
    name: 'General manager',
    note: 'Runs one location: its diary, takings, stock and branch visits.',
  },
  regional: {
    name: 'Regional manager',
    note: 'Looks after the locations in one region, their branch visits and sign-offs.',
  },
}

/** The role and place a team invitation offers, shown on the join page. */
export function InvitationSummary({ invitation }: { invitation: InvitationPreview }) {
  const role = roles[invitation.role] ?? { name: invitation.role, note: '' }
  return (
    <section className="invitation-summary" aria-label="Your invitation">
      <span className="invitation-summary-icon" aria-hidden="true">
        <Users size={19} />
      </span>
      <dl>
        <div>
          <dt>Your role</dt>
          <dd>{role.name}</dd>
        </div>
        {invitation.location && (
          <div>
            <dt>Location</dt>
            <dd>{invitation.location}</dd>
          </div>
        )}
        {invitation.region && (
          <div>
            <dt>Region</dt>
            <dd>{invitation.region}</dd>
          </div>
        )}
      </dl>
      {role.note && <p>{role.note}</p>}
    </section>
  )
}
