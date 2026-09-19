declare module 'onscan.js' {
  const scanner: { attachTo:(target:HTMLElement|Document, options:Record<string,unknown>)=>void; detachFrom:(target:HTMLElement|Document)=>void; isAttachedTo:(target:HTMLElement|Document)=>boolean }
  export default scanner
}
