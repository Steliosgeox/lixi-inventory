import { useEffect, useMemo, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { SquaresFour, Package, Barcode, MapPin, SlidersHorizontal, MagnifyingGlass, ArrowUpRight, ArrowRight, ArrowClockwise, CaretRight, CaretLeft, CaretDown, DownloadSimple, Printer, Check, X, Plus, Clock, Calendar, List, ListChecks, WarningCircle, Sun, Moon, Command, Scan, FileText, Tray, ChartBar, SignOut, ArrowUp, ArrowDown, CircleNotch } from '@phosphor-icons/react'
import { useLegacyTable, getCoreRowModel, getSortedRowModel, getPaginationRowModel, type LegacyColumnDef } from '@tanstack/react-table/legacy'
import { flexRender, type SortingState, type RowSelectionState } from '@tanstack/react-table'
import type { ProductOverview, Location, Membership, ExpiryBatchOverview } from '../lib/types'
import { money, signed, normalize, searchProducts, matches, labels, exportProducts, dateLabel, type Filter } from './data'
import { supabase } from '../lib/supabase'
import PullToRefresh from './PullToRefresh'

export type Page = 'dashboard' | 'products' | 'audit' | 'expiry' | 'locations' | 'activity' | 'scan' | 'settings'
const navigation = [
  { id: 'dashboard', title: 'Επισκόπηση', icon: SquaresFour },
  { id: 'products', title: 'Κατάλογος', icon: Package },
  { id: 'audit', title: 'Έλεγχος τιμών', icon: ChartBar },
  { id: 'expiry', title: 'Λήξεις', icon: Calendar },
  { id: 'locations', title: 'Θέσεις & ράφια', icon: MapPin },
  { id: 'activity', title: 'Καταγραφές', icon: Clock },
  { id: 'scan', title: 'Κέντρο σάρωσης', icon: Scan },
  { id: 'settings', title: 'Ρυθμίσεις', icon: SlidersHorizontal },
] as const

type Props = { products: ProductOverview[]; locations: Location[]; membership: Membership; email: string; loading: boolean; lastSynced: Date | null; onRefresh: () => void | Promise<void>; onEdit: (p: ProductOverview) => void; scan: ReactNode; settings: ReactNode; toast: ReactNode }
export default function Workspace({ products, locations, membership, email, loading, lastSynced, onRefresh, onEdit, scan, settings, toast }: Props) {
  const [page, setPage] = useState<Page>('dashboard')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [locationFilter, setLocationFilter] = useState('all')
  const [commandOpen, setCommandOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('leaksy-theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' } })
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#141b19' : '#f5f6f2')
    try { localStorage.setItem('leaksy-theme', theme) } catch { /* private browsing may block storage */ }
  }, [theme])
  useEffect(() => {
    const on = () => setOnline(navigator.onLine)
    const keyboard = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCommandOpen(v => !v) } }
    window.addEventListener('online', on); window.addEventListener('offline', on); window.addEventListener('keydown', keyboard)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); window.removeEventListener('keydown', keyboard) }
  }, [])
  const checked = products.filter(p => p.shelf_price != null).length
  const differences = products.filter(p => p.price_status === 'different')
  const expiryAttention = products.filter(p => ['expired','critical','warning'].includes(p.expiry_status ?? 'untracked'))
  const current = navigation.find(n => n.id === page)!
  const mobileNavigation = (['dashboard','products','scan','expiry','settings'] as Page[]).map(id => navigation.find(n => n.id === id)!)
  const jump = (p: Page, f: Filter = 'all', loc = 'all') => { setPage(p); setFilter(f); setLocationFilter(loc); setQuery(''); setMenuOpen(false); window.scrollTo({ top: 0, behavior: 'instant' }) }
  const find = (p: ProductOverview) => { setCommandOpen(false); onEdit(p) }
  const now = new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Athens' }).format(new Date())
  return <div className="wk-shell">
    <PullToRefresh refresh={onRefresh} refreshing={loading} />
    <a className="wk-skip" href="#workspace-content">Μετάβαση στο περιεχόμενο</a>
    <aside className="wk-sidebar">
      <a className="wk-brand" href="#" onClick={e => { e.preventDefault(); jump('dashboard') }} aria-label="Leaksy αρχική"><span className="wk-logo"><Package size={25} weight="duotone" /></span><span>leaksy<span className="wk-brand-sub">INVENTORY WORKSPACE</span></span></a>
      <div className="wk-store"><span className="wk-store-icon"><SquaresFour weight="duotone" size={20} /></span><span><b>Το κατάστημά μου</b><small>Κεντρική απογραφή</small></span><span className="wk-live-dot" /></div>
      <div className="wk-nav-label">Χώρος εργασίας</div>
      <nav aria-label="Κύρια πλοήγηση" className="wk-nav">{navigation.map((n, i) => <button key={n.id} onClick={() => jump(n.id, n.id === 'audit' ? 'different' : 'all')} className={page === n.id ? 'is-active' : ''} aria-current={page === n.id ? 'page' : undefined}><n.icon size={20} weight={page === n.id ? 'duotone' : 'regular'} /><span>{n.title}</span>{n.id === 'audit' && differences.length > 0 && <b className="wk-nav-count">{differences.length}</b>}{n.id === 'expiry' && expiryAttention.length > 0 && <b className="wk-nav-count">{expiryAttention.length}</b>}</button>)}</nav>
      <div className="wk-side-tip"><Barcode size={24} /><b>Λιγότερη πληκτρολόγηση.</b><p>Βρες το είδος με την κάμερα και κατέγραψε την τιμή του.</p><button onClick={() => jump('scan')}>Άνοιγμα σαρωτή <ArrowUpRight size={16} /></button></div>
      <div className="wk-account"><span className="wk-avatar">{(email || 'L').slice(0,2).toUpperCase()}</span><div><b>{email?.split('@')[0] || 'Λογαριασμός'}</b><small>{membership.role === 'owner' ? 'Ιδιοκτήτης' : membership.role}</small></div><button className="wk-icon" aria-label="Ρυθμίσεις λογαριασμού" onClick={() => jump('settings')}><SlidersHorizontal size={18} /></button></div>
    </aside>
    <div className="wk-main" data-page={page}>
      <header className="wk-top"><div className="wk-top-leading"><button className="wk-icon wk-menu-trigger" aria-label="Όλες οι ενότητες" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><List size={21} /></button><div className="wk-breadcrumb"><span>Χώρος εργασίας</span><CaretRight size={13} /><strong>{current.title}</strong></div></div><div className="wk-top-actions"><button className="wk-command" aria-label="Αναζήτηση προϊόντος" onClick={() => setCommandOpen(true)}><MagnifyingGlass size={17} /><span>Αναζήτηση προϊόντος</span><kbd>⌘ K</kbd></button><button className="wk-icon" aria-label={theme === 'light' ? 'Σκούρο θέμα' : 'Φωτεινό θέμα'} onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</button><button className="wk-icon" aria-label="Ανανέωση δεδομένων" disabled={loading} onClick={onRefresh}><ArrowClockwise size={19} className={loading ? 'wk-spin' : ''} /></button></div></header>
      <main id="workspace-content" className="wk-content" tabIndex={-1}>
        <div className="wk-page-title"><div><div className="wk-overline">{page === 'dashboard' ? now : 'LEAKSY / ' + current.title}</div><h1>{page === 'dashboard' ? 'Έλεγχος καταλόγου' : current.title}</h1><p>{page === 'dashboard' ? `${differences.length} διαφορές τιμών · ${products.length - checked} προϊόντα χωρίς τιμή ραφιού.` : page === 'products' ? 'Κωδικοί, τιμές και θέσεις. Όλα σε ένα σημείο.' : page === 'audit' ? 'Σύγκρινε τον κατάλογο με τις καταγεγραμμένες τιμές ραφιού.' : page === 'locations' ? 'Πραγματικές θέσεις από τον κατάλογο. Όχι εκτιμήσεις.' : page === 'activity' ? 'Οι τελευταίες διαθέσιμες παρατηρήσεις ανά προϊόν.' : page === 'expiry' ? 'Παρτίδες που έχουν λήξει ή πλησιάζουν τη λήξη, με προτεραιότητα και monitoring.' : page === 'scan' ? 'Smart Scan: προϊόν, τιμή, λήξη και lot στην ίδια συνεχή διαδικασία.' : 'Η πρόσβαση και οι προτιμήσεις του χώρου σου.'}</p></div><div className="wk-title-actions">{page !== 'scan' && <button className="wk-button primary" onClick={() => jump('scan')}><Plus size={17} />Νέα καταγραφή</button>}</div></div>
        {!online && <div role="status" className="wk-notice"><WarningCircle size={18} />Εκτός σύνδεσης. Η προβολή μπορεί να είναι παλιά· οι αλλαγές χρειάζονται σύνδεση.</div>}
        {loading && !products.length ? <div className="wk-skeleton" role="status" aria-label="Φόρτωση καταλόγου"><i /><i /><i /><i /></div> : <>
          {page === 'dashboard' && <Overview products={products} onEdit={onEdit} jump={jump} />}
          {(page === 'products' || page === 'audit') && <Catalogue key={page} products={products} filter={filter} setFilter={setFilter} query={query} setQuery={setQuery} locationFilter={locationFilter} setLocationFilter={setLocationFilter} onEdit={onEdit} />}
          {page === 'locations' && <div className="wk-locations"><section className="wk-card wk-unmapped"><span className="wk-square amber"><MapPin size={26} /></span><h2>{products.filter(p => !p.location_code).length} προϊόντα χωρίς θέση</h2><p>Άνοιξε ένα προϊόν για να ορίσεις θέση, σειρά και αριθμό. Οι θέσεις δεν συμπληρώνονται αυτόματα από ονόματα προϊόντων.</p><button className="wk-button" onClick={() => jump('products', 'unlocated')}>Χαρτογράφηση προϊόντων <ArrowRight size={17} /></button></section>{locations.map(l => <button key={l.id} className="wk-card wk-location-card" onClick={() => jump('products', 'all', l.code)}><div className="wk-location-label">{l.code}</div><h2>{l.name}</h2><span>{products.filter(p => p.location_code === l.code).length} καταχωρισμένα προϊόντα</span><span className="wk-location-open">Προβολή θέσης <ArrowUpRight size={19} /></span></button>)}</div>}
          {page === 'activity' && <Activity products={products} onEdit={onEdit} full />}
          {page === 'expiry' && <ExpiryPage products={products} membership={membership} onEdit={onEdit} jump={jump} />}
          {page === 'scan' && <div className="wk-legacy">{scan}</div>}
          {page === 'settings' && <div className="wk-legacy"><section className="wk-card wk-theme-setting"><div><h2>Εμφάνιση</h2><p>Η επιλογή θέματος αποθηκεύεται σε αυτή τη συσκευή.</p></div><button className="wk-button" onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}{theme === 'light' ? 'Σκούρο θέμα' : 'Φωτεινό θέμα'}</button></section>{settings}</div>}
        </>}
        <footer className="wk-footer"><span><span className={`wk-live-dot ${!online || !lastSynced ? 'offline' : ''}`} />{lastSynced ? `Τελευταία λήψη ${lastSynced.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })}` : 'Αναμονή δεδομένων'}</span><span>{products.length} προϊόντα · {checked} με τιμή ραφιού <span className="wk-footer-version">WORKSPACE 0.3</span></span></footer>
      </main>
    </div>
    <nav className="wk-mobile-nav" aria-label="Πλοήγηση κινητού">{mobileNavigation.map(n => <button key={n.id} data-page={n.id} aria-current={page === n.id ? 'page' : undefined} className={page === n.id ? 'is-active' : ''} onClick={() => jump(n.id, n.id === 'audit' ? 'different' : 'all')}><n.icon size={n.id === 'scan' ? 25 : 21} weight={page === n.id ? 'fill' : 'regular'} /><span>{n.id === 'dashboard' ? 'Αρχική' : n.id === 'scan' ? 'Σάρωση' : n.id === 'expiry' ? 'Λήξεις' : n.title}</span></button>)}</nav>
    <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}><Dialog.Portal>
      <Dialog.Overlay className="wk-overlay" />
      <Dialog.Content className="wk-mobile-menu">
        <div className="wk-menu-head"><div><Dialog.Title>Χώρος εργασίας</Dialog.Title><Dialog.Description>Όλες οι λειτουργίες του καταστήματος</Dialog.Description></div><Dialog.Close className="wk-icon" aria-label="Κλείσιμο μενού"><X size={20} /></Dialog.Close></div>
        <nav aria-label="Όλες οι ενότητες" className="wk-menu-links">{navigation.map(n => <button key={n.id} aria-current={page === n.id ? 'page' : undefined} onClick={() => jump(n.id, n.id === 'audit' ? 'different' : 'all')}><n.icon size={23} /><span>{n.title}</span><CaretRight size={17} /></button>)}</nav>
        <p className="wk-menu-account">{email || 'Συνδεδεμένος λογαριασμός'}</p>
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>
    <CommandSearch open={commandOpen} setOpen={setCommandOpen} products={products} onPick={find} />
    {toast}
  </div>
}

