import { FormEvent, useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from '@phosphor-icons/react'
import Workspace, { ProductHistory } from './ui/Workspace'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import type { Location, Membership, ProductOverview } from './lib/types'

type Toast = { kind: 'ok' | 'error'; text: string } | null

type EditDraft = {
  product: ProductOverview
  description: string
  barcode: string
  catalogPrice: string
  locationCode: string
  rowLabel: string
  numberLabel: string
}

const money = (value: number | null | undefined) =>
  value == null ? '—' : new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(value)

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [booting, setBooting] = useState(true)
  const [membership, setMembership] = useState<Membership | null>(null)
  const [products, setProducts] = useState<ProductOverview[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [lastSynced, setLastSynced] = useState<Date | null>(null)
  const [saving, setSaving] = useState(false)
  const [workspaceReady, setWorkspaceReady] = useState(false)
  const loadVersion = useRef(0)
  const [loadingData, setLoadingData] = useState(false)
  const [toast, setToast] = useState<Toast>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setBooting(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setMembership(null)
      loadVersion.current++
      setProducts([])
      setLocations([])
      setWorkspaceReady(false)
      setLastSynced(null)
      return
    }
    void loadWorkspace(session)
  }, [session?.user.id])

  async function loadWorkspace(activeSession = session) {
    if (!activeSession) return
    const version = ++loadVersion.current
    setLoadingData(true)
    try {
      const { data: member, error } = await supabase.from('memberships').select('store_id,user_id,role').eq('user_id', activeSession.user.id).maybeSingle()
      if (error) throw error
      if (version !== loadVersion.current) return
      if (!member) { setMembership(null); setProducts([]); setLocations([]); return }
      const productRows: ProductOverview[] = []
      for (let offset = 0; ; offset += 1000) {
        const result = await supabase.from('product_overview').select('*').eq('store_id', member.store_id).order('internal_code').range(offset, offset + 999)
        if (result.error) throw result.error
        if (version !== loadVersion.current) return
        productRows.push(...(result.data ?? []) as ProductOverview[])
        if (!result.data || result.data.length < 1000) break
      }
      const loc = await supabase.from('locations').select('id,code,name,sort_order').eq('store_id', member.store_id).order('sort_order')
      if (loc.error) throw loc.error
      if (version !== loadVersion.current) return
      setMembership(member as Membership); setProducts(productRows); setLocations((loc.data ?? []) as Location[]); setLastSynced(new Date())
    } catch (e) {
      if (version === loadVersion.current) setToast({ kind: 'error', text: e instanceof Error ? e.message : 'Δεν ήταν δυνατή η λήψη δεδομένων. Δοκίμασε ξανά.' })
    } finally {
      if (version === loadVersion.current) { setLoadingData(false); setWorkspaceReady(true) }
    }
  }

  async function saveProduct(draft: EditDraft) {
    if (!membership || saving || membership.role === 'viewer') return
    const raw = draft.catalogPrice.trim().replace(',', '.')
    if ((raw && !/^\d+(?:\.\d{1,2})?$/.test(raw)) || !draft.description.trim()) {
      setToast({ kind: 'error', text: 'Συμπλήρωσε περιγραφή και έγκυρη μη αρνητική τιμή (έως δύο δεκαδικά).' }); return
    }
    const parsedPrice = raw ? Number(raw) : null
    if (parsedPrice != null && (!Number.isFinite(parsedPrice) || parsedPrice > 9999999999.99)) {
      setToast({ kind: 'error', text: 'Η τιμή καταλόγου είναι εκτός ορίων.' }); return
    }
    setSaving(true)
    try {
      const { error } = await supabase.rpc('save_inventory_product', {
        p_store: membership.store_id, p_product: draft.product.product_id,
        p_description: draft.description.trim(), p_barcode: draft.barcode.trim() || null,
        p_price: parsedPrice, p_location_code: draft.locationCode || null,
        p_row: draft.rowLabel.trim() || null, p_number: draft.numberLabel.trim() || null,
      })
      if (error) throw error
      setEditDraft(null); setToast({ kind: 'ok', text: 'Οι αλλαγές αποθηκεύτηκαν.' }); await loadWorkspace()
    } catch (e) { setToast({ kind: 'error', text: e instanceof Error ? e.message : 'Η αποθήκευση απέτυχε. Οι αλλαγές σου παραμένουν ανοιχτές.' }) }
    finally { setSaving(false) }
  }

  if (booting) return <Splash />
  if (!session) return <EntryScreen onToast={setToast} toast={toast} />
  if (!workspaceReady) return <Splash />
  if (!membership) {
    return <LockedScreen session={session} onRefresh={() => loadWorkspace(session)} onSignOut={() => supabase.auth.signOut()} />
  }

  return <>
    <Workspace products={products} locations={locations} membership={membership} email={session.user.email || ''}
      loading={loadingData} lastSynced={lastSynced} onRefresh={() => { void loadWorkspace() }} onEdit={p => { setToast(null); setEditDraft(toDraft(p)) }}
      scan={membership.role === 'viewer' ? <div className="wk-empty">Ο λογαριασμός έχει πρόσβαση μόνο για ανάγνωση.</div> : <ScanCenter products={products} membership={membership} onSaved={async message => { setToast({ kind: 'ok', text: message }); await loadWorkspace() }} onError={text => setToast({ kind: 'error', text })} />}
      settings={<Settings session={session} membership={membership} onToast={setToast} />}
      toast={toast && <button role={toast.kind === 'error' ? 'alert' : 'status'} className={`toast ${toast.kind}`} onClick={() => setToast(null)}>{toast.text}</button>} />
    {editDraft && <ProductEditor draft={editDraft} setDraft={setEditDraft} locations={locations} onClose={() => !saving && setEditDraft(null)} onSave={saveProduct} saving={saving} readOnly={membership.role === 'viewer'} error={toast?.kind === 'error' ? toast.text : null} />}
  </>
}

