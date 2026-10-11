import type { BusinessState } from '../domain/model'
import { CLOSING_LINE } from '../domain/moments'
import type { ClosingFigures } from '../domain/moments'
import { money } from '../domain/format'
import './moments.css'

/**
 * Stage 6: a settled day, set like a printed ledger. Each line is a count or an amount from the
 * record, with money called "recorded" because most of it was taken outside SALEANE.
 */
export function ClosingLedger({
  ledger,
  organisation,
}: {
  ledger: ClosingFigures
  organisation: Pick<BusinessState['organisation'], 'locale' | 'currency'>
}) {
  const rows: [string, string][] = [
    ['Guests seen', String(ledger.guestsSeen)],
    ['First-time guests', String(ledger.firstTime)],
    ['Rebooked before leaving', `${ledger.rebooked} of ${ledger.visits}`],
    ['Treatment takings recorded', money(ledger.takingsMinor, organisation, true)],
    ...(ledger.productsMinor
      ? ([['Products sold, before tax', money(ledger.productsMinor, organisation, true)]] as [
          string,
          string,
        ][])
      : []),
    ['Tips recorded', money(ledger.tipsMinor, organisation, true)],
  ]
  return (
    <div className="closing-ledger settle-in">
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {ledger.rentersMinor > 0 && (
        <p className="closing-ledger-aside">
          Renters’ own takings, {money(ledger.rentersMinor, organisation, true)}, are left out.
        </p>
      )}
      <p className="closing-ledger-note">{ledger.note}</p>
      <p className="closing-ledger-end">{CLOSING_LINE}</p>
    </div>
  )
}