function Overview({ products, onEdit, jump }: { products: ProductOverview[]; onEdit: (p: ProductOverview) => void; jump: (p: Page, f?: Filter) => void }) {
  const total = products.length, checked = products.filter(p => p.shelf_price != null).length
  const changed = products.filter(p => p.price_status === 'different').sort((a,b) => Math.abs(b.price_diff ?? 0) - Math.abs(a.price_diff ?? 0))
  const same = products.filter(p => p.price_status === 'same').length
  const pending = total - checked, located = products.filter(p => p.location_code).length, barcoded = products.filter(p => p.barcode).length
  const percentage = total ? Math.round(checked / total * 100) : 0
  const expiryUrgent=products.filter(p=>['expired','critical','warning'].includes(p.expiry_status??'untracked'))
  const expired=products.filter(p=>p.expiry_status==='expired').length
  const untrackedExpiry=products.filter(p=>(p.expiry_status??'untracked')==='untracked').length
  const metrics = [
    { label: 'Προϊόντα καταλόγου', value: total, note: 'Μοναδικοί κωδικοί είδους', icon: Package, page:'products' as Page, f: 'all' as Filter },
    { label: 'Τιμές ραφιού', value: checked, note: `${percentage}% κάλυψη καταλόγου`, icon: ListChecks, page:'products' as Page, f: 'checked' as Filter },
    { label: 'Διαφορές τιμών', value: changed.length, note: `${changed.filter(p => (p.price_diff ?? 0) > 0).length} υψηλότερες · ${changed.filter(p => (p.price_diff ?? 0) < 0).length} χαμηλότερες`, icon: ChartBar, page:'audit' as Page, f: 'different' as Filter },
    { label: 'Λήξεις ≤30 ημέρες', value: expiryUrgent.length, note: `${expired} ληγμένα · ${untrackedExpiry} χωρίς παρακολούθηση`, icon: Calendar, page:'expiry' as Page, f: 'all' as Filter },
  ]
  return <div className="wk-overview">
    <div className="wk-metrics">{metrics.map((m,i) => <button key={m.label} className="wk-metric" onClick={() => jump(m.page, m.f)}><div><span>{m.label}</span><m.icon size={19} /></div><strong className={(i === 2 || i===3) && m.value > 0 ? 'wk-text-amber' : ''}>{m.value}<ArrowUpRight size={18} /></strong><small>{m.note}</small>{i === 1 && <div className="wk-mini-track"><i style={{ width: `${percentage}%` }} /></div>}</button>)}</div>
    <div className="wk-dashboard-grid">
      <section className="wk-card wk-priority"><div className="wk-card-head"><div><span className="wk-section-kicker">ΠΡΟΤΕΡΑΙΟΤΗΤΑ</span><h2>Τι χρειάζεται προσοχή <span className="wk-count">{changed.length}</span></h2><p>Οι μεγαλύτερες αποκλίσεις από τον κατάλογο.</p></div><button className="wk-text-button" onClick={() => jump('audit', 'different')}>Όλες οι διαφορές <ArrowUpRight size={16} /></button></div><div className="wk-exception-head"><span>Προϊόν</span><span>Κατάλογος</span><span>Ράφι</span><span>Διαφορά</span></div><div>{changed.slice(0,6).map((p,i) => <button key={p.product_id} className="wk-exception" onClick={() => onEdit(p)}><span className="wk-product-cell"><span className={`wk-product-symbol s${i % 3}`}><Package size={21} weight="duotone" /></span><span><strong>{p.description}</strong><small><code>{p.internal_code}</code> · {p.unit || 'Μονάδα μη ορισμένη'}</small><span className="wk-mobile-price-pair"><span>Κατάλογος {money(p.catalog_price)}</span><span>Ράφι <b>{money(p.shelf_price)}</b></span></span></span></span><span className="wk-old-price">{money(p.catalog_price)}</span><span className="wk-shelf-price">{money(p.shelf_price)}</span><Delta product={p} /></button>)}{!changed.length && <div className="wk-empty"><Check size={28} /><b>Δεν υπάρχουν καταγεγραμμένες διαφορές.</b><p>{pending ? `${pending} προϊόντα δεν έχουν ακόμη τιμή ραφιού.` : 'Όλες οι διαθέσιμες τιμές συμφωνούν.'}</p></div>}</div><div className="wk-card-foot"><WarningCircle size={15} /><span>Η διαφορά αφορά τη δηλωμένη μονάδα, όχι αξία συνολικού αποθέματος.</span></div></section>
      <section className="wk-card wk-coverage"><div className="wk-card-head"><div><span className="wk-section-kicker">ΕΙΚΟΝΑ ΕΛΕΓΧΟΥ</span><h2>Κάλυψη καταλόγου</h2></div><ListChecks size={20} /></div><div className="wk-ring"><svg viewBox="0 0 180 180" aria-hidden="true"><circle className="ring-track" cx="90" cy="90" r="72" /><circle className="ring-value" cx="90" cy="90" r="72" pathLength="100" strokeDasharray={`${percentage} 100`} /></svg><div><strong>{percentage}<small>%</small></strong><span>με τιμή ραφιού</span></div></div><div className="wk-legend"><span><i className="green" />Ίδια τιμή <b>{same}</b></span><span><i className="amber" />Με διαφορά <b>{changed.length}</b></span><span><i />Χωρίς τιμή / προς έλεγχο <b>{total - same - changed.length}</b></span></div><button className="wk-button" onClick={() => jump('products', 'unchecked')}>Συνέχεια ελέγχου <ArrowRight size={16} /></button></section>
      <section className="wk-card wk-next"><div className="wk-card-head"><div><span className="wk-section-kicker">ΟΡΓΑΝΩΣΗ</span><h2>Επόμενες κινήσεις</h2></div><ArrowUpRight size={20} /></div>{[{ icon: Barcode, label: 'Συμπλήρωση barcode', sub: 'Για αναζήτηση με την κάμερα', count: total-barcoded, f: 'nobarcode' as Filter }, { icon: MapPin, label: 'Χαρτογράφηση ραφιού', sub: 'Θέση, σειρά και αριθμός', count: total-located, f: 'unlocated' as Filter }, { icon: FileText, label: 'Έλεγχος μονάδας / στοιχείων', sub: 'Κιλό, κιβώτιο ή μηδενική τιμή', count: products.filter(p => matches(p, 'review')).length, f: 'review' as Filter }].map(t => <button key={t.label} className="wk-task" onClick={() => jump('products', t.f)}><span className="wk-square"><t.icon size={21} /></span><span><b>{t.label}</b><small>{t.sub}</small></span><strong>{t.count}</strong><CaretRight size={16} /></button>)}</section>
      <Activity products={products} onEdit={onEdit} />
    </div>
    <section className="wk-bottom-banner"><span className="wk-banner-icon"><Scan size={29} weight="duotone" /></span><div><h2>Από το ράφι, κατευθείαν στον κατάλογο.</h2><p>Στόχευσε μία φορά. Barcode/GS1 και PP-OCRv5 συνεργάζονται για προϊόν, τιμή, λήξη και lot.</p></div><button className="wk-button primary" onClick={() => jump('scan')}>Smart Scan <ArrowRight size={17} /></button></section>
  </div>
}

