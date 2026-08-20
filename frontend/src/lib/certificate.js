/**
 * Single-page forensic certificate.
 *
 * The whole document is constrained to one A4 page by construction: addPage()
 * is never called, every block is measured before it is drawn, and anything
 * that would run past the reserved footer is truncated with an explicit
 * "+N more" note. That keeps the output predictable for any image aspect ratio
 * or finding count, at the cost of showing fewer findings on busy reports —
 * the full set is always available in the app and the JSON payload.
 */

const PAGE = { W: 595.28, H: 841.89 }
const MX = 32 // side margin
const MY = 12 // top/bottom margin, per spec

const INK = {
  heading: [226, 232, 240],
  body: [30, 41, 59],
  muted: [90, 105, 125],
  faint: [130, 145, 165],
  rule: [210, 218, 228],
  panel: [247, 249, 251],
}
const ACCENT = [8, 145, 178]

// Fallback labels only: the backend sends the authoritative `verdict` string.
const VERDICT_LABEL = {
  authentic_photograph: 'Authentic Photograph',
  authentic_digital_art: 'Authentic Digital Art',
  ai_generated: 'AI Generated',
  manipulated: 'Manipulated',
  inconclusive: 'Inconclusive / Human Review Needed',
}
const VERDICT_COLOR = {
  authentic_photograph: [16, 133, 96],
  authentic_digital_art: [12, 110, 160],
  ai_generated: [155, 44, 155],
  manipulated: [190, 45, 65],
  inconclusive: [176, 120, 20],
}

