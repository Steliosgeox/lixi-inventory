import {describe,it,expect} from 'vitest'
import {canAcceptScan,normalizeGtin,pickLiveBarcode,sameGtin,validGtin} from '../../src/jev/continuousScan'

describe('continuous scan helpers',()=>{
  it('accepts checksum-valid GTIN and ignores QR noise',()=>{
    expect(validGtin('5201050130807')).toBe(true)
    expect(validGtin('5201050130808')).toBe(false)
    expect(pickLiveBarcode([
      {text:'https://example.com',format:'QRCode'},
      {text:'5201050130807',format:'EAN13'}
    ])).toBe('5201050130807')
  })
  it('normalizes leading zero variants',()=>{
    expect(normalizeGtin('034000470693')).toBe(normalizeGtin('0034000470693'))
    expect(sameGtin('034000470693','0034000470693')).toBe(true)
  })
  it('suppresses only immediate duplicate scans',()=>{
    expect(canAcceptScan('5201050130807',null,1000)).toBe(true)
    expect(canAcceptScan('5201050130807',{code:'5201050130807',at:1000},2000,3500)).toBe(false)
    expect(canAcceptScan('5201050130807',{code:'5201050130807',at:1000},5000,3500)).toBe(true)
    expect(canAcceptScan('5201050130807',{code:'3017624010701',at:1000},1100,3500)).toBe(true)
  })
})