function ExpiryPage({products,membership,onEdit,jump}:{products:ProductOverview[];membership:Membership;onEdit:(p:ProductOverview)=>void;jump:(p:Page,f?:Filter)=>void}){
  type EF='all'|'expired'|'critical'|'warning'|'monitor'|'ok'
  const [filter,setFilter]=useState<EF>('all')
  const [batches,setBatches]=useState<ExpiryBatchOverview[]>([])
  const [loading,setLoading]=useState(true),[error,setError]=useState('')
  useEffect(()=>{
    let live=true;setLoading(true);setError('')
    supabase.from('expiry_batches_overview').select('*').eq('store_id',membership.store_id).order('expiry_date',{ascending:true}).limit(1000).then(({data,error})=>{
      if(!live)return
      setBatches((data??[]) as ExpiryBatchOverview[]);setError(error?'Δεν ήταν δυνατή η λήψη παρτίδων λήξης.':'');setLoading(false)
    })
    return()=>{live=false}
  },[membership.store_id])
  const visible=filter==='all'?batches:batches.filter(b=>b.expiry_status===filter)
  const untracked=products.filter(p=>(p.expiry_status??'untracked')==='untracked').length
  const count=(s:EF)=>s==='all'?batches.length:batches.filter(b=>b.expiry_status===s).length
  const label=(s:string)=>s==='expired'?'Ληγμένο':s==='critical'?'≤ 7 ημέρες':s==='warning'?'≤ 30 ημέρες':s==='monitor'?'≤ 90 ημέρες':'ΟΚ'
  const productById=new Map(products.map(p=>[p.product_id,p]))
  return <div className="wk-expiry-page">
    <div className="wk-expiry-kpis">
      <button className="wk-expiry-kpi expired" onClick={()=>setFilter('expired')}><small>ΛΗΓΜΕΝΑ</small><strong>{count('expired')}</strong><span>άμεση ενέργεια</span></button>
      <button className="wk-expiry-kpi critical" onClick={()=>setFilter('critical')}><small>ΕΠΟΜΕΝΕΣ 7 ΗΜ.</small><strong>{count('critical')}</strong><span>υψηλή προτεραιότητα</span></button>
      <button className="wk-expiry-kpi warning" onClick={()=>setFilter('warning')}><small>ΕΠΟΜΕΝΕΣ 30 ΗΜ.</small><strong>{count('warning')}</strong><span>προγραμματισμός</span></button>
      <button className="wk-expiry-kpi untracked" onClick={()=>jump('scan')}><small>ΧΩΡΙΣ ΛΗΞΗ</small><strong>{untracked}</strong><span>χρειάζονται Smart Scan</span></button>
    </div>
    <section className="wk-card wk-expiry-list">
      <div className="wk-card-head"><div><span className="wk-section-kicker">EXPIRY MONITOR</span><h2>Παρτίδες και λήξεις</h2><p>Κάθε διαφορετική ημερομηνία/lot παραμένει ξεχωριστή παρτίδα.</p></div><button className="wk-button primary" onClick={()=>jump('scan')}><Scan size={17}/>Smart Scan</button></div>
      <div className="wk-expiry-tabs">{(['all','expired','critical','warning','monitor','ok'] as EF[]).map(s=><button key={s} className={filter===s?'is-active':''} onClick={()=>setFilter(s)}>{s==='all'?'Όλες':label(s)} <b>{count(s)}</b></button>)}</div>
      {loading?<div className="wk-empty"><CircleNotch className="wk-spin" size={24}/>Φόρτωση λήξεων…</div>:error?<div className="wk-empty" role="alert"><WarningCircle size={25}/>{error}</div>:visible.length?<div className="wk-expiry-rows">{visible.map(b=>{
        const p=productById.get(b.product_id)
        return <button key={b.batch_id} className={'wk-expiry-row '+b.expiry_status} onClick={()=>p&&onEdit(p)}>
          <span className="wk-expiry-date"><b>{new Intl.DateTimeFormat('el-GR',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'}).format(new Date(b.expiry_date+'T00:00:00Z'))}</b><small>{b.days_until_expiry<0?Math.abs(b.days_until_expiry)+' ημέρες πριν':b.days_until_expiry===0?'Σήμερα':b.days_until_expiry+' ημέρες'}</small></span>
          <span className="wk-product-cell"><span className="wk-product-symbol"><Package size={19}/></span><span><strong>{b.description}</strong><small><code>{b.internal_code}</code>{b.lot_number?' · LOT '+b.lot_number:''}</small></span></span>
          <span className={'wk-expiry-pill '+b.expiry_status}>{label(b.expiry_status)}</span>
          <span className="wk-expiry-meta">{b.quantity!=null?<b>{b.quantity} {b.unit??''}</b>:<b>—</b>}<small>{b.location_code?'Θέση '+b.location_code:'Χωρίς θέση'} · {b.source_type.toUpperCase()}</small></span>
        </button>
      })}</div>:<div className="wk-empty"><Calendar size={30}/><h2>Δεν υπάρχουν παρτίδες σε αυτή την κατηγορία.</h2><p>Το Smart Scan μπορεί να προσθέσει λήξη και lot χωρίς ξεχωριστή φόρμα.</p><button className="wk-button primary" onClick={()=>jump('scan')}>Άνοιγμα Smart Scan</button></div>}
      <div className="wk-card-foot"><WarningCircle size={15}/>Alerts: ληγμένα, 7, 30 και 90 ημέρες. Το OCR απαιτεί ανθρώπινη επιβεβαίωση πριν αποθηκευτεί.</div>
    </section>
  </div>
}

export function Delta({ product: p }: { product: ProductOverview }) { return <span className={`wk-delta ${p.price_diff == null ? 'none' : p.price_diff > 0 ? 'up' : p.price_diff < 0 ? 'down' : 'equal'}`}>{p.price_diff != null && p.price_diff !== 0 && (p.price_diff > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}{signed(p.price_diff)}</span> }
function Activity({ products, onEdit, full = false }: { products: ProductOverview[]; onEdit: (p: ProductOverview) => void; full?: boolean }) {
  const recent = products.filter(p => p.observed_at).sort((a,b) => (b.observed_at ?? '').localeCompare(a.observed_at ?? '')).slice(0, full ? 40 : 4)
  return <section className="wk-card wk-activity"><div className="wk-card-head"><div><span className="wk-section-kicker">ΙΧΝΗΛΑΣΙΜΟΤΗΤΑ</span><h2>Πρόσφατες καταγραφές</h2></div><Clock size={20} /></div>{recent.length ? recent.map(p => <button className="wk-activity-row" key={p.product_id} onClick={() => onEdit(p)}><span className="wk-activity-dot" /><span><b>{p.description}</b><small>{p.source_ref || 'Χειροκίνητη καταγραφή'}</small></span><span><strong>{money(p.shelf_price)}</strong><small>{dateLabel(p.observed_at)}</small></span></button>) : <div className="wk-empty"><Clock size={27} /><p>Δεν έχουν καταχωριστεί παρατηρήσεις.</p></div>}<div className="wk-card-foot">Προβολή τελευταίας παρατήρησης ανά είδος. Το πλήρες ιστορικό ανοίγει μέσα στο προϊόν.</div></section>
}

function Catalogue({ products, filter, setFilter, query, setQuery, locationFilter, setLocationFilter, onEdit }: { products: ProductOverview[]; filter: Filter; setFilter: (f: Filter) => void; query: string; setQuery: (q: string) => void; locationFilter: string; setLocationFilter: (s: string) => void; onEdit: (p: ProductOverview) => void }) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [selection, setSelection] = useState<RowSelectionState>({})
  const filtered = useMemo(() => searchProducts(products.filter(p => matches(p, filter) && (locationFilter === 'all' || p.location_code === locationFilter)), query), [products, filter, query, locationFilter])
  useEffect(() => { setSelection({}) }, [filter, query, locationFilter])
  const columns = useMemo<LegacyColumnDef<ProductOverview>[]>(() => [
    { id: 'select', enableSorting: false, header: ({ table }) => <input aria-label="Επιλογή τρέχουσας σελίδας" type="checkbox" checked={table.getIsAllPageRowsSelected()} onChange={table.getToggleAllPageRowsSelectedHandler()} />, cell: ({ row }) => <label className="wk-checkbox-target"><input aria-label={`Επιλογή ${row.original.internal_code}`} type="checkbox" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} /></label> },
    { accessorKey: 'description', header: 'Προϊόν', cell: ({ row: { original: p } }) => <button className="wk-table-product" onClick={() => onEdit(p)}><span className="wk-product-symbol"><Package size={19} /></span><span><strong>{p.description}</strong><small><code>{p.internal_code}</code> · {p.unit || '—'}</small></span></button> },
    { accessorKey: 'catalog_price', header: 'Κατάλογος', cell: ({ row }) => money(row.original.catalog_price) },
    { accessorKey: 'shelf_price', header: 'Ράφι', cell: ({ row }) => <b>{money(row.original.shelf_price)}</b> },
    { accessorKey: 'price_diff', header: 'Διαφορά', cell: ({ row }) => <Delta product={row.original} /> },
    { accessorKey: 'location_code', header: 'Θέση', cell: ({ row: { original: p } }) => p.location_code ? <span className="wk-location-tag"><MapPin size={13} />{p.location_code} · {p.row_label ?? '—'} / {p.number_label ?? '—'}</span> : <span className="wk-subtle">Μη ορισμένη</span> },
    { id: 'state', header: 'Κατάσταση', enableSorting: false, cell: ({ row: { original: p } }) => <span className={`wk-state ${p.price_status}`}><i />{p.price_status === 'different' ? 'Διαφορά' : p.price_status === 'same' ? 'Συμφωνεί' : p.price_status === 'review' ? 'Προς έλεγχο' : 'Χωρίς έλεγχο'}</span> },
  ], [onEdit])
  const table = useLegacyTable({ data: filtered, columns, defaultColumn: { sortDescFirst: false }, state: { sorting, rowSelection: selection }, onSortingChange: setSorting, onRowSelectionChange: setSelection, getRowId: p => p.product_id, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageSize: 20, pageIndex: 0 } } })
  const selected = table.getSelectedRowModel().rows.map(r => r.original)
  const exportRows = selected.length ? selected : filtered
  const pageCount = Math.max(1, table.getPageCount())
  useEffect(() => { table.setPageIndex(0) }, [filter, query, locationFilter])
  return <section className="wk-card wk-catalogue"><div className="wk-table-tabs">{(['all','different','same','unchecked'] as Filter[]).map(f => <button className={filter === f ? 'is-active' : ''} key={f} onClick={() => setFilter(f)}>{labels[f]} <span>{products.filter(p => matches(p,f)).length}</span></button>)}</div><div className="wk-tools"><label className="wk-search"><MagnifyingGlass size={18} /><input aria-label="Αναζήτηση στον κατάλογο" placeholder="Περιγραφή, κωδικός ή barcode…" value={query} onChange={e => setQuery(e.target.value)} /></label><label className="wk-select"><SlidersHorizontal size={17} /><select aria-label="Φίλτρο καταλόγου" value={filter} onChange={e => setFilter(e.target.value as Filter)}>{Object.entries(labels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>{locationFilter !== 'all' && <button className="wk-filter-tag" onClick={() => setLocationFilter('all')}>Θέση {locationFilter}<X size={14} /></button>}<button className="wk-button" disabled={!exportRows.length} onClick={() => exportProducts(exportRows)}><DownloadSimple size={16} /><span>CSV{selected.length ? ` (${selected.length})` : ''}</span></button><button className="wk-icon" aria-label="Εκτύπωση λίστας" onClick={() => window.print()}><Printer size={18} /></button></div><div className="wk-mobile-table-tools"><label><input type="checkbox" aria-label="Επιλογή σελίδας κινητού" checked={table.getIsAllPageRowsSelected()} onChange={table.getToggleAllPageRowsSelectedHandler()} />Επιλογή σελίδας</label><label className="wk-sort">Ταξινόμηση<select aria-label="Ταξινόμηση προϊόντων" value={sorting.length ? `${sorting[0].id}:${sorting[0].desc ? 'desc' : 'asc'}` : 'default'} onChange={e => { const [id, direction] = e.target.value.split(':'); setSorting(id === 'default' ? [] : [{ id, desc: direction === 'desc' }]) }}><option value="default">Κωδικός είδους</option><option value="description:asc">Περιγραφή Α–Ω</option><option value="catalog_price:asc">Τιμή καταλόγου ↑</option><option value="catalog_price:desc">Τιμή καταλόγου ↓</option><option value="price_diff:desc">Διαφορά ↓</option><option value="price_diff:asc">Διαφορά ↑</option></select></label></div><div className="wk-table-scroll"><table className="wk-table" role="table"><caption className="sr-only">Κατάλογος προϊόντων και σύγκριση τιμών</caption><thead>{table.getHeaderGroups().map(g => <tr key={g.id}>{g.headers.map(h => <th key={h.id} aria-sort={h.column.getIsSorted() === 'asc' ? 'ascending' : h.column.getIsSorted() === 'desc' ? 'descending' : undefined}>{h.column.getCanSort() ? <button onClick={h.column.getToggleSortingHandler()}>{flexRender(h.column.columnDef.header,h.getContext())}{h.column.getIsSorted() ? (h.column.getIsSorted() === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <CaretDown size={11} />}</button> : flexRender(h.column.columnDef.header,h.getContext())}</th>)}</tr>)}</thead><tbody>{table.getRowModel().rows.map(r => <tr key={r.id} className={r.getIsSelected() ? 'is-selected' : ''}>{r.getVisibleCells().map(c => <td key={c.id} data-column={c.column.id} data-label={typeof c.column.columnDef.header === 'string' ? c.column.columnDef.header : ''}>{flexRender(c.column.columnDef.cell,c.getContext())}</td>)}</tr>)}</tbody></table></div>{!filtered.length && <div className="wk-empty"><MagnifyingGlass size={30} /><h2>Δεν βρέθηκαν προϊόντα.</h2><p>Άλλαξε την αναζήτηση ή καθάρισε τα φίλτρα.</p><button className="wk-button" onClick={() => { setFilter('all'); setQuery(''); setLocationFilter('all') }}>Καθαρισμός φίλτρων</button></div>}<div className="wk-pagination"><span>{selected.length ? `${selected.length} επιλεγμένα · ` : ''}{filtered.length} αποτελέσματα</span><label>Ανά σελίδα <select aria-label="Προϊόντα ανά σελίδα" value={table.getState().pagination.pageSize} onChange={e => table.setPageSize(Number(e.target.value))}><option>20</option><option>50</option><option>100</option></select></label><div><button className="wk-icon" aria-label="Προηγούμενη σελίδα" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}><CaretLeft size={16} /></button><span>{Math.min(table.getState().pagination.pageIndex+1,pageCount)} / {pageCount}</span><button className="wk-icon" aria-label="Επόμενη σελίδα" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}><CaretRight size={16} /></button></div></div><div className="wk-card-foot">CSV: εισήγαγε Κωδικό και Barcode ως κείμενο στο Excel για να κρατηθούν τα αρχικά μηδενικά. Η εκτύπωση αφορά την τρέχουσα σελίδα.</div></section>
}

