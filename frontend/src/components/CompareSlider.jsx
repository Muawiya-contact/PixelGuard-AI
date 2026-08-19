import { useCallback, useEffect, useRef, useState } from 'react'
import { MoveHorizontal } from 'lucide-react'

/**
 * Side-by-side reveal: the ELA heatmap is clipped to the left of a draggable
 * divider, with the original underneath. Pointer events cover mouse, touch and
 * pen in one path; the handle is also a real slider for keyboard users.
 */
export default function CompareSlider({ original, heatmap, alt = 'Comparison' }) {
  const [position, setPosition] = useState(50)
  const [dragging, setDragging] = useState(false)
  const frameRef = useRef(null)

  const setFromClientX = useCallback((clientX) => {
    const frame = frameRef.current
    if (!frame) return
    const rect = frame.getBoundingClientRect()
    if (rect.width === 0) return
    const pct = ((clientX - rect.left) / rect.width) * 100
    setPosition(Math.max(0, Math.min(100, pct)))
  }, [])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e) => {
      e.preventDefault()
      setFromClientX(e.clientX)
    }
    const stop = () => setDragging(false)
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [dragging, setFromClientX])

  if (!original || !heatmap) return null

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={frameRef}
        onPointerDown={(e) => {
          setDragging(true)
          setFromClientX(e.clientX)
        }}
        className="relative select-none overflow-hidden rounded-xl border border-white/10 bg-surface-950 touch-none"
        style={{ cursor: dragging ? 'grabbing' : 'ew-resize' }}
      >
        {/* Base layer: the original image defines the box size. */}
        <img src={original} alt={alt} className="block w-full select-none" draggable={false} />

        {/* Overlay: heatmap, clipped to the divider. */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        >
          <img
            src={heatmap}
            alt="ELA heatmap"
            className="block h-full w-full select-none object-cover"
            draggable={false}
          />
        </div>

        <div className="pointer-events-none absolute inset-y-0" style={{ left: `${position}%` }}>
          <div className="absolute inset-y-0 -translate-x-1/2 border-l-2 border-accent/90 shadow-[0_0_12px_rgba(34,211,238,0.6)]" />
        </div>

        <input
          type="range"
          min="0"
          max="100"
          step="0.5"
          value={position}
          aria-label="Reveal ELA heatmap"
          onChange={(e) => setPosition(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
        />

        <div
          className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/60 bg-surface-900/90 p-2 shadow-lg"
          style={{ left: `${position}%` }}
        >
          <MoveHorizontal size={16} className="text-accent" />
        </div>

        <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-surface-950/80 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-accent">
          ELA
        </span>
        <span className="pointer-events-none absolute right-3 top-3 rounded-md bg-surface-950/80 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
          Original
        </span>
      </div>

      <p className="text-center text-xs text-slate-500">
        Drag the divider (or focus it and use arrow keys) to compare compression error against the original.
      </p>
    </div>
  )
}
