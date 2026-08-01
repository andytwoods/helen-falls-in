// Directional controls: touch/click the LEFT half of the screen to lean left,
// the RIGHT half to lean right; ← / → on a keyboard. Space still works the old
// one-button way (direction auto-sampled from the visible lean). Multiple
// sources can be held at once — the most recent wins, and releasing one falls
// back to whatever is still held. A missed release is a fatal stuck hold, so
// pointercancel / blur / visibilitychange all force-release everything.

export interface ControlHandlers {
  // dir: -1 lean left, +1 lean right, 0 = auto-sample (legacy one-button)
  onDown: (dir: -1 | 0 | 1) => void;
  onUp: () => void;
}

export function attachControls(surface: HTMLElement, handlers: ControlHandlers): void {
  const active: Array<{ id: string; dir: -1 | 0 | 1 }> = [];

  const push = (id: string, dir: -1 | 0 | 1) => {
    const i = active.findIndex((a) => a.id === id);
    if (i >= 0) active.splice(i, 1);
    active.push({ id, dir });
    handlers.onDown(dir);
  };
  const pop = (id: string) => {
    const i = active.findIndex((a) => a.id === id);
    if (i < 0) return;
    const wasTop = i === active.length - 1;
    active.splice(i, 1);
    if (active.length === 0) handlers.onUp();
    else if (wasTop) handlers.onDown(active[active.length - 1]!.dir); // fall back
  };
  const clearAll = () => {
    if (active.length === 0) return;
    active.length = 0;
    handlers.onUp();
  };

  surface.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    surface.setPointerCapture(e.pointerId);
    push(`p${e.pointerId}`, e.clientX < window.innerWidth / 2 ? -1 : 1);
  });
  surface.addEventListener('pointerup', (e) => {
    e.preventDefault();
    pop(`p${e.pointerId}`);
  });
  surface.addEventListener('pointercancel', (e) => pop(`p${e.pointerId}`));
  surface.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'ArrowLeft') {
      e.preventDefault();
      push('kl', -1);
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      push('kr', 1);
    } else if (e.code === 'Space') {
      e.preventDefault();
      push('ks', 0);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft') pop('kl');
    else if (e.code === 'ArrowRight') pop('kr');
    else if (e.code === 'Space') pop('ks');
  });

  window.addEventListener('blur', clearAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearAll();
  });
}
