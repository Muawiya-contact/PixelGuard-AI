import { useEffect, useState } from 'react'
import { Images, ChevronDown, Loader2 } from 'lucide-react'
import { SAMPLE_CATEGORIES, resolveSampleUrl } from '../constants/samples.js'

/**
 * One-click fixtures, grouped into the three categories defined in
 * constants/samples.js.
 *
 * Slots are resolved against the filesystem on first open: a slot whose file is
 * absent is dropped rather than rendered as a broken thumbnail, so a
 * half-populated folder still looks deliberate. Drop images into
 * public/images/<category>/ and they appear with no code change.
 *
 * The bundled fixtures are procedurally generated, not photographs, and the
 * footer says so — presenting a synthetic image as real evidence would
 * misrepresent what the detectors just found.
 */
export default function SampleGallery({ onPick, disabled }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(null)
  const [resolved, setResolved] = useState(null) // null = not probed yet

  // Probe once, the first time the gallery is opened.
  useEffect(() => {
    if (!open || resolved) return
    let cancelled = false
    ;(async () => {
      const out = await Promise.all(
        SAMPLE_CATEGORIES.map(async (cat) => ({
          ...cat,
          samples: (
            await Promise.all(
              cat.samples.map(async (s) => {
                const url = await resolveSampleUrl(cat.dir, s.file)
                return url ? { ...s, url } : null
              }),
            )
          ).filter(Boolean),
        })),
      )
      if (!cancelled) setResolved(out)
    })()
    return () => { cancelled = true }
  }, [open, resolved])

  const pick = async (cat, sample) => {
    if (disabled || loading) return
    const key = `${cat.id}/${sample.file}`
    setLoading(key)
    try {
      const res = await fetch(sample.url)
      if (!res.ok) throw new Error(`Sample unavailable (${res.status})`)
      const blob = await res.blob()
      onPick(new File([blob], sample.file, { type: blob.type }))
    } catch (err) {
      onPick(null, err.message)
    } finally {
      setLoading(null)
    }
  }

  const categories = resolved ?? []
  const total = categories.reduce((n, c) => n + c.samples.length, 0)

  return (
    <div className="panel overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm transition-colors hover:bg-raised"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2 font-medium text-fg">
          <Images size={16} className="shrink-0 text-accent" />
          Sample gallery
          <span className="hidden text-xs font-normal text-faint sm:inline">— test without uploading</span>
        </span>
        <ChevronDown size={16} className={`shrink-0 text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-line p-3">
          {resolved === null ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-faint">
              <Loader2 size={16} className="animate-spin" /> Looking for samples…
            </div>
          ) : total === 0 ? (
            <p className="break-anywhere px-1 py-4 text-[11px] leading-relaxed text-faint">
              No sample images found. Add files under <code>public/images/&lt;category&gt;/</code> and
              list them in <code>src/constants/samples.js</code>.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {categories.map((cat) => (
                <section key={cat.id}>
                  <div className="mb-2 min-w-0">
                    <h3 className="text-xs font-semibold text-fg">{cat.title}</h3>
                    <p className="mt-0.5 break-anywhere text-[11px] leading-snug text-muted">{cat.blurb}</p>
                  </div>

                  {cat.samples.length === 0 ? (
                    <p className="break-anywhere rounded-lg border border-dashed border-line px-3 py-2 text-[11px] text-faint">
                      Nothing found in <code>{cat.dir}/</code> — check the filenames listed in{' '}
                      <code>samples.js</code>.
                    </p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-3">
                      {cat.samples.map((s) => (
                        <button
                          key={s.file}
                          onClick={() => pick(cat, s)}
                          disabled={disabled || loading !== null}
                          title={cat.expects}
                          className={`group flex flex-col gap-2 rounded-xl border p-3 text-left transition-all hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-40 ${cat.tone}`}
                        >
                          <div className="relative aspect-video overflow-hidden rounded-lg bg-raised">
                            <img
                              src={s.url}
                              alt={`${cat.title} — ${s.title}`}
                              loading="lazy"
                              className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                            />
                            {loading === `${cat.id}/${s.file}` && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                                <Loader2 size={20} className="animate-spin text-accent" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold">{s.title}</p>
                            <p className="mt-0.5 break-anywhere text-[11px] leading-snug text-muted">{s.detail}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}

          <p className="mt-3 break-anywhere text-[11px] leading-relaxed text-faint">
            The bundled fixtures are procedurally generated, not photographs — each carries a crafted
            metadata or compression history so you can see a specific detector respond to known ground
            truth. Category labels describe what a sample is meant to exercise; PixelGuard still reports
            whatever it actually finds.
          </p>
        </div>
      )}
    </div>
  )
}
