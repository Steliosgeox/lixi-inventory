import { describe,expect,it } from 'vitest'
import { gs1Date,parseGs1Hri,parseGs1Scan,scanDataString } from '../../src/capture/gs1'

describe('GS1 capture parsing',()=>{
  const now=new Date('2026-09-22T00:00:00Z')
  it('converts GS1 day 00 to end of month',()=>expect(gs1Date('270900',now)).toBe('2027-09-30'))
  it('parses expiry, lot and GTIN from HRI',()=>expect(parseGs1Hri(['(01) 05201050130807','(17) 260930','(10) LOT-A1'],now)).toMatchObject({gtin:'05201050130807',expiryDate:'2026-09-30',expiryKind:'expiry',lot:'LOT-A1'}))
  it('recognises best-before AI 15',()=>expect(parseGs1Hri(['(01) 05201050130807','(15) 270900'],now)).toMatchObject({expiryDate:'2027-09-30',expiryKind:'best_before'}))
  it('adds DataMatrix AIM prefix when the decoder omits it',()=>expect(scanDataString({text:'01052010501308071726093010LOT',format:'DataMatrix'})).toBe(']d201052010501308071726093010LOT'))
  it('runs the official GS1 WASM syntax engine',async()=>{
    const gs=String.fromCharCode(29)
    const parsed=await parseGs1Scan({text:`01052010501308071726093010LOT-A1${gs}21SERIAL`,format:'DataMatrix'},now)
    expect(parsed).toMatchObject({gtin:'05201050130807',expiryDate:'2026-09-30',expiryKind:'expiry',lot:'LOT-A1',serial:'SERIAL'})
  },20000)
})
