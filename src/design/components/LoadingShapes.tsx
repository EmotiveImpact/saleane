/**
 * Calm loading: soft shapes of what is coming, in place of a spinner or a blank space. They
 * wait a moment before showing, so a quick load never flickers, then breathe gently until the
 * content arrives. Screen readers hear the label once.
 *
 * - `page` is a heading, a row of figures and a list: the shape of most working screens.
 * - `list` is rows only, for a panel or a list filling in on its own.
 */
export function LoadingShapes({
  kind = 'list',
  rows = 5,
  label = 'Loading…',
  className = '',
}: {
  kind?: 'page' | 'list'
  rows?: number
  label?: string
  className?: string
}) {
  return (
    <div className={`loading-shapes loading-${kind} ${className}`} role="status">
      <span className="sr-only">{label}</span>
      {kind === 'page' && (
        <>
          <div className="loading-heading" aria-hidden="true">
            <span className="shape shape-title" />
            <span className="shape shape-line" />
          </div>
          <div className="loading-tiles" aria-hidden="true">
            {[0, 1, 2, 3].map((tile) => (
              <span key={tile} className="shape shape-tile" />
            ))}
          </div>
        </>
      )}
      <div className="loading-rows" aria-hidden="true">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="loading-row">
            <span className="shape shape-round" />
            <span className="loading-row-words">
              <span className="shape shape-text" />
              <span className="shape shape-detail" />
            </span>
            <span className="shape shape-end" />
          </div>
        ))}
      </div>
    </div>
  )
}
