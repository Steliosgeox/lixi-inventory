
import { useEffect,useMemo,useRef,useState } from 'react'
import type { Membership,ProductOverview,ExpiryKind } from '../lib/types'
import { barcodeClient,OcrEngine } from './engines'
import { buildIndex,codesFromOcr,identifier,parseCents,priceCandidates,type OcrResult } from './domain'
import { expiryCandidates,lotCandidates,type ExpiryCandidate } from './expiry'
import { parseGs1Scan,type Gs1Capture } from './gs1'
import { cameraErrorMessage } from './cameraErrors'
import { draftEvents,flushSmartDrafts,listSmartDrafts,queueSmartDraft,type SmartCaptureDraft } from './offline'

type Decoded={text:string;format:string;symbologyIdentifier?:string;bytes?:number[]}
type ExtendedCapabilities=MediaTrackCapabilities&{torch?:boolean;zoom?:{min:number;max:number;step:number}}
type Props={products:ProductOverview[];membership:Membership;owner:string;onSaved:(s:string)=>void;onError:(s:string)=>void}

const PRICE_HINT=/(?:€|EUR|\bΤΙΜΗ\b|\bPRICE\b)/iu
const money=(cents:number)=>new Intl.NumberFormat('el-GR',{style:'currency',currency:'EUR'}).format(cents/100)

