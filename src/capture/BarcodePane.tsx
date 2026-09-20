import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProductOverview } from '../lib/types'
import { barcodeClient } from './engines'
import { buildIndex, FrameConsensus, identifier } from './domain'
import { cameraErrorMessage } from './cameraErrors'

type ExtendedCapabilities = MediaTrackCapabilities & { torch?: boolean; zoom?: { min: number; max: number; step: number } }

export default function BarcodePane({ products, onPick }: { products: ProductOverview[]; onPick: (p: ProductOverview) => void }) {
  const lookup = useMemo(() => buildIndex(products), [products])
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const client = useRef<ReturnType<typeof barcodeClient> | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const generation = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const frameId = useRef<number | null>(null)
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [hardware, setHardware] = useState(false)
  const [caps, setCaps] = useState<ExtendedCapabilities>({})
  const [zoom, setZoom] = useState(1)
  const [torch, setTorch] = useState(false)
  const [ms, setMs] = useState<number | null>(null)
  const matches = lookup(value)
  const id = identifier(value)

  function resolve(raw: string) { setValue(raw.trim()); setError('') }
  function stop() {
    generation.current++
    clearTimeout(timer.current)
    if (frameId.current !== null) video.current?.cancelVideoFrameCallback?.(frameId.current)
    frameId.current = null
    client.current?.cancel()
    client.current = null
    stream.current?.getTracks().forEach(track => track.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
    setRunning(false); setStarting(false); setCaps({}); setTorch(false)
  }

  useEffect(() => {
    const hide = () => { if (document.hidden) stop() }
    document.addEventListener('visibilitychange', hide)
    return () => { document.removeEventListener('visibilitychange', hide); stop() }
  }, [])

  useEffect(() => {
    if (!hardware) return
    let cancelled = false
    let dispose: (() => void) | undefined
    void import('onscan.js').then(({ default: onScan }) => {
      if (cancelled) return
      onScan.attachTo(document, {
        suffixKeyCodes: [13], minLength: 7, avgTimeByChar: 45, timeBeforeScanTest: 120,
        ignoreIfFocusOn: 'input,textarea,select,[contenteditable="true"]', reactToPaste: false,
        preventDefault: false, stopPropagation: false,
        onScan: (code: string) => { if (identifier(code).valid) resolve(code) },
      })
      dispose = () => onScan.detachFrom(document)
    }).catch(() => { if (!cancelled) setError('Η υποστήριξη scanner δεν φορτώθηκε. Χρησιμοποίησε το πεδίο κωδικού.') })
    return () => { cancelled = true; dispose?.() }
  }, [hardware])

  async function start() {
    if (starting || running) return
    stop()
    const gen = generation.current
    setStarting(true); setError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Η κάμερα απαιτεί HTTPS και άδεια στο Safari.')
      const decoder = barcodeClient()
      client.current = decoder
      const [media] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }).then(media => {
          if (gen !== generation.current) media.getTracks().forEach(track => track.stop())
          else stream.current = media
          return media
        }),
        decoder.call({ kind: 'warm' }),
      ])
      if (gen !== generation.current) { media.getTracks().forEach(track => track.stop()); return }
      const v = video.current
      if (!v) { stop(); return }
      v.srcObject = media
      await v.play()
      if (gen !== generation.current) { media.getTracks().forEach(track => track.stop()); return }
      const track = media.getVideoTracks()[0]
      const cap = track.getCapabilities?.() as ExtendedCapabilities ?? {}
      setCaps(cap); setZoom(track.getSettings().zoom ?? cap.zoom?.min ?? 1)
      setStarting(false); setRunning(true)
      const consensus = new FrameConsensus()
      const frame = async () => {
        if (gen !== generation.current) return
        frameId.current = null
        try {
          if (!v.videoWidth) { timer.current = setTimeout(frame, 100); return }
          const roi = { x: v.videoWidth * .08, y: v.videoHeight * .2, w: v.videoWidth * .84, h: v.videoHeight * .6 }
          const scale = Math.min(1, 960 / roi.w)
          const c = canvas.current ?? (canvas.current = document.createElement('canvas'))
          const width = Math.round(roi.w * scale), height = Math.round(roi.h * scale)
          if (c.width !== width || c.height !== height) { c.width = width; c.height = height }
          const ctx = c.getContext('2d', { willReadFrequently: true })
          if (!ctx) throw new Error('Δεν είναι διαθέσιμη η επεξεργασία εικόνας.')
          ctx.drawImage(v, roi.x, roi.y, roi.w, roi.h, 0, 0, width, height)
          const pixels = ctx.getImageData(0, 0, width, height)
          const result = await decoder.call({ buffer: pixels.data.buffer, width, height }, [pixels.data.buffer], undefined, 10000)
          if (gen !== generation.current) return
          setMs(Math.round(result.ms))
          const codes = [...new Set((result.codes as { text: string }[]).map(x => x.text).filter(x => identifier(x).valid))]
          if (codes.length === 1 && consensus.accept(codes[0], performance.now())) { resolve(codes[0]); stop(); return }
          if (codes.length !== 1) consensus.reset()
          if (codes.length > 1) setError('Βλέπω περισσότερους κωδικούς. Στόχευσε ένα προϊόν.')
          const schedule = () => {
            if (gen !== generation.current) return
            if (v.requestVideoFrameCallback) frameId.current = v.requestVideoFrameCallback(() => void frame())
            else void frame()
          }
          timer.current = setTimeout(schedule, Math.max(80, 180 - result.ms))
        } catch (error) {
          if (gen === generation.current) { stop(); setError(cameraErrorMessage(error)) }
        }
      }
      void frame()
    } catch (error) {
      if (gen === generation.current) { stop(); setError(cameraErrorMessage(error)) }
    }
  }

  async function image(file: File) {
    stop(); setError('')
    const gen = generation.current
    let decoder: ReturnType<typeof barcodeClient> | null = null
    try {
      decoder = barcodeClient(); client.current = decoder
      const result = await decoder.call({ blob: file, still: true })
      if (gen !== generation.current) return
      const codes = [...new Set((result.codes as { text: string }[]).map(x => x.text).filter(x => identifier(x).valid))]
      if (codes.length !== 1) throw new Error(codes.length ? 'Πολλαπλοί κωδικοί. Επίλεξε πιο κοντινή εικόνα.' : 'Δεν βρέθηκε έγκυρος κωδικός.')
      resolve(codes[0])
    } catch (error) {
      if (gen === generation.current) setError(error instanceof Error ? error.message : 'Αποτυχία ανάγνωσης.')
    } finally {
      decoder?.cancel()
      if (client.current === decoder) client.current = null
    }
  }

  async function trackOption(option: { zoom?: number; torch?: boolean }) {
    try {
      const track = stream.current?.getVideoTracks()[0]
      if (!track) return
      await track.applyConstraints({ advanced: [option as MediaTrackConstraintSet] })
      if (option.zoom !== undefined) setZoom(option.zoom)
      if (option.torch !== undefined) setTorch(option.torch)
    } catch { setError('Η κάμερα δεν υποστηρίζει αυτή τη ρύθμιση.') }
  }

  return <section className="capture-pane"><div className="capture-heading"><h2>Βρες το προϊόν.</h2><p>Κάμερα, φωτογραφία ή scanner χειρός. Ο κωδικός ελέγχεται πριν αντιστοιχιστεί.</p></div>
    <div className="capture-video"><video ref={video} muted playsInline aria-label="Προεπισκόπηση κάμερας" /><div className="capture-reticle" /><span>{running ? 'Στόχευσε έναν κωδικό' : starting ? 'Προετοιμασία κάμερας…' : 'Η κάμερα είναι κλειστή'}</span></div>
    <div className="capture-actions"><button className="wk-button primary" onClick={() => void start()} disabled={running || starting}>Άνοιγμα κάμερας</button><button className="wk-button" onClick={stop} disabled={!running && !starting}>Διακοπή</button><label className="wk-button">Από εικόνα<input className="sr-only" aria-label="Εικόνα barcode" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { const file = e.target.files?.[0]; if (file) void image(file); e.target.value = '' }} /></label>{caps.torch && <button className="wk-button" aria-pressed={torch} onClick={() => void trackOption({ torch: !torch })}>Φακός</button>}</div>
    {caps.zoom && <label className="capture-zoom">Zoom {zoom.toFixed(1)}×<input type="range" min={caps.zoom.min} max={Math.max(caps.zoom.min, Math.min(4, caps.zoom.max))} step={caps.zoom.step || .1} value={zoom} onChange={e => void trackOption({ zoom: Number(e.target.value) })} /></label>}
    <label className="capture-field">Κωδικός ή barcode<input aria-label="Κωδικός ή barcode" inputMode="numeric" autoComplete="off" value={value} onChange={e => resolve(e.target.value)} placeholder="Σκάναρε ή γράψε τον κωδικό" /></label>
    <label className="capture-check"><input type="checkbox" checked={hardware} onChange={e => setHardware(e.target.checked)} />Scanner χειρός / Bluetooth πληκτρολόγιο (Enter)</label><p className="capture-caption">Η παγκόσμια λήψη δεν παρεμβαίνει όταν γράφεις σε πεδίο. Μέσα σε πεδίο μπορείς να σκανάρεις ως πληκτρολόγιο.</p>
    {error && <p role="alert" className="capture-warning">{error}</p>}
    {value && <div className={`scan-result ${matches.length === 1 ? 'hit' : 'miss'}`}>{matches.length === 1 ? <><strong>{matches[0].description}</strong><small>{matches[0].internal_code} · {matches[0].unit} · Θέση {matches[0].location_code ?? '—'}</small><button className="wk-button primary" onClick={() => onPick(matches[0])}>Καταγραφή τιμής</button></> : <><strong>{matches.length > 1 ? 'Ο ίδιος κωδικός αντιστοιχεί σε πολλά προϊόντα.' : id.valid ? 'Δεν υπάρχει ακόμη στη βάση.' : 'Μη έγκυρος ή μη υποστηριζόμενος κωδικός.'}</strong><small>Δεν δημιουργήθηκε ούτε άλλαξε προϊόν.</small></>}</div>}
    {ms !== null && <p className="capture-caption">Τελευταίο decode: {ms} ms · ZXing-C++ WASM · συμφωνία δύο καρέ</p>}
  </section>
}
