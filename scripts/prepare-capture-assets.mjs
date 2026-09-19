import { mkdir,readFile,writeFile,copyFile,readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
const target='public/capture';await mkdir(target,{recursive:true})
const models=[
 {file:'detection.tar',url:'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_onnx_infer.tar',sha:'781056046c9ed77a15c94681605db6a0f62317c2e9cce6931c71da2478d4bc30'},
 {file:'greek.tar',url:'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/el_PP-OCRv5_mobile_rec_onnx_infer.tar',sha:'7a69b483daa1a26f9e478aa24949db10252e4cc7230d1f1d57ddf6b4dbf72cd4'},
 // Language assets are pinned to an upstream dataset version; digests checked below.
 {file:'eng.traineddata.gz',url:'https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz',sha:'18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b'},
 {file:'ell.traineddata.gz',url:'https://tessdata.projectnaptha.com/4.0.0_fast/ell.traineddata.gz',sha:'ac762fb0b3af8e8a48776a4a8edae0e7684a52ac657f9219ef5078b4e988859e'},
]
const hash=b=>createHash('sha256').update(b).digest('hex')
for(const model of models){
 const dest=path.join(target,model.file)
 let data;try{data=await readFile(dest)}catch{}
 if(!data||hash(data)!==model.sha){
  const response=await fetch(model.url,{signal:AbortSignal.timeout(120000)})
  if(!response.ok)throw new Error(`Model ${model.file}: HTTP ${response.status}`)
  data=Buffer.from(await response.arrayBuffer())
  if(hash(data)!==model.sha)throw new Error(`Model ${model.file} changed upstream. Review and verify before changing the pinned digest.`)
  await writeFile(dest,data)
 }
 console.log(`Verified ${model.file}: ${data.length} bytes`)
}
await copyFile('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm',path.join(target,'zxing_reader.wasm'))
await copyFile('node_modules/tesseract.js/dist/worker.min.js',path.join(target,'tesseract-worker.js'))
for(const file of await readdir('node_modules/tesseract.js-core'))if(/\.wasm(\.js)?$/.test(file))await copyFile('node_modules/tesseract.js-core/'+file,path.join(target,file))
for(const file of ['ort-wasm-simd-threaded.wasm','ort-wasm-simd-threaded.mjs'])await copyFile('node_modules/onnxruntime-web/dist/'+file,path.join(target,file))
await writeFile(path.join(target,'models.json'),JSON.stringify(models.map(({file,sha})=>({file,sha256:sha})),null,2))
