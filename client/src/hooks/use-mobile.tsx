import * as React from "react"

const MOBILE_BREAKPOINT = 768
export function shouldUseMobileLayout(viewportWidth: number, screenWidth: number, screenHeight: number, coarsePointer: boolean) {
  const shortSide = Math.min(screenWidth, screenHeight)
  return viewportWidth < MOBILE_BREAKPOINT || (coarsePointer && shortSide > 0 && shortSide < 600)
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(() => {
    if (typeof window === "undefined") return false
    return shouldUseMobileLayout(window.innerWidth, window.screen.width, window.screen.height, window.matchMedia("(pointer: coarse)").matches)
  })

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const coarse = window.matchMedia("(pointer: coarse)")
    // A phone rotated sideways has a wide viewport, but its physical screen
    // remains phone-sized. Do not use viewport height here: the keyboard can
    // shrink it and must not change the shell into desktop navigation.
    const onChange = () => setIsMobile(shouldUseMobileLayout(window.innerWidth, window.screen.width, window.screen.height, coarse.matches))
    mql.addEventListener("change", onChange)
    coarse.addEventListener("change", onChange)
    window.addEventListener("resize", onChange)
    window.addEventListener("orientationchange", onChange)
    onChange()
    return () => {
      mql.removeEventListener("change", onChange)
      coarse.removeEventListener("change", onChange)
      window.removeEventListener("resize", onChange)
      window.removeEventListener("orientationchange", onChange)
    }
  }, [])

  return !!isMobile
}

/** The manifest cannot express "portrait for phones, unchanged for tablets". */
export function usePhonePortraitPreference() {
  React.useEffect(() => {
    const shortSide = Math.min(window.screen.width, window.screen.height)
    const phone = shortSide > 0 && shortSide < 600 && window.matchMedia("(pointer: coarse)").matches
    const installed = window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    const orientation = window.screen.orientation as ScreenOrientation & { lock?: (value: string) => Promise<void> }
    if (!phone || !installed || !orientation?.lock) return
    let disposed = false
    let locked = false
    void orientation.lock("portrait").then(() => {
      locked = true
      if (disposed) orientation.unlock()
    }).catch(() => {
      // Browsers may require native/fullscreen privileges. The phone landscape
      // layout remains usable; never cover the page with a rotate-screen gate.
    })
    return () => { disposed = true; if (locked) orientation.unlock() }
  }, [])
}