function fmtStamp(date) {
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

/**
 * Load an image and re-encode it as a small JPEG data URI.
 *
 * Oversampled relative to the 60pt frame so it stays crisp when the PDF is
 * zoomed, but still tiny. The SHA-256 in the fingerprint grid is what actually
 * identifies the bytes; these are visual references.
 */
function toBoundedImage(source, maxEdge = 240, quality = 0.8) {
  return new Promise((resolve) => {
    if (!source) return resolve(null)
    if (typeof document === 'undefined' || typeof Image === 'undefined') return resolve(null)

    const isBlob = typeof Blob !== 'undefined' && source instanceof Blob
    let src = source
    let owned = null
    if (isBlob) {
      try { src = owned = URL.createObjectURL(source) } catch { return resolve(null) }
    }
    const release = () => { if (owned) URL.revokeObjectURL(owned) }

    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
        const w = Math.max(1, Math.round(img.naturalWidth * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        release()
        resolve({ dataUrl, width: w, height: h })
      } catch {
        release()
        resolve(null)
      }
    }
    img.onerror = () => { release(); resolve(null) }
    img.src = src
  })
}

export async function buildCertificate(result, originalSrc = null) {
  if (!result) throw new Error('No analysis result to certify.')
  const { jsPDF } = await import('jspdf')

  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  const issued = new Date()

  const report = result.report || {}
  const fp = result.fingerprint || {}
  const aspect = fp.aspect || {}
  const colour = fp.colour || {}
  const meta = result.metadata || {}
  const ela = result.ela || null
  const verdict = report.verdict_key || 'inconclusive'
  const verdictText = report.verdict || VERDICT_LABEL[verdict] || VERDICT_LABEL.inconclusive
  const score = Number.isFinite(report.integrity_score) ? report.integrity_score : null

  const [origImg, elaImg] = await Promise.all([
    toBoundedImage(originalSrc),
    toBoundedImage(ela?.heatmap),
  ])

  // ---- footer first: it is fixed, and everything else budgets around it ----
  const LIMITATIONS = [
    'Automated analysis, not a legal or expert determination.',
    'Metadata is trivially forged and stripped by most platforms on upload — its absence proves nothing.',
    'Any C2PA manifest was detected but NOT cryptographically validated.',
    'ELA is a visual aid only; texture and re-saving raise error without editing.',
    'The visual assessment comes from a general-purpose language model and can be confidently wrong.',
  ]
  doc.setFont('helvetica', 'normal').setFontSize(7)
  const limLines = LIMITATIONS.map((t) => doc.splitTextToSize(t, PAGE.W - 2 * MX - 34))
  const limBodyH = limLines.reduce((n, l) => n + l.length * 8, 0)
  const FOOTER_H = 16 + limBodyH + 12          // title + body + credit line
  const FOOTER_TOP = PAGE.H - MY - FOOTER_H
  const CONTENT_BOTTOM = FOOTER_TOP - 8        // hard ceiling for flowing content

  let y = 0

  // ---- header band ----
  doc.setFillColor(11, 14, 23)
  doc.rect(0, 0, PAGE.W, 52, 'F')
  doc.setTextColor(...INK.heading).setFont('helvetica', 'bold').setFontSize(15)
  doc.text('PixelGuard', MX, 25)
  const brandW = doc.getTextWidth('PixelGuard')
  doc.setTextColor(...ACCENT)
  doc.text('Forensic Certificate', MX + brandW + 9, 25)
  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(150, 165, 185)
  doc.text('AI Asset Provenance & Forensics Engine', MX, 38)
  doc.text(`Issued ${fmtStamp(issued)}`, PAGE.W - MX, 38, { align: 'right' })
  y = 52 + 14

  // ---- verdict strip ----
  const vc = VERDICT_COLOR[verdict] || VERDICT_COLOR.inconclusive
  // The pill grows to fit: "Inconclusive / Human Review Needed" is far wider
  // than "Authentic", and a fixed width would clip it.
  doc.setFont('helvetica', 'bold').setFontSize(11)
  const pillW = Math.min(doc.getTextWidth(verdictText) + 22, 250)
  doc.setFillColor(...vc)
  doc.roundedRect(MX, y, pillW, 26, 5, 5, 'F')
  doc.setTextColor(255, 255, 255)
  doc.text(verdictText, MX + 11, y + 17.5)
  const statsX = MX + pillW + 14

  doc.setTextColor(...INK.body).setFont('helvetica', 'normal').setFontSize(9.5)
  const scoreTxt = `Integrity ${score === null ? '—' : `${score}/100`}`
  const confTxt = Number.isFinite(report.confidence) ? `Confidence ${report.confidence}%` : 'Confidence —'
  const lintTxt = `Verification: ${result.prelint?.status ?? '—'} (${result.prelint?.total ?? 0})`
  doc.text(scoreTxt, statsX, y + 11)
  doc.text(confTxt, statsX, y + 22)
  doc.text(lintTxt, Math.max(statsX + 150, MX + 310), y + 11)
  doc.text(`Model: ${result.model || '—'}`, Math.max(statsX + 150, MX + 310), y + 22)
  y += 26 + 12

  // ---- structural fingerprint: 3-column micro-grid ----
  const label = (t, x, yy) => {
    doc.setFont('helvetica', 'bold').setFontSize(6.5).setTextColor(...INK.faint)
    doc.text(t.toUpperCase(), x, yy)
  }
  const value = (t, x, yy, w) => {
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...INK.body)
    doc.text(doc.splitTextToSize(String(t ?? '—'), w)[0] || '—', x, yy)
  }

  doc.setDrawColor(...INK.rule).setLineWidth(0.5)
  doc.line(MX, y, PAGE.W - MX, y)
  y += 12

  const colW = (PAGE.W - 2 * MX) / 3
  const cells = [
    ['File', result.filename],
    ['Type / size', `${result.content_type || '—'} · ${fmtBytes(result.size_bytes)}`],
    ['Dimensions', result.dimensions ? `${result.dimensions.width}×${result.dimensions.height} px${fp.megapixels ? ` · ${fp.megapixels} MP` : ''}` : '—'],
    ['Aspect', aspect.simplified ? `${aspect.simplified}${aspect.name ? ` (${aspect.name})` : ''}` : '—'],
    ['Mean RGB', colour.mean_rgb ? `${colour.mean_rgb.r} / ${colour.mean_rgb.g} / ${colour.mean_rgb.b}` : '—'],
    ['RGB balance', colour.channel_balance ? `R ${(colour.channel_balance.r * 100).toFixed(0)}%  G ${(colour.channel_balance.g * 100).toFixed(0)}%  B ${(colour.channel_balance.b * 100).toFixed(0)}%` : '—'],
    ['Media type', report.media_type_label || report.media_type || '—'],
    ['Metadata', `${meta.verdict || '—'}${meta.confidence ? ` (${meta.confidence})` : ''}`],
    ['C2PA', meta.c2pa?.present ? 'Present — unvalidated' : 'None found'],
    ['Generator', meta.ai_signatures?.length ? meta.ai_signatures.map((x) => x.label).join(', ') : 'None found'],
  ]
  cells.forEach(([k, v], i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    const x = MX + col * colW
    const yy = y + row * 26
    label(k, x, yy)
    value(v, x, yy + 10, colW - 10)
  })
  y += Math.ceil(cells.length / 3) * 26 + 2

  // SHA-256 spans the full width: it must never wrap or be clipped.
  label('SHA-256', MX, y)
  doc.setFont('courier', 'normal').setFontSize(7.4).setTextColor(...INK.body)
  doc.text(fp.sha256 || 'not computed', MX, y + 10)
  y += 20

  // ---- visual record + dominant colours, one row ----
  doc.setDrawColor(...INK.rule)
  doc.line(MX, y, PAGE.W - MX, y)
  y += 12

  const THUMB = 60
  const drawThumb = (img, x, caption) => {
    doc.setDrawColor(...INK.rule).setFillColor(...INK.panel)
    doc.roundedRect(x, y, THUMB, THUMB, 3, 3, 'FD')
    // Guard on the payload, not just the wrapper: an encoder that returns a
    // null data URI would otherwise reach addImage() and throw.
    if (img?.dataUrl) {
      // Fit inside the square: any aspect ratio lands within the frame, so a
      // panorama or a tall portrait can never push the layout around.
      const pad = 4
      const s = Math.min((THUMB - pad * 2) / img.width, (THUMB - pad * 2) / img.height)
      const w = img.width * s
      const h = img.height * s
      doc.addImage(img.dataUrl, 'JPEG', x + (THUMB - w) / 2, y + (THUMB - h) / 2, w, h)
    } else {
      doc.setFont('helvetica', 'normal').setFontSize(6).setTextColor(...INK.faint)
      doc.text('n/a', x + THUMB / 2, y + THUMB / 2, { align: 'center' })
    }
    doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(...INK.muted)
    doc.text(caption, x + THUMB / 2, y + THUMB + 8, { align: 'center' })
  }
  drawThumb(origImg, MX, 'Original')
  drawThumb(elaImg, MX + THUMB + 10, 'ELA heatmap')

  // swatches to the right of the thumbnails
  if (colour.dominant?.length) {
    const sx = MX + 2 * THUMB + 26
    label('Dominant colours by area', sx, y + 6)
    let cx = sx
    for (const c of colour.dominant.slice(0, 5)) {
      const [r, g, b] = c.rgb || [0, 0, 0]
      doc.setFillColor(r, g, b).setDrawColor(...INK.rule)
      doc.roundedRect(cx, y + 12, 34, 20, 2, 2, 'FD')
      doc.setFont('courier', 'normal').setFontSize(6).setTextColor(...INK.muted)
      doc.text(c.hex, cx, y + 40)
      doc.text(`${(c.share * 100).toFixed(1)}%`, cx, y + 48)
      cx += 40
    }
    if (ela?.interpretation?.signal) {
      doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...INK.muted)
      doc.text(
        `ELA: ${ela.interpretation.signal} · mean error ${ela.metrics?.mean_error ?? '—'}`,
        sx, y + 62,
      )
    }
  }
  y += THUMB + 18

  // ---- combined summary + indicators ----
  doc.setDrawColor(...INK.rule)
  doc.line(MX, y, PAGE.W - MX, y)
  y += 12

  const indicators = [
    ...(report.tampering_detection?.indicators || []),
    ...(report.model_signature?.signature_evidence || []),
  ]
  const innerW = PAGE.W - 2 * MX - 20
  doc.setFont('helvetica', 'normal').setFontSize(8.2)
  const summaryLines = doc.splitTextToSize(report.summary || 'No summary was produced.', innerW)

  // Budget: leave room for the findings block below.
  const indicatorLines = indicators.map((t) => doc.splitTextToSize(t, innerW - 10))
  let boxH = 26 + summaryLines.length * 9.6
  const shownIndicators = []
  for (let i = 0; i < indicatorLines.length; i += 1) {
    const add = indicatorLines[i].length * 9.2
    if (y + boxH + add + 14 > CONTENT_BOTTOM - 60) break
    boxH += add
    shownIndicators.push(indicatorLines[i])
  }
  if (indicators.length) boxH += 14 // sub-heading
  const droppedIndicators = indicators.length - shownIndicators.length
  if (droppedIndicators > 0) boxH += 10

  doc.setFillColor(...INK.panel).setDrawColor(...INK.rule)
  doc.roundedRect(MX, y, PAGE.W - 2 * MX, boxH, 4, 4, 'FD')
  let by = y + 14
  doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...INK.body)
  doc.text('Summary', MX + 10, by)
  by += 11
  doc.setFont('helvetica', 'normal').setFontSize(8.2).setTextColor(...INK.body)
  doc.text(summaryLines, MX + 10, by)
  by += summaryLines.length * 9.6 + 4

  if (indicators.length) {
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...INK.body)
    doc.text('Detected indicators', MX + 10, by)
    by += 10
    doc.setFont('helvetica', 'normal').setFontSize(7.8).setTextColor(...INK.muted)
    for (const lines of shownIndicators) {
      doc.text('•', MX + 10, by)
      doc.text(lines, MX + 20, by)
      by += lines.length * 9.2
    }
    if (droppedIndicators > 0) {
      doc.setFont('helvetica', 'italic').setFontSize(7)
      doc.text(`+${droppedIndicators} more in the full report`, MX + 20, by)
    }
  }
  y += boxH + 12

  // ---- verification findings, truncated to fit ----
  const findings = result.prelint?.findings || []
  doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...INK.body)
  if (y + 22 < CONTENT_BOTTOM) {
    doc.text('Verification findings', MX, y)
    y += 11
    doc.setFont('helvetica', 'normal').setFontSize(7.6).setTextColor(...INK.muted)
    if (!findings.length) {
      doc.text('None — model output matched the expected schema and the local evidence.', MX, y)
      y += 10
    } else {
      let drawn = 0
      for (const f of findings) {
        const lines = doc.splitTextToSize(`[${f.severity}] ${f.stage} · ${f.code}: ${f.detail}`, PAGE.W - 2 * MX - 12)
        if (y + lines.length * 8.6 > CONTENT_BOTTOM - 8) break
        doc.text('•', MX, y)
        doc.text(lines, MX + 10, y)
        y += lines.length * 8.6 + 1.5
        drawn += 1
      }
      if (drawn < findings.length) {
        doc.setFont('helvetica', 'italic').setFontSize(7)
        doc.text(`+${findings.length - drawn} more finding(s) in the full report`, MX + 10, y)
      }
    }
  }

  // ---- limitations block, 7pt ----
  // Pinned to the bottom on a full report, but floated up to follow the content
  // on a light one: a certificate with 400pt of dead space in the middle reads
  // as broken rather than formal. The budget above guarantees content always
  // ends above FOOTER_TOP, so this can only move the block upward.
  const limTop = Math.min(y + 14, FOOTER_TOP)
  doc.setFillColor(...INK.panel).setDrawColor(...INK.rule)
  doc.roundedRect(MX, limTop, PAGE.W - 2 * MX, FOOTER_H - 10, 4, 4, 'FD')
  doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...INK.body)
  doc.text('Limitations', MX + 10, limTop + 11)
  doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...INK.muted)
  let fy = limTop + 21
  for (const lines of limLines) {
    doc.text('•', MX + 10, fy)
    doc.text(lines, MX + 20, fy)
    fy += lines.length * 8
  }
  doc.setFontSize(6.5).setTextColor(...INK.faint)
  doc.text(`PixelGuard · issued ${issued.toISOString()}`, MX, PAGE.H - MY - 2)
  doc.text('Page 1 of 1', PAGE.W - MX, PAGE.H - MY - 2, { align: 'right' })

  return doc
}

export async function downloadCertificate(result, originalSrc = null) {
  const doc = await buildCertificate(result, originalSrc)
  const base = (result.filename || 'image').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_')
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  doc.save(`pixelguard-certificate-${base}-${stamp}.pdf`)
}
