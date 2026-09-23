export type LiveBarcode={text:string;format:string;symbologyIdentifier?:string}

export function validGtin(value:string):boolean{
  const s=value.trim()
  if(!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(s))return false
  let sum=0
  for(let i=s.length-2,w=3;i>=0;i--,w=4-w)sum+=Number(s[i])*w
  return (10-sum%10)%10===Number(s.at(-1))
}

export function pickLiveBarcode(codes:LiveBarcode[]):string|null{
  const numeric=codes.map(c=>c.text.trim()).find(validGtin)
  return numeric??null
}

export function normalizeGtin(value:string):string{
  return value.replace(/^0+/,'').padStart(14,'0')
}

export function sameGtin(a:string|null|undefined,b:string|null|undefined):boolean{
  return !!a&&!!b&&normalizeGtin(a)===normalizeGtin(b)
}

export function canAcceptScan(code:string,last:{code:string;at:number}|null,now=Date.now(),cooldownMs=3500):boolean{
  return !last||last.code!==code||now-last.at>=cooldownMs
}

export async function videoFrame(video:HTMLVideoElement,maxSide=960,quality=.72):Promise<Blob|null>{
  if(!video.videoWidth||!video.videoHeight)return null
  const scale=Math.min(1,maxSide/Math.max(video.videoWidth,video.videoHeight))
  const canvas=document.createElement('canvas')
  canvas.width=Math.max(1,Math.round(video.videoWidth*scale))
  canvas.height=Math.max(1,Math.round(video.videoHeight*scale))
  const context=canvas.getContext('2d',{alpha:false})
  if(!context)return null
  context.drawImage(video,0,0,canvas.width,canvas.height)
  return new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality))
}
