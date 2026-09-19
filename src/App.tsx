import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import type { Location, Membership, ProductOverview } from './lib/types'

type PageKey = 'dashboard' | 'products' | 'audit' | 'scan' | 'settings'
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

const nav: Array<{ key: PageKey; label: string; glyph: string }> = [
  { key: 'dashboard', label: 'Επισκόπηση', glyph: '◫' },
  { key: 'products', label: 'Προϊόντα', glyph: '▤' },
  { key: 'audit', label: 'Τιμές', glyph: '∆' },
  { key: 'scan', label: 'Σάρωση', glyph: '⌁' },
  { key: 'settings', label: 'Ρυθμίσεις', glyph: '⚙' },
]

const money = (value: number | null | undefined) =>
  value == null ? '—' : new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(value)

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('el-GR')

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [booting, setBooting] = useState(true)
  const [membership, setMembership] = useState<Membership | null>(null)
  const [products, setProducts] = useState<ProductOverview[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [page, setPage] = useState<PageKey>('dashboard')
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
      setProducts([])
      return
    }
    void loadWorkspace(session)
  }, [session?.user.id])

  async function loadWorkspace(activeSession = session) {
    if (!activeSession) return
    setLoadingData(true)
    const { data: member, error: memberError } = await supabase
      .from('memberships')
      .select('store_id,user_id,role')
      .eq('user_id', activeSession.user.id)
      .maybeSingle()

    if (memberError) {
      setToast({ kind: 'error', text: memberError.message })
      setLoadingData(false)
      return
    }

    if (!member) {
      setMembership(null)
      setProducts([])
      setLocations([])
      setLoadingData(false)
      return
    }

    setMembership(member as Membership)
    const [productResponse, locationResponse] = await Promise.all([
      supabase
        .from('product_overview')
        .select('*')
        .eq('store_id', member.store_id)
        .order('internal_code'),
      supabase
        .from('locations')
        .select('id,code,name,sort_order')
        .eq('store_id', member.store_id)
        .order('sort_order'),
    ])

    if (productResponse.error) setToast({ kind: 'error', text: productResponse.error.message })
    if (locationResponse.error) setToast({ kind: 'error', text: locationResponse.error.message })
    setProducts((productResponse.data ?? []) as ProductOverview[])
    setLocations((locationResponse.data ?? []) as Location[])
    setLoadingData(false)
  }

  async function saveProduct(draft: EditDraft) {
    if (!membership) return
    const parsedPrice = draft.catalogPrice.trim() === '' ? null : Number(draft.catalogPrice.replace(',', '.'))
    if (parsedPrice != null && !Number.isFinite(parsedPrice)) {
      setToast({ kind: 'error', text: 'Μη έγκυρη τιμή καταλόγου.' })
      return
    }

    const { error: productError } = await supabase
      .from('products')
      .update({
        description: draft.description.trim(),
        barcode: draft.barcode.trim() || null,
        catalog_price: parsedPrice,
        updated_at: new Date().toISOString(),
      })
      .eq('id', draft.product.product_id)
      .eq('store_id', membership.store_id)

    if (productError) {
      setToast({ kind: 'error', text: productError.message })
      return
    }

    const location = locations.find(x => x.code === draft.locationCode)
    const locationChanged =
      draft.locationCode !== (draft.product.location_code ?? '') ||
      draft.rowLabel.trim() !== (draft.product.row_label ?? '') ||
      draft.numberLabel.trim() !== (draft.product.number_label ?? '')

    if (locationChanged) {
      const { error: deactivateError } = await supabase
        .from('product_locations')
        .update({ is_current: false })
        .eq('product_id', draft.product.product_id)
        .eq('store_id', membership.store_id)
        .eq('is_current', true)

      if (deactivateError) {
        setToast({ kind: 'error', text: deactivateError.message })
        return
      }

      if (location) {
        const { error: locationError } = await supabase.from('product_locations').insert({
          store_id: membership.store_id,
          product_id: draft.product.product_id,
          location_id: location.id,
          row_label: draft.rowLabel.trim() || null,
          number_label: draft.numberLabel.trim() || null,
          is_current: true,
        })
        if (locationError) {
          setToast({ kind: 'error', text: locationError.message })
          return
        }
      }
    }

    setEditDraft(null)
    setToast({ kind: 'ok', text: 'Το προϊόν ενημερώθηκε.' })
    await loadWorkspace()
  }

  if (booting) return <Splash />
  if (!session) return <EntryScreen onToast={setToast} toast={toast} />
  if (!membership) {
    return <LockedScreen session={session} onRefresh={() => loadWorkspace(session)} onSignOut={() => supabase.auth.signOut()} />
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav className="side-nav">
          {nav.map(item => (
            <button
              key={item.key}
              className={page === item.key ? 'nav-item active' : 'nav-item'}
              onClick={() => setPage(item.key)}
            >
              <span className="nav-glyph">{item.glyph}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="side-status">
          <span className="status-dot" />
          <div>
            <strong>Supabase online</strong>
            <span>{membership.role}</span>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <Header page={page} products={products} loading={loadingData} onRefresh={() => loadWorkspace()} />
        <section className="content">
          {page === 'dashboard' && <Dashboard products={products} onOpenProduct={setEditDraft} />}
          {page === 'products' && <Products products={products} onEdit={setEditDraft} />}
          {page === 'audit' && <PriceAudit products={products} />}
          {page === 'scan' && (
            <ScanCenter
              products={products}
              membership={membership}
              onSaved={async message => {
                setToast({ kind: 'ok', text: message })
                await loadWorkspace()
              }}
              onError={text => setToast({ kind: 'error', text })}
            />
          )}
          {page === 'settings' && <Settings session={session} membership={membership} onToast={setToast} />}
        </section>
      </main>

      <nav className="bottom-nav">
        {nav.map(item => (
          <button key={item.key} className={page === item.key ? 'active' : ''} onClick={() => setPage(item.key)}>
            <span>{item.glyph}</span>
            <small>{item.label}</small>
          </button>
        ))}
      </nav>

      {toast && (
        <button className={`toast ${toast.kind}`} onClick={() => setToast(null)}>
          {toast.text}
        </button>
      )}

      {editDraft && (
        <ProductEditor
          draft={editDraft}
          setDraft={setEditDraft}
          locations={locations}
          onClose={() => setEditDraft(null)}
          onSave={saveProduct}
        />
      )}
    </div>
  )
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
  const [mode, setMode] = useState<'quick' | 'email'>('quick')
  const [emailMode, setEmailMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
    const result = emailMode === 'signin'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password })
    setWorking(false)
    if (result.error) onToast({ kind: 'error', text: result.error.message })
    else if (!result.data.session) onToast({ kind: 'ok', text: 'Έλεγξε το email σου για επιβεβαίωση.' })
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
          <p className="muted">Η πρώτη εγκεκριμένη συνεδρία γίνεται ο ιδιοκτήτης του inventory.</p>
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
              <button className="primary-action" disabled={working}>{working ? 'Παρακαλώ…' : emailMode === 'signin' ? 'Σύνδεση' : 'Δημιουργία λογαριασμού'}</button>
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
  return (
    <div className="center-card-page">
      <div className="center-card">
        <Brand />
        <div className="lock-symbol">⌁</div>
        <h2>Η συνεδρία δεν έχει πρόσβαση.</h2>
        <p>Αν αυτό είναι το πρώτο άνοιγμα, πάτησε επανέλεγχο. Διαφορετικά συνδέσου με τον λογαριασμό ιδιοκτήτη.</p>
        <button className="primary-action" onClick={onRefresh}>Επανέλεγχος πρόσβασης</button>
        <button className="text-action" onClick={onSignOut}>Αποσύνδεση</button>
        <code className="session-id">{session.user.id.slice(0, 8)}…</code>
      </div>
    </div>
  )
}

function Header({ page, products, loading, onRefresh }: { page: PageKey; products: ProductOverview[]; loading: boolean; onRefresh: () => void }) {
  const titles: Record<PageKey, [string, string]> = {
    dashboard: ['Επισκόπηση', 'Στιγμιότυπο inventory και ελέγχου τιμών'],
    products: ['Προϊόντα', `${products.length} εγγραφές στη βάση`],
    audit: ['Έλεγχος τιμών', 'Κατάλογος έναντι τελευταίας τιμής ραφιού'],
    scan: ['Σάρωση', 'Barcode, φωτογραφία ραφιού και OCR εγγράφου'],
    settings: ['Ρυθμίσεις', 'Λογαριασμός, PWA και ασφάλεια'],
  }
  return (
    <header className="topbar">
      <div><h1>{titles[page][0]}</h1><p>{titles[page][1]}</p></div>
      <button className="icon-button" onClick={onRefresh} aria-label="Ανανέωση">{loading ? '…' : '↻'}</button>
    </header>
  )
}

function Dashboard({ products, onOpenProduct }: { products: ProductOverview[]; onOpenProduct: (draft: EditDraft) => void }) {
  const differences = products.filter(p => p.price_status === 'different')
  const checked = products.filter(p => p.shelf_price != null)
  const located = products.filter(p => p.location_code)
  const positive = differences.filter(p => (p.price_diff ?? 0) > 0)
  const coverage = products.length ? Math.round((checked.length / products.length) * 100) : 0
  return (
    <div className="stack-xl">
      <div className="metric-grid">
        <Metric label="Προϊόντα" value={String(products.length)} note="master catalogue" />
        <Metric label="Έλεγχος τιμής" value={`${coverage}%`} note={`${checked.length} επιβεβαιωμένα`} />
        <Metric label="Διαφορές" value={String(differences.length)} note={`${positive.length} ακριβότερα στο ράφι`} danger={differences.length > 0} />
        <Metric label="Με θέση" value={String(located.length)} note={`${products.length - located.length} χωρίς χαρτογράφηση`} />
      </div>
      <section className="panel">
        <div className="panel-heading"><div><span className="eyebrow">PRICE EXCEPTIONS</span><h3>Μεγαλύτερες αποκλίσεις</h3></div><span className="count-pill">{differences.length}</span></div>
        <div className="exception-list">
          {[...differences].sort((a, b) => Math.abs(b.price_diff ?? 0) - Math.abs(a.price_diff ?? 0)).slice(0, 8).map(p => (
            <button key={p.product_id} className="exception-row" onClick={() => onOpenProduct(toDraft(p))}>
              <div className="product-code">{p.internal_code}</div>
              <div className="exception-main"><strong>{p.description}</strong><span>{money(p.catalog_price)} → {money(p.shelf_price)}</span></div>
              <div className={(p.price_diff ?? 0) > 0 ? 'delta up' : 'delta down'}>{signedMoney(p.price_diff)}</div>
            </button>
          ))}
          {!differences.length && <Empty text="Δεν υπάρχουν αποκλίσεις." />}
        </div>
      </section>
      <section className="panel data-health">
        <div className="panel-heading"><div><span className="eyebrow">DATA HEALTH</span><h3>Ποιότητα βάσης</h3></div></div>
        <div className="health-grid">
          <Health label="Τιμές ραφιού" value={checked.length} total={products.length} />
          <Health label="Barcode" value={products.filter(x => x.barcode).length} total={products.length} />
          <Health label="Χαρτογράφηση θέσης" value={located.length} total={products.length} />
        </div>
      </section>
    </div>
  )
}

function Metric({ label, value, note, danger = false }: { label: string; value: string; note: string; danger?: boolean }) {
  return <div className={danger ? 'metric danger' : 'metric'}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
}

function Health({ label, value, total }: { label: string; value: number; total: number }) {
  const pc = total ? Math.round((value / total) * 100) : 0
  return <div className="health-item"><div><span>{label}</span><strong>{value}/{total}</strong></div><div className="bar"><span style={{ width: `${pc}%` }} /></div><small>{pc}%</small></div>
}

function Products({ products, onEdit }: { products: ProductOverview[]; onEdit: (x: EditDraft) => void }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'different' | 'unchecked' | 'located'>('all')
  const filtered = useMemo(() => {
    const q = normalize(query.trim())
    return products.filter(p => {
      const hit = !q || normalize(`${p.internal_code} ${p.description} ${p.barcode ?? ''}`).includes(q)
      const statusHit = status === 'all' || (status === 'different' && p.price_status === 'different') || (status === 'unchecked' && p.shelf_price == null) || (status === 'located' && !!p.location_code)
      return hit && statusHit
    })
  }, [products, query, status])
  return (
    <section className="panel full-panel">
      <div className="toolbar">
        <div className="search-box"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Κωδικός, barcode ή περιγραφή…" /></div>
        <div className="segmented">
          {(['all','different','unchecked','located'] as const).map(x => <button key={x} className={status === x ? 'active' : ''} onClick={() => setStatus(x)}>{x === 'all' ? 'Όλα' : x === 'different' ? 'Διαφορές' : x === 'unchecked' ? 'Χωρίς έλεγχο' : 'Με θέση'}</button>)}
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Κωδικός</th><th>Περιγραφή</th><th>Θέση</th><th>Κατάλογος</th><th>Ράφι</th><th>∆</th><th /></tr></thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.product_id}>
                <td><code>{p.internal_code}</code>{p.barcode && <small className="subcode">{p.barcode}</small>}</td>
                <td><strong>{p.description}</strong><small>{p.unit ?? '—'}</small></td>
                <td>{p.location_code ? <span className="location-chip">{p.location_code} · {p.row_label ?? '—'} / {p.number_label ?? '—'}</span> : <span className="muted">—</span>}</td>
                <td>{money(p.catalog_price)}</td>
                <td>{money(p.shelf_price)}</td>
                <td>{p.price_diff == null ? '—' : <span className={p.price_diff === 0 ? 'delta neutral' : p.price_diff > 0 ? 'delta up' : 'delta down'}>{signedMoney(p.price_diff)}</span>}</td>
                <td><button className="row-action" onClick={() => onEdit(toDraft(p))}>Επεξεργασία</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <Empty text="Δεν βρέθηκαν προϊόντα με αυτά τα φίλτρα." />}
      </div>
    </section>
  )
}

