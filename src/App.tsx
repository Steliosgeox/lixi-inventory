import { FormEvent, useEffect, useRef, useState, lazy, Suspense } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from '@phosphor-icons/react'
import Workspace, { ProductHistory } from './ui/Workspace'
const CaptureCenter = lazy(() => import('./capture/CaptureCenter'))
import { loadSnapshot, saveSnapshot, purgeSnapshots, flushDrafts, flushSmartDrafts } from './capture/offline'
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
      if (!navigator.onLine) {
        const cached = await loadSnapshot(activeSession.user.id)
        if (cached && version === loadVersion.current) { setMembership(cached.member); setProducts(cached.products); setLocations(cached.locations); setLastSynced(new Date(cached.saved)); return }
      }
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
      await saveSnapshot(activeSession.user.id, member as Membership, productRows, (loc.data ?? []) as Location[]).catch(() => {})
    } catch (e) {
      if (version === loadVersion.current) setToast({ kind: 'error', text: e instanceof Error ? e.message : 'Δεν ήταν δυνατή η λήψη δεδομένων. Δοκίμασε ξανά.' })
    } finally {
      if (version === loadVersion.current) { setLoadingData(false); setWorkspaceReady(true) }
    }
  }

  useEffect(() => {
    if (!session || !membership) return
    let active = true
    const sync = async () => {
      try { const [prices,smart] = await Promise.all([flushDrafts(session.user.id, membership.store_id),flushSmartDrafts(session.user.id, membership.store_id)]); if (active && (prices || smart)) await loadWorkspace(session) } catch { /* pending records remain durable and visible in Capture */ }
    }
    const wake = () => { if (!document.hidden) void sync() }
    const timer = setInterval(() => { void sync() }, 30000)
    window.addEventListener('online', wake); document.addEventListener('visibilitychange', wake)
    void sync()
    return () => { active = false; clearInterval(timer); window.removeEventListener('online', wake); document.removeEventListener('visibilitychange', wake) }
  }, [session?.user.id, membership?.store_id])

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
      scan={membership.role === 'viewer' ? <div className="wk-empty">Ο λογαριασμός έχει πρόσβαση μόνο για ανάγνωση.</div> : <Suspense fallback={<p role="status">Φόρτωση κέντρου σάρωσης…</p>}><CaptureCenter owner={session.user.id} products={products} membership={membership} onSaved={async message => { setToast({ kind: 'ok', text: message }); await loadWorkspace() }} onError={text => setToast({ kind: 'error', text })} /></Suspense>}
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
        <div className="wk-drawer-scroll"><fieldset disabled={saving || readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
          <label>Περιγραφή<textarea required value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
          <div className="form-grid"><label>Barcode<input value={draft.barcode} onChange={e => setDraft({ ...draft, barcode: e.target.value })} /></label><label>Τιμή καταλόγου (€)<input inputMode="decimal" value={draft.catalogPrice} onChange={e => setDraft({ ...draft, catalogPrice: e.target.value })} /></label></div>
          <div className="form-grid three"><label>Θέση<select value={draft.locationCode} onChange={e => setDraft({ ...draft, locationCode: e.target.value })}><option value="">Χωρίς θέση</option>{locations.map(x => <option key={x.id} value={x.code}>{x.name}</option>)}</select></label><label>Σειρά<input value={draft.rowLabel} onChange={e => setDraft({ ...draft, rowLabel: e.target.value })} /></label><label>Αριθμός<input value={draft.numberLabel} onChange={e => setDraft({ ...draft, numberLabel: e.target.value })} /></label></div>
        </fieldset>
        <div className="read-only-card"><span>Τελευταία τιμή ραφιού · {draft.product.unit || '—'}</span><strong>{money(draft.product.shelf_price)}</strong><small>{draft.product.source_ref || 'Χωρίς καταγραφή ραφιού'}</small></div>
        <div className={"read-only-card expiry "+(draft.product.expiry_status ?? 'untracked')}><span>Κοντινότερη λήξη</span><strong>{draft.product.nearest_expiry ? new Intl.DateTimeFormat('el-GR',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'}).format(new Date(draft.product.nearest_expiry+'T00:00:00Z')) : '—'}</strong><small>{draft.product.days_until_expiry == null ? 'Δεν υπάρχει καταγεγραμμένη παρτίδα' : draft.product.days_until_expiry < 0 ? 'Έχει λήξει' : draft.product.days_until_expiry+' ημέρες · '+(draft.product.expiry_batch_count ?? 0)+' παρτίδες'}</small></div>
        {error && <p role="alert" className="wk-form-error">{error}</p>}
        <ProductHistory product={draft.product} /></div>
        <div className="wk-drawer-actions">{!readOnly && <button type="submit" className="wk-button primary" disabled={saving}>{saving ? 'Αποθήκευση…' : 'Αποθήκευση αλλαγών'}</button>}<button type="button" className="wk-button" disabled={saving} onClick={onClose}>Κλείσιμο</button></div>
      </form>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
}

function toDraft(p: ProductOverview): EditDraft { return { product: p, description: p.description, barcode: p.barcode ?? '', catalogPrice: p.catalog_price?.toString() ?? '', locationCode: p.location_code ?? '', rowLabel: p.row_label ?? '', numberLabel: p.number_label ?? '' } }

export default App
