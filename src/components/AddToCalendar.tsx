import { useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import { Button } from '../design'
import { calendarFile, calendarFileName } from '../domain/calendarFile'
import type { CalendarVisit } from '../domain/calendarFile'
import '../guest-extras.css'

/**
 * Downloads an .ics file for one visit, made in this browser. Nothing is sent anywhere and the
 * file holds only what the guest can already see on this page.
 */
export function AddToCalendar({ visit }: { visit: CalendarVisit }) {
  const [error, setError] = useState('')
  function download() {
    setError('')
    try {
      const blob = new Blob([calendarFile(visit)], { type: 'text/calendar;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = calendarFileName(visit)
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      setError('The calendar file could not be made. Note the date and time instead.')
    }
  }
  return (
    <div className="add-to-calendar">
      <Button variant="secondary" onClick={download}>
        <CalendarPlus size={17} aria-hidden="true" />
        Add to calendar
      </Button>
      {error && <small role="alert">{error}</small>}
    </div>
  )
}