function CommandSearch({ open, setOpen, products, onPick }: { open: boolean; setOpen: (b: boolean) => void; products: ProductOverview[]; onPick: (p: ProductOverview) => void }) {
  const [q, setQ] = useState('')
  useEffect(() => { if (open) setQ('') }, [open])
  const found = searchProducts(products, q).slice(0,9)
  return <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal><Dialog.Overlay className="wk-overlay" /><Dialog.Content className="wk-command-modal"><Dialog.Title className="sr-only">Αναζήτηση προϊόντων</Dialog.Title><Dialog.Description className="sr-only">Αναζήτησε με περιγραφή, εσωτερικό κωδικό ή barcode.</Dialog.Description><div className="wk-command-input"><MagnifyingGlass size={23} /><input autoFocus aria-label="Γρήγορη αναζήτηση" placeholder="Τι ψάχνεις;" value={q} onChange={e => setQ(e.target.value)} /><Dialog.Close className="wk-icon" aria-label="Κλείσιμο αναζήτησης"><X size={18} /></Dialog.Close></div><div className="wk-command-results">{found.map(p => <button key={p.product_id} onClick={() => onPick(p)}><Package size={19} /><span><b>{p.description}</b><small>{p.internal_code} · {money(p.catalog_price)}</small></span><ArrowUpRight size={16} /></button>)}{!found.length && <div className="wk-empty">Δεν υπάρχει αποτέλεσμα.</div>}</div><div className="wk-card-foot"><kbd>Esc</kbd> για κλείσιμο · <kbd>Tab</kbd> για επιλογή</div></Dialog.Content></Dialog.Portal></Dialog.Root>
}

