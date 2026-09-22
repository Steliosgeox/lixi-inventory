import { describe,expect,it } from 'vitest'
import { expiryCandidates } from '../../src/capture/expiry'
import type { OcrResult } from '../../src/capture/domain'

const result=(...texts:string[]):OcrResult=>({engine:'test',elapsedMs:1,width:800,height:600,lines:texts.map((text,i)=>({text,score:.96,box:{x:10,y:20+i*35,width:400,height:25}}))})
const now=new Date('2026-09-22T00:00:00Z')

describe('expiry OCR candidates',()=>{
  it('reads explicit Greek expiry date',()=>expect(expiryCandidates(result('ΛΗΞΗ 20/10/2026'),now)[0]).toMatchObject({iso:'2026-10-20',kind:'expiry'}))
  it('reads Greek best-before month as month-end',()=>expect(expiryCandidates(result('ΑΝΑΛΩΣΗ ΚΑΤΑ ΠΡΟΤΙΜΗΣΗ ΠΡΙΝ ΑΠΟ','09/2027'),now)[0]).toMatchObject({iso:'2027-09-30',kind:'best_before'}))
  it('reads English use-by',()=>expect(expiryCandidates(result('USE BY 01.11.26'),now)[0]).toMatchObject({iso:'2026-11-01',kind:'expiry'}))
  it('reads compact date only next to a semantic marker',()=>expect(expiryCandidates(result('EXP 260930'),now)[0]).toMatchObject({iso:'2026-09-30'}))
  it('does not turn a shelf price into a date',()=>expect(expiryCandidates(result('ΤΙΜΗ 1,95 €'),now)).toEqual([]))
  it('does not accept an unlabelled date',()=>expect(expiryCandidates(result('20/10/2026'),now)).toEqual([]))
  it('rejects impossible dates',()=>expect(expiryCandidates(result('ΛΗΞΗ 31/02/2027'),now)).toEqual([]))
})
