import 'fake-indexeddb/auto'
import { beforeEach,describe,it,expect,vi } from 'vitest'
const api=vi.hoisted(()=>({owner:'owner-one',rpc:vi.fn(),upload:vi.fn(),list:vi.fn()}))
vi.mock('../../src/lib/supabase',()=>({supabase:{auth:{getSession:async()=>({data:{session:{user:{id:api.owner}}}})},rpc:api.rpc,storage:{from:()=>({upload:api.upload,list:api.list})}}}))
import {captureDb,queueDraft,listDrafts,discardDraft,flushDrafts,retryDraft,queueSmartDraft,listSmartDrafts,flushSmartDrafts,retrySmartDraft,type CaptureDraft,type SmartCaptureDraft} from '../../src/capture/offline'
const draft=(id='draft-1'):CaptureDraft=>({id,owner:'owner-one',store:'store-one',product:'prod-one',code:'0018023',cents:131,unit:'Τεμάχιο',observedAt:'2026-09-19T18:00:00Z',created:1,metadata:{reviewed:true},image:null,state:'pending',error:'',attempts:0,retryAt:0})
beforeEach(async()=>{await captureDb.drafts.clear();await captureDb.smartDrafts.clear();api.owner='owner-one';api.rpc.mockReset().mockResolvedValue({data:'receipt',error:null});Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true})})
describe('outbox',()=>{
 it('isolates records by user and store',async()=>{await queueDraft(draft());expect(await listDrafts('other','store-one')).toHaveLength(0);expect(await listDrafts('owner-one','other')).toHaveLength(0)})
 it('persists before any network call',async()=>{await queueDraft(draft());expect(api.rpc).not.toHaveBeenCalled();expect(await listDrafts('owner-one','store-one')).toHaveLength(1)})
 it('rejects duplicate queue operation IDs',async()=>{await queueDraft(draft());await expect(queueDraft(draft())).rejects.toThrow()})
 it('leaves an offline record pending',async()=>{Object.defineProperty(globalThis,'navigator',{value:{onLine:false},configurable:true});await queueDraft(draft());expect(await flushDrafts('owner-one','store-one')).toBe(0);expect(await listDrafts('owner-one','store-one')).toHaveLength(1)})
 it('never synchronizes under another identity',async()=>{await queueDraft(draft());api.owner='other';expect(await flushDrafts('owner-one','store-one')).toBe(0);expect(api.rpc).not.toHaveBeenCalled()})
 it('retries the same operation with the same payload',async()=>{await queueDraft(draft());api.rpc.mockResolvedValueOnce({error:{message:'network lost'}});await flushDrafts('owner-one','store-one');await retryDraft('draft-1','owner-one');await flushDrafts('owner-one','store-one');expect(api.rpc).toHaveBeenCalledTimes(2);expect(api.rpc.mock.calls[0][1]).toEqual(api.rpc.mock.calls[1][1]);expect(await listDrafts('owner-one','store-one')).toHaveLength(0)})
 it('deletes only after server acknowledgement',async()=>{await queueDraft(draft());api.rpc.mockResolvedValue({error:{message:'denied'}});await flushDrafts('owner-one','store-one');expect((await listDrafts('owner-one','store-one'))[0].error).toBe('denied')})
 it('cannot discard another user draft',async()=>{await queueDraft(draft());await discardDraft('draft-1','other');expect(await listDrafts('owner-one','store-one')).toHaveLength(1)})
})

const smart=(id='smart-1'):SmartCaptureDraft=>({id,owner:'owner-one',store:'store-one',product:'prod-one',code:'0018023',unit:'Τεμάχιο',priceCents:131,expiry:'2026-10-20',expiryKind:'expiry',lot:'LOT1',quantity:1,locationId:null,expirySource:'ocr',created:2,metadata:{reviewed:true,smart_scan:true},image:null,state:'pending',error:'',attempts:0,retryAt:0})
describe('smart outbox',()=>{
 it('persists the combined capture before sync',async()=>{await queueSmartDraft(smart());expect(api.rpc).not.toHaveBeenCalled();expect(await listSmartDrafts('owner-one','store-one')).toHaveLength(1)})
 it('sends price and expiry through one atomic RPC',async()=>{await queueSmartDraft(smart());await flushSmartDrafts('owner-one','store-one');expect(api.rpc).toHaveBeenCalledTimes(1);expect(api.rpc.mock.calls[0][0]).toBe('commit_smart_capture');expect(api.rpc.mock.calls[0][1]).toMatchObject({p_price_cents:131,p_expiry:'2026-10-20',p_lot:'LOT1'});expect(await listSmartDrafts('owner-one','store-one')).toHaveLength(0)})
 it('keeps the same operation id and payload on retry',async()=>{await queueSmartDraft(smart());api.rpc.mockResolvedValueOnce({error:{message:'offline'}});await flushSmartDrafts('owner-one','store-one');await retrySmartDraft('smart-1','owner-one');await flushSmartDrafts('owner-one','store-one');expect(api.rpc.mock.calls[0][1]).toEqual(api.rpc.mock.calls[1][1])})
})
