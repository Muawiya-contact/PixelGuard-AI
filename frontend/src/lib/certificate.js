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

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export async function buildCertificate(result) {
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
  doc.setTextColor(...ACCENT)
  doc.text('Forensic Certificate', M + 92, 44)
  doc.setFont('helvetica', 'normal').setFontSize(9)
  doc.setTextColor(148, 163, 184)
  doc.text('AI Asset Provenance & Forensics Engine', M, 62)
  doc.text(`Issued ${issued.toISOString()}`, M, 76)
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
  const rows = [
    ['File', result.filename || '—'],
    ['Type / size', `${result.content_type || '—'} · ${fmtBytes(result.size_bytes)}`],
    ['Dimensions', result.dimensions ? `${result.dimensions.width} x ${result.dimensions.height} px` : '—'],
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
    if (y > H - 130) {
      doc.addPage()
      y = M + 8
    }
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...INK.body)
    doc.text(title, M, y)
    y += 15
    doc.setFont('helvetica', 'normal').setFontSize(9.5)
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
      const lines = doc.splitTextToSize(`•  ${item}`, W - 2 * M - 10)
      doc.text(lines, M + 8, y)
      y += lines.length * 12 + 3
    }
    y += 6
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
  const wrapped = limitations.map((t) => doc.splitTextToSize(`•  ${t}`, W - 2 * M - 24))
  const boxHeight = 26 + wrapped.reduce((n, l) => n + l.length * 11 + 4, 0)
  doc.roundedRect(M, boxTop, W - 2 * M, boxHeight, 5, 5, 'FD')
  doc.text('Limitations', M + 12, y + 14)
  y += 28
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...INK.muted)
  for (const lines of wrapped) {
    doc.text(lines, M + 12, y)
    y += lines.length * 11 + 4
  }

  // --- footer on every page ---------------------------------------------
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...INK.muted)
    doc.text(`PixelGuard forensic certificate · ${issued.toISOString()}`, M, H - 26)
    doc.text(`Page ${p} of ${pages}`, W - M, H - 26, { align: 'right' })
  }

  return doc
}

export async function downloadCertificate(result) {
  const doc = await buildCertificate(result)
  const base = (result.filename || 'image').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_')
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  doc.save(`pixelguard-certificate-${base}-${stamp}.pdf`)
}
