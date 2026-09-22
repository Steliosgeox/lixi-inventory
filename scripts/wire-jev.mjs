import fs from 'node:fs'
function edit(path,fn){const before=fs.readFileSync(path,'utf8'),after=fn(before);if(after===before)throw new Error('No patch applied: '+path);fs.writeFileSync(path,after)}
function replace(s,from,to){if(!s.includes(from))throw new Error('Missing patch anchor: '+from.slice(0,100));return s.replace(from,to)}
edit('src/capture/CaptureCenter.tsx',s=>{
 s=replace(s,"import SmartScanPane from './SmartScanPane'","import SmartScanPane from './SmartScanPane'\nimport AutoPhotoPane from '../jev/AutoPhotoPane'")
 s=replace(s,"useState<'smart'|'price'|'document'>('smart')","useState<'auto'|'smart'|'price'|'document'>('auto')")
 s=replace(s,"([['smart','Smart Scan']","([['auto','Αυτόματη καταχώριση'],['smart','Smart Scan']")
 s=replace(s,"{mode==='smart'?<SmartScanPane","{mode==='auto'?<AutoPhotoPane products={products} membership={membership} owner={owner} onSaved={onSaved} onError={onError}/>:mode==='smart'?<SmartScanPane")
 return s
})
edit('src/App.tsx',s=>{
 s=replace(s,'async function loadWorkspace(activeSession = session) {','async function loadWorkspace(activeSession = session, quiet = false) {')
 s=replace(s,'    setLoadingData(true)','    if (!quiet) setLoadingData(true)')
 s=replace(s,'await loadWorkspace() }} onError','await loadWorkspace(session, true) }} onError')
 return s
})
edit('src/capture/SmartScanPane.tsx',s=>{
 s=replace(s,"  const dirty=price.trim()!==''||expiry.trim()!==''||lot.trim()!==''","  const dirty=price.trim()!==''||expiry.trim()!==''\n  const latest=useRef({product,price,expiry,expirySource,lot,reviewed,saving});latest.current={product,price,expiry,expirySource,lot,reviewed,saving}\n  const revision=useRef(0),saveLock=useRef(false)\n  const [manualCode,setManualCode]=useState('')")
 s=replace(s,'  function resetItem(){','  function resetItem(){\n    revision.current++;setManualCode(\'\')')
 s=replace(s,"      onScan.attachTo(document,{suffixKeyCodes:[13]","      onScan.attachTo(document,{keyCodeMapper:(e:KeyboardEvent)=>e.key.length===1?e.key:'',suffixKeyCodes:[13]")
 s=replace(s,"  async function consumeBarcode(code:Decoded,confirmed=false){","  async function consumeBarcode(code:Decoded,confirmed=false){\n    if(latest.current.reviewed||latest.current.saving)return\n    const rev=revision.current")
 s=replace(s,'    if(parsed)applyGs1(parsed)','    if(rev!==revision.current)return')
 s=replace(s,"    if(candidates.length===1){lock(candidates[0],parsed?'GS1':'barcode');navigator.vibrate?.(30)}","    if(candidates.length===1){\n      if(latest.current.product&&latest.current.product.product_id!==candidates[0].product_id){setError('Διαφορετικό προϊόν. Πάτησε Επόμενο πριν συνεχίσεις.');return}\n      if(parsed&&!latest.current.expiry)applyGs1(parsed)\n      if(latest.current.product?.product_id!==candidates[0].product_id){lock(candidates[0],parsed?'GS1':'barcode');navigator.vibrate?.(30)}\n    }")
 s=replace(s,'  function consumeOcr(result:OcrResult,blob:Blob){','  function consumeOcr(result:OcrResult,blob:Blob){\n    if(latest.current.reviewed||latest.current.saving)return\n    const current=latest.current\n    const found=codesFromOcr(result,lookup)\n    if(found.length>1||(current.product&&found.length===1&&found[0]!==current.product.internal_code)){setError(\'Ασυμφωνία προϊόντος. Η ανάγνωση δεν εφαρμόστηκε.\');return}')
 s=replace(s,'&& !price)', '&& !price)') // checked below using actual compact source
 return s
})
// Compact scanner source uses no space before field guards.
edit('src/capture/SmartScanPane.tsx',s=>{
 s=replace(s,'size===1&&!price)','size===1&&!current.price)')
 s=replace(s,"if((!expiry||expirySource!=='gs1')&&","if(!current.expiry&&")
 s=replace(s,'if(!lot&&lots.length===1)','if(!current.lot&&lots.length===1)')
 s=replace(s,'const now=performance.now();if(ocrBusy.current','const rev=revision.current;const now=performance.now();if(latest.current.reviewed||latest.current.saving||ocrBusy.current')
 s=replace(s,'if(gen===generation.current)consumeOcr(result,blob)','if(gen===generation.current&&rev===revision.current)consumeOcr(result,blob)')
 s=replace(s,'    if(!canSave||!product)return','    if(!canSave||!product||saveLock.current)return\n    if(expiry&&(!Number.isFinite(Number(quantity.replace(\',\',\'.\')))||Number(quantity.replace(\',\',\'.\'))<0)){setError(\'Μη έγκυρη ποσότητα.\');return}\n    saveLock.current=true')
 s=replace(s,'quantity:expiry?Math.max(0,Number(quantity)||1):null','quantity:expiry?Number(quantity.replace(\',\',\'.\')):null')
 s=replace(s,'}finally{setSaving(false)}','}finally{saveLock.current=false;setSaving(false)}')
 s=replace(s,'    <div className="smart-fields">','    <label className="capture-field">Κωδικός ή barcode<input aria-label="Κωδικός ή barcode" value={manualCode} onChange={e=>{setManualCode(e.target.value);void consumeBarcode({text:e.target.value,format:\'Manual\'},true)}} /></label>\n    {product&&<div className="scan-result hit">{product.description}</div>}\n    <div className="smart-fields">')
 return s
})
for(const path of ['tests/capture-session.spec.ts','tests/iphone.spec.ts'])edit(path,s=>replace(s,"name: 'Τιμή ραφιού'","name: 'Μεμονωμένο OCR'"))
edit('tests/capture.spec.ts',s=>replace(s,"  await expect(page.getByText('SMART SCAN'","  await page.getByRole('button',{name:'Smart Scan',exact:true}).click()\n  await expect(page.getByText('SMART SCAN'"))
edit('tests/workspace.spec.ts',s=>replace(s,"  await page.getByLabel('Κωδικός ή barcode').fill('0000001')","  await page.getByRole('button',{name:'Smart Scan',exact:true}).click()\n  await page.getByLabel('Κωδικός ή barcode').fill('0000001')"))
edit('tests/expiry.spec.ts',s=>replace(s,"  await page.locator('.wk-nav').getByRole('button',{name:/Λήξεις/}).click()","  if(await page.locator('.wk-mobile-nav').isVisible())await page.locator('.wk-mobile-nav').getByRole('button',{name:'Λήξεις',exact:true}).click()\n  else await page.locator('.wk-nav').getByRole('button',{name:/Λήξεις/}).click()"))
edit('public/sw.js',s=>replace(s,'leaksy-static-v6','leaksy-static-v7'))
for(const path of ['package.json','package-lock.json']){const value=JSON.parse(fs.readFileSync(path,'utf8'));value.version='0.5.0';if(value.packages?.[''])value.packages[''].version='0.5.0';fs.writeFileSync(path,JSON.stringify(value,null,2)+'\n')}
console.log('Jev integration patched. Source build and regression tests are mandatory before promotion.')
