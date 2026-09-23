/*
 * Adapted from marmelab/atomic-crm Mobile PullToRefresh (MIT).
 * See THIRD_PARTY_NOTICES.md.
 */
import { useCallback,useEffect,useRef,useState } from 'react'
import { ArrowClockwise,CircleNotch } from '@phosphor-icons/react'

const GESTURE_SLOP=8
const DRAG_RESISTANCE=.5
const TRIGGER_DISTANCE=64
const MAX_DISTANCE=96

function isScrollGesture(target:EventTarget|null){
  if(window.scrollY>0)return true
  let node=target instanceof Element?target:null
  if(node?.closest('[role="dialog"], [data-radix-popper-content-wrapper]'))return true
  while(node){if((node as HTMLElement).scrollTop>0)return true;node=node.parentElement}
  return false
}

export default function PullToRefresh({refresh,refreshing}:{refresh:()=>void|Promise<void>;refreshing:boolean}){
  const [distance,setDistance]=useState(0)
  const distanceRef=useRef(0),refreshingRef=useRef(refreshing),startYRef=useRef<number|null>(null)
  useEffect(()=>{refreshingRef.current=refreshing},[refreshing])
  const moveTo=useCallback((value:number)=>{distanceRef.current=value;setDistance(value)},[])
  const run=useCallback(async()=>{
    if(refreshingRef.current)return
    refreshingRef.current=true;moveTo(TRIGGER_DISTANCE)
    try{await refresh()}finally{refreshingRef.current=false;moveTo(0)}
  },[moveTo,refresh])

  useEffect(()=>{
    if(!window.matchMedia('(max-width: 760px)').matches)return
    const start=(e:TouchEvent)=>{
      if(e.touches.length!==1||refreshingRef.current||isScrollGesture(e.target)){startYRef.current=null;if(!refreshingRef.current)moveTo(0);return}
      startYRef.current=e.touches[0].clientY
    }
    const move=(e:TouchEvent)=>{
      if(startYRef.current===null)return
      const delta=e.touches[0].clientY-startYRef.current
      if(delta<=GESTURE_SLOP){moveTo(0);return}
      moveTo(Math.min(MAX_DISTANCE,(delta-GESTURE_SLOP)*DRAG_RESISTANCE))
    }
    const end=()=>{
      const started=startYRef.current!==null;startYRef.current=null
      if(refreshingRef.current)return
      if(started&&distanceRef.current>=TRIGGER_DISTANCE)void run();else moveTo(0)
    }
    const cancel=()=>{startYRef.current=null;moveTo(0)}
    document.addEventListener('touchstart',start,{passive:true})
    document.addEventListener('touchmove',move,{passive:true})
    document.addEventListener('touchend',end,{passive:true})
    document.addEventListener('touchcancel',cancel,{passive:true})
    return()=>{document.removeEventListener('touchstart',start);document.removeEventListener('touchmove',move);document.removeEventListener('touchend',end);document.removeEventListener('touchcancel',cancel)}
  },[moveTo,run])

  if(distance===0&&!refreshing)return null
  const progress=Math.min(1,distance/TRIGGER_DISTANCE)
  return <div aria-hidden="true" className="atomic-pull-refresh"><div style={{transform:'translateY('+distance+'px)',opacity:refreshing?1:progress}}>{refreshing?<CircleNotch size={19} className="wk-spin"/>:<ArrowClockwise size={19} style={{transform:'rotate('+(progress*270)+'deg)'}}/>}</div></div>
}
