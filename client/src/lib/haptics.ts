function vibrate(pattern: number | number[]): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {}
  }
}

export function hapticLight(): void {
  vibrate(10);
}

export function hapticMedium(): void {
  vibrate(20);
}

export function hapticSuccess(): void {
  vibrate([10, 50, 10]);
}

export function hapticError(): void {
  vibrate([20, 100, 20]);
}
