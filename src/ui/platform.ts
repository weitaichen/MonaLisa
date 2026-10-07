// Small platform probes and the iOS haptics trick (RB §1 #18).

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

let hapticLabel: HTMLLabelElement | null = null;
const hapticsSupported = typeof HTMLInputElement !== 'undefined' && 'switch' in HTMLInputElement.prototype;

/**
 * Light tap feedback via a hidden <input type=checkbox switch> (Safari 17.4+). Since iOS 26.5 it only
 * fires inside a real tap, so call it from tap handlers only — never from slider movement.
 */
export function haptic(): void {
  if (!hapticsSupported) return;
  if (!hapticLabel) {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;left:-40px;top:0;width:1px;height:1px;opacity:0;overflow:hidden';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    hapticLabel = label;
  }
  hapticLabel.click();
}
