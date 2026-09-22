import { describe,expect,it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { prepareZXingModule as prepareWriter,writeBarcode } from 'zxing-wasm/writer'
import { prepareZXingModule as prepareReader,readBarcodes } from 'zxing-wasm/reader'

describe('ZXing-C++ WASM retail decoder',()=>{
 it('round-trips a real EAN13 through the pinned writer and reader',async()=>{
   await prepareWriter({overrides:{wasmBinary:new Uint8Array(await readFile('node_modules/zxing-wasm/dist/writer/zxing_writer.wasm'))},fireImmediately:true})
   await prepareReader({overrides:{wasmBinary:new Uint8Array(await readFile('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm'))},fireImmediately:true})
   const written=await writeBarcode('5201050130807',{format:'EAN13',scale:4,addHRT:true})
   expect(written.error).toBe('')
   const results=await readBarcodes(written.image!,{formats:['EAN13'],tryHarder:true,maxNumberOfSymbols:1})
   expect(results[0]).toMatchObject({isValid:true,text:'5201050130807',format:'EAN13'})
 },20000)
})
