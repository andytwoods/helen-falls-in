// Haptic pulses that mirror the percussive feedback — real taptics in the
// native apps via Capacitor, navigator.vibrate on the mobile web, silently
// nothing on desktop. Fire-and-forget: a missing engine must never break play.
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

const STORAGE_KEY = 'hfi-haptics-muted';

const quiet = (p: Promise<unknown>): void => void p.catch(() => {});

class GameHaptics {
  muted = localStorage.getItem(STORAGE_KEY) === '1';

  toggleMuted(): boolean {
    this.muted = !this.muted;
    localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0');
    if (!this.muted) quiet(Haptics.impact({ style: ImpactStyle.Light })); // felt confirmation
    return this.muted;
  }

  // road bumps, grooves, tree roots — a light tap, felt more than noticed
  thud(): void {
    if (!this.muted) quiet(Haptics.impact({ style: ImpactStyle.Light }));
  }

  // a rock throwing the bike, a poo finding its mark — a firmer knock
  jolt(): void {
    if (!this.muted) quiet(Haptics.impact({ style: ImpactStyle.Medium }));
  }

  // going into the canal / ditch / a tree — a proper jolt
  crash(): void {
    if (!this.muted) quiet(Haptics.impact({ style: ImpactStyle.Heavy }));
  }

  // reaching a pub — a gentle success pattern
  bell(): void {
    if (!this.muted) quiet(Haptics.notification({ type: NotificationType.Success }));
  }
}

export const haptics = new GameHaptics();
