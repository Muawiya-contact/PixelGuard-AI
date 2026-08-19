/**
 * Build a forensic certificate PDF from an analysis result.
 *
 * jsPDF is imported dynamically: it drags in html2canvas and roughly 200 KB of
 * transitive weight that nobody needs until the download button is pressed, so
 * keeping it out of the entry chunk buys a materially faster first paint.
 *
 * The document is written to be defensible rather than impressive: it records
 * what was examined, what each detector reported, and — importantly — the
 * limits of those detectors. A certificate that implied more certainty than the
 * analysis supports would be worse than no certificate at all.
 */

/**
 * Load an image and re-encode it as a bounded JPEG data URI.
 *
 * jsPDF needs raw image data, and an object URL is not that. These renders are
 * a visual reference so a reader can see what was examined — the SHA-256 in the
 * evidence table is the authoritative identifier, not these pixels — so JPEG at
 * a capped edge is the right trade: a PNG of the same photo pushed a typical
 * certificate past 1.2 MB, which is unusable as an email attachment.
 */
function toBoundedImage(src, maxEdge = 520, quality = 0.82) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null)
      return
    }
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      resolve(null) // no DOM (SSR, tests) — the certificate is still valid without art
      return
    }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
        const w = Math.max(1, Math.round(img.naturalWidth * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        // JPEG has no alpha; paint white first so transparent PNGs do not
        // flatten onto black.
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', quality), width: w, height: h })
      } catch {
        resolve(null) // tainted canvas or no 2d context — the PDF is still valid without art
      }
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}

const INK = { heading: [226, 232, 240], body: [51, 65, 85], muted: [100, 116, 139], rule: [203, 213, 225] }
const ACCENT = [8, 145, 178]

const VERDICT_LABEL = {
  authentic: 'Authentic',
  ai_generated: 'AI generated',
  manipulated: 'Manipulated',
  inconclusive: 'Inconclusive',
}

const VERDICT_COLOR = {
  authentic: [16, 133, 96],
  ai_generated: [155, 44, 155],
  manipulated: [190, 45, 65],
  inconclusive: [176, 120, 20],
}

