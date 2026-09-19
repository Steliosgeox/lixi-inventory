/// <reference lib="webworker" />
import { PaddleOCR } from '@paddleocr/paddleocr-js'
import type { OcrResult } from './domain'
const ctx = self as unknown as DedicatedWorkerGlobalScope
let engine: ReturnType<typeof PaddleOCR.create> | null = null
ctx.onmessage = async ({ data }) => {
  try {
    if (!engine) {
      ctx.postMessage({id:data.id,progress:'Φόρτωση ελληνικού μοντέλου (μόνο την πρώτη φορά)…'})
      const base=new URL(`${import.meta.env.BASE_URL}capture/`,self.location.origin).href
      engine=PaddleOCR.create({worker:false,textDetectionModelName:'PP-OCRv5_mobile_det',textRecognitionModelName:'el_PP-OCRv5_mobile_rec',
        textDetectionModelAsset:{url:base+'detection.tar'},textRecognitionModelAsset:{url:base+'greek.tar'},
        ortOptions:{backend:'wasm',numThreads:1,simd:true,wasmPaths:base},textRecognitionBatchSize:1})
    }
    const ocr=await engine
    if(data.kind==='warm'){ctx.postMessage({id:data.id,ready:true});return}
    ctx.postMessage({id:data.id,progress:'Αναγνώριση κειμένου…'})
    const t=performance.now(), [r]=await ocr.predict(data.blob,{textDetLimitSideLen:data.document?1600:960,textDetLimitType:'max',textRecScoreThresh:0})
    const result:OcrResult={engine:'PaddleOCR.js 0.4.2 / el_PP-OCRv5_mobile_rec',width:r.image.width,height:r.image.height,elapsedMs:performance.now()-t,
      lines:r.items.map(l=>{const xs=l.poly.map(p=>p[0]),ys=l.poly.map(p=>p[1]);return {text:l.text,score:Number.isFinite(l.score)?l.score:null,box:{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}}})}
    ctx.postMessage({id:data.id,result})
  } catch(e) {ctx.postMessage({id:data.id,error:e instanceof Error?e.message:'OCR failed'});void engine?.then(e=>e.dispose()).catch(()=>{});engine=null}
}
