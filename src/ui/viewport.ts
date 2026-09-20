/** Keep fixed dialogs inside the visible viewport without fighting native page scroll.
 * CSS safe-area insets remain the source of truth for the notch/home indicator.
 * No UA-specific pixel offsets and no forced zoom or scroll resets.
 */
export function installViewportEnvironment(): () => void {
  const root = document.documentElement
  const viewport = window.visualViewport
  const standalone = window.matchMedia('(display-mode: standalone)')
  const touch = window.matchMedia('(any-pointer: coarse)')
  let frame = 0
  let disposed = false
  const editable = () => {
    const el = document.activeElement
    if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled
    if (el instanceof HTMLInputElement) return !el.readOnly && !el.disabled && /^(text|search|email|password|tel|url|number)$/.test(el.type)
    return el instanceof HTMLElement && el.isContentEditable
  }
  const update = () => {
    frame = 0
    if (disposed) return
    root.dataset.standalone = String(standalone.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)
    // Pinch zoom is not a keyboard. Leave the browser in control of magnification.
    const unzoomed = !viewport || Math.abs(viewport.scale - 1) < 0.05
    const keyboard = !!viewport && unzoomed && touch.matches && editable() && window.innerHeight - viewport.height > 140
    root.dataset.keyboard = String(keyboard)
    if (unzoomed && viewport) {
      root.style.setProperty('--visual-height', `${Math.round(viewport.height)}px`)
      root.style.setProperty('--visual-top', `${Math.max(0, Math.round(viewport.offsetTop))}px`)
    } else {
      root.style.removeProperty('--visual-height')
      root.style.removeProperty('--visual-top')
    }
  }
  const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(update) }
  viewport?.addEventListener('resize', schedule)
  viewport?.addEventListener('scroll', schedule)
  window.addEventListener('resize', schedule)
  window.addEventListener('pageshow', schedule)
  document.addEventListener('focusin', schedule)
  document.addEventListener('focusout', schedule)
  document.addEventListener('visibilitychange', schedule)
  standalone.addEventListener('change', schedule)
  update()
  return () => {
    disposed = true
    cancelAnimationFrame(frame)
    viewport?.removeEventListener('resize', schedule)
    viewport?.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    window.removeEventListener('pageshow', schedule)
    document.removeEventListener('focusin', schedule)
    document.removeEventListener('focusout', schedule)
    document.removeEventListener('visibilitychange', schedule)
    standalone.removeEventListener('change', schedule)
    root.style.removeProperty('--visual-height')
    root.style.removeProperty('--visual-top')
    delete root.dataset.keyboard
    delete root.dataset.standalone
  }
}
