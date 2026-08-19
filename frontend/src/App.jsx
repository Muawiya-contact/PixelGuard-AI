import { useCallback, useRef, useState } from 'react'
import {
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  UploadCloud,
  ScanSearch,
  Loader2,
  ImageIcon,
  Fingerprint,
  Cpu,
  FileWarning,
  Activity,
  FileText,
  Layers,
  FileSearch,
  CheckCircle2,
  AlertTriangle,
  Info,
  X,
} from 'lucide-react'
import CompareSlider from './components/CompareSlider.jsx'
import SampleGallery from './components/SampleGallery.jsx'
import { downloadCertificate } from './lib/certificate.js'

const API_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

const VERDICT_STYLES = {
  authentic: {
    label: 'Authentic',
    icon: ShieldCheck,
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    glow: 'shadow-[0_0_24px_rgba(16,185,129,0.25)]',
  },
  ai_generated: {
    label: 'AI Generated',
    icon: Cpu,
    badge: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
    glow: 'shadow-[0_0_24px_rgba(217,70,239,0.25)]',
  },
  manipulated: {
    label: 'Manipulated',
    icon: ShieldAlert,
    badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    glow: 'shadow-[0_0_24px_rgba(244,63,94,0.25)]',
  },
  inconclusive: {
    label: 'Inconclusive',
    icon: ShieldQuestion,
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    glow: 'shadow-[0_0_24px_rgba(245,158,11,0.2)]',
  },
}

const SEVERITY = {
  error: { icon: AlertTriangle, cls: 'text-rose-300' },
  warning: { icon: AlertTriangle, cls: 'text-amber-300' },
  info: { icon: Info, cls: 'text-sky-300' },
}

function scoreColor(score) {
  if (score >= 75) return 'text-emerald-400'
  if (score >= 45) return 'text-amber-400'
  return 'text-rose-400'
}

function scoreBarColor(score) {
  if (score >= 75) return 'bg-emerald-400'
  if (score >= 45) return 'bg-amber-400'
  return 'bg-rose-400'
}