export default function SmartScanPane({products,membership,owner,onSaved,onError}:Props){
  const lookup=useMemo(()=>buildIndex(products),[products])
  const video=useRef<HTMLVideoElement>(null),decodeCanvas=useRef<HTMLCanvasElement|null>(null),ocrCanvas=useRef<HTMLCanvasElement|null>(null)
  const decoder=useRef<ReturnType<typeof barcodeClient>|null>(null),ocr=useRef<OcrEngine|null>(null),stream=useRef<MediaStream|null>(null)
  const generation=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),frameId=useRef<number|null>(null),ocrBusy=useRef(false),lastOcr=useRef(0)
  const rawConsensus=useRef({value:'',at:0,hits:0})
  const [running,setRunning]=useState(false),[starting,setStarting]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('Άνοιξε την κάμερα και στόχευσε μία ετικέτα ή συσκευασία.')
  const [product,setProduct]=useState<ProductOverview|null>(null),[scanned,setScanned]=useState(''),[price,setPrice]=useState(''),[expiry,setExpiry]=useState(''),[expiryKind,setExpiryKind]=useState<ExpiryKind>('expiry'),[expirySource,setExpirySource]=useState<'gs1'|'ocr'|'manual'|null>(null),[lot,setLot]=useState(''),[quantity,setQuantity]=useState('1')
  const [reviewed,setReviewed]=useState(false),[saving,setSaving]=useState(false),[priceOptions,setPriceOptions]=useState<number[]>([]),[expiryOptions,setExpiryOptions]=useState<ExpiryCandidate[]>([]),[evidence,setEvidence]=useState<Blob|null>(null),[lastOcrText,setLastOcrText]=useState(''),[gs1,setGs1]=useState<Gs1Capture|null>(null),[pending,setPending]=useState<SmartCaptureDraft[]>([])
  const [hardware,setHardware]=useState(false),[caps,setCaps]=useState<ExtendedCapabilities>({}),[zoom,setZoom]=useState(1),[torch,setTorch]=useState(false),[decodeMs,setDecodeMs]=useState<number|null>(null),[ocrMs,setOcrMs]=useState<number|null>(null)

  const dirty=price.trim()!==''||expiry.trim()!==''||lot.trim()!==''
  const exactPrice=price.trim()?parseCents(price):null
  const canSave=!!product&&dirty&&(price.trim()===''||exactPrice!==null)&&(!expiry||/^\d{4}-\d{2}-\d{2}$/.test(expiry))&&reviewed&&!saving

  function revokeReview(){setReviewed(false)}
  function resetItem(){
    setProduct(null);setScanned('');setPrice('');setExpiry('');setExpiryKind('expiry');setExpirySource(null);setLot('');setQuantity('1');setPriceOptions([]);setExpiryOptions([]);setEvidence(null);setLastOcrText('');setGs1(null);setReviewed(false);setError('')
    rawConsensus.current={value:'',at:0,hits:0};setStatus('Έτοιμο για το επόμενο προϊόν.')
  }
  async function refreshDrafts(){try{setPending(await listSmartDrafts(owner,membership.store_id))}catch{}}
  async function sync(){try{const count=await flushSmartDrafts(owner,membership.store_id);if(count)onSaved('Συγχρονίστηκαν '+count+' Smart Scan καταγραφές.')}catch(e){onError(e instanceof Error?e.message:'Ο συγχρονισμός Smart Scan απέτυχε.')}finally{void refreshDrafts()}}

  useEffect(()=>{
    void refreshDrafts();void sync()
    const update=()=>void refreshDrafts(),online=()=>void sync()
    draftEvents.addEventListener('change',update);window.addEventListener('online',online)
    return()=>{draftEvents.removeEventListener('change',update);window.removeEventListener('online',online);stop();ocr.current?.cancel();ocr.current=null}
  },[owner,membership.store_id])

  useEffect(()=>{
    if(!hardware)return
    let cancelled=false,dispose:(()=>void)|undefined
    void import('onscan.js').then(({default:onScan})=>{
      if(cancelled)return
      onScan.attachTo(document,{suffixKeyCodes:[13],minLength:7,avgTimeByChar:45,timeBeforeScanTest:120,ignoreIfFocusOn:'input,textarea,select,[contenteditable="true"]',reactToPaste:false,preventDefault:false,stopPropagation:false,
        onScan:(raw:string)=>{if(!cancelled)void consumeBarcode({text:raw,format:'Hardware'})}})
      dispose=()=>onScan.detachFrom(document)
    }).catch(()=>setError('Δεν φορτώθηκε η υποστήριξη scanner χειρός.'))
    return()=>{cancelled=true;dispose?.()}
  },[hardware,products])

  function stop(){
    generation.current++;clearTimeout(timer.current)
    if(frameId.current!==null)video.current?.cancelVideoFrameCallback?.(frameId.current)
    frameId.current=null;decoder.current?.cancel();decoder.current=null
    stream.current?.getTracks().forEach(t=>t.stop());stream.current=null
    if(video.current)video.current.srcObject=null
    setRunning(false);setStarting(false);setCaps({});setTorch(false);ocrBusy.current=false
  }
  useEffect(()=>{const hide=()=>{if(document.hidden)stop()};document.addEventListener('visibilitychange',hide);return()=>document.removeEventListener('visibilitychange',hide)},[])

  function rawAccepted(value:string,now:number){
    const r=rawConsensus.current
    if(value!==r.value||now-r.at>1200){rawConsensus.current={value,at:now,hits:1};return false}
    if(now-r.at<60)return false
    r.at=now;r.hits++;return r.hits>=2
  }
  function lock(p:ProductOverview,via:string){
    setProduct(current=>{
      if(current?.product_id===p.product_id)return current
      revokeReview();setStatus('Κλειδώθηκε: '+p.description+' · '+via);return p
    })
  }
  function applyGs1(parsed:Gs1Capture){
    setGs1(parsed)
    if(parsed.expiryDate){setExpiry(parsed.expiryDate);setExpiryKind(parsed.expiryKind??'expiry');setExpirySource('gs1');revokeReview()}
    if(parsed.lot){setLot(parsed.lot);revokeReview()}
  }
  async function consumeBarcode(code:Decoded){
    const raw=code.text.trim()
    if(!raw||!rawAccepted(raw,performance.now()))return
    setScanned(raw)
    const parsed=await parseGs1Scan(code)
    if(parsed)applyGs1(parsed)
    const candidates=parsed?.gtin?lookup(parsed.gtin):lookup(raw)
    if(candidates.length===1){lock(candidates[0],parsed?'GS1':'barcode');navigator.vibrate?.(30)}
    else if(candidates.length>1)setError('Ο κωδικός αντιστοιχεί σε περισσότερα από ένα προϊόντα.')
    else if(identifier(raw).valid)setStatus('Ο κωδικός διαβάστηκε αλλά δεν έχει αντιστοίχιση. Συνεχίζω με OCR για κωδικό είδους.')
  }

  async function jpegFrame(v:HTMLVideoElement,maxWidth=1280):Promise<Blob>{
    const scale=Math.min(1,maxWidth/v.videoWidth),w=Math.max(1,Math.round(v.videoWidth*scale)),h=Math.max(1,Math.round(v.videoHeight*scale))
    const c=ocrCanvas.current??(ocrCanvas.current=document.createElement('canvas'));c.width=w;c.height=h
    const ctx=c.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Δεν μπορώ να επεξεργαστώ το καρέ.')
    ctx.drawImage(v,0,0,w,h)
    return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('Δεν δημιουργήθηκε εικόνα OCR.')),'image/jpeg',.84))
  }
  function consumeOcr(result:OcrResult,blob:Blob){
    setOcrMs(Math.round(result.elapsedMs));setLastOcrText(result.lines.map(x=>x.text).join('\n').slice(0,12000))
    const codes=codesFromOcr(result,lookup)
    if(codes.length===1){const m=lookup(codes[0]);if(m.length===1)lock(m[0],'OCR κωδικός')}
    const allPrices=priceCandidates(result).filter(x=>!x.unitPrice)
    const hinted=allPrices.filter(x=>PRICE_HINT.test(x.line.text)),source=hinted.length?hinted:allPrices
    const unique=[...new Set(source.map(x=>x.cents))].slice(0,6);setPriceOptions(unique)
    if(hinted.length&&new Set(hinted.map(x=>x.cents)).size===1&&!price){setPrice((hinted[0].cents/100).toFixed(2));setEvidence(blob);revokeReview()}
    const ex=expiryCandidates(result);setExpiryOptions(ex.slice(0,5))
    if((!expiry||expirySource!=='gs1')&&new Set(ex.map(x=>x.kind+':'+x.iso)).size===1&&ex[0]){setExpiry(ex[0].iso);setExpiryKind(ex[0].kind);setExpirySource('ocr');setEvidence(blob);revokeReview()}
    const lots=lotCandidates(result);if(!lot&&lots.length===1){setLot(lots[0].value);setEvidence(blob);revokeReview()}
  }
  async function maybeOcr(v:HTMLVideoElement,gen:number){
    const now=performance.now();if(ocrBusy.current||now-lastOcr.current<1200||!v.videoWidth)return
    ocrBusy.current=true;lastOcr.current=now
    try{
      const blob=await jpegFrame(v);if(gen!==generation.current)return
      ocr.current??=new OcrEngine()
      const result=await ocr.current.recognize(blob,'paddle',false,s=>{if(gen===generation.current)setStatus(s)})
      if(gen===generation.current)consumeOcr(result,blob)
    }catch{if(gen===generation.current)setStatus('Το OCR δεν βρήκε ασφαλή πεδία σε αυτό το καρέ. Συνέχισε να στοχεύεις.')}
    finally{ocrBusy.current=false}
  }

  async function start(){
    if(starting||running)return
    stop();const gen=generation.current;setStarting(true);setError('');setStatus('Προετοιμασία Smart Scan…')
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Η κάμερα απαιτεί HTTPS και άδεια.')
      const d=barcodeClient();decoder.current=d
      const [media]=await Promise.all([
        navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920,min:1280},height:{ideal:1080,min:720}}}).then(m=>{if(gen!==generation.current)m.getTracks().forEach(t=>t.stop());else stream.current=m;return m}),
        d.call({kind:'warm'})
      ])
      if(gen!==generation.current)return
      const v=video.current;if(!v)return stop()
      v.srcObject=media;await v.play();if(gen!==generation.current)return
      const track=media.getVideoTracks()[0],cap=(track.getCapabilities?.() as ExtendedCapabilities)??{}
      setCaps(cap);setZoom(track.getSettings().zoom??cap.zoom?.min??1);setStarting(false);setRunning(true);setStatus('Barcode + OCR τρέχουν μαζί. Κράτα το προϊόν στο πλαίσιο.')
      const frame=async()=>{
        if(gen!==generation.current)return
        frameId.current=null
        try{
          if(!v.videoWidth){timer.current=setTimeout(frame,80);return}
          const roi={x:v.videoWidth*.05,y:v.videoHeight*.16,w:v.videoWidth*.9,h:v.videoHeight*.68},scale=Math.min(1,960/roi.w)
          const c=decodeCanvas.current??(decodeCanvas.current=document.createElement('canvas')),w=Math.round(roi.w*scale),h=Math.round(roi.h*scale)
          if(c.width!==w||c.height!==h){c.width=w;c.height=h}
          const ctx=c.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Barcode frame unavailable')
          ctx.drawImage(v,roi.x,roi.y,roi.w,roi.h,0,0,w,h)
          const pixels=ctx.getImageData(0,0,w,h)
          const decoded=await d.call({buffer:pixels.data.buffer,width:w,height:h},[pixels.data.buffer],undefined,10000)
          if(gen!==generation.current)return
          setDecodeMs(Math.round(decoded.ms));const codes=(decoded.codes as Decoded[])
          if(codes.length===1)void consumeBarcode(codes[0])
          void maybeOcr(v,gen)
          const schedule=()=>{if(gen!==generation.current)return;if(v.requestVideoFrameCallback)frameId.current=v.requestVideoFrameCallback(()=>void frame());else void frame()}
          timer.current=setTimeout(schedule,Math.max(80,180-decoded.ms))
        }catch(e){if(gen===generation.current){stop();setError(cameraErrorMessage(e))}}
      }
      void frame()
    }catch(e){if(gen===generation.current){stop();setError(cameraErrorMessage(e))}}
  }

  async function option(value:{zoom?:number;torch?:boolean}){
    try{const track=stream.current?.getVideoTracks()[0];if(!track)return;await track.applyConstraints({advanced:[value as MediaTrackConstraintSet]});if(value.zoom!=null)setZoom(value.zoom);if(value.torch!=null)setTorch(value.torch)}
    catch{setError('Η κάμερα δεν υποστηρίζει αυτή τη ρύθμιση.')}
  }
  async function confirm(){
    if(!canSave||!product)return
    setSaving(true);setError('')
    try{
      const cents=price.trim()?parseCents(price):null
      const draft:SmartCaptureDraft={id:crypto.randomUUID(),owner,store:membership.store_id,product:product.product_id,code:product.internal_code,unit:product.unit??'',priceCents:cents,expiry:expiry||null,expiryKind:expiry?expiryKind:null,lot:lot.trim(),quantity:expiry?Math.max(0,Number(quantity)||1):null,locationId:null,expirySource:expiry?expirySource??'manual':null,created:Date.now(),image:evidence,attempts:0,error:'',retryAt:0,state:'pending',
        metadata:{reviewed:true,reviewed_at:new Date().toISOString(),smart_scan:true,product_code:product.internal_code,scanned_identifier:scanned||null,gs1_hri:gs1?.hri??[],ocr_engine:'PaddleOCR.js 0.4.2 / el_PP-OCRv5_mobile_rec',ocr_elapsed_ms:ocrMs,decode_ms:decodeMs,raw_ocr:lastOcrText||null}}
      await queueSmartDraft(draft);await refreshDrafts();navigator.vibrate?.([40,25,40]);onSaved('Smart Scan αποθηκεύτηκε. Έτοιμο για το επόμενο προϊόν.');resetItem();void sync()
    }catch(e){setError(e instanceof Error?e.message:'Η Smart Scan καταγραφή απέτυχε.')}finally{setSaving(false)}
  }

  return <section className="smart-scan">
    <div className="smart-scan-head"><div><span className="smart-live-dot"/><b>SMART SCAN</b><small>Barcode · GS1 · PP-OCRv5 Greek · λήξη · τιμή</small></div><span>{pending.length?pending.length+' σε ουρά':'συγχρονισμένο'}</span></div>
    <div className="capture-video smart-video"><video ref={video} muted playsInline aria-label="Smart Scan κάμερα"/><div className="capture-reticle"/><span>{running?'Μετακίνησε τη συσκευασία χωρίς να κλείσεις την κάμερα':starting?'Προετοιμασία…':'Πάτησε έναρξη'}</span></div>
    <div className="capture-actions"><button className="wk-button primary" disabled={running||starting} onClick={()=>void start()}>Έναρξη Smart Scan</button><button className="wk-button" disabled={!running&&!starting} onClick={stop}>Παύση</button>{caps.torch&&<button className="wk-button" aria-pressed={torch} onClick={()=>void option({torch:!torch})}>Φακός</button>}{product&&<button className="wk-button" onClick={resetItem}>Επόμενο / καθαρισμός</button>}</div>
    {caps.zoom&&<label className="capture-zoom">Zoom {zoom.toFixed(1)}×<input type="range" min={caps.zoom.min} max={Math.min(4,caps.zoom.max)} step={caps.zoom.step||.1} value={zoom} onChange={e=>void option({zoom:Number(e.target.value)})}/></label>}
    <label className="capture-check"><input type="checkbox" checked={hardware} onChange={e=>setHardware(e.target.checked)}/>Scanner χειρός / Bluetooth keyboard</label>
    <p className="capture-status" role="status">{status}</p>{error&&<p className="capture-warning" role="alert">{error}</p>}

    <div className="smart-fields">
      <div className={'smart-field '+(product?'done':'')}><span>1</span><div><small>ΠΡΟΪΟΝ</small><b>{product?.description??'Περιμένω barcode ή κωδικό OCR'}</b><em>{product?(product.internal_code+(scanned?' · '+scanned:'')):'Η κάμερα συνεχίζει μέχρι να κλειδώσει μοναδικό προϊόν.'}</em></div></div>
      <div className={'smart-field '+(price?'done':'')}><span>2</span><div><small>ΤΙΜΗ ΡΑΦΙΟΥ</small><label><input aria-label="Smart Scan τιμή" inputMode="decimal" placeholder="π.χ. 1,95" value={price} onChange={e=>{setPrice(e.target.value);revokeReview()}}/><i>€</i></label>{priceOptions.length>0&&<div className="smart-chips">{priceOptions.map(x=><button key={x} onClick={()=>{setPrice((x/100).toFixed(2));revokeReview()}}>{money(x)}</button>)}</div>}</div></div>
      <div className={'smart-field '+(expiry?'done':'')}><span>3</span><div><small>ΛΗΞΗ</small><div className="smart-expiry-input"><input aria-label="Smart Scan λήξη" type="date" value={expiry} onChange={e=>{setExpiry(e.target.value);setExpirySource('manual');revokeReview()}}/><select aria-label="Είδος λήξης" value={expiryKind} onChange={e=>{setExpiryKind(e.target.value as ExpiryKind);setExpirySource('manual');revokeReview()}}><option value="expiry">Λήξη / use by</option><option value="best_before">Ανάλωση κατά προτίμηση</option><option value="sell_by">Sell by</option><option value="unknown">Άγνωστο</option></select></div>{expiry&&<em>{expirySource==='gs1'?'Από GS1 barcode — δομημένο πεδίο':expirySource==='ocr'?'Πρόταση PP-OCRv5 — έλεγξέ την':'Χειροκίνητη τιμή'}</em>}{expiryOptions.length>1&&<div className="smart-chips">{expiryOptions.map(x=><button key={x.kind+x.iso} onClick={()=>{setExpiry(x.iso);setExpiryKind(x.kind);setExpirySource('ocr');revokeReview()}}>{x.iso}</button>)}</div>}</div></div>
      <div className={'smart-field '+(lot?'done':'')}><span>4</span><div><small>LOT / ΠΑΡΤΙΔΑ</small><input aria-label="Smart Scan lot" value={lot} onChange={e=>{setLot(e.target.value);revokeReview()}} placeholder="προαιρετικό"/>{expiry&&<label className="smart-qty">Ποσότητα παρτίδας<input aria-label="Ποσότητα παρτίδας" inputMode="decimal" value={quantity} onChange={e=>{setQuantity(e.target.value);revokeReview()}}/></label>}</div></div>
    </div>

    <label className="smart-review"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} disabled={!product||!dirty}/>Έλεγξα προϊόν, τιμή/λήξη και lot. Το OCR δεν αποθηκεύει τίποτα μόνο του.</label>
    <button className="wk-button primary smart-confirm" disabled={!canSave} onClick={()=>void confirm()}>{saving?'Αποθήκευση…':'Επιβεβαίωση → επόμενο προϊόν'}</button>
    <div className="smart-tech"><span>ZXing-C++ {decodeMs==null?'—':decodeMs+' ms'}</span><span>PP-OCRv5 Greek {ocrMs==null?'—':(ocrMs/1000).toFixed(1)+' s'}</span><span>{gs1?.expiryDate?'GS1 λήξη ✓':'GS1 έλεγχος ενεργός'}</span></div>
  </section>
}
