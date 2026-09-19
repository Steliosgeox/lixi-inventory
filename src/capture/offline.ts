import Dexie, { type Table } from 'dexie'
import { supabase } from '../lib/supabase'
import type { Location, Membership, ProductOverview } from '../lib/types'
export type CaptureDraft = {
  id:string; owner:string; store:string; product:string; code:string; cents:number; unit:string;
  observedAt:string; created:number; metadata:Record<string,unknown>; image:Blob|null;
  state:'pending'|'error'; attempts:number; error:string; retryAt:number;
}
type Snapshot={scope:string;owner:string;member:Membership;products:ProductOverview[];locations:Location[];saved:number}
class CaptureDatabase extends Dexie {
  drafts!:Table<CaptureDraft,string>;catalogue!:Table<Snapshot,string>
  constructor(){super('leaksy-capture-v1');this.version(1).stores({drafts:'&id,[owner+store],owner,created',catalogue:'&scope,owner'})}
}
export const captureDb=new CaptureDatabase()
export const draftEvents=new EventTarget()
const changed=()=>draftEvents.dispatchEvent(new Event('change'))
export const listDrafts=(owner:string,store:string)=>captureDb.drafts.where('[owner+store]').equals([owner,store]).sortBy('created')
export async function queueDraft(draft:CaptureDraft){await captureDb.drafts.add(draft);changed()}
export async function discardDraft(id:string,owner:string){await captureDb.transaction('rw',captureDb.drafts,async()=>{const d=await captureDb.drafts.get(id);if(d?.owner===owner)await captureDb.drafts.delete(id)});changed()}
export async function retryDraft(id:string,owner:string){const d=await captureDb.drafts.get(id);if(d?.owner===owner)await captureDb.drafts.update(id,{retryAt:0,state:'pending',error:''});changed()}
export async function saveSnapshot(owner:string,member:Membership,products:ProductOverview[],locations:Location[]){await captureDb.catalogue.put({scope:`${owner}:${member.store_id}`,owner,member,products,locations,saved:Date.now()})}
export async function loadSnapshot(owner:string){return captureDb.catalogue.where('owner').equals(owner).first()}
export async function purgeSnapshots(owner:string){await captureDb.catalogue.where('owner').equals(owner).delete()}
let flushing:Promise<number>|null=null
/** FIFO + stable operation UUID; retries never mean creating a new price observation. */
export function flushDrafts(owner:string,store:string):Promise<number>{
  if(flushing)return flushing
  flushing=(async()=>{
    if(!navigator.onLine)return 0
    const {data}=await supabase.auth.getSession()
    if(data.session?.user.id!==owner)return 0
    let saved=0
    for(const draft of await listDrafts(owner,store)){
      if(draft.retryAt>Date.now())break // preserve observation ordering
      try{
        let evidence:string|null=null
        if(draft.image){
          evidence=`${store}/${owner}/${draft.id}.jpg`
          const upload=await supabase.storage.from('capture-evidence').upload(evidence,draft.image,{contentType:'image/jpeg',upsert:false})
          if(upload.error){
            // A successful previous upload may precede an interrupted RPC. Verify object metadata via SELECT.
            const check=await supabase.storage.from('capture-evidence').list(`${store}/${owner}`,{search:`${draft.id}.jpg`,limit:1})
            if(check.error||!check.data?.some(x=>x.name===`${draft.id}.jpg`))throw upload.error
          }
        }
        const current=(await supabase.auth.getSession()).data.session
        if(current?.user.id!==owner)break
        const {error}=await supabase.rpc('commit_capture_price',{p_id:draft.id,p_store:store,p_product:draft.product,p_cents:draft.cents,p_unit:draft.unit,p_observed_at:draft.observedAt,p_evidence:evidence,p_metadata:draft.metadata})
        if(error)throw error
        await captureDb.drafts.delete(draft.id);saved++;changed()
      }catch(error){
        const message=error instanceof Error?error.message:typeof error==='object'&&error&&'message' in error?String(error.message):'Η σύνδεση ή αποθήκευση απέτυχε.'
        const attempts=draft.attempts+1
        await captureDb.drafts.update(draft.id,{attempts,state:'error',error:message,retryAt:Date.now()+Math.min(300000,2000*2**Math.min(attempts,7))});changed();break
      }
    }
    return saved
  })().finally(()=>{flushing=null})
  return flushing
}
