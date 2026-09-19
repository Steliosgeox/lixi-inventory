import { describe,it,expect } from 'vitest'
import { gtinValid,identifier,buildIndex,FrameConsensus,parseCents,priceCandidates,codesFromOcr,documentRows,safeCsv,type OcrResult } from '../../src/capture/domain'
import type { ProductOverview } from '../../src/lib/types'
const product=(code:string,barcode:string|null=null)=>({product_id:code,internal_code:code,barcode,description:'Δοκιμή',unit:'Τεμάχιο'}) as ProductOverview
const result=(texts:string[]):OcrResult=>({engine:'fixture',elapsedMs:0,width:1000,height:1000,lines:texts.map((text,i)=>({text,score:.99,box:{x:0,y:i*25,width:900,height:20}}))})
describe('strict identifiers',()=>{
 it.each(['5201050130807','4006381333931','036000291452','96385074','04006381333931'])('validates checksum %s',v=>expect(gtinValid(v)).toBe(true))
 it.each(['5201050130808','4006381333932','036000291453','96385075','abc','0018023'])('rejects checksum %s',v=>expect(gtinValid(v)).toBe(false))
 it('retains leading zeroes on internal identifiers',()=>expect(identifier('0018023')).toEqual({value:'0018023',kind:'internal',valid:true}))
 it('supports explicitly tagged GS1 AI 01',()=>expect(identifier(']d201040063813339311727123110LOT').value).toBe('04006381333931'))
 it('does not treat random URLs as a product',()=>expect(identifier('https://evil.example/4006381333931').valid).toBe(false))
 it('canonical GTIN lookup, no destructive zero-stripping',()=>{const find=buildIndex([product('0018023','4006381333931')]);expect(find('04006381333931')[0].internal_code).toBe('0018023');expect(find('18023')).toEqual([])})
 it('returns duplicates for deliberate review',()=>expect(buildIndex([product('0018023','4006381333931'),product('0018024','4006381333931')])('4006381333931')).toHaveLength(2))
 it('requires distinct camera frames',()=>{const c=new FrameConsensus();expect(c.accept('4006381333931',100)).toBe(false);expect(c.accept('4006381333931',120)).toBe(false);expect(c.accept('4006381333931',250)).toBe(true)})
 it('does not count inconsistent or stale frames',()=>{const c=new FrameConsensus();c.accept('4006381333931',100);expect(c.accept('5201050130807',300)).toBe(false);expect(c.accept('5201050130807',1700)).toBe(false)})
})
describe('money and field review',()=>{
 it.each([['0',0],['0,00',0],['0,90',90],['1.9',190],['1234,56',123456],['0.01',1]])('parses %s in integer cents',(v,e)=>expect(parseCents(v as string)).toBe(e))
 it.each(['','-1','1.234','1,2,3','Infinity','1e2','NaN','12345678','€1.20'])('rejects %s',v=>expect(parseCents(v)).toBeNull())
 it('keeps conflicting prices as candidates',()=>expect(priceCandidates(result(['1,95 €','7,95 €'])).map(p=>p.cents)).toEqual([195,795]))
 it('marks price per kilo separately',()=>expect(priceCandidates(result(['3,90 €/kg']))[0].unitPrice).toBe(true))
 it('does not extract decimal suffixes from large numbers',()=>expect(priceCandidates(result(['1234567,89']))).toEqual([]))
 it('flags multiple exact OCR codes rather than choosing first',()=>{const lookup=buildIndex([product('0018023'),product('0018024')]);expect(codesFromOcr(result(['0018023','0018024']),lookup)).toHaveLength(2)})
 it('ignores handwriting after printed unit price',()=>{const [r]=documentRows(result(['Μάρκετ Α 6,00 21,10 0018023 ΚΑΝΕΛΟΝΙΑ ΗΛΙΟΣ 250ΓΡ Τεμάχιο 1,31 999 ✓']),buildIndex([product('0018023')]));expect(r).toMatchObject({code:'0018023',price:'1,31',row:'6,00',number:'21,10',needsReview:true})})
 it('does not guess missing document price',()=>expect(documentRows(result(['0018023 ΚΑΝΕΛΟΝΙΑ 250ΓΡ ✓']),buildIndex([]))[0].price).toBe(''))
 it('neutralizes spreadsheet formulas in draft export',()=>expect(safeCsv([['=SUM(A1:A2)','0018023']])).toContain('"\'=SUM(A1:A2)";"0018023"'))
})
