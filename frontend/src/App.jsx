import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ShieldCheck, ShieldAlert, ShieldQuestion, UploadCloud, ScanSearch, Loader2,
  ImageIcon, Fingerprint, Cpu, FileWarning, Activity, FileText, Layers,
  FileSearch, CheckCircle2, AlertTriangle, Info, X, RotateCcw, Hash,
} from 'lucide-react'
import CompareSlider from './components/CompareSlider.jsx'
import SampleGallery from './components/SampleGallery.jsx'
import ThemeToggle from './components/ThemeToggle.jsx'
import { useTheme } from './lib/theme.js'
import { downloadCertificate } from './lib/certificate.js'

const API_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

// Status palettes carry both themes: a -300 tint that reads on near-black is
// unreadable on white, so each role names its light and dark shade explicitly.
const TONE = {
  emerald: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-600/30 dark:border-emerald-500/30',
  rose: 'text-rose-700 dark:text-rose-300 bg-rose-500/10 dark:bg-rose-500/15 border-rose-600/30 dark:border-rose-500/30',
  amber: 'text-amber-700 dark:text-amber-300 bg-amber-500/10 dark:bg-amber-500/15 border-amber-600/30 dark:border-amber-500/30',
  fuchsia: 'text-fuchsia-700 dark:text-fuchsia-300 bg-fuchsia-500/10 dark:bg-fuchsia-500/15 border-fuchsia-600/30 dark:border-fuchsia-500/30',
  sky: 'text-sky-700 dark:text-sky-300 bg-sky-500/10 dark:bg-sky-500/15 border-sky-600/30 dark:border-sky-500/30',
  neutral: 'text-muted bg-raised border-line',
}

const VERDICT_STYLES = {
  authentic: { label: 'Authentic', icon: ShieldCheck, tone: TONE.emerald },
  ai_generated: { label: 'AI Generated', icon: Cpu, tone: TONE.fuchsia },
  manipulated: { label: 'Manipulated', icon: ShieldAlert, tone: TONE.rose },
  inconclusive: { label: 'Inconclusive', icon: ShieldQuestion, tone: TONE.amber },
}

const SEVERITY = {
  error: { icon: AlertTriangle, cls: 'text-rose-600 dark:text-rose-300' },
  warning: { icon: AlertTriangle, cls: 'text-amber-600 dark:text-amber-300' },
  info: { icon: Info, cls: 'text-sky-600 dark:text-sky-300' },
}

function scoreColor(score) {
  if (score >= 75) return 'text-emerald-600 dark:text-emerald-400'
  if (score >= 45) return 'text-amber-600 dark:text-amber-400'
  return 'text-rose-600 dark:text-rose-400'
}

function scoreBarColor(score) {
  if (score >= 75) return 'bg-emerald-500'
  if (score >= 45) return 'bg-amber-500'
  return 'bg-rose-500'
}

