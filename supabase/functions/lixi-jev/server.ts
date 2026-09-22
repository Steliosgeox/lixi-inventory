import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { GS1encoder } from 'npm:gs1encoder@1.4.1'
import { buildBundle,callJev,validateInput,validGtin,MODEL,ENDPOINT,type CaptureInput,type Product,type StructuredBarcode } from './core.ts'
const url=Deno.env.get('SUPABASE_URL')??''
const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??''
const db=()=>createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
type DB=ReturnType<typeof db>
const origins=new Set(['https://lixi-inventory.vercel.app'])
async function providerKey(client:DB,store:string):Promise<string>{
 const preset=Deno.env.get('OPENROUTER_API_KEY')?.trim();if(preset)return preset
 const {data,error}=await client.rpc('jev_provider_key',{p_store:store})
 if(error)throw new Error('provider_configuration_unavailable')
 return typeof data==='string'?data:''
}
const sha=async(b:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(n=>n.toString(16).padStart(2,'0')).join('')
const shaText=(s:string)=>sha(new TextEncoder().encode(s).buffer)
const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v!==null&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}':JSON.stringify(v)
const allowedError=(e:unknown)=>e instanceof Error&&/^provider_|^invalid_provider|^budget_/.test(e.message)?e.message:'processing_error'
async function requireMember(client:DB,user:string,store:string,write=false){
 const {data,error}=await client.from('memberships').select('role').eq('user_id',user).eq('store_id',store).maybeSingle()
 if(error||!data||(write&&!['owner','admin','editor'].includes(data.role)))throw new Error('unauthorized_store')
 return data.role
}
async function structuredCodes(input:CaptureInput):Promise<StructuredBarcode[]> {
 const result:StructuredBarcode[]=[]
 const candidates=input.barcodes.filter(b=>/^\](?:d2|C1|Q3)/.test(b.text)||/^\](?:d2|C1|Q3)$/.test(b.symbologyIdentifier??''))
 if(!candidates.length)return result
 const encoder=await GS1encoder.create()
 try{for(const b of candidates){try{
  encoder.scanData=/^\]/.test(b.text)?b.text:b.symbologyIdentifier+b.text
  const fields=new Map<string,string>()
  for(const line of encoder.hri){const m=line.match(/^\((\d{2,4})\)\s*(.*)$/);if(m)fields.set(m[1],m[2])}
  const gtin=fields.get('01')??null;if(gtin&&!validGtin(gtin))continue
  const ai=fields.has('17')?'17':fields.has('15')?'15':fields.has('16')?'16':null
  const d=ai?fields.get(ai):null;let expiryDate:string|null=null
  if(d&&/^\d{6}$/.test(d)){const y=2000+Number(d.slice(0,2)),m=Number(d.slice(2,4)),day=Number(d.slice(4))||new Date(Date.UTC(y,m,0)).getUTCDate();if(m>=1&&m<=12&&day>=1&&day<=new Date(Date.UTC(y,m,0)).getUTCDate())expiryDate=`${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`}
  result.push({gtin,expiryDate,expiryKind:ai==='17'?'expiry':ai==='15'?'best_before':ai==='16'?'sell_by':null,lot:fields.get('10')??null})
 }catch{/* Invalid GS1 is not converted to an invented GTIN/date. */}}}finally{encoder.free()}
 return result
}
async function catalogue(client:DB,store:string):Promise<Product[]> {
 const out:Product[]=[]
 for(let offset=0;offset<10000;offset+=1000){const {data,error}=await client.from('products').select('id,internal_code,barcode,description,unit,updated_at,catalog_price').eq('store_id',store).eq('active',true).order('id').range(offset,offset+999);if(error)throw new Error('catalogue_unavailable');out.push(...(data??[]));if(!data||data.length<1000)return out}
 throw new Error('catalogue_exceeds_safe_scan_limit')
}
async function processCapture(client:DB,user:string,input:CaptureInput){
 await requireMember(client,user,input.storeId,true)
 if(input.evidencePath!==`${input.storeId}/${user}/${input.id}.jpg`)throw new Error('invalid_evidence_path')
 const {data:reservation,error}=await client.rpc('reserve_jev_capture',{p_id:input.id,p_store:input.storeId,p_user:user,p_hash:await shaText(canonical(input)),p_image_hash:input.imageHash,p_input:input})
 if(error)throw new Error('capture_reservation_failed')
 if(reservation.cached||reservation.duplicate||reservation.busy)return reservation
 const key=await providerKey(client,input.storeId)
 if(!key){
  await client.from('ai_capture_runs').update({state:'failed',error_code:'provider_not_configured',updated_at:new Date().toISOString()}).eq('id',input.id)
  return {state:'waiting',reason:'provider_not_configured'}
 }
 try{
  const {data:image,error:downloadError}=await client.storage.from('capture-evidence').download(input.evidencePath)
  if(downloadError||!image||image.size>8*1024*1024)throw new Error('evidence_unavailable')
  if(await sha(await image.arrayBuffer())!==input.imageHash)throw new Error('evidence_hash_mismatch')
  const [{data:budget,error:budgetError},items,structured]=await Promise.all([client.rpc('jev_take_budget',{p_store:input.storeId}),catalogue(client,input.storeId),structuredCodes(input)])
  if(budgetError||!budget)throw new Error('budget_limit')
  const {data:row}=await client.from('ai_capture_runs').select('attempts').eq('id',input.id).single()
  await client.from('ai_capture_runs').update({attempts:(row?.attempts??0)+1}).eq('id',input.id)
  const response=await callJev(buildBundle(input,items,structured),key)
  const {data:committed,error:saveError}=await client.rpc('finish_jev_capture',{p_id:input.id,p_user:user,p_model:response.model,p_decision:response.decision})
  if(saveError){
   const review={...response.decision,status:'review',reasons:['catalogue_or_evidence_changed']}
   const result=await client.rpc('finish_jev_capture',{p_id:input.id,p_user:user,p_model:response.model,p_decision:review})
   if(result.error)throw new Error('commit_failed');return result.data
  }
  return committed
 }catch(e){
  const code=allowedError(e)
  await client.from('ai_capture_runs').update({state:'failed',error_code:code,updated_at:new Date().toISOString()}).eq('id',input.id).eq('state','processing')
  return {state:'waiting',reason:code}
 }
}
async function scheduled(client:DB,ticket:string){
 const {data:job,error}=await client.rpc('claim_jev_job',{p_ticket:ticket})
 if(error||!job)throw new Error('unauthorized_job')
 let committed=0,review=0,waiting=0
 try{
  const {data:settings}=await client.from('jev_automation_settings').select('enabled').eq('store_id',job.store_id).single()
  if(!settings?.enabled)throw new Error('automation_disabled')
  const key=await providerKey(client,job.store_id)
  if(key){
   const {data:rows,error:readError}=await client.from('ai_capture_runs').select('input,user_id').eq('store_id',job.store_id).in('state',['failed','processing']).lt('attempts',3).lt('updated_at',new Date(Date.now()-60000).toISOString()).order('created_at').limit(8)
   if(readError)throw new Error('queue_unavailable')
   for(const r of rows??[]){try{const out=await processCapture(client,r.user_id,validateInput(r.input));if(out.state==='committed')committed++;else if(out.state==='review')review++;else waiting++}catch{waiting++}}
  }
  // Calendar arithmetic and inventory facts stay deterministic; no model call for date subtraction.
  const {count:expiryAlerts}=await client.from('expiry_batches_overview').select('*',{count:'exact',head:true}).eq('store_id',job.store_id).in('expiry_status',['expired','critical','warning'])
  const {count:unmatched}=await client.from('products').select('*',{count:'exact',head:true}).eq('store_id',job.store_id).is('barcode',null)
  const {count:backlog}=await client.from('ai_capture_runs').select('*',{count:'exact',head:true}).eq('store_id',job.store_id).in('state',['processing','failed'])
  const summary={committed,review,waiting,backlog:backlog??0,expiry_alerts:expiryAlerts??0,missing_barcodes:unmatched??0,provider_configured:!!key,timezone:'Europe/Athens',model:MODEL}
  const {error:finishError}=await client.from('jev_sync_runs').update({state:key?'completed':'blocked',summary,finished_at:new Date().toISOString()}).eq('id',job.id)
  if(finishError)throw new Error('job_receipt_failed')
  return {job_id:job.id,...summary}
 }catch{
  await client.from('jev_sync_runs').update({state:'failed',summary:{error:'scheduled_processing_failed'},finished_at:new Date().toISOString()}).eq('id',job.id)
  throw new Error('scheduled_processing_failed')
 }
}
export async function handleRequest(req:Request):Promise<Response>{
 const origin=req.headers.get('origin')??''
 const cors={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(origins.has(origin)?{'Access-Control-Allow-Origin':origin}:{}),'Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'}
 const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors})
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors})
 if(req.method!=='POST')return json({error:'method_not_allowed'},405)
 if(origin&&!origins.has(origin))return json({error:'origin_not_allowed'},403)
 if(!url||!secret)return json({error:'server_not_configured'},503)
 const client=db()
 try{
  const job=req.headers.get('x-lixi-job');if(job)return json(await scheduled(client,job))
  const token=req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if(!token)return json({error:'authentication_required'},401)
  const {data:auth,error}=await client.auth.getUser(token)
  if(error||!auth.user)return json({error:'invalid_session'},401)
  if(Number(req.headers.get('content-length')??0)>65536)return json({error:'request_too_large'},413)
  const raw=await req.text();if(raw.length>65536)return json({error:'request_too_large'},413)
  const body=JSON.parse(raw)
  if(body.action==='status'){
   const role=await requireMember(client,auth.user.id,body.storeId)
   const key=await providerKey(client,body.storeId)
   const [last,recent,config]=await Promise.all([
    client.from('jev_sync_runs').select('id,slot,state,summary,finished_at').eq('store_id',body.storeId).order('slot',{ascending:false}).limit(7),
    client.from('ai_capture_runs').select('id,state,decision,result,error_code,created_at').eq('store_id',body.storeId).order('created_at',{ascending:false}).limit(30),
    client.from('jev_automation_settings').select('enabled').eq('store_id',body.storeId).single()
   ])
   return json({provider:'openrouter',model:MODEL,configured:!!key,can_configure:role==='owner',automatic_enabled:config.data?.enabled??false,schedule:{timezone:'Europe/Athens',times:['07:00','07:20','07:40','08:00','08:20','08:40','09:00']},runs:last.data??[],captures:recent.data??[]})
  }
  if(body.action==='configure'){
   const role=await requireMember(client,auth.user.id,body.storeId,true)
   if(role!=='owner')return json({error:'owner_required'},403)
   if(typeof body.apiKey!=='string'||!/^sk-or-[A-Za-z0-9_-]{20,190}$/.test(body.apiKey.trim()))return json({error:'invalid_key_format'},400)
   const credential=body.apiKey.trim()
   // Probe the documented Decisions endpoint before storing a credential. Never log request bodies.
   const {data:budget,error:budgetError}=await client.rpc('jev_take_budget',{p_store:body.storeId})
   if(budgetError||!budget)return json({error:'budget_limit'},429)
   const probe=await fetch(ENDPOINT,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,state:'Leaksy provider connection test.',questions:{connected:{type:'noul',instructions:'Is this a provider connection test?'}}})})
   if(!probe.ok)return json({error:'provider_http_'+probe.status},400)
   const result=await probe.json()
   if(typeof result.answers?.connected?.noul!=='number')return json({error:'invalid_provider_response'},400)
   const {error:saveError}=await client.rpc('configure_jev_provider',{p_store:body.storeId,p_user:auth.user.id,p_key:credential})
   if(saveError)return json({error:'configuration_not_saved'},500)
   return json({configured:true,model:result.model??MODEL})
  }
  if(body.action!=='capture')return json({error:'unsupported_action'},400)
  return json(await processCapture(client,auth.user.id,validateInput(body.capture)))
 }catch(e){
  if(e instanceof Error&&(e.message.startsWith('unauthorized')||e.message==='invalid_session'))return json({error:'access_denied'},403)
  return json({error:'invalid_or_unavailable_request'},400)
 }
}
