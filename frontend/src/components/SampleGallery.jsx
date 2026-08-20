import { useState } from 'react'
import { Images, ChevronDown, Loader2 } from 'lucide-react'

/**
 * One-click demo fixtures.
 *
 * These are procedurally generated images, not photographs. Each one carries a
 * crafted metadata or compression history so a reviewer can watch a specific
 * detector fire against known ground truth. The UI says so plainly — presenting
 * a synthetic image as a real camera photo would misrepresent what the tool
 * just detected.
 */
const SAMPLES = [
  {
    id: 'ai',
    file: '/samples/ai-stable-diffusion.png',
    name: 'AI generated',
    detail: 'Carries Stable Diffusion generation parameters in PNG text chunks.',
    expect: 'Metadata parser should report a Stable Diffusion signature.',
    tone: 'text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-600/30 dark:border-fuchsia-500/30 bg-fuchsia-500/10',
  },
  {
    id: 'camera',
    file: '/samples/authentic-camera.jpg',
    name: 'Camera EXIF',
    detail: 'Procedurally drawn, then given full capture EXIF (body, lens, exposure, GPS).',
    expect: 'EXIF is read as camera capture while the visual read declines to call a drawing a photograph — the disagreement is reported, not resolved.',
    tone: 'text-emerald-700 dark:text-emerald-300 border-emerald-600/30 dark:border-emerald-500/30 bg-emerald-500/10',
  },
  {
    id: 'splice',
    file: '/samples/manipulated-splice.jpg',
    name: 'Composite',
    detail: 'A region from another image was pasted in, then the whole frame re-saved.',
    expect: 'Metadata is stripped. ELA may not flag this — re-saving erases the trace.',
    tone: 'text-amber-700 dark:text-amber-300 border-amber-600/30 dark:border-amber-500/30 bg-amber-500/10',
  },
]

export default function SampleGallery({ onPick, disabled }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(null)

  const pick = async (sample) => {
    if (disabled || loading) return
    setLoading(sample.id)
    try {
      const res = await fetch(sample.file)
      if (!res.ok) throw new Error(`Sample unavailable (${res.status})`)
      const blob = await res.blob()
      const filename = sample.file.split('/').pop()
      onPick(new File([blob], filename, { type: blob.type }))
    } catch (err) {
      onPick(null, err.message)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="panel overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm transition-colors hover:bg-raised"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 min-w-0 font-medium text-fg">
          <Images size={16} className="text-accent" />
          Sample gallery
          <span className="hidden text-xs font-normal text-faint sm:inline">— test without uploading</span>
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-faint transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-line p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {SAMPLES.map((s) => (
              <button
                key={s.id}
                onClick={() => pick(s)}
                disabled={disabled || loading !== null}
                title={s.expect}
                className={`group flex flex-col gap-2 rounded-xl border p-3 text-left transition-all hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-40 ${s.tone}`}
              >
                <div className="relative aspect-video overflow-hidden rounded-lg bg-raised">
                  <img
                    src={s.file}
                    alt={s.name}
                    loading="lazy"
                    className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                  />
                  {loading === s.id && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                      <Loader2 size={20} className="animate-spin text-accent" />
                    </div>
                  )}
                </div>
                <div>
                  <p className="truncate text-xs font-semibold">{s.name}</p>
                  <p className="mt-0.5 break-anywhere text-[11px] leading-snug text-muted">{s.detail}</p>
                </div>
              </button>
            ))}
          </div>
          <p className="mt-3 break-anywhere text-[11px] leading-relaxed text-faint">
            These are procedurally generated fixtures, not photographs. Each carries a crafted
            metadata or compression history so you can see a specific detector respond to known
            ground truth.
          </p>
        </div>
      )}
    </div>
  )
}
