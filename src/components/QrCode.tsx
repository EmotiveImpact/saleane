import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

/**
 * NEXT-04: a QR code drawn as one SVG path, dark on white with a quiet border, so any phone camera
 * reads it in light or dark mode. Made in the browser; the text never leaves the page.
 */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    const code = qrcode(0, 'M')
    code.addData(text)
    code.make()
    const count = code.getModuleCount()
    let d = ''
    for (let row = 0; row < count; row++)
      for (let col = 0; col < count; col++)
        if (code.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`
    return { size: count + 8, path: d }
  }, [text])
  return (
    <svg className="qr-code" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#1d211f" shapeRendering="crispEdges" />
    </svg>
  )
}
