import { useEffect,useMemo,useRef,useState } from 'react'
import type { ProductOverview } from '../lib/types'
import { barcodeClient } from './engines'
import { buildIndex,FrameConsensus,identifier } from './domain'

type ExtendedCapabilities=MediaTrackCapabilities & {torch?:boolean;zoom?:{min:number;max:number;step:number}}
export default function BarcodePane({products,onPick}:{products:ProductOverview[];onPick:(p:ProductOverview)=>void}){
  const lookup=useMemo(()=>buildIndex(products),[products]),video=useRef<HTMLVideoElement>(null),canvas=useRef(document.createElement('canvas'))
  const client=useRef<ReturnType<typeof barcodeClient>|null>(null),stream=useRef<MediaStream|null>(null),generation=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined)
  const [running,setRunning]=useState(false),[starting,setStarting]=useState(false),[value,setValue]=useState(''),[error,setError]=useState(''),[hardware,setHardware]=useState(false),[caps,setCaps]=useState<ExtendedCapabilities>({}),[zoom,setZoom]=useState(1),[torch,setTorch]=useState(false),[ms,setMs]=useState<number|null>(null)
  const matches=lookup(value),id=identifier(value),currentLookup=useRef(lookup)
  currentLookup.current=lookup
  function resolve(raw:string){setValue(raw.trim());setError('')}
  function stop(){generation.current++;clearTimeout(timer.current);client.current?.cancel();client.current=null;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;if(video.current)video.current.srcObject=null;setRunning(false);setStarting(false);setCaps({});setTorch(false)}
  useEffect(()=>{const hide=()=>{if(document.hidden)stop()};document.addEventListener('visibilitychange',hide);return()=>{document.removeEventListener('visibilitychange',hide);stop()}},[])
  useEffect(()=>{
    if(!hardware)return
    let cancelled=false,dispose:(()=>void)|undefined
    void import('onscan.js').then(({default:onScan})=>{
      if(cancelled)return
      onScan.attachTo(document,{suffixKeyCodes:[13],minLength:7,avgTimeByChar:45,timeBeforeScanTest:120,ignoreIfFocusOn:'input,textarea,select,[contenteditable="true"]',reactToPaste:false,preventDefault:false,stopPropagation:false,
        onScan:(code:string)=>{if(identifier(code).valid)resolve(code)}})
      dispose=()=>onScan.detachFrom(document)
    }).catch(()=>setError('Η υποστήριξη scanner δεν φορτώθηκε. Χρησιμοποίησε το πεδίο κωδικού.'))
    return()=>{cancelled=true;dispose?.()}
  },[hardware])
  async function start(){
    if(starting||running)return
    stop();const gen=generation.current;setStarting(true);setError('')
    const decoder=barcodeClient();client.current=decoder
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Η κάμερα απαιτεί HTTPS και άδεια στο Safari.')
      const [media]=await Promise.all([navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}}).then(media=>{if(gen!==generation.current)media.getTracks().forEach(t=>t.stop());else stream.current=media;return media}),decoder.call({kind:'warm'})])
      if(gen!==generation.current){media.getTracks().forEach(t=>t.stop());return}
      const v=video.current!;v.srcObject=media;await v.play()
      const cap=media.getVideoTracks()[0].getCapabilities?.() as ExtendedCapabilities??{};setCaps(cap);setZoom(media.getVideoTracks()[0].getSettings().zoom??cap.zoom?.min??1)
      setStarting(false);setRunning(true)
      const consensus=new FrameConsensus()
      const frame=async()=>{
        if(gen!==generation.current)return
        try{
          if(!v.videoWidth){timer.current=setTimeout(frame,100);return}
          const cw=v.videoWidth,ch=v.videoHeight,roi={x:cw*.08,y:ch*.2,w:cw*.84,h:ch*.6},scale=Math.min(1,960/roi.w)
          const c=canvas.current;c.width=Math.round(roi.w*scale);c.height=Math.round(roi.h*scale)
          const ctx=c.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(v,roi.x,roi.y,roi.w,roi.h,0,0,c.width,c.height)
          const pixels=ctx.getImageData(0,0,c.width,c.height)
          const r=await decoder.call({buffer:pixels.data.buffer,width:c.width,height:c.height},[pixels.data.buffer],undefined,10000)
          if(gen!==generation.current)return
          setMs(Math.round(r.ms));const codes=[...new Set((r.codes as {text:string}[]).map(x=>x.text).filter(x=>identifier(x).valid))]
          if(codes.length===1&&consensus.accept(codes[0],performance.now())){resolve(codes[0]);stop();return}
          if(codes.length>1){consensus.reset();setError('Βλέπω περισσότερους κωδικούς. Στόχευσε ένα προϊόν.')}
          const schedule=()=>{if(gen!==generation.current)return;if(v.requestVideoFrameCallback)v.requestVideoFrameCallback(()=>void frame());else void frame()}
          timer.current=setTimeout(schedule,Math.max(80,180-r.ms))
        }catch(e){if(gen===generation.current){stop();setError(e instanceof Error?e.message:'Η σάρωση διακόπηκε.')}}
      }
      void frame()
    }catch(e){if(gen===generation.current){stop();setError(e instanceof Error?e.message:'Η κάμερα δεν άνοιξε.')}}
  }
  async function image(file:File){stop();setError('');const d=barcodeClient();client.current=d;const gen=generation.current;try{const r=await d.call({blob:file,still:true});if(gen!==generation.current)return;const codes=[...new Set((r.codes as {text:string}[]).map(x=>x.text).filter(x=>identifier(x).valid))];if(codes.length!==1)throw new Error(codes.length?'Πολλαπλοί κωδικοί. Επίλεξε πιο κοντινή εικόνα.':'Δεν βρέθηκε έγκυρος κωδικός.');resolve(codes[0])}catch(e){if(gen===generation.current)setError(e instanceof Error?e.message:'Αποτυχία ανάγνωσης.')}finally{d.cancel();if(client.current===d)client.current=null}}
  async function trackOption(option:{zoom?:number;torch?:boolean}){try{await stream.current?.getVideoTracks()[0].applyConstraints({advanced:[option as MediaTrackConstraintSet]});if(option.zoom!==undefined)setZoom(option.zoom);if(option.torch!==undefined)setTorch(option.torch)}catch{setError('Η κάμερα δεν υποστηρίζει αυτή τη ρύθμιση.')}}
  return <section className="capture-pane"><div className="capture-heading"><h2>Βρες το προϊόν.</h2><p>Κάμερα, φωτογραφία ή scanner χειρός. Ο κωδικός ελέγχεται πριν αντιστοιχιστεί.</p></div>
    <div className="capture-video"><video ref={video} muted playsInline aria-label="Προεπισκόπηση κάμερας"/><div className="capture-reticle"/><span>{running?'Στόχευσε έναν κωδικό':starting?'Προετοιμασία κάμερας…':'Η κάμερα είναι κλειστή'}</span></div>
    <div className="capture-actions"><button className="wk-button primary" onClick={()=>void start()} disabled={running||starting}>Άνοιγμα κάμερας</button><button className="wk-button" onClick={stop} disabled={!running&&!starting}>Διακοπή</button><label className="wk-button">Από εικόνα<input className="sr-only" aria-label="Εικόνα barcode" type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const f=e.target.files?.[0];if(f)void image(f);e.target.value=''}}/></label>{caps.torch&&<button className="wk-button" aria-pressed={torch} onClick={()=>void trackOption({torch:!torch})}>Φακός</button>}</div>
    {caps.zoom&&<label className="capture-zoom">Zoom {zoom.toFixed(1)}×<input type="range" min={caps.zoom.min} max={Math.min(4,caps.zoom.max)} step={caps.zoom.step||.1} value={zoom} onChange={e=>void trackOption({zoom:Number(e.target.value)})}/></label>}
    <label className="capture-field">Κωδικός ή barcode<input aria-label="Κωδικός ή barcode" inputMode="numeric" autoComplete="off" value={value} onChange={e=>resolve(e.target.value)} placeholder="Σκάναρε ή γράψε τον κωδικό"/></label>
    <label className="capture-check"><input type="checkbox" checked={hardware} onChange={e=>setHardware(e.target.checked)}/>Scanner χειρός / Bluetooth πληκτρολόγιο (Enter)</label><p className="capture-caption">Η παγκόσμια λήψη δεν παρεμβαίνει όταν γράφεις σε πεδίο. Μέσα σε πεδίο μπορείς να σκανάρεις ως πληκτρολόγιο.</p>
    {error&&<p role="alert" className="capture-warning">{error}</p>}
    {value&&<div className={`scan-result ${matches.length===1?'hit':'miss'}`}>{matches.length===1?<><strong>{matches[0].description}</strong><small>{matches[0].internal_code} · {matches[0].unit} · Θέση {matches[0].location_code??'—'}</small><button className="wk-button primary" onClick={()=>onPick(matches[0])}>Καταγραφή τιμής</button></>:<><strong>{matches.length>1?'Ο ίδιος κωδικός αντιστοιχεί σε πολλά προϊόντα.':id.valid?'Δεν υπάρχει ακόμη στη βάση.':'Μη έγκυρος ή μη υποστηριζόμενος κωδικός.'}</strong><small>Δεν δημιουργήθηκε ούτε άλλαξε προϊόν.</small></>}</div>}
    {ms!==null&&<p className="capture-caption">Τελευταίο decode: {ms} ms · ZXing-C++ WASM · συμφωνία δύο καρέ</p>}
  </section>
}
