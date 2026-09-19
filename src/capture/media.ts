import type { Box } from './domain'
export type PreparedImage = { blob: Blob; width: number; height: number; warnings: string[]; sha256: string }
export async function blobHash(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2,'0')).join('')
}
export async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob), image = new Image()
  try { image.src = url; await image.decode(); return image }
  catch { throw new Error('Η εικόνα δεν διαβάζεται. Δοκίμασε JPEG ή PNG από την κάμερα.') }
  finally { URL.revokeObjectURL(url) }
}
export async function prepareImage(file: Blob, crop?: Box, rotation = 0): Promise<PreparedImage> {
  if (!file.type.startsWith('image/') || file.type.includes('svg') || file.size > 20 * 1024 * 1024) throw new Error('Χρησιμοποίησε φωτογραφία έως 20 MB, όχι SVG.')
  const img = await loadImage(file)
  if (img.naturalWidth * img.naturalHeight > 40_000_000) throw new Error('Πολύ μεγάλη εικόνα. Μείωσε την ανάλυση πριν την εισαγωγή.')
  const c = crop ?? { x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight }
  if (c.width < 60 || c.height < 40 || c.x < 0 || c.y < 0 || c.x+c.width > img.naturalWidth+1 || c.y+c.height > img.naturalHeight+1) throw new Error('Επίλεξε μεγαλύτερη, έγκυρη περιοχή στην εικόνα.')
  const scale = Math.min(1, 2000 / Math.max(c.width, c.height))
  const sw = Math.round(c.width * scale), sh = Math.round(c.height * scale)
  const canvas = document.createElement('canvas'), quarter = rotation % 180 !== 0
  canvas.width = quarter ? sh : sw; canvas.height = quarter ? sw : sh
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height)
  ctx.translate(canvas.width/2,canvas.height/2); ctx.rotate(rotation * Math.PI/180)
  ctx.drawImage(img,c.x,c.y,c.width,c.height,-sw/2,-sh/2,sw,sh)
  // Cheap, advisory acquisition checks. They are not calibrated OCR confidence scores.
  const small = document.createElement('canvas'); small.width = 256; small.height = Math.max(1,Math.round(256*canvas.height/canvas.width))
  const sc = small.getContext('2d',{willReadFrequently:true})!; sc.drawImage(canvas,0,0,small.width,small.height)
  const data = sc.getImageData(0,0,small.width,small.height).data
  let total=0, bright=0, dark=0, edge=0
  for (let i=0;i<data.length;i+=4) { const v=(data[i]+data[i+1]+data[i+2])/3; total+=v; if(v>250) bright++; if(v<25) dark++; if(i>=4) edge+=Math.abs(v-(data[i-4]+data[i-3]+data[i-2])/3) }
  const n=data.length/4, warnings:string[]=[]
  if(total/n<65 || dark/n>.6) warnings.push('Χαμηλός φωτισμός. Πρόσθεσε φως και απόφυγε σκιές.')
  if(bright/n>.85) warnings.push('Πολύ φωτεινή περιοχή. Έλεγξε αντανακλάσεις και χαμένα γράμματα.')
  if(edge/n<3) warnings.push('Λίγη λεπτομέρεια. Πλησίασε ή εστίασε καλύτερα.')
  if(Math.min(sw,sh)<150) warnings.push('Μικρή περιοχή. Χρειάζεται κοντινότερη φωτογραφία.')
  const blob = await new Promise<Blob>((resolve,reject) => canvas.toBlob(b=>b?resolve(b):reject(new Error('Αποτυχία προετοιμασίας εικόνας.')),'image/jpeg',.92))
  return { blob, width: canvas.width, height: canvas.height, warnings, sha256: await blobHash(blob) }
}
