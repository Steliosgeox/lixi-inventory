import { useEffect,useRef,useState } from 'react'
import { Camera,CameraSlash,Images,ArrowClockwise,CheckCircle,Clock,WarningCircle,Lightning,Barcode,Pause,Play } from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'
import type { Membership,ProductOverview } from '../lib/types'
import { cameraErrorMessage } from '../capture/cameraErrors'
import { barcodeClient } from '../capture/engines'
import { canAcceptScan,pickLiveBarcode,sameGtin,videoFrame } from './continuousScan'
import { enqueuePhoto,getJevStatus,listPhotos,photoEvents,processPhotos,retryPhoto,type PhotoJob } from './photos'
import './jev.css'
type Props={products:ProductOverview[];membership:Membership;owner:string;onSaved:(message:string)=>void;onError:(message:string)=>void}
const states:Record<string,string>={queued:'Στην ουρά',reading:'Ανάγνωση',sending:'Jev',waiting:'Σε αναμονή',review:'Έλεγχος',committed:'Αποθηκεύτηκε',duplicate:'Ήδη καταχωρισμένη',error:'Νέα προσπάθεια'}
const reasons:Record<string,string>={product_not_identified:'Δεν ταυτοποιήθηκε προϊόν',multiple_products:'Περισσότερα από ένα προϊόντα',unknown_date_kind:'Η ημερομηνία δεν δηλώνει ξεκάθαρα λήξη',association_not_confirmed:'Ασαφής αντιστοίχιση πεδίων',no_captured_price_or_expiry:'Δεν βρέθηκε τιμή ή λήξη',large_price_change:'Μεγάλη αλλαγή τιμής',catalogue_or_evidence_changed:'Ο κατάλογος άλλαξε κατά τον έλεγχο'}
export default function AutoPhotoPane({products,membership,owner,onSaved,onError}:Props){
 const video=useRef<HTMLVideoElement>(null),stream=useRef<MediaStream|null>(null),generation=useRef(0),taking=useRef(false)
 const liveDecoder=useRef<ReturnType<typeof barcodeClient>|null>(null),scanTimer=useRef<number|undefined>(undefined),drainTimer=useRef<number|undefined>(undefined),lastAccepted=useRef<{code:string;at:number}|null>(null),lastCaptureAt=useRef(0),cameraActive=useRef(false)
 const [camera,setCamera]=useState(false),[starting,setStarting]=useState(false),[capturing,setCapturing]=useState(false),[message,setMessage]=useState(''),[jobs,setJobs]=useState<PhotoJob[]>([]),[health,setHealth]=useState<any>(null)
 const [healthError,setHealthError]=useState(false),[autoScan,setAutoScan]=useState(true),[latestCode,setLatestCode]=useState(''),[sessionScans,setSessionScans]=useState(0),[torch,setTorch]=useState(false),[canTorch,setCanTorch]=useState(false)
 const [providerKey,setProviderKey]=useState(''),[configuring,setConfiguring]=useState(false),[configMessage,setConfigMessage]=useState('')
 const onSavedRef=useRef(onSaved);onSavedRef.current=onSaved
 const store=membership.store_id
 async function refresh(){setJobs((await listPhotos(owner,store)).sort((a,b)=>b.created-a.created))}
 async function drain(){try{const count=await processPhotos(owner,store);if(count)onSavedRef.current('Καταχωρίστηκαν αυτόματα '+count+' φωτογραφίες.')}catch{onError('Δεν είναι διαθέσιμη η τοπική ουρά.')}finally{void refresh()}}
 function scheduleDrain(delay=2200){window.clearTimeout(drainTimer.current);drainTimer.current=window.setTimeout(()=>{if(cameraActive.current&&Date.now()-lastCaptureAt.current<1800){scheduleDrain(1200);return}void drain()},delay)}
 async function status(){try{setHealth(await getJevStatus(store));setHealthError(false)}catch{setHealthError(true)}}
 function stopCamera(){generation.current++;window.clearTimeout(scanTimer.current);liveDecoder.current?.cancel();liveDecoder.current=null;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;cameraActive.current=false;if(video.current)video.current.srcObject=null;setCamera(false);setStarting(false);setTorch(false);setCanTorch(false)}
 useEffect(()=>{
  let live=true
  const update=()=>{if(live)void refresh()},online=()=>{if(live){scheduleDrain(500);void status()}},visibility=()=>{if(document.hidden)stopCamera();else if(live)window.setTimeout(()=>void open(),180)}
  void refresh();void status();scheduleDrain(2600)
  const autoStart=window.setTimeout(()=>void open(),220)
  const tick=setInterval(()=>{if(live)scheduleDrain(700)},7000),healthTick=setInterval(()=>{if(live&&navigator.onLine)void status()},60000)
  photoEvents.addEventListener('change',update);window.addEventListener('online',online);document.addEventListener('visibilitychange',visibility)
  return()=>{live=false;window.clearTimeout(autoStart);window.clearTimeout(drainTimer.current);clearInterval(tick);clearInterval(healthTick);photoEvents.removeEventListener('change',update);window.removeEventListener('online',online);document.removeEventListener('visibilitychange',visibility);stopCamera()}
 },[owner,store])
 async function configure(event:React.FormEvent){
  event.preventDefault();if(configuring||!providerKey.trim())return
  setConfiguring(true);setConfigMessage('')
  try{
   const {data,error}=await supabase.functions.invoke('lixi-jev',{body:{action:'configure',storeId:store,apiKey:providerKey.trim()}})
   if(error||!data?.configured)throw new Error('Δεν έγινε σύνδεση. Έλεγξε ότι το κλειδί είναι ενεργό και έχει διαθέσιμο υπόλοιπο OpenRouter.')
   setConfigMessage('Ο Jev συνδέθηκε. Οι φωτογραφίες σε αναμονή θα επανυποβληθούν.')
   await status()
   for(const job of await listPhotos(owner,store))if(['waiting','error'].includes(job.state))await retryPhoto(job.id,owner)
   void drain()
  }catch(e){setConfigMessage(e instanceof Error?e.message:'Η ρύθμιση δεν αποθηκεύτηκε.')}
  finally{setProviderKey('');setConfiguring(false)}
 }
 async function open(){
  if(starting||camera)return
  setStarting(true);setMessage('');const gen=++generation.current
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw new Error('Η κάμερα απαιτεί HTTPS.')
   const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}})
   if(gen!==generation.current){media.getTracks().forEach(t=>t.stop());return}
   stream.current=media
   if(!video.current){media.getTracks().forEach(t=>t.stop());return}
   video.current.srcObject=media;await video.current.play()
   const track=media.getVideoTracks()[0],caps=(track?.getCapabilities?.()??{}) as MediaTrackCapabilities&{torch?:boolean};setCanTorch(Boolean(caps.torch));cameraActive.current=true
   if(gen===generation.current)setCamera(true)
  }catch(e){stopCamera();setMessage(cameraErrorMessage(e))}finally{setStarting(false)}
 }
 async function take(source:'manual'|'auto'='manual',detectedCode?:string){
  const v=video.current;if(!v?.videoWidth||taking.current)return
  taking.current=true;setCapturing(true);setMessage('')
  try{
   const c=document.createElement('canvas'),scale=Math.min(1,2000/Math.max(v.videoWidth,v.videoHeight));c.width=Math.round(v.videoWidth*scale);c.height=Math.round(v.videoHeight*scale)
   const context=c.getContext('2d');if(!context)throw new Error('Δεν δημιουργήθηκε εικόνα.');context.drawImage(v,0,0,c.width,c.height)
   const blob=await new Promise<Blob>((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('Η φωτογραφία απέτυχε.')),'image/jpeg',.92))
   await enqueuePhoto(blob,owner,store);lastCaptureAt.current=Date.now();setSessionScans(v=>v+1);if(detectedCode)setLatestCode(detectedCode);setMessage(source==='auto'?(detectedCode?'Σαρώθηκε '+detectedCode+' · συνέχισε αμέσως στο επόμενο προϊόν.':'Αυτόματη λήψη · συνέχισε στο επόμενο προϊόν.'):'Η λήψη μπήκε στην ουρά. Συνέχισε στο επόμενο προϊόν.');navigator.vibrate?.(25);scheduleDrain()
  }catch(e){setMessage(e instanceof Error?e.message:'Δεν αποθηκεύτηκε η φωτογραφία.')}finally{taking.current=false;setCapturing(false)}
 }
 async function files(selected:File[]){
  if(selected.length>20){setMessage('Διάλεξε έως 20 φωτογραφίες τη φορά.');return}
  try{for(const file of selected)await enqueuePhoto(file,owner,store);lastCaptureAt.current=Date.now();setSessionScans(v=>v+selected.length);setMessage('Προστέθηκαν '+selected.length+' φωτογραφίες.');scheduleDrain(700)}catch(e){setMessage(e instanceof Error?e.message:'Η εισαγωγή απέτυχε.')}
 }
 async function toggleTorch(){const track=stream.current?.getVideoTracks()[0];if(!track||!canTorch)return;const next=!torch;try{await (track as any).applyConstraints({advanced:[{torch:next}]});setTorch(next)}catch{setCanTorch(false)}}
 useEffect(()=>{
  if(!camera||!autoScan)return
  let cancelled=false,busy=false
  const loop=async()=>{
   if(cancelled)return
   const v=video.current
   if(v?.videoWidth&&!taking.current&&!busy&&!document.hidden){
    busy=true
    try{
     const frame=await videoFrame(v)
     if(frame){liveDecoder.current??=barcodeClient();const decoded=await liveDecoder.current.call({blob:frame,still:true});const code=pickLiveBarcode((decoded.codes??[]) as any)
      if(code&&canAcceptScan(code,lastAccepted.current)){lastAccepted.current={code,at:Date.now()};setLatestCode(code);void take('auto',code)}
     }
    }catch{/* Camera scanning is best-effort; manual capture stays available. */}finally{busy=false}
   }
   if(!cancelled)scanTimer.current=window.setTimeout(loop,460)
  }
  scanTimer.current=window.setTimeout(loop,260)
  return()=>{cancelled=true;window.clearTimeout(scanTimer.current);liveDecoder.current?.cancel();liveDecoder.current=null}
 },[camera,autoScan])
 const latestProduct=latestCode?products.find(p=>sameGtin(p.barcode,latestCode)):undefined
 const pending=jobs.filter(j=>!['committed','duplicate','review'].includes(j.state)).length
 const review=jobs.filter(j=>j.state==='review').length
 return <section className="jev-capture" aria-label="Αυτόματη καταχώριση φωτογραφίας">
  <header className="jev-heading"><div><span className="jev-eyebrow">ΦΩΤΟΓΡΑΦΙΑ → ΚΑΤΑΧΩΡΙΣΗ</span><h2>Μία λήψη. Τα πεδία στη θέση τους.</h2><p>PP-OCRv5 + barcode διαβάζουν. Ο Jev αντιστοιχίζει. Η βάση καταχωρίζει όσα πέρασαν τους ελέγχους.</p></div><span className={'jev-provider '+(health?.configured?'online':'waiting')}>{healthError?'Μη διαθέσιμη κατάσταση':health?.configured?'Jev · συνδεδεμένος':'Jev · αναμονή ενεργοποίησης'}</span></header>
  {membership.role==='owner'&&<details className="jev-configuration"><summary>Σύνδεση OpenRouter / Jev</summary><form onSubmit={configure}><label htmlFor="jev-api-key">OpenRouter API key</label><input id="jev-api-key" type="password" autoComplete="off" spellCheck={false} value={providerKey} placeholder="API key" onChange={e=>setProviderKey(e.target.value)} required/><button className="wk-button" disabled={configuring||!providerKey.trim()}>{configuring?'Έλεγχος σύνδεσης…':'Σύνδεση Jev'}</button><p>Μοντέλο: typesafe/jev-1.13. Το κλειδί αποθηκεύεται στον server, όχι στη συσκευή.</p>{configMessage&&<p role="status">{configMessage}</p>}</form></details>}
  <div className="jev-camera"><video ref={video} muted playsInline aria-label="Κάμερα αυτόματης καταγραφής"/><div className="jev-frame" aria-hidden="true"/><div className="jev-live-hud"><span className={camera&&autoScan?'live':''}><i/> {camera&&autoScan?'LIVE SCAN':'SCAN'}</span><strong>{latestCode||'Στόχευσε το barcode'}</strong><small>{sessionScans} λήψεις</small></div>{!camera&&<div className="jev-camera-prompt"><Barcode size={34}/><strong>{starting?'Άνοιγμα κάμερας…':'Η κάμερα ανοίγει αυτόματα'}</strong><span>Κράτησε barcode, ετικέτα τιμής και λήξη όσο γίνεται στο ίδιο κάδρο. Αν το iPhone ζητήσει άδεια, πάτησε Allow.</span></div>}</div>
  <div className="jev-controls">{!camera?<button className="wk-button primary" onClick={()=>void open()} disabled={starting}><Camera size={20}/>{starting?'Άνοιγμα…':'Ενεργοποίηση κάμερας'}</button>:<><button className={'wk-button '+(autoScan?'primary':'')} aria-pressed={autoScan} onClick={()=>setAutoScan(v=>!v)}>{autoScan?<><Pause size={19}/>Auto scan ON</>:<><Play size={19}/>Auto scan OFF</>}</button><button className="wk-button" disabled={capturing} onClick={()=>void take('manual')}><Camera size={20}/>Χειροκίνητη λήψη</button>{canTorch&&<button className="wk-button" aria-pressed={torch} onClick={()=>void toggleTorch()}><Lightning size={19}/>{torch?'Φως ON':'Φως'}</button>}<button className="wk-button" onClick={stopCamera} aria-label="Κλείσιμο κάμερας"><CameraSlash size={20}/></button></>}
   <label className="wk-button jev-files"><Images size={20}/>Από φωτογραφίες<input className="sr-only" aria-label="Φωτογραφίες για αυτόματη καταχώριση" type="file" accept="image/*" multiple onChange={e=>{void files([...(e.target.files??[])]);e.target.value=''}}/></label>
  </div>
  <div className={'jev-now '+(latestCode?'has-scan':'')}><div><span>ΤΕΛΕΥΤΑΙΑ ΣΑΡΩΣΗ</span><strong>{latestProduct?.description||latestCode||'Περιμένω barcode…'}</strong><small>{latestCode?(latestProduct?latestCode+' · '+latestProduct.internal_code:latestCode+' · νέο / χωρίς mapping στη βάση'):'Με το που κλειδώσει barcode γίνεται λήψη και μπορείς να πας αμέσως στο επόμενο.'}</small></div><b>{latestCode?'Επόμενο →':'AUTO'}</b></div>
  {message&&<p className="jev-message" role="status">{message}</p>}
  <div className="jev-queue-header"><h3>Ουρά καταγραφών <span>{pending} αναμονή · {review} για έλεγχο</span></h3><button className="wk-icon" aria-label="Ανανέωση κατάστασης Jev" onClick={()=>{void drain();void status()}}><ArrowClockwise size={19}/></button></div>
  <div className="jev-jobs">{jobs.length?jobs.slice(0,20).map(j=><article className={'jev-job '+j.state} key={j.id}>
   {j.state==='committed'?<CheckCircle size={21}/>:j.state==='review'||j.state==='error'?<WarningCircle size={21}/>:<Clock size={21}/>}
   <div><strong>{j.result?.decision?.plan?.description??new Intl.DateTimeFormat('el-GR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(j.created))}</strong><p>{j.message}</p>{j.result?.decision?.plan&&<small>{j.result.decision.plan.internal_code} {j.result.decision.plan.price_cents!=null?' · '+(j.result.decision.plan.price_cents/100).toFixed(2)+' €':''}{j.result.decision.plan.expiry_date?' · Λήξη '+j.result.decision.plan.expiry_date:''}</small>}{j.state==='review'&&<small>{(j.result?.decision?.reasons??[]).map((r:string)=>reasons[r]??'Αβέβαιο πεδίο').join(' · ')}</small>}</div>
   <span className="jev-state">{states[j.state]}</span>{['waiting','error'].includes(j.state)&&<button className="wk-icon" aria-label="Επανάληψη φωτογραφίας" onClick={()=>void retryPhoto(j.id,owner).then(drain)}><ArrowClockwise size={18}/></button>}
  </article>):<p className="jev-empty">Οι φωτογραφίες αποθηκεύονται πρώτα στη συσκευή. Οι αμφίβολες καταγραφές μένουν για έλεγχο χωρίς να σταματούν την επόμενη λήψη.</p>}</div>
  <details className="jev-monitor"><summary>Πρωινός συγχρονισμός · 07:00–09:00 · κάθε 20 λεπτά</summary><p>Ώρα Ελλάδας, με προσαρμογή θερινής ώρας. Οι κύκλοι επανεξετάζουν αποτυχημένες αποστολές και ενημερώνουν τη σύνοψη λήξεων. Δεν χρειάζεται ανοιχτή εφαρμογή για όσα έχουν ήδη φτάσει στον server.</p>{health?.runs?.length?health.runs.map((r:any)=><div className="jev-run" key={r.id}><time>{new Intl.DateTimeFormat('el-GR',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Athens'}).format(new Date(r.slot))}</time><strong>{r.state==='blocked'?'Αναμονή κλειδιού':r.state==='completed'?'Ολοκληρώθηκε':r.state==='failed'?'Αποτυχία':r.state==='running'?'Σε εξέλιξη':'Προγραμματίστηκε'}</strong><span>{r.summary?.committed??0} καταχωρίσεις · {r.summary?.expiry_alerts??0} ειδοποιήσεις λήξης</span></div>):<p>Δεν έχει καταγραφεί ακόμη πρωινός κύκλος.</p>}</details>
 </section>
}