function Badge({ children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${className}`}>
      {children}
    </span>
  )
}

function ScoreRing({ score }) {
  const r = 52
  const c = 2 * Math.PI * r
  const filled = (Math.max(0, Math.min(100, score)) / 100) * c
  return (
    <div className="relative h-32 w-32 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth="8" />
        <circle
          cx="60" cy="60" r={r} fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`} className={scoreColor(score)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-bold ${scoreColor(score)}`}>{score}</span>
        <span className="text-[10px] uppercase tracking-widest text-slate-500">Integrity</span>
      </div>
    </div>
  )
}

function UploadZone({ file, previewUrl, onFile, onClear, loading }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault()
      setDragOver(false)
      const dropped = e.dataTransfer.files?.[0]
      if (dropped && dropped.type.startsWith('image/')) onFile(dropped)
    },
    [onFile],
  )

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => !file && inputRef.current?.click()}
      className={`panel relative flex min-h-[300px] flex-col items-center justify-center overflow-hidden p-6 transition-all duration-200 ${
        file ? '' : 'cursor-pointer hover:border-accent/40'
      } ${dragOver ? 'border-accent/60 bg-accent/5' : ''}`}
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
        <div className="relative w-full">
          <div className="relative mx-auto max-h-[380px] w-fit overflow-hidden rounded-xl border border-white/10">
            <img src={previewUrl} alt="Evidence preview" className="max-h-[380px] w-auto object-contain" />
            {loading && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="scanline absolute inset-x-0 top-1/2 h-24" />
              </div>
            )}
          </div>
          {!loading && (
            <button
              onClick={(e) => { e.stopPropagation(); onClear() }}
              className="absolute -right-2 -top-2 rounded-full border border-white/10 bg-surface-800 p-1.5 text-slate-400 transition-colors hover:text-rose-400"
              title="Remove image"
            >
              <X size={14} />
            </button>
          )}
          <p className="mt-4 truncate text-center font-mono text-xs text-slate-500">
            {file?.name} · {(file?.size / 1024).toFixed(1)} KB
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="rounded-2xl border border-white/5 bg-surface-800 p-5">
            <UploadCloud size={36} className="text-accent" />
          </div>
          <div>
            <p className="font-medium text-slate-200">Drop evidence image here</p>
            <p className="mt-1 text-sm text-slate-500">or click to browse — PNG, JPG, WebP</p>
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
      <p className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500">
        <FileSearch size={12} className="text-accent" /> Metadata &amp; Provenance
      </p>
      <div className="flex flex-wrap gap-2">
        <Badge className={ai_signatures.length ? 'border-fuchsia-500/30 bg-fuchsia-500/15 text-fuchsia-300' : 'border-white/10 bg-white/5 text-slate-400'}>
          {ai_signatures.length ? `Generator: ${ai_signatures.map((s) => s.label).join(', ')}` : 'No generator signature'}
        </Badge>
        <Badge className={c2pa.present ? 'border-sky-500/30 bg-sky-500/15 text-sky-300' : 'border-white/10 bg-white/5 text-slate-400'}>
          {c2pa.present ? 'C2PA manifest present' : 'No C2PA manifest'}
        </Badge>
        <Badge className={camera_evidence.present ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300' : 'border-white/10 bg-white/5 text-slate-400'}>
          {camera_evidence.present ? 'Camera EXIF present' : 'No camera EXIF'}
        </Badge>
        {editing_software.length > 0 && (
          <Badge className="border-amber-500/30 bg-amber-500/15 text-amber-300">
            Editor: {editing_software.join(', ')}
          </Badge>
        )}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-slate-400">{metadata.rationale}</p>
      {c2pa.present && <p className="mt-2 text-xs leading-relaxed text-amber-300/80">{c2pa.note}</p>}
    </div>
  )
}

function PrelintPanel({ prelint }) {
  if (!prelint) return null
  const { status, counts = {}, findings = [] } = prelint
  const tone =
    status === 'corrected' ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
      : status === 'flagged' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  return (
    <div className="panel p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500">
          <CheckCircle2 size={12} className="text-accent" /> Output Verification
        </p>
        <Badge className={tone}>
          {status} · {counts.error || 0}E / {counts.warning || 0}W / {counts.info || 0}I
        </Badge>
      </div>
      {findings.length === 0 ? (
        <p className="text-sm text-slate-400">
          Model output matched the expected schema and agreed with the local evidence.
        </p>
      ) : (
        <ul className="space-y-2">
          {findings.map((f, i) => {
            const S = SEVERITY[f.severity] || SEVERITY.info
            const Icon = S.icon
            return (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Icon size={14} className={`mt-0.5 shrink-0 ${S.cls}`} />
                <span className="text-slate-400">
                  <span className="font-mono text-xs text-slate-500">{f.stage}/{f.code}</span> — {f.detail}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function AnalysisPanel({ loading, error, result, onDownload, certifying }) {
  if (loading) {
    return (
      <div className="panel flex min-h-[340px] flex-col items-center justify-center gap-5 p-8">
        <div className="relative">
          <Loader2 size={44} className="animate-spin text-accent" />
          <div className="absolute inset-0 animate-ping rounded-full bg-accent/10" />
        </div>
        <div className="text-center">
          <p className="font-medium text-slate-200">Running forensic analysis…</p>
          <p className="mt-1 font-mono text-xs text-slate-500">
            metadata · ELA · model analysis · verification
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="panel flex min-h-[340px] flex-col items-center justify-center gap-4 p-8">
        <FileWarning size={36} className="text-rose-400" />
        <div className="max-w-sm text-center">
          <p className="font-medium text-rose-300">Analysis failed</p>
          <p className="mt-2 break-words text-sm text-slate-400">{error}</p>
        </div>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="panel flex min-h-[340px] flex-col items-center justify-center gap-4 p-8 text-center">
        <ScanSearch size={36} className="text-slate-600" />
        <div>
          <p className="font-medium text-slate-400">Awaiting evidence</p>
          <p className="mt-1 text-sm text-slate-600">
            Upload an image or pick a sample, then run forensics.
          </p>
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
      <div className={`panel flex items-center justify-between gap-4 p-5 ${verdict.glow}`}>
        <div className="flex items-center gap-4">
          <div className={`rounded-xl border p-3 ${verdict.badge}`}>
            <VerdictIcon size={24} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500">Verdict</p>
            <p className="text-lg font-semibold text-slate-100">Status: {verdict.label}</p>
          </div>
        </div>
        {Number.isFinite(report.confidence) && (
          <Badge className="border-white/10 bg-white/5 text-slate-300">
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
                <span className="text-slate-500">Integrity Score</span>
                <span className={`font-mono font-semibold ${scoreColor(score)}`}>{score}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                <div className={`h-full rounded-full transition-all duration-700 ${scoreBarColor(score)}`} style={{ width: `${score}%` }} />
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Badge className={tampering.detected ? 'border-rose-500/30 bg-rose-500/15 text-rose-300' : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'}>
              <ShieldAlert size={12} />
              Tampering: {tampering.detected ? 'Detected' : 'None found'}
            </Badge>
            <Badge className={signature.likely_ai_generated ? 'border-fuchsia-500/30 bg-fuchsia-500/15 text-fuchsia-300' : 'border-white/10 bg-white/5 text-slate-300'}>
              <Fingerprint size={12} />
              {signature.likely_ai_generated ? `Model: ${signature.suspected_model_family || 'Unknown AI'}` : 'No AI signature'}
            </Badge>
          </div>
          <button
            onClick={onDownload}
            disabled={certifying}
            className="mt-1 inline-flex w-fit items-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
          >
            {certifying
              ? (<><Loader2 size={15} className="animate-spin" /> Generating…</>)
              : (<><FileText size={15} /> Download Forensic Certificate</>)}
          </button>
        </div>
      </div>

      {report.summary && (
        <div className="panel p-5">
          <p className="mb-2 text-[10px] uppercase tracking-widest text-slate-500">Forensic Summary</p>
          <p className="text-sm leading-relaxed text-slate-300">{report.summary}</p>
        </div>
      )}

      <MetadataPanel metadata={result.metadata} />
      <PrelintPanel prelint={result.prelint} />

      {indicators.length > 0 && (
        <div className="panel p-5">
          <p className="mb-3 text-[10px] uppercase tracking-widest text-slate-500">Detected Indicators</p>
          <ul className="space-y-2">
            {indicators.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-400">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="panel group p-5">
        <summary className="cursor-pointer text-[10px] uppercase tracking-widest text-slate-500 transition-colors hover:text-accent">
          Raw JSON Payload
        </summary>
        <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-surface-950 p-4 font-mono text-xs leading-relaxed text-cyan-200/80">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </div>
  )
}

export default function App() {
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const applyFile = useCallback(
    (picked, pickError) => {
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
    },
    [],
  )

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

  const [certifying, setCertifying] = useState(false)

  const handleDownload = async () => {
    if (certifying) return
    setCertifying(true)
    try {
      await downloadCertificate(result)
    } catch (err) {
      setError(`Could not generate certificate: ${err.message}`)
    } finally {
      setCertifying(false)
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-accent/20 bg-accent/10 p-2.5">
            <ShieldCheck size={26} className="text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-100">
              Pixel<span className="text-accent">Guard</span>
            </h1>
            <p className="text-xs text-slate-500">AI Asset Provenance &amp; Forensics Engine</p>
          </div>
        </div>
        <Badge className="border-white/10 bg-white/5 font-mono text-slate-400">
          <Cpu size={12} /> {result?.model || 'gemini-pro-latest'}
        </Badge>
      </header>

      <main className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-400">
            <ImageIcon size={16} className="text-accent" /> Evidence Intake
          </div>

          <SampleGallery onPick={applyFile} disabled={loading} />

          <UploadZone
            file={file} previewUrl={previewUrl} onFile={applyFile}
            onClear={handleClear} loading={loading}
          />

          <input
            type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder="Optional analyst instructions (e.g. focus on face region)…"
            className="panel w-full px-4 py-3 text-sm text-slate-300 placeholder:text-slate-600 focus:border-accent/40 focus:outline-none"
          />

          <button
            onClick={runForensics}
            disabled={!file || loading}
            className="flex items-center justify-center gap-2 rounded-2xl bg-accent px-6 py-3.5 font-semibold text-surface-950 transition-all hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-30"
          >
            {loading ? (<><Loader2 size={18} className="animate-spin" /> Analyzing…</>) : (<><ScanSearch size={18} /> Run Forensics</>)}
          </button>

          {result?.ela?.heatmap && previewUrl && (
            <div className="panel p-5">
              <p className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500">
                <Layers size={12} className="text-accent" /> Error Level Analysis
              </p>
              <CompareSlider original={previewUrl} heatmap={result.ela.heatmap} alt={result.filename} />
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                {result.ela.interpretation?.note}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-amber-300/70">
                {result.ela.interpretation?.caveat}
              </p>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-400">
            <Fingerprint size={16} className="text-accent" /> Forensic Report
          </div>
          <AnalysisPanel loading={loading} error={error} result={result} onDownload={handleDownload} certifying={certifying} />
        </section>
      </main>

      <footer className="mt-12 border-t border-white/5 pt-6 text-center font-mono text-xs text-slate-600">
        PixelGuard v0.3.0 · local analysis node · {API_URL}
      </footer>
    </div>
  )
}
