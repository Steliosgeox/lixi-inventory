/// <reference lib="webworker" />
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader'
const ctx = self as unknown as DedicatedWorkerGlobalScope
let ready: Promise<unknown> | null = null
ctx.onmessage = async ({ data }) => {
  try {
    if (!ready) ready = prepareZXingModule({ overrides: { locateFile: (path: string) => path.endsWith('.wasm') ? new URL(`${import.meta.env.BASE_URL}capture/zxing_reader.wasm`, self.location.origin).href : path }, fireImmediately: true })
    await ready
    if (data.kind === 'warm') { ctx.postMessage({ id:data.id, ready:true }); return }
    const t=performance.now()
    const image = data.blob ?? new ImageData(new Uint8ClampedArray(data.buffer), data.width, data.height)
    const results=await readBarcodes(image,{ formats:['EAN13','EAN8','UPCA','UPCE','Code128','DataMatrix','QRCode'],tryHarder:!!data.still,tryRotate:true,tryInvert:false,maxNumberOfSymbols:3,returnErrors:false,textMode:'Plain' })
    ctx.postMessage({ id:data.id, codes: results.filter(x=>x.isValid).map(x=>({ text:x.text,format:x.format,symbologyIdentifier:x.symbologyIdentifier,bytes:Array.from(x.bytes) })), ms:performance.now()-t })
  } catch(e) { ctx.postMessage({id:data.id,error:e instanceof Error?e.message:'Barcode worker failed'}); ready=null }
}
