import { GS1encoder } from 'gs1encoder'
import type { ExpiryKind } from '../lib/types'

export type Gs1Capture = {
  gtin: string | null
  expiryDate: string | null
  expiryKind: ExpiryKind | null
  lot: string | null
  serial: string | null
  hri: string[]
}

let encoderPromise: Promise<GS1encoder> | null = null
let queue: Promise<unknown> = Promise.resolve()
const encoder=()=>encoderPromise??=(GS1encoder.create())

function expandYear(two:number,now=new Date()){
  const current=now.getUTCFullYear(),century=Math.floor(current/100)*100
  let full=century+two
  if(full>current+50)full-=100
  else if(full<current-50)full+=100
  return full
}
export function gs1Date(value:string,now=new Date()):string|null{
  if(!/^\d{6}$/.test(value))return null
  const y=expandYear(Number(value.slice(0,2)),now),m=Number(value.slice(2,4))
  let d=Number(value.slice(4,6))
  if(m<1||m>12)return null
  const max=new Date(Date.UTC(y,m,0)).getUTCDate()
  if(d===0)d=max
  if(d<1||d>max)return null
  return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
}
export function parseGs1Hri(hri:string[],now=new Date()):Gs1Capture{
  const fields=new Map<string,string>()
  for(const line of hri){
    const m=line.match(/^\((\d{2,4})\)\s*(.*)$/)
    if(m&&!fields.has(m[1]))fields.set(m[1],m[2].trim())
  }
  const dateAI=fields.has('17')?'17':fields.has('15')?'15':fields.has('16')?'16':null
  return {
    gtin: fields.get('01')??null,
    expiryDate: dateAI?gs1Date(fields.get(dateAI)??'',now):null,
    expiryKind: dateAI==='17'?'expiry':dateAI==='15'?'best_before':dateAI==='16'?'sell_by':null,
    lot: fields.get('10')??null,
    serial: fields.get('21')??null,
    hri,
  }
}
export function scanDataString(input:{text:string;format?:string;symbologyIdentifier?:string;bytes?:number[]}):string|null{
  const raw=input.bytes?.length&&input.bytes.every(x=>x>=0&&x<128)
    ?String.fromCharCode(...input.bytes)
    :input.text
  if(!raw)return null
  if(/^\][A-Za-z0-9]{2}/.test(raw))return raw
  if(input.symbologyIdentifier)return input.symbologyIdentifier+raw
  if(input.format==='DataMatrix')return ']d2'+raw
  if(input.format==='QRCode')return ']Q3'+raw
  if(input.format==='Code128'&&raw.includes(String.fromCharCode(29)))return ']C1'+raw
  return null
}
export async function parseGs1Scan(input:{text:string;format?:string;symbologyIdentifier?:string;bytes?:number[]},now=new Date()):Promise<Gs1Capture|null>{
  const scan=scanDataString(input)
  if(!scan)return null
  const run=async()=>{
    const e=await encoder()
    try{
      e.scanData=scan
      const parsed=parseGs1Hri(e.hri,now)
      return parsed.gtin||parsed.expiryDate||parsed.lot?parsed:null
    }catch{return null}
  }
  const next=queue.then(run,run)
  queue=next.then(()=>undefined,()=>undefined)
  return next
}
