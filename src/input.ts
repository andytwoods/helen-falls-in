// One button. Pointer events on the game surface + spacebar. A missed release is a
// fatal stuck hold, so pointercancel / blur / visibilitychange all force-release.

export interface ButtonHandlers {
  onDown: () => void;
  onUp: () => void;
}

export function attachButton(surface: HTMLElement, handlers: ButtonHandlers): void {
  let down = false;

  const setDown = (d: boolean) => {
    if (d === down) return;
    down = d;
    if (d) handlers.onDown();
    else handlers.onUp();
  };

  surface.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    surface.setPointerCapture(e.pointerId);
    setDown(true);
  });
  surface.addEventListener('pointerup', (e) => {
    e.preventDefault();
    setDown(false);
  });
  surface.addEventListener('pointercancel', () => setDown(false));
  surface.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat) return;
    if (e.target instanceof HTMLInputElement) return; // don't steer from a focused slider
    e.preventDefault();
    setDown(true);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return;
    setDown(false);
  });

  window.addEventListener('blur', () => setDown(false));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setDown(false);
  });
}
