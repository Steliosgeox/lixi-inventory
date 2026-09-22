import type { OcrLine, OcrResult } from './domain'
import type { ExpiryKind } from '../lib/types'

export type ExpiryCandidate = {
  iso: string
  kind: ExpiryKind
  score: number | null
  text: string
  reason: string
  line: OcrLine
}

const fold=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim()
const EXPIRY=/(?:ΛΗΞ(?:Η|ΕΙ|ΕΩΣ)?|ΗΜΕΡΟΜΗΝΙΑ ΛΗΞΗΣ|ΑΝΑΛΩΣΗ ΕΩΣ|\bUSE\s*BY\b|\bEXP(?:IRY|IRATION)?\b|\bEXPIRES?\b)/u
const BEST=/(?:ΑΝΑΛΩΣΗ ΚΑΤΑ ΠΡΟΤΙΜΗΣΗ(?: ΠΡΙΝ(?: ΑΠΟ)?)?|\bBEST\s*BEFORE\b|\bBBE\b|\bBEST\s*BY\b)/u
const SELL=/(?:\bSELL\s*BY\b|ΠΩΛΗΣΗ ΕΩΣ)/u

function kindFor(text:string):ExpiryKind {
  const x=fold(text)
  if(BEST.test(x)) return 'best_before'
  if(SELL.test(x)) return 'sell_by'
  if(EXPIRY.test(x)) return 'expiry'
  return 'unknown'
}
function iso(y:number,m:number,d:number){
  if(y<1900||y>2200||m<1||m>12)return null
  const max=new Date(Date.UTC(y,m,0)).getUTCDate()
  if(d===0)d=max
  if(d<1||d>max)return null
  return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
}
function expandYear(y:number,now=new Date()){
  if(y>=100)return y
  const current=now.getUTCFullYear(), century=Math.floor(current/100)*100
  let full=century+y
  if(full>current+50)full-=100
  else if(full<current-50)full+=100
  return full
}
function plausible(value:string,now=new Date()){
  const t=Date.parse(value+'T00:00:00Z')
  if(!Number.isFinite(t))return false
  const min=Date.UTC(now.getUTCFullYear()-1,now.getUTCMonth(),now.getUTCDate())
  const max=Date.UTC(now.getUTCFullYear()+15,now.getUTCMonth(),now.getUTCDate())
  return t>=min&&t<=max
}
function parseDates(text:string,kind:ExpiryKind,now=new Date()):{iso:string;reason:string}[]{
  const out:{iso:string;reason:string}[]=[], seen=new Set<string>()
  const add=(value:string|null,reason:string)=>{if(value&&plausible(value,now)&&!seen.has(value)){seen.add(value);out.push({iso:value,reason})}}
  for(const m of text.matchAll(/(?<!\d)(20\d{2})[\/.\-](0?[1-9]|1[0-2])[\/.\-](0?[1-9]|[12]\d|3[01])(?!\d)/g))
    add(iso(+m[1],+m[2],+m[3]),'YYYY-MM-DD')
  for(const m of text.matchAll(/(?<!\d)(0?[1-9]|[12]\d|3[01])[\/.\-](0?[1-9]|1[0-2])[\/.\-](\d{2}|20\d{2})(?!\d)/g))
    add(iso(expandYear(+m[3],now),+m[2],+m[1]),'DD-MM-YYYY')
  // Month/year without a day is accepted only next to an expiry semantic marker.
  if(kind!=='unknown') for(const m of text.matchAll(/(?<!\d[\/.\-])(?<![\d.,])(0?[1-9]|1[0-2])[\/.\-](\d{2}|20\d{2})(?!\d)/g)){
    const y=expandYear(+m[2],now), month=+m[1]
    add(iso(y,month,0),'MM-YYYY (month end)')
  }
  // Compact YYMMDD is only accepted when the OCR window explicitly says expiry/best-before/sell-by.
  if(kind!=='unknown') for(const m of text.matchAll(/(?<!\d)(\d{2})(0[1-9]|1[0-2])([0-3]\d)(?!\d)/g))
    add(iso(expandYear(+m[1],now),+m[2],+m[3]),'YYMMDD')
  return out
}
function center(l:OcrLine){return l.box.y+l.box.height/2}
export function expiryCandidates(result:OcrResult,now=new Date()):ExpiryCandidate[]{
  const sorted=[...result.lines].sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x)
  const found:ExpiryCandidate[]=[]
  for(let i=0;i<sorted.length;i++){
    const line=sorted[i]
    const neighbours=[line]
    for(const j of [i-1,i+1]){
      const other=sorted[j]
      if(other&&Math.abs(center(other)-center(line))<=Math.max(line.box.height,other.box.height)*2.6)neighbours.push(other)
    }
    const window=neighbours.map(x=>x.text).join(' ')
    const kind=kindFor(window)
    // Unlabelled dates are too risky for automatic expiry suggestions.
    if(kind==='unknown')continue
    const scoreVals=neighbours.map(x=>x.score).filter((x):x is number=>x!=null&&Number.isFinite(x))
    const score=scoreVals.length?scoreVals.reduce((a,b)=>a+b,0)/scoreVals.length:null
    for(const parsed of parseDates(window,kind,now)) found.push({iso:parsed.iso,kind,score,text:window,reason:parsed.reason,line})
  }
  const unique=new Map<string,ExpiryCandidate>()
  for(const c of found){
    const key=`${c.kind}:${c.iso}`, prior=unique.get(key)
    if(!prior||(c.score??0)>(prior.score??0))unique.set(key,c)
  }
  return [...unique.values()].sort((a,b)=>(b.score??0)-(a.score??0)||a.iso.localeCompare(b.iso))
}

export function expiryStatus(date:string|null|undefined,days:number|null|undefined){
  if(!date||days==null)return 'untracked' as const
  if(days<0)return 'expired' as const
  if(days<=7)return 'critical' as const
  if(days<=30)return 'warning' as const
  if(days<=90)return 'monitor' as const
  return 'ok' as const
}

export function lotCandidates(result:OcrResult):{value:string;score:number|null;text:string}[]{
  const found:{value:string;score:number|null;text:string}[]=[]
  const seen=new Set<string>()
  for(const line of result.lines){
    const x=fold(line.text)
    const m=x.match(/(?:\bLOT(?:\s*(?:NO|NUMBER|#))?|\bΠΑΡΤΙΔΑ(?:Σ)?|\bΑΡ\.?\s*ΠΑΡΤΙΔΑΣ)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,30})/u)
    if(!m)continue
    const value=m[1].replace(/[.,;:]+$/,'')
    if(!seen.has(value)){seen.add(value);found.push({value,score:line.score,text:line.text})}
  }
  return found.sort((a,b)=>(b.score??0)-(a.score??0))
}