export function ProductHistory({ product }: { product: ProductOverview }) {
  const [state, setState] = useState<{ rows: { id: string; observed_price: number; observed_at: string; source_ref: string | null; verified: boolean }[]; error: string; loading: boolean }>({ rows: [], error: '', loading: true })
  useEffect(() => {
    let live = true
    setState({ rows: [], error: '', loading: true })
    supabase.from('price_observations').select('id,observed_price,observed_at,source_ref,verified').eq('store_id', product.store_id).eq('product_id', product.product_id).order('observed_at', { ascending: false }).limit(20).then(({ data, error }) => { if (live) setState({ rows: data ?? [], error: error ? 'Δεν ήταν δυνατή η λήψη ιστορικού.' : '', loading: false }) })
    return () => { live = false }
  }, [product.product_id, product.store_id])
  return <section className="wk-history"><h3><Clock size={17} />Ιστορικό τιμών ραφιού</h3>{state.loading ? <p>Φόρτωση…</p> : state.error ? <p role="alert">{state.error}</p> : state.rows.length ? state.rows.map(r => <div key={r.id}><span><strong>{money(r.observed_price)}</strong><small>{r.source_ref || 'Χειροκίνητη καταγραφή'}</small></span><span><b>{dateLabel(r.observed_at)}</b><small>{r.verified ? 'Επιβεβαιωμένη' : 'Προς έλεγχο'}</small></span></div>) : <p>Δεν υπάρχει ιστορικό για αυτό το προϊόν.</p>}</section>
}