function Badge({ children, className = '' }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${className}`}>
      {children}
    </span>
  )
}

function SectionLabel({ icon: Icon, children }) {
  return (
    <p className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-widest text-faint">
      {Icon && <Icon size={12} className="shrink-0 text-accent" />}
      {children}
    </p>
  )
}

function ScoreRing({ score }) {
  const r = 52
  const c = 2 * Math.PI * r
  const filled = (Math.max(0, Math.min(100, score)) / 100) * c
  return (
    <div className="relative h-32 w-32 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgb(var(--pg-line))" strokeWidth="8" />
        <circle
          cx="60" cy="60" r={r} fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`} className={scoreColor(score)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-bold ${scoreColor(score)}`}>{score}</span>
        <span className="text-[10px] uppercase tracking-widest text-faint">Integrity</span>
      </div>
    </div>
  )
}

function UploadZone({ file, previewUrl, onFile, onClear, loading }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files?.[0]
    if (dropped && dropped.type.startsWith('image/')) onFile(dropped)
  }, [onFile])

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => !file && inputRef.current?.click()}
      className={`panel relative flex min-h-[280px] flex-col items-center justify-center overflow-hidden p-5 transition-colors ${
        file ? '' : 'cursor-pointer hover:border-accent/50'
      } ${dragOver ? 'border-accent bg-accent/5' : ''}`}
    >
      <input
        ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0]
          if (picked) onFile(picked)
          e.target.value = ''
        }}
      />
      {previewUrl ? (
        <div className="w-full min-w-0">
          <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-xl border border-line">
            <img src={previewUrl} alt="Evidence preview" className="block max-h-[360px] w-auto max-w-full object-contain" />
            {loading && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="scanline absolute inset-x-0 top-1/2 h-24" />
              </div>
            )}
            {!loading && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onClear() }}
                aria-label="Remove image"
                title="Remove image"
                className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/25 bg-black/55 text-white backdrop-blur-sm transition-colors hover:border-rose-400 hover:bg-rose-500/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <X size={15} />
              </button>
            )}
          </div>
          <p className="mt-3 truncate text-center font-mono text-xs text-faint" title={file?.name}>
            {file?.name} · {(file?.size / 1024).toFixed(1)} KB
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="rounded-2xl border border-line bg-raised p-5">
            <UploadCloud size={34} className="text-accent" />
          </div>
          <div>
            <p className="font-medium text-fg">Drop evidence image here</p>
            <p className="mt-1 text-sm text-muted">or click to browse — PNG, JPG, WebP</p>
          </div>
        </div>
      )}
    </div>
  )
}

function FingerprintPanel({ fingerprint }) {
  if (!fingerprint) return null
  const { aspect = {}, colour = {}, dimensions = {} } = fingerprint
  return (
    <div className="panel p-5">
      <SectionLabel icon={Hash}>Structural Fingerprint</SectionLabel>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-xs text-faint">SHA-256</dt>
          <dd className="break-anywhere font-mono text-xs text-muted">{fingerprint.sha256}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-faint">Dimensions</dt>
          <dd className="text-muted">
            {dimensions.width} × {dimensions.height} px · {fingerprint.megapixels} MP
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-faint">Aspect ratio</dt>
          <dd className="break-anywhere text-muted">
            {aspect.simplified}{aspect.name ? ` · ${aspect.name}` : ''} · {aspect.orientation}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-faint">Format</dt>
          <dd className="text-muted">{fingerprint.format} · {fingerprint.mode}</dd>
        </div>
        {colour.mean_rgb && (
          <div className="min-w-0">
            <dt className="text-xs text-faint">Mean RGB</dt>
            <dd className="font-mono text-xs text-muted">
              {colour.mean_rgb.r} / {colour.mean_rgb.g} / {colour.mean_rgb.b}
            </dd>
          </div>
        )}
      </dl>
      {colour.dominant?.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs text-faint">Dominant colours by area</p>
          <div className="flex flex-wrap gap-2">
            {colour.dominant.map((c) => (
              <div key={c.hex} className="flex items-center gap-2 rounded-lg border border-line bg-raised px-2 py-1">
                <span className="h-4 w-4 shrink-0 rounded border border-line" style={{ backgroundColor: c.hex }} />
                <span className="font-mono text-[11px] text-muted">{c.hex}</span>
                <span className="text-[11px] text-faint">{(c.share * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MetadataPanel({ metadata }) {
  if (!metadata) return null
  const { c2pa = {}, ai_signatures = [], editing_software = [], camera_evidence = {} } = metadata
  return (
    <div className="panel p-5">
      <SectionLabel icon={FileSearch}>Metadata &amp; Provenance</SectionLabel>
      <div className="flex flex-wrap gap-2">
        <Badge className={ai_signatures.length ? TONE.fuchsia : TONE.neutral}>
          <span className="break-anywhere">
            {ai_signatures.length ? `Generator: ${ai_signatures.map((s) => s.label).join(', ')}` : 'No generator signature'}
          </span>
        </Badge>
        <Badge className={c2pa.present ? TONE.sky : TONE.neutral}>
          {c2pa.present ? 'C2PA manifest present' : 'No C2PA manifest'}
        </Badge>
        <Badge className={camera_evidence.present ? TONE.emerald : TONE.neutral}>
          {camera_evidence.present ? 'Camera EXIF present' : 'No camera EXIF'}
        </Badge>
        {editing_software.length > 0 && (
          <Badge className={TONE.amber}>
            <span className="break-anywhere">Editor: {editing_software.join(', ')}</span>
          </Badge>
        )}
      </div>
      <p className="mt-3 break-anywhere text-sm leading-relaxed text-muted">{metadata.rationale}</p>
      {c2pa.present && (
        <p className="mt-2 break-anywhere text-xs leading-relaxed text-amber-700 dark:text-amber-300/80">{c2pa.note}</p>
      )}
    </div>
  )
}

function PrelintPanel({ prelint }) {
  if (!prelint) return null
  const { status, counts = {}, findings = [] } = prelint
  const tone = status === 'corrected' ? TONE.rose : status === 'flagged' ? TONE.amber : TONE.emerald
  return (
    <div className="panel p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionLabel icon={CheckCircle2}>Output Verification</SectionLabel>
        <Badge className={tone}>
          {status} · {counts.error || 0}E / {counts.warning || 0}W / {counts.info || 0}I
        </Badge>
      </div>
      {findings.length === 0 ? (
        <p className="text-sm text-muted">Model output matched the expected schema and agreed with the local evidence.</p>
      ) : (
        <ul className="space-y-2">
          {findings.map((f, i) => {
            const S = SEVERITY[f.severity] || SEVERITY.info
            const Icon = S.icon
            return (
              <li key={i} className="flex min-w-0 items-start gap-2 text-sm">
                <Icon size={14} className={`mt-0.5 shrink-0 ${S.cls}`} />
                <span className="min-w-0 break-anywhere text-muted">
                  <span className="font-mono text-xs text-faint">{f.stage}/{f.code}</span> — {f.detail}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function AnalysisPanel({ loading, error, result }) {
  if (loading) {
    return (
      <div className="panel flex min-h-[340px] flex-col items-center justify-center gap-5 p-8">
        <div className="relative">
          <Loader2 size={44} className="animate-spin text-accent" />
          <div className="absolute inset-0 animate-ping rounded-full bg-accent/10" />
        </div>
        <div className="text-center">
          <p className="font-medium text-fg">Running forensic analysis…</p>
          <p className="mt-1 font-mono text-xs text-faint">fingerprint · metadata · ELA · model · verification</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="panel flex min-h-[340px] flex-col items-center justify-center gap-4 p-8">
        <FileWarning size={34} className="text-rose-600 dark:text-rose-400" />
        <div className="min-w-0 max-w-sm text-center">
          <p className="font-medium text-rose-700 dark:text-rose-300">Analysis failed</p>
          <p className="mt-2 break-anywhere text-sm text-muted">{error}</p>
        </div>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="panel flex min-h-[340px] flex-col items-center justify-center gap-4 p-8 text-center">
        <ScanSearch size={34} className="text-faint" />
        <div>
          <p className="font-medium text-muted">Awaiting evidence</p>
          <p className="mt-1 text-sm text-faint">Upload an image or pick a sample, then run forensics.</p>
        </div>
      </div>
    )
  }

  const report = result.report || {}
  const verdict = VERDICT_STYLES[report.verdict] || VERDICT_STYLES.inconclusive
  const VerdictIcon = verdict.icon
  const score = Number.isFinite(report.integrity_score) ? report.integrity_score : null
  const tampering = report.tampering_detection || {}
  const signature = report.model_signature || {}
  const indicators = [...(tampering.indicators || []), ...(signature.signature_evidence || [])]

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="flex min-w-0 items-center gap-4">
          <div className={`shrink-0 rounded-xl border p-3 ${verdict.tone}`}>
            <VerdictIcon size={22} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-faint">Verdict</p>
            <p className="break-anywhere text-lg font-semibold text-fg">Status: {verdict.label}</p>
          </div>
        </div>
        {Number.isFinite(report.confidence) && (
          <Badge className={TONE.neutral}>
            <Activity size={12} /> {report.confidence}% confidence
          </Badge>
        )}
      </div>

      <div className="panel flex flex-col gap-6 p-5 sm:flex-row sm:items-center">
        {score !== null && <ScoreRing score={score} />}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {score !== null && (
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-faint">Integrity Score</span>
                <span className={`font-mono font-semibold ${scoreColor(score)}`}>{score}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                <div className={`h-full rounded-full transition-all duration-700 ${scoreBarColor(score)}`} style={{ width: `${score}%` }} />
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Badge className={tampering.detected ? TONE.rose : TONE.emerald}>
              <ShieldAlert size={12} /> Tampering: {tampering.detected ? 'Detected' : 'None found'}
            </Badge>
            <Badge className={signature.likely_ai_generated ? TONE.fuchsia : TONE.neutral}>
              <Fingerprint size={12} />
              <span className="break-anywhere">
                {signature.likely_ai_generated ? `Model: ${signature.suspected_model_family || 'Unknown AI'}` : 'No AI signature'}
              </span>
            </Badge>
          </div>
        </div>
      </div>

      {report.summary && (
        <div className="panel p-5">
          <SectionLabel>Forensic Summary</SectionLabel>
          <p className="break-anywhere text-sm leading-relaxed text-muted">{report.summary}</p>
        </div>
      )}

      <FingerprintPanel fingerprint={result.fingerprint} />
      <MetadataPanel metadata={result.metadata} />
      <PrelintPanel prelint={result.prelint} />

      {indicators.length > 0 && (
        <div className="panel p-5">
          <SectionLabel>Detected Indicators</SectionLabel>
          <ul className="space-y-2">
            {indicators.map((item, i) => (
              <li key={i} className="flex min-w-0 items-start gap-2 text-sm text-muted">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span className="break-anywhere">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="panel p-5">
        <summary className="cursor-pointer text-[10px] uppercase tracking-widest text-faint transition-colors hover:text-accent">
          Raw JSON Payload
        </summary>
        <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-raised p-4 font-mono text-xs leading-relaxed text-muted">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </div>
  )
}

export default function App() {
  const { isDark, toggle } = useTheme()
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [certifying, setCertifying] = useState(false)

  // Object URLs are revoked when replaced or cleared (below) but deliberately
  // NOT on unmount: React Fast Refresh and StrictMode both remount components
  // in development, and an unmount-time revoke kills a URL that the surviving
  // state still points at — the preview silently blanks. The browser reclaims
  // these when the document goes away, so there is nothing to gain here.

  const applyFile = useCallback((picked, pickError) => {
    if (pickError) {
      setError(pickError)
      return
    }
    if (!picked) return
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old)
      return URL.createObjectURL(picked)
    })
    setFile(picked)
    setResult(null)
    setError(null)
  }, [])

  const handleClear = useCallback(() => {
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old)
      return null
    })
    setFile(null)
    setResult(null)
    setError(null)
  }, [])

  const runForensics = async () => {
    if (!file || loading) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      if (prompt.trim()) formData.append('prompt', prompt.trim())
      const res = await fetch(`${API_URL}/api/v1/forensics/analyze`, { method: 'POST', body: formData })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.detail || `Request failed with status ${res.status}`)
      setResult(data)
    } catch (err) {
      setError(
        err.message === 'Failed to fetch'
          ? `Could not reach the backend at ${API_URL}. Is uvicorn running?`
          : err.message,
      )
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async () => {
    if (certifying || !result) return
    setCertifying(true)
    try {
      await downloadCertificate(result, file)
    } catch (err) {
      setError(`Could not generate certificate: ${err.message}`)
    } finally {
      setCertifying(false)
    }
  }

  const controlBtn =
    'inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 text-xs font-medium text-muted transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'

  return (
    <div className="mx-auto min-h-screen w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="shrink-0 rounded-xl border border-accent/25 bg-accent/10 p-2.5">
            <ShieldCheck size={24} className="text-accent" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold tracking-tight text-fg">
              Pixel<span className="text-accent">Guard</span>
            </h1>
            <p className="truncate text-xs text-muted">AI Asset Provenance &amp; Forensics Engine</p>
          </div>
        </div>

        {/* Single control strip: model, reset, export, theme. */}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-xl border border-line bg-card p-1.5">
          <span
            className="hidden max-w-[150px] truncate px-2 font-mono text-[11px] text-faint sm:inline"
            title={result?.model || 'gemini-pro-latest'}
          >
            {result?.model || 'gemini-pro-latest'}
          </span>
          <button onClick={handleClear} disabled={!file || loading} className={controlBtn} title="Clear the selected image">
            <RotateCcw size={13} /> <span className="hidden sm:inline">Reset</span>
          </button>
          <button onClick={handleDownload} disabled={!result || certifying} className={controlBtn} title="Download the forensic certificate as PDF">
            {certifying ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
            <span className="hidden sm:inline">{certifying ? 'Building…' : 'Export'}</span>
          </button>
          <ThemeToggle isDark={isDark} onToggle={toggle} />
        </div>
      </header>

      <main className="grid min-w-0 gap-5 lg:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted">
            <ImageIcon size={16} className="text-accent" /> Evidence Intake
          </div>

          <SampleGallery onPick={applyFile} disabled={loading} />
          <UploadZone file={file} previewUrl={previewUrl} onFile={applyFile} onClear={handleClear} loading={loading} />

          <input
            type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder="Optional analyst instructions (e.g. focus on face region)…"
            className="panel w-full min-w-0 px-4 py-3 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none"
          />

          <button
            onClick={runForensics}
            disabled={!file || loading}
            className="flex items-center justify-center gap-2 rounded-2xl bg-accent px-6 py-3.5 font-semibold text-accent-on transition-all hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? (<><Loader2 size={18} className="animate-spin" /> Analyzing…</>) : (<><ScanSearch size={18} /> Run Forensics</>)}
          </button>

          {result?.ela?.heatmap && previewUrl && (
            <div className="panel p-5">
              <SectionLabel icon={Layers}>Error Level Analysis</SectionLabel>
              <CompareSlider original={previewUrl} heatmap={result.ela.heatmap} alt={result.filename} />
              <p className="mt-3 break-anywhere text-xs leading-relaxed text-muted">{result.ela.interpretation?.note}</p>
              <p className="mt-2 break-anywhere text-xs leading-relaxed text-amber-700 dark:text-amber-300/80">
                {result.ela.interpretation?.caveat}
              </p>
            </div>
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted">
            <Fingerprint size={16} className="text-accent" /> Forensic Report
          </div>
          <AnalysisPanel loading={loading} error={error} result={result} />
        </section>
      </main>

      <footer className="mt-10 break-anywhere border-t border-line pt-5 text-center font-mono text-xs text-faint">
        PixelGuard v0.4.0 · local analysis node · {API_URL}
      </footer>
    </div>
  )
}
