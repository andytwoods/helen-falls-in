// Minimal chrome: just the sound toggle. (The greybox tuning panel was removed
// for release — tuning lives in params.ts defaults and the harness; the panel
// survives in git history if it's ever needed again.)

export function attachHapticsToggle(h: { muted: boolean; toggleMuted(): boolean }): void {
  const btn = document.getElementById('haptics-toggle')!;
  const label = () => (btn.textContent = h.muted ? '📴' : '📳');
  label();
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('pointerup', (e) => e.stopPropagation());
  btn.addEventListener('click', () => {
    h.toggleMuted();
    label();
    (btn as HTMLButtonElement).blur();
  });
}

export function attachSoundToggle(sound: { muted: boolean; toggleMuted(): boolean }): void {
  const btn = document.getElementById('sound-toggle')!;
  const label = () => (btn.textContent = sound.muted ? '🔇' : '🔊');
  label();
  // presses on the button must never reach the steering surface
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('pointerup', (e) => e.stopPropagation());
  btn.addEventListener('click', () => {
    sound.toggleMuted();
    label();
    (btn as HTMLButtonElement).blur(); // or the spacebar would re-toggle it
  });
}