function PriceAudit({ products }: { products: ProductOverview[] }) {
  const differences = products.filter(p => p.price_status === 'different').sort((a,b) => Math.abs(b.price_diff ?? 0) - Math.abs(a.price_diff ?? 0))
  return (
    <div className="stack-xl">
      <div className="audit-summary">
        <div><span>Αποκλίσεις</span><strong>{differences.length}</strong></div>
        <div><span>Ακριβότερα</span><strong>{differences.filter(x => (x.price_diff ?? 0) > 0).length}</strong></div>
        <div><span>Φθηνότερα</span><strong>{differences.filter(x => (x.price_diff ?? 0) < 0).length}</strong></div>
        <div><span>Χωρίς έλεγχο</span><strong>{products.filter(x => x.shelf_price == null).length}</strong></div>
      </div>
      <section className="panel full-panel">
        <div className="panel-heading"><div><span className="eyebrow">LATEST OBSERVATION</span><h3>Επιβεβαιωμένες διαφορές</h3></div></div>
        <div className="table-wrap">
          <table className="data-table audit-table">
            <thead><tr><th>Κωδικός</th><th>Προϊόν</th><th>Κατάλογος</th><th>Ράφι</th><th>Διαφορά</th><th>Πηγή</th></tr></thead>
            <tbody>{differences.map(p => <tr key={p.product_id}><td><code>{p.internal_code}</code></td><td><strong>{p.description}</strong></td><td>{money(p.catalog_price)}</td><td>{money(p.shelf_price)}</td><td><span className={p.price_diff! > 0 ? 'delta up' : 'delta down'}>{signedMoney(p.price_diff)}</span></td><td><small>{p.source_ref ?? '—'}</small></td></tr>)}</tbody>
          </table>
        </div>
      </section>
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
        <div className="manual-code"><input value={code} onChange={e => resolve(e.target.value)} placeholder="ή γράψε κωδικό / EAN" /></div>
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
      if (prices.length) setPrice(prices[prices.length - 1])
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Αποτυχία OCR.')
    } finally { setWorking(false) }
  }

  async function save() {
    if (!product) return onError('Επίλεξε έγκυρο κωδικό προϊόντος.')
    const value = Number(price.replace(',', '.'))
    if (!Number.isFinite(value)) return onError('Η τιμή δεν είναι έγκυρη.')
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
      {!!rows.length && <div className="ocr-lines"><div className="line-header"><strong>{rows.length} κωδικοί εντοπίστηκαν</strong><span>{rows.filter(x => x.known).length} υπάρχουν στη βάση</span></div>{rows.slice(0, 30).map((r,i) => <div className="ocr-line" key={`${r.code}-${i}`}><code>{r.code}</code><span>{r.text}</span><b className={r.known ? 'known' : 'unknown'}>{r.known ? 'MATCH' : 'NEW'}</b></div>)}</div>}
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

function ProductEditor({ draft, setDraft, locations, onClose, onSave }: { draft: EditDraft; setDraft: (d: EditDraft) => void; locations: Location[]; onClose: () => void; onSave: (d: EditDraft) => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        <div className="drawer-head"><div><span className="eyebrow">PRODUCT {draft.product.internal_code}</span><h2>Επεξεργασία</h2></div><button className="icon-button" onClick={onClose}>×</button></div>
        <div className="form-stack">
          <label>Περιγραφή<textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
          <div className="form-grid"><label>Barcode<input value={draft.barcode} onChange={e => setDraft({ ...draft, barcode: e.target.value })} /></label><label>Τιμή καταλόγου<input inputMode="decimal" value={draft.catalogPrice} onChange={e => setDraft({ ...draft, catalogPrice: e.target.value })} /></label></div>
          <div className="form-grid three"><label>Θέση<select value={draft.locationCode} onChange={e => setDraft({ ...draft, locationCode: e.target.value })}><option value="">Χωρίς θέση</option>{locations.map(x => <option key={x.id} value={x.code}>{x.code} — {x.name}</option>)}</select></label><label>Σειρά<input value={draft.rowLabel} onChange={e => setDraft({ ...draft, rowLabel: e.target.value })} /></label><label>Αριθμός<input value={draft.numberLabel} onChange={e => setDraft({ ...draft, numberLabel: e.target.value })} /></label></div>
          <div className="read-only-card"><span>Τελευταία τιμή ραφιού</span><strong>{money(draft.product.shelf_price)}</strong><small>{draft.product.source_ref ?? 'Χωρίς φωτογραφικό έλεγχο'}</small></div>
          <button className="primary-action" onClick={() => onSave(draft)}>Αποθήκευση αλλαγών</button>
        </div>
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) { return <div className="empty-state">{text}</div> }
function signedMoney(value: number | null) { if (value == null) return '—'; return `${value > 0 ? '+' : ''}${money(value)}` }
function toDraft(p: ProductOverview): EditDraft { return { product: p, description: p.description, barcode: p.barcode ?? '', catalogPrice: p.catalog_price?.toString() ?? '', locationCode: p.location_code ?? '', rowLabel: p.row_label ?? '', numberLabel: p.number_label ?? '' } }

export default App