function Splash() {
  return (
    <div className="splash">
      <Brand large />
      <div className="loading-line"><span /></div>
    </div>
  )
}

function Brand({ large = false }: { large?: boolean }) {
  return (
    <div className={large ? 'brand brand-large' : 'brand'}>
      <div className="brand-mark">L</div>
      <div>
        <strong>Leaksy</strong>
        <span>Inventory</span>
      </div>
    </div>
  )
}

function EntryScreen({ onToast, toast }: { onToast: (x: Toast) => void; toast: Toast }) {
  const [mode, setMode] = useState<'quick' | 'email'>('email')
  const [emailMode, setEmailMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [ownerKey, setOwnerKey] = useState('')
  const [working, setWorking] = useState(false)

  async function createPrivateSession() {
    setWorking(true)
    const { error } = await supabase.auth.signInAnonymously()
    setWorking(false)
    if (error) {
      setMode('email')
      onToast({ kind: 'error', text: 'Η γρήγορη ιδιωτική συνεδρία δεν είναι ενεργή. Χρησιμοποίησε λογαριασμό email.' })
    }
  }

  async function submitEmail(e: FormEvent) {
    e.preventDefault()
    setWorking(true)

    if (emailMode === 'signin') {
      const result = await supabase.auth.signInWithPassword({ email, password })
      setWorking(false)
      if (result.error) onToast({ kind: 'error', text: result.error.message })
      return
    }

    const bootstrap = await supabase.functions.invoke('leaksy-bootstrap-owner', {
      body: { email, password, ownerKey },
    })

    if (bootstrap.error) {
      setWorking(false)
      onToast({ kind: 'error', text: 'Η δημιουργία ιδιοκτήτη απέτυχε. Έλεγξε το owner key και ξαναδοκίμασε.' })
      return
    }

    const result = await supabase.auth.signInWithPassword({ email, password })
    setWorking(false)
    if (result.error) {
      onToast({ kind: 'error', text: result.error.message })
      return
    }

    setOwnerKey('')
    onToast({ kind: 'ok', text: 'Ο λογαριασμός ιδιοκτήτη ενεργοποιήθηκε.' })
  }

  return (
    <div className="entry-page">
      <section className="entry-visual">
        <Brand large />
        <div className="entry-copy">
          <div className="eyebrow">PRIVATE INVENTORY CONTROL</div>
          <h1>Τα προϊόντα σου, χωρίς χαρτιά.</h1>
          <p>Κωδικοί, θέσεις, τιμές ραφιού και σαρώσεις σε μία καθαρή βάση δεδομένων.</p>
        </div>
        <div className="entry-stats">
          <div><strong>398</strong><span>προϊόντα βάσης</span></div>
          <div><strong>324</strong><span>τιμές ραφιού</span></div>
          <div><strong>EU</strong><span>Supabase region</span></div>
        </div>
      </section>
      <section className="entry-card">
        <div className="entry-card-inner">
          <div className="eyebrow">LEAKSY ACCESS</div>
          <h2>Άνοιγμα χώρου εργασίας</h2>
          <p className="muted">Σύνδεση με email ή ασφαλής ενεργοποίηση του αρχικού ιδιοκτήτη.</p>
          {mode === 'quick' ? (
            <>
              <button className="primary-action" onClick={createPrivateSession} disabled={working}>
                {working ? 'Δημιουργία…' : 'Έναρξη ιδιωτικής συνεδρίας'}
              </button>
              <button className="text-action" onClick={() => setMode('email')}>Χρήση email και κωδικού</button>
            </>
          ) : (
            <form onSubmit={submitEmail} className="auth-form">
              <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
              <label>Κωδικός πρόσβασης<input type="password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} required /></label>
              {emailMode === 'signup' && (
                <label>One-time owner key<input type="password" value={ownerKey} onChange={e => setOwnerKey(e.target.value)} required /></label>
              )}
              <button className="primary-action" disabled={working}>{working ? 'Παρακαλώ…' : emailMode === 'signin' ? 'Σύνδεση' : 'Δημιουργία ιδιοκτήτη'}</button>
              <button type="button" className="text-action" onClick={() => setEmailMode(x => x === 'signin' ? 'signup' : 'signin')}>
                {emailMode === 'signin' ? 'Δεν έχω λογαριασμό' : 'Έχω ήδη λογαριασμό'}
              </button>
              <button type="button" className="text-action faint" onClick={() => setMode('quick')}>Πίσω</button>
            </form>
          )}
          {toast && <div className={`inline-alert ${toast.kind}`}>{toast.text}</div>}
        </div>
      </section>
    </div>
  )
}

function LockedScreen({ session, onRefresh, onSignOut }: { session: Session; onRefresh: () => void; onSignOut: () => void }) {
  const [ownerKey, setOwnerKey] = useState('')
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  async function claimOwner(e: React.FormEvent) {
    e.preventDefault()
    if (!ownerKey.trim()) return
    setWorking(true)
    setMessage(null)
    const { error } = await supabase.functions.invoke('leaksy-claim-owner', {
      body: { token: ownerKey.trim() },
    })
    setWorking(false)
    if (error) {
      setMessage({ kind: 'error', text: error.message })
      return
    }
    setOwnerKey('')
    setMessage({ kind: 'ok', text: 'Η ιδιοκτησία ενεργοποιήθηκε.' })
    onRefresh()
  }

  return (
    <div className="center-card-page">
      <div className="center-card">
        <Brand />
        <div className="lock-symbol">⌁</div>
        <h2>Η συνεδρία δεν έχει πρόσβαση.</h2>
        <p>Αν είσαι ο αρχικός ιδιοκτήτης, χρησιμοποίησε το one-time owner key. Διαφορετικά ο διαχειριστής πρέπει να σε προσθέσει στο inventory.</p>
        <form className="secure-form" onSubmit={claimOwner}>
          <input
            type="password"
            autoComplete="one-time-code"
            placeholder="One-time owner key"
            value={ownerKey}
            onChange={e => setOwnerKey(e.target.value)}
            aria-label="One-time owner key"
          />
          <button className="primary-action" disabled={working || !ownerKey.trim()}>
            {working ? 'Ενεργοποίηση…' : 'Ενεργοποίηση ιδιοκτήτη'}
          </button>
        </form>
        {message && <div className={`inline-alert ${message.kind}`}>{message.text}</div>}
        <button className="text-action" onClick={onRefresh}>Επανέλεγχος πρόσβασης</button>
        <button className="text-action faint" onClick={onSignOut}>Αποσύνδεση</button>
        <code className="session-id">{session.user.id.slice(0, 8)}…</code>
      </div>
    </div>
  )
}

function ScanCenter({ products, membership, onSaved, onError }: { products: ProductOverview[]; membership: Membership; onSaved: (x: string) => void; onError: (x: string) => void }) {
  const [mode, setMode] = useState<'barcode' | 'price' | 'document'>('barcode')
  return (
    <div className="scan-layout">
      <section className="panel scan-menu">
        <div className="scan-tabs">
          <button className={mode === 'barcode' ? 'active' : ''} onClick={() => setMode('barcode')}><b>01</b><span>Barcode</span><small>EAN / QR / DataMatrix</small></button>
          <button className={mode === 'price' ? 'active' : ''} onClick={() => setMode('price')}><b>02</b><span>Τιμή ραφιού</span><small>OCR + επιβεβαίωση</small></button>
          <button className={mode === 'document' ? 'active' : ''} onClick={() => setMode('document')}><b>03</b><span>Κατάσταση Α4</span><small>Ελληνικό OCR</small></button>
        </div>
      </section>
      <section className="panel scan-workspace">
        {mode === 'barcode' && <BarcodeScanner products={products} />}
        {mode === 'price' && <PriceOcr products={products} membership={membership} onSaved={onSaved} onError={onError} />}
        {mode === 'document' && <DocumentOcr products={products} />}
      </section>
    </div>
  )
}

function BarcodeScanner({ products }: { products: ProductOverview[] }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<any>(null)
  const [running, setRunning] = useState(false)
  const [code, setCode] = useState('')
  const [found, setFound] = useState<ProductOverview | null>(null)
  const [error, setError] = useState('')

  useEffect(() => () => controlsRef.current?.stop?.(), [])

  function resolve(value: string) {
    const clean = value.trim()
    setCode(clean)
    setFound(products.find(p => p.barcode === clean || p.internal_code === clean) ?? null)
  }

  async function start() {
    setError('')
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser')
      const reader = new BrowserMultiFormatReader()
      setRunning(true)
      controlsRef.current = await reader.decodeFromVideoDevice(undefined, videoRef.current!, result => {
        if (result) {
          resolve(result.getText())
          controlsRef.current?.stop?.()
          setRunning(false)
        }
      })
    } catch (e) {
      setRunning(false)
      setError(e instanceof Error ? e.message : 'Η κάμερα δεν άνοιξε.')
    }
  }

  return (
    <div className="scan-card">
      <div className="scan-heading"><span className="eyebrow">LIVE CAMERA</span><h3>Σάρωση προϊόντος</h3><p>Το barcode συγκρίνεται άμεσα με τη βάση Leaksy.</p></div>
      <div className="camera-frame"><video ref={videoRef} muted playsInline /><div className="scan-line" /></div>
      <div className="scan-actions">
        <button className="primary-action compact" onClick={start} disabled={running}>{running ? 'Σάρωση…' : 'Άνοιγμα κάμερας'}</button>
        <div className="manual-code"><input value={code} onChange={e => resolve(e.target.value)} aria-label="Κωδικός ή barcode" placeholder="ή γράψε κωδικό / EAN" /></div>
      </div>
      {error && <div className="inline-alert error">{error}</div>}
      {code && <div className={found ? 'scan-result hit' : 'scan-result miss'}>{found ? <><span>ΒΡΕΘΗΚΕ</span><strong>{found.description}</strong><small>{found.internal_code} · {money(found.catalog_price)} · Θέση {found.location_code ?? '—'}</small></> : <><span>ΝΕΟΣ ΚΩΔΙΚΟΣ</span><strong>{code}</strong><small>Δεν υπάρχει ακόμη στη βάση.</small></>}</div>}
    </div>
  )
}