function fmtStamp(date) {
  // A certificate is read by people: "19 Aug 2026, 19:39:09 UTC" beats an ISO
  // string. The exact ISO form still appears in the footer for machine use.
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}, ` +
    `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())} UTC`
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export async function buildCertificate(result, originalSrc = null) {
  if (!result) throw new Error('No analysis result to certify.')

  const { jsPDF } = await import('jspdf')

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 48
  const issued = new Date()
  let y = 0

  const report = result.report || {}
  const verdict = report.verdict || 'inconclusive'
  const score = Number.isFinite(report.integrity_score) ? report.integrity_score : null

  // --- header band -------------------------------------------------------
  doc.setFillColor(11, 14, 23)
  doc.rect(0, 0, W, 96, 'F')
  doc.setTextColor(...INK.heading)
  doc.setFont('helvetica', 'bold').setFontSize(20)
  doc.text('PixelGuard', M, 44)
  // Measure rather than assume: a hardcoded offset collides the moment the
  // font metrics differ from whatever was eyeballed.
  const brandWidth = doc.getTextWidth('PixelGuard')
  doc.setTextColor(...ACCENT)
  doc.text('Forensic Certificate', M + brandWidth + 12, 44)
  doc.setFont('helvetica', 'normal').setFontSize(9)
  doc.setTextColor(148, 163, 184)
  doc.text('AI Asset Provenance & Forensics Engine', M, 62)
  doc.text(`Issued ${fmtStamp(issued)}`, M, 76)
  y = 128

  // --- verdict + score ---------------------------------------------------
  const vc = VERDICT_COLOR[verdict] || VERDICT_COLOR.inconclusive
  doc.setFillColor(...vc)
  doc.roundedRect(M, y - 22, 168, 32, 6, 6, 'F')
  doc.setTextColor(255, 255, 255).setFont('helvetica', 'bold').setFontSize(13)
  doc.text(VERDICT_LABEL[verdict] || 'Inconclusive', M + 14, y - 1)

  doc.setTextColor(...INK.body).setFontSize(11).setFont('helvetica', 'normal')
  doc.text(`Integrity score: ${score === null ? 'not reported' : `${score} / 100`}`, M + 190, y - 12)
  const conf = Number.isFinite(report.confidence) ? `${report.confidence}%` : 'not reported'
  doc.text(`Model confidence: ${conf}`, M + 190, y + 4)
  y += 34

  // --- evidence table ----------------------------------------------------
  const meta = result.metadata || {}
  const ela = result.ela || null
  const fp = result.fingerprint || {}
  const aspect = fp.aspect || {}
  const colour = fp.colour || {}
  const rows = [
    ['File', result.filename || '—'],
    ['SHA-256', fp.sha256 || 'not computed'],
    ['Type / size', `${result.content_type || '—'} · ${fmtBytes(result.size_bytes)}`],
    [
      'Dimensions',
      result.dimensions
        ? `${result.dimensions.width} x ${result.dimensions.height} px${fp.megapixels ? ` · ${fp.megapixels} MP` : ''}`
        : '—',
    ],
    [
      'Aspect ratio',
      aspect.simplified
        ? `${aspect.simplified}${aspect.name ? ` (${aspect.name})` : ''} · ${aspect.orientation}`
        : '—',
    ],
    [
      'Colour balance',
      colour.mean_rgb
        ? `mean RGB ${colour.mean_rgb.r} / ${colour.mean_rgb.g} / ${colour.mean_rgb.b}` +
          (colour.channel_balance
            ? `  ·  R ${(colour.channel_balance.r * 100).toFixed(1)}% G ${(colour.channel_balance.g * 100).toFixed(1)}% B ${(colour.channel_balance.b * 100).toFixed(1)}%`
            : '')
        : '—',
    ],
    ['Analysis model', result.model || '—'],
    ['Metadata verdict', `${meta.verdict || '—'}${meta.confidence ? ` (confidence: ${meta.confidence})` : ''}`],
    ['C2PA manifest', meta.c2pa?.present ? 'Present — NOT cryptographically validated' : 'None found'],
    ['Generator signature', meta.ai_signatures?.length ? meta.ai_signatures.map((s) => s.label).join(', ') : 'None found'],
    ['Editing software', meta.editing_software?.length ? meta.editing_software.join(', ') : 'None recorded'],
    ['ELA signal', ela ? `${ela.interpretation?.signal ?? '—'} (mean error ${ela.metrics?.mean_error ?? '—'})` : 'Not run'],
    ['Verification', `${result.prelint?.status ?? '—'} · ${result.prelint?.total ?? 0} finding(s)`],
  ]

  doc.setDrawColor(...INK.rule).setLineWidth(0.5)
  doc.line(M, y, W - M, y)
  y += 16
  doc.setFontSize(10)
  for (const [label, value] of rows) {
    doc.setFont('helvetica', 'bold').setTextColor(...INK.muted)
    doc.text(label, M, y)
    doc.setFont('helvetica', 'normal').setTextColor(...INK.body)
    const lines = doc.splitTextToSize(String(value), W - M - 176)
    doc.text(lines, M + 136, y)
    y += Math.max(15, lines.length * 12 + 3)
  }

  y += 4
  doc.setDrawColor(...INK.rule)
  doc.line(M, y, W - M, y)
  y += 20

  const section = (title) => {
    // Only needs room for the heading plus a line or two; bullets() re-checks
    // per item, so a tighter bound here just avoids stranding a third of a page.
    if (y > H - 96) {
      doc.addPage()
      y = M + 8
    }
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...INK.body)
    doc.text(title, M, y)
    y += 15
    doc.setFont('helvetica', 'normal').setFontSize(9.5)
  }

  // Hanging indent: the bullet sits in its own gutter and wrapped lines align
  // under the text, not back at the margin.
  const BULLET_GUTTER = 12

  const bullet = (text, left, width, lineHeight = 12) => {
    const lines = doc.splitTextToSize(String(text), width - BULLET_GUTTER)
    doc.text('\u2022', left, y)
    doc.text(lines, left + BULLET_GUTTER, y)
    y += lines.length * lineHeight + 4
  }

  const bullets = (items, empty) => {
    if (!items || items.length === 0) {
      doc.setTextColor(...INK.muted)
      doc.text(empty, M + 8, y)
      y += 16
      return
    }
    doc.setTextColor(...INK.body)
    for (const item of items) {
      if (y > H - 90) {
        doc.addPage()
        y = M + 8
      }
      bullet(item, M + 8, W - 2 * M - 8)
    }
    y += 6
  }

  // Dominant colour swatches: a compact visual the eye can match against the image.
  if (colour.dominant?.length) {
    section('Dominant colours by area')
    const sw = 54
    const gap = 10
    let x = M
    doc.setFontSize(7.5)
    for (const c of colour.dominant.slice(0, 5)) {
      const [r, g, b] = c.rgb || [0, 0, 0]
      doc.setFillColor(r, g, b)
      doc.setDrawColor(...INK.rule)
      doc.roundedRect(x, y, sw, 26, 3, 3, 'FD')
      doc.setTextColor(...INK.muted)
      doc.text(c.hex, x, y + 36)
      doc.text(`${(c.share * 100).toFixed(1)}%`, x, y + 45)
      x += sw + gap
    }
    y += 72 // clear of the swatch captions before the next section heading
  }

  // Embedded renders. Generous padding below the images keeps their captions
  // clear of whatever section lands next.
  const [origImg, elaImg] = await Promise.all([
    toBoundedImage(originalSrc),
    toBoundedImage(ela?.heatmap),
  ])
  if (origImg || elaImg) {
    if (y > H - 260) {
      doc.addPage()
      y = M + 8
    }
    section('Visual record')
    const slot = (W - 2 * M - 20) / 2
    const boxH = 150
    const drawImage = (img, left, caption) => {
      doc.setDrawColor(...INK.rule)
      doc.setFillColor(248, 250, 252)
      doc.roundedRect(left, y, slot, boxH, 4, 4, 'FD')
      if (img) {
        const pad = 10
        const scale = Math.min((slot - pad * 2) / img.width, (boxH - pad * 2) / img.height)
        const w = img.width * scale
        const h = img.height * scale
        doc.addImage(img.dataUrl, 'JPEG', left + (slot - w) / 2, y + (boxH - h) / 2, w, h)
      }
      doc.setFontSize(8).setTextColor(...INK.muted)
      doc.text(caption, left + slot / 2, y + boxH + 13, { align: 'center' })
    }
    drawImage(origImg, M, 'Original')
    drawImage(elaImg, M + slot + 20, 'ELA heatmap')
    y += boxH + 26
    doc.setFontSize(7.5).setTextColor(...INK.muted)
    doc.text(
      'Downscaled visual references. The SHA-256 above identifies the analysed bytes.',
      M, y,
    )
    y += 18
  }

  section('Summary')
  doc.setTextColor(...INK.body)
  const summary = doc.splitTextToSize(report.summary || 'No summary was produced.', W - 2 * M)
  doc.text(summary, M, y)
  y += summary.length * 12 + 12

  section('Detected indicators')
  bullets(
    [...(report.tampering_detection?.indicators || []), ...(report.model_signature?.signature_evidence || [])],
    'No specific indicators were recorded.',
  )

  section('Verification findings')
  bullets(
    (result.prelint?.findings || []).map((f) => `[${f.severity}] ${f.stage} · ${f.code}: ${f.detail}`),
    'No verification findings — model output matched the expected schema and the local evidence.',
  )

  // --- limitations -------------------------------------------------------
  if (y > H - 150) {
    doc.addPage()
    y = M + 8
  }
  doc.setFillColor(248, 250, 252)
  doc.setDrawColor(...INK.rule)
  const boxTop = y - 4
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...INK.body)
  const limitations = [
    'This certificate records automated analysis, not a legal or expert determination.',
    'Metadata is trivially forged and is stripped by most platforms on upload, so its absence proves nothing.',
    'Any C2PA manifest reported here was detected but NOT cryptographically validated.',
    'Error Level Analysis is a visual aid only. Texture and re-saving raise error without editing, and an edit re-saved at the same quality leaves no trace.',
    'The visual assessment comes from a general-purpose language model and can be confidently wrong.',
  ]
  const LIM_WIDTH = W - 2 * M - 24 - BULLET_GUTTER
  // Measure at the size the text will actually be drawn at, or the box will
  // not match its contents.
  doc.setFont('helvetica', 'normal').setFontSize(8.5)
  const wrapped = limitations.map((t) => doc.splitTextToSize(t, LIM_WIDTH))
  const boxHeight = 34 + wrapped.reduce((n, l) => n + l.length * 11 + 5, 0)
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...INK.body)
  doc.roundedRect(M, boxTop, W - 2 * M, boxHeight, 5, 5, 'FD')
  doc.text('Limitations', M + 12, y + 14)
  y += 30
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...INK.muted)
  for (const lines of wrapped) {
    doc.text('\u2022', M + 12, y)
    doc.text(lines, M + 12 + BULLET_GUTTER, y)
    y += lines.length * 11 + 5
  }

  // --- footer on every page ---------------------------------------------
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...INK.muted)
    doc.text(`PixelGuard forensic certificate · issued ${issued.toISOString()}`, M, H - 26)
    doc.text(`Page ${p} of ${pages}`, W - M, H - 26, { align: 'right' })
  }

  return doc
}

export async function downloadCertificate(result, originalSrc = null) {
  const doc = await buildCertificate(result, originalSrc)
  const base = (result.filename || 'image').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_')
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  doc.save(`pixelguard-certificate-${base}-${stamp}.pdf`)
}
