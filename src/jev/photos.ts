import Dexie,{type Table} from 'dexie'
import { supabase } from '../lib/supabase'
import { prepareImage } from '../capture/media'
import { OcrEngine,barcodeClient } from '../capture/engines'
import type { CaptureInput } from '../../supabase/functions/lixi-jev/core'
export type PhotoState='queued'|'reading'|'sending'|'waiting'|'review'|'committed'|'duplicate'|'error'
export type PhotoJob={id:string;owner:string;store:string;created:number;updated:number;state:PhotoState;blob:Blob|null;input:CaptureInput|null;message:string;result:any;retryAt:number}
class PhotoDatabase extends Dexie{photos!:Table<PhotoJob,string>;constructor(){super('lixi-jev-photos-v1');this.version(1).stores({photos:'&id,[owner+store],created,state'})}}
export const photoDb=new PhotoDatabase()
export const photoEvents=new EventTarget()
const changed=()=>photoEvents.dispatchEvent(new Event('change'))
export const listPhotos=(owner:string,store:string)=>photoDb.photos.where('[owner+store]').equals([owner,store]).reverse().sortBy('created')
export async function enqueuePhoto(blob:Blob,owner:string,store:string){
 if(!blob.type.startsWith('image/')||blob.type.includes('svg')||blob.size>20*1024*1024)throw new Error('Χρειάζεται φωτογραφία έως 20 MB.')
 const all=await listPhotos(owner,store);if(all.filter(p=>!['committed','duplicate'].includes(p.state)).length>=50)throw new Error('Υπάρχουν ήδη 50 εκκρεμείς φωτογραφίες. Περίμενε τον συγχρονισμό.')
 const id=crypto.randomUUID(),now=Date.now()
 await photoDb.photos.add({id,owner,store,created:now,updated:now,state:'queued',blob,input:null,message:'Αποθηκεύτηκε στη συσκευή',result:null,retryAt:0});changed();return id
}
async function update(id:string,patch:Partial<PhotoJob>){await photoDb.photos.update(id,{...patch,updated:Date.now()});changed()}
export async function retryPhoto(id:string,owner:string){const p=await photoDb.photos.get(id);if(p?.owner===owner&&!['committed','duplicate','review'].includes(p.state)){await update(id,{state:'queued',retryAt:0,message:'Νέα προσπάθεια'})}}
export async function getJevStatus(store:string){const {data,error}=await supabase.functions.invoke('lixi-jev',{body:{action:'status',storeId:store}});if(error)throw new Error('Η κατάσταση του Jev δεν είναι διαθέσιμη.');return data}
let draining:Promise<number>|null=null
let activeScope=''
let ocr:OcrEngine|null=null
let decoder:ReturnType<typeof barcodeClient>|null=null
let idle:ReturnType<typeof setTimeout>|undefined
const stopWorkers=()=>{ocr?.cancel();decoder?.cancel();ocr=null;decoder=null}
export function processPhotos(owner:string,store:string):Promise<number>{
 if(draining)return activeScope===owner+':'+store?draining:Promise.resolve(0)
 activeScope=owner+':'+store;clearTimeout(idle)
 draining=(async()=>{
  let committed=0
  const jobs=(await listPhotos(owner,store)).sort((a,b)=>a.created-b.created)
  for(const job of jobs){
   if(['committed','duplicate','review'].includes(job.state)||job.retryAt>Date.now())continue
   const session=(await supabase.auth.getSession()).data.session;if(session?.user.id!==owner)break
   try{
    let input=job.input
    if(!input){
     if(!job.blob)throw new Error('Η αρχική φωτογραφία δεν είναι διαθέσιμη.')
     await update(job.id,{state:'reading',message:'PP-OCRv5 + barcode'})
     const image=await prepareImage(job.blob)
     ocr??=new OcrEngine();decoder??=barcodeClient()
     const [recognition,decoded]=await Promise.all([
      ocr.recognize(image.blob,'paddle',false,s=>{void update(job.id,{message:s})}),
      decoder.call({blob:image.blob,still:true})
     ])
     input={id:job.id,storeId:store,observedAt:new Date(job.created).toISOString(),imageHash:image.sha256,evidencePath:store+'/'+owner+'/'+job.id+'.jpg',ocr:recognition,barcodes:(decoded.codes??[]).map((b:any)=>({text:b.text,format:b.format,...(b.symbologyIdentifier?{symbologyIdentifier:b.symbologyIdentifier}:{})}))}
     // Persist exact normalized pixels and OCR before networking. Retries reuse this immutable input.
     await update(job.id,{blob:image.blob,input,state:'sending',message:'Έτοιμο για Jev'})
    }
    if(!navigator.onLine){await update(job.id,{state:'waiting',message:'Εκτός σύνδεσης · η φωτογραφία είναι ασφαλής στη συσκευή',retryAt:Date.now()+15000});continue}
    if((await supabase.auth.getSession()).data.session?.user.id!==owner)break
    const current=await photoDb.photos.get(job.id);if(!current?.blob)throw new Error('Λείπει η φωτογραφία τεκμηρίωσης.')
    await update(job.id,{state:'sending',message:'Ο Jev αντιστοιχίζει τα πεδία'})
    const upload=await supabase.storage.from('capture-evidence').upload(input.evidencePath,current.blob,{contentType:'image/jpeg',upsert:false})
    if(upload.error){const exists=await supabase.storage.from('capture-evidence').list(store+'/'+owner,{search:job.id+'.jpg',limit:5});if(exists.error||!exists.data.some(f=>f.name===job.id+'.jpg'))throw new Error('Δεν ολοκληρώθηκε η αποστολή της φωτογραφίας.')}
    if((await supabase.auth.getSession()).data.session?.user.id!==owner)break
    const {data,error}=await supabase.functions.invoke('lixi-jev',{body:{action:'capture',capture:input}})
    if(error||!data)throw new Error('Ο server δεν επιβεβαίωσε την καταγραφή. Θα ξαναδοκιμάσει χωρίς διπλότυπα.')
    if(data.state==='committed'||data.state==='duplicate'){
     await update(job.id,{state:data.state,result:data,blob:null,message:data.state==='committed'?'Καταχωρίστηκε αυτόματα':'Η ίδια φωτογραφία έχει ήδη υποβληθεί',retryAt:0});if(data.state==='committed')committed++
    }else if(data.state==='review'){
     await update(job.id,{state:'review',result:data,message:'Χρειάζεται έλεγχο · συνέχισε με την επόμενη φωτογραφία',retryAt:0})
    }else{
     const reason=data.reason==='provider_not_configured'?'Αναμονή ενεργοποίησης Jev στον server':'Αναμονή Jev / νέας προσπάθειας'
     await update(job.id,{state:'waiting',message:reason,result:data,retryAt:Date.now()+300000})
    }
   }catch(e){await update(job.id,{state:'error',message:e instanceof Error?e.message:'Η καταγραφή δεν ολοκληρώθηκε',retryAt:Date.now()+60000})}
  }
  return committed
 })().finally(()=>{draining=null;idle=setTimeout(stopWorkers,120000)})
 return draining
}