function PriceOcr({ products, membership, onSaved, onError }: { products: ProductOverview[]; membership: Membership; onSaved: (x: string) => void; onError: (x: string) => void }) {
  const [working, setWorking] = useState(false)
  const [progress, setProgress] = useState(0)
  const [text, setText] = useState('')
  const [code, setCode] = useState('')
  const [price, setPrice] = useState('')
  const product = products.find(x => x.internal_code === code || x.barcode === code)

  async function process(file: File) {
    setWorking(true); setProgress(3); setText(''); setCode(''); setPrice('')
    try {
      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker('ell+eng', 1, { logger: m => m.progress && setProgress(Math.round(m.progress * 100)) })
      const result = await worker.recognize(file)
      await worker.terminate()
      const raw = result.data.text
      setText(raw)
      const codes = raw.match(/\b\d{7}\b/g) ?? []
      const known = codes.find(c => products.some(p => p.internal_code === c))
      if (known) setCode(known)
      const prices = [...raw.matchAll(/(?:€\s*)?(\d{1,3})[,.](\d{2})\s*(?:€)?/g)].map(m => `${m[1]}.${m[2]}`)
      if (new Set(prices).size === 1) setPrice(prices[0])
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Αποτυχία OCR.')
    } finally { setWorking(false) }
  }

  async function save() {
    if (!product) return onError('Επίλεξε έγκυρο κωδικό προϊόντος.')
    const value = Number(price.replace(',', '.'))
    if (!price.trim() || !/^\d+(?:[.,]\d{1,2})?$/.test(price.trim()) || !Number.isFinite(value) || value < 0) return onError('Η τιμή δεν είναι έγκυρη.')
    const { error } = await supabase.from('price_observations').insert({
      store_id: membership.store_id,
      product_id: product.product_id,
      internal_code: product.internal_code,
      observed_price: value,
      source_type: 'manual',
      source_ref: `Leaksy OCR ${new Date().toISOString()}`,
      barcode: product.barcode,
      verified: true,
      confidence: null,
    })
    if (error) onError(error.message)
    else onSaved(`Αποθηκεύτηκε ${money(value)} για ${product.internal_code}.`)
  }

  return (
    <div className="scan-card">
      <div className="scan-heading"><span className="eyebrow">LOCAL OCR</span><h3>Τιμή από φωτογραφία</h3><p>Το OCR τρέχει στη συσκευή και η τιμή αποθηκεύεται μόνο μετά από δική σου επιβεβαίωση.</p></div>
      <label className="upload-zone"><input type="file" accept="image/*" capture="environment" onChange={e => e.target.files?.[0] && process(e.target.files[0])} /><span>＋</span><strong>Φωτογράφισε ετικέτα</strong><small>ή επίλεξε εικόνα</small></label>
      {working && <div className="ocr-progress"><span style={{ width: `${progress}%` }} /><small>{progress}%</small></div>}
      {(text || code || price) && <div className="ocr-review"><div className="review-grid"><label>Κωδικός<input value={code} onChange={e => setCode(e.target.value)} /></label><label>Τιμή ραφιού<input value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" /></label></div>{product && <div className="matched-product"><strong>{product.description}</strong><span>Κατάλογος {money(product.catalog_price)}</span></div>}<details><summary>OCR κείμενο</summary><pre>{text}</pre></details><button className="primary-action compact" onClick={save}>Επιβεβαίωση και αποθήκευση</button></div>}
    </div>
  )
}

function DocumentOcr({ products }: { products: ProductOverview[] }) {
  const [working, setWorking] = useState(false)
  const [progress, setProgress] = useState(0)
  const [raw, setRaw] = useState('')
  const [rows, setRows] = useState<Array<{ code: string; text: string; known: boolean }>>([])

  async function process(file: File) {
    setWorking(true); setProgress(2); setRows([]); setRaw('')
    try {
      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker('ell+eng', 1, { logger: m => m.progress && setProgress(Math.round(m.progress * 100)) })
      const result = await worker.recognize(file)
      await worker.terminate()
      setRaw(result.data.text)
      const parsed = result.data.text.split('\n').map(line => {
        const code = line.match(/\b\d{7}\b/)?.[0]
        return code ? { code, text: line.trim(), known: products.some(p => p.internal_code === code) } : null
      }).filter(Boolean) as Array<{ code: string; text: string; known: boolean }>
      setRows(parsed)
    } finally { setWorking(false) }
  }

  return (
    <div className="scan-card">
      <div className="scan-heading"><span className="eyebrow">DOCUMENT OCR</span><h3>Κατάσταση απογραφής Α4</h3><p>Ανάγνωση ελληνικών κωδικών από φωτογραφία. Οι γραμμές μπαίνουν πρώτα σε review — ποτέ τυφλά στη βάση.</p></div>
      <label className="upload-zone document"><input type="file" accept="image/*" capture="environment" onChange={e => e.target.files?.[0] && process(e.target.files[0])} /><span>▧</span><strong>Σάρωση σελίδας</strong><small>κράτα την κάμερα παράλληλη με το χαρτί</small></label>
      {working && <div className="ocr-progress"><span style={{ width: `${progress}%` }} /><small>{progress}%</small></div>}
      {!!rows.length && <div className="ocr-lines"><div className="line-header"><strong>{rows.length} κωδικοί εντοπίστηκαν</strong><span>{rows.filter(x => x.known).length} υπάρχουν στη βάση</span></div>{rows.map((r,i) => <div className="ocr-line" key={`${r.code}-${i}`}><code>{r.code}</code><span>{r.text}</span><b className={r.known ? 'known' : 'unknown'}>{r.known ? 'MATCH' : 'NEW'}</b></div>)}</div>}
      {raw && <details className="raw-details"><summary>Πλήρες OCR</summary><pre>{raw}</pre></details>}
    </div>
  )
}

function Settings({ session, membership, onToast }: { session: Session; membership: Membership; onToast: (x: Toast) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const isAnonymous = session.user.is_anonymous

  async function secureAccount(e: FormEvent) {
    e.preventDefault(); setSaving(true)
    const { error } = await supabase.auth.updateUser({ email, password })
    setSaving(false)
    onToast(error ? { kind: 'error', text: error.message } : { kind: 'ok', text: 'Έλεγξε το email σου για επιβεβαίωση. Η ίδια ιδιοκτησία inventory διατηρείται.' })
  }

  return (
    <div className="settings-grid">
      <section className="panel setting-card"><span className="eyebrow">ACCOUNT</span><h3>Πρόσβαση</h3><dl><div><dt>Ρόλος</dt><dd>{membership.role}</dd></div><div><dt>Session</dt><dd>{session.user.id.slice(0, 12)}…</dd></div><div><dt>Τύπος</dt><dd>{isAnonymous ? 'Τοπική ιδιωτική συνεδρία' : session.user.email}</dd></div></dl>{isAnonymous && <form className="secure-form" onSubmit={secureAccount}><p>Σύνδεσε email ώστε να μπορείς να μπεις και από Windows χωρίς να χάσεις την ιδιοκτησία.</p><input type="email" placeholder="email" value={email} onChange={e => setEmail(e.target.value)} required /><input type="password" minLength={8} placeholder="νέος κωδικός" value={password} onChange={e => setPassword(e.target.value)} required /><button className="primary-action compact" disabled={saving}>{saving ? 'Αποθήκευση…' : 'Ασφάλιση λογαριασμού'}</button></form>}<button className="danger-action" onClick={() => supabase.auth.signOut()}>Αποσύνδεση</button></section>
      <section className="panel setting-card"><span className="eyebrow">IPHONE PWA</span><h3>Εγκατάσταση</h3><ol className="steps"><li>Άνοιξε το Leaksy στο Safari.</li><li>Share → Add to Home Screen.</li><li>Άνοιξέ το από το νέο icon.</li></ol><div className="setting-note">Η κάμερα barcode λειτουργεί μέσω HTTPS στο Vercel.</div></section>
      <section className="panel setting-card"><span className="eyebrow">OCR POLICY</span><h3>Review first</h3><p>Κάθε OCR αποτέλεσμα περνά από επιβεβαίωση πριν γίνει δεδομένο. Αυτό αποτρέπει λάθος κωδικούς και τιμές από θολές φωτογραφίες.</p><div className="setting-note">Τρέχων provider: local Tesseract ελληνικά + αγγλικά. Η αρχιτεκτονική είναι έτοιμη για cloud document OCR όταν προστεθούν credentials.</div></section>
    </div>
  )
}

function ProductEditor({ draft, setDraft, locations, onClose, onSave, saving, readOnly, error }: { draft: EditDraft; setDraft: (d: EditDraft) => void; locations: Location[]; onClose: () => void; onSave: (d: EditDraft) => void; saving: boolean; readOnly: boolean; error: string | null }) {
  return <Dialog.Root open onOpenChange={open => { if (!open && !saving) onClose() }}><Dialog.Portal>
    <Dialog.Overlay className="wk-overlay" />
    <Dialog.Content className="wk-drawer" onEscapeKeyDown={e => { if (saving) e.preventDefault() }} onInteractOutside={e => { if (saving) e.preventDefault() }}>
      <div className="wk-drawer-head"><div><p>ΠΡΟΪΟΝ / <code>{draft.product.internal_code}</code></p><Dialog.Title>Καρτέλα προϊόντος</Dialog.Title><Dialog.Description className="sr-only">Περιγραφή, τιμές, θέση και ιστορικό προϊόντος.</Dialog.Description></div><Dialog.Close className="wk-icon" disabled={saving} aria-label="Κλείσιμο προϊόντος"><X size={19} /></Dialog.Close></div>
      <form className="wk-drawer-body" onSubmit={e => { e.preventDefault(); if (!readOnly) onSave(draft) }}>
        <fieldset disabled={saving || readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
          <label>Περιγραφή<textarea required value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
          <div className="form-grid"><label>Barcode<input value={draft.barcode} onChange={e => setDraft({ ...draft, barcode: e.target.value })} /></label><label>Τιμή καταλόγου (€)<input inputMode="decimal" value={draft.catalogPrice} onChange={e => setDraft({ ...draft, catalogPrice: e.target.value })} /></label></div>
          <div className="form-grid three"><label>Θέση<select value={draft.locationCode} onChange={e => setDraft({ ...draft, locationCode: e.target.value })}><option value="">Χωρίς θέση</option>{locations.map(x => <option key={x.id} value={x.code}>{x.name}</option>)}</select></label><label>Σειρά<input value={draft.rowLabel} onChange={e => setDraft({ ...draft, rowLabel: e.target.value })} /></label><label>Αριθμός<input value={draft.numberLabel} onChange={e => setDraft({ ...draft, numberLabel: e.target.value })} /></label></div>
        </fieldset>
        <div className="read-only-card"><span>Τελευταία τιμή ραφιού · {draft.product.unit || '—'}</span><strong>{money(draft.product.shelf_price)}</strong><small>{draft.product.source_ref || 'Χωρίς καταγραφή ραφιού'}</small></div>
        {!readOnly && <button type="submit" className="wk-button primary" disabled={saving}>{saving ? 'Αποθήκευση…' : 'Αποθήκευση αλλαγών'}</button>}
        {error && <p role="alert" className="wk-form-error">{error}</p>}
        <ProductHistory product={draft.product} />
      </form>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
}

function Empty({ text }: { text: string }) { return <div className="empty-state">{text}</div> }
function signedMoney(value: number | null) { if (value == null) return '—'; return `${value > 0 ? '+' : ''}${money(value)}` }
function toDraft(p: ProductOverview): EditDraft { return { product: p, description: p.description, barcode: p.barcode ?? '', catalogPrice: p.catalog_price?.toString() ?? '', locationCode: p.location_code ?? '', rowLabel: p.row_label ?? '', numberLabel: p.number_label ?? '' } }

export default App
