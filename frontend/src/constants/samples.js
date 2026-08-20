/**
 * Sample gallery configuration.
 *
 * Three categories, three slots each, served from `public/images/<category>/`.
 * Drop `sample1`–`sample3` into a folder and the gallery picks them up — no code
 * change needed. `EXTENSIONS` is probed in order, so `sample2.jpg` and
 * `sample2.png` both work.
 *
 * Slots whose file is absent are skipped at runtime rather than rendered as a
 * broken thumbnail, so a partially-filled folder still looks intentional.
 *
 * A note on `expects`: it describes what a category is *designed* to
 * demonstrate, not a promise about any particular file. PixelGuard reports what
 * it finds, and a real analysis can disagree with the label on the folder —
 * that disagreement is a feature, not a bug. Nothing here is fed to the
 * analysis pipeline; it is descriptive copy only.
 */

export const EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']
export const SLOTS = ['sample1', 'sample2', 'sample3']

export const SAMPLE_CATEGORIES = [
  {
    id: 'ai-generated',
    dir: '/images/ai-generated',
    title: 'AI Generated',
    blurb: 'Assets produced by a generative model. Where a generator signature survives in the file, the metadata parser should find it.',
    expects: 'Expected: AI Generated — strongest when a generator signature is present in metadata.',
    tone: 'text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-600/30 dark:border-fuchsia-500/30 bg-fuchsia-500/10',
    samples: [
      {
        slot: 'sample1',
        title: 'Stable Diffusion metadata',
        detail: 'Procedurally drawn, then given a Stable Diffusion parameter block in PNG text chunks.',
        // Verified: metadata overrides the visual read, and the override is reported.
        verified: true,
      },
      { slot: 'sample2', title: 'AI sample 2', detail: 'Add an AI-generated image to /images/ai-generated/.' },
      { slot: 'sample3', title: 'AI sample 3', detail: 'Add an AI-generated image to /images/ai-generated/.' },
    ],
  },
  {
    id: 'camera-exif',
    dir: '/images/camera-exif',
    title: 'Camera EXIF',
    blurb: 'Files carrying camera capture metadata. EXIF is trivially forged, so PixelGuard weighs it against the visual read rather than trusting it.',
    expects: 'Expected: capture EXIF reported; a disagreement with the visual read is surfaced, not resolved.',
    tone: 'text-emerald-700 dark:text-emerald-300 border-emerald-600/30 dark:border-emerald-500/30 bg-emerald-500/10',
    samples: [
      {
        slot: 'sample1',
        title: 'Full capture EXIF',
        detail: 'Procedurally drawn, then given body, lens, exposure and GPS EXIF — so the two evidence sources disagree on purpose.',
        verified: true,
      },
      { slot: 'sample2', title: 'Camera sample 2', detail: 'Add a photograph with intact EXIF to /images/camera-exif/.' },
      { slot: 'sample3', title: 'Camera sample 3', detail: 'Add a photograph with intact EXIF to /images/camera-exif/.' },
    ],
  },
  {
    id: 'composite',
    dir: '/images/composite',
    title: 'Composite',
    blurb: 'Images assembled from more than one source. ELA renders the compression history for a human to read — it is not a tampering classifier.',
    expects: 'Expected: ELA heatmap for visual review. ELA alone never proves manipulation.',
    tone: 'text-amber-700 dark:text-amber-300 border-amber-600/30 dark:border-amber-500/30 bg-amber-500/10',
    samples: [
      {
        slot: 'sample1',
        title: 'Spliced region',
        detail: 'A region from another image pasted in, then the whole frame re-saved — which is what erases most of the ELA trace.',
        verified: true,
      },
      { slot: 'sample2', title: 'Composite sample 2', detail: 'Add a composited or edited image to /images/composite/.' },
      { slot: 'sample3', title: 'Composite sample 3', detail: 'Add a composited or edited image to /images/composite/.' },
    ],
  },
]

/** Resolve a slot to the first extension that actually loads, or null. */
export function resolveSampleUrl(dir, slot) {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') return resolve(null)
    let i = 0
    const tryNext = () => {
      if (i >= EXTENSIONS.length) return resolve(null)
      const url = `${dir}/${slot}.${EXTENSIONS[i++]}`
      const img = new Image()
      img.onload = () => resolve(url)
      img.onerror = tryNext
      img.src = url
    }
    tryNext()
  })
}
