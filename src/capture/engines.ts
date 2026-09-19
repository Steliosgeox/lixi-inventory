import type { OcrResult } from './domain'
export class WorkerClient {
  private worker: Worker | null = null
  private pending: { resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>;progress?:(s:string)=>void } | null = null
  private serial=0
  constructor(private factory:()=>Worker) {}
  async call(message: Record<string,unknown>, transfer:Transferable[]=[], progress?:(s:string)=>void, timeout=90000):Promise<any> {
    if(this.pending) throw new Error('Υπάρχει ήδη εργασία σε εξέλιξη.')
    if(!this.worker){
      this.worker=this.factory()
      this.worker.onmessage=({data})=>{if(data.id!==this.serial||!this.pending)return;if(data.progress){this.pending.progress?.(data.progress);return}const p=this.pending;this.pending=null;clearTimeout(p.timer);data.error?p.reject(new Error(data.error)):p.resolve(data)}
      this.worker.onerror=e=>this.cancel(e.message||'Ο worker δεν ξεκίνησε.')
    }
    const id=++this.serial
    return new Promise((resolve,reject)=>{
      this.pending={resolve,reject,progress,timer:setTimeout(()=>this.cancel('Η αναγνώριση άργησε. Δοκίμασε μικρότερη περιοχή ή άλλο OCR.'),timeout)}
      try{this.worker!.postMessage({...message,id},transfer)}catch(e){this.cancel(e instanceof Error?e.message:'Αποτυχία αποστολής εικόνας.')}
    })
  }
  cancel(reason='Η εργασία ακυρώθηκε.') {this.serial++;if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error(reason));this.pending=null}this.worker?.terminate();this.worker=null}
}
export const barcodeClient=()=>new WorkerClient(()=>new Worker(new URL('./barcode.worker.ts',import.meta.url),{type:'module'}))
export class OcrEngine {
  private paddle=new WorkerClient(()=>new Worker(new URL('./ocr.worker.ts',import.meta.url),{type:'module'}))
  private fallback: import('tesseract.js').Worker | null = null
  private active=false
  private generation=0
  async recognize(blob:Blob, mode:'paddle'|'tesseract', document:boolean, progress:(s:string)=>void):Promise<OcrResult>{
    if(this.active)throw new Error('Περίμενε να ολοκληρωθεί η τρέχουσα εικόνα.')
    this.active=true; const gen=this.generation
    try{
      if(mode==='paddle')return (await this.paddle.call({blob,document},[],progress)).result
      if(!this.fallback){
        const {createWorker}=await import('tesseract.js'),base=new URL(`${import.meta.env.BASE_URL}capture/`,location.origin).href
        const w=await createWorker('ell+eng',1,{workerPath:base+'tesseract-worker.js',corePath:base,langPath:base,gzip:true,logger:m=>progress(m.status==='recognizing text'?`Αναγνώριση ${Math.round(m.progress*100)}%`:'Προετοιμασία εναλλακτικού OCR…')})
        if(gen!==this.generation){await w.terminate();throw new Error('Η εργασία ακυρώθηκε.')}
        this.fallback=w
      }
      const t=performance.now()
      const result=await this.fallback.recognize(blob,{}, {blocks:true,text:true})
      return {engine:'Tesseract.js 6.0.1 / ell+eng',elapsedMs:performance.now()-t,width:0,height:0,
        lines:(result.data.blocks??[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words.map(w=>({text:w.text,score:w.confidence/100,box:{x:w.bbox.x0,y:w.bbox.y0,width:w.bbox.x1-w.bbox.x0,height:w.bbox.y1-w.bbox.y0}})))))}
    } finally{if(gen===this.generation)this.active=false}
  }
  cancel(){this.generation++;this.active=false;this.paddle.cancel();void this.fallback?.terminate();this.fallback=null}
}
