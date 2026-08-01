// The journey: West Byfleet to Godalming along the Wey Navigation, pub to pub.
// ~55,000px at ~90px/s ≈ ten minutes of riding, five legs of roughly two
// minutes each. Reaching a pub unlocks it as a future starting point; falling
// in is not the end — Helen climbs out and rides on.

export interface Pub {
  name: string;
  d: number; // forward distance, px
}

export const PUBS: Pub[] = [
  { name: 'West Byfleet', d: 0 },
  { name: 'The Anchor, Pyrford Lock', d: 11000 },
  { name: 'The New Inn, Send', d: 22000 },
  { name: 'The White House, Guildford', d: 33000 },
  { name: 'The Parrot, Shalford', d: 44000 },
  { name: 'The Star, Godalming', d: 55000 },
];

export const TOTAL_D = PUBS[PUBS.length - 1]!.d;

const UNLOCK_KEY = 'hfi-pub';
const BEST_KEY = 'hfi-journey-best';

export function unlockedPub(): number {
  return Math.min(PUBS.length - 1, Number(localStorage.getItem(UNLOCK_KEY) ?? '0'));
}

export function unlockPub(index: number): void {
  if (index > unlockedPub()) localStorage.setItem(UNLOCK_KEY, String(index));
}

export interface JourneyBest {
  timeS: number;
  falls: number;
}

export function journeyBest(): JourneyBest | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    return raw ? (JSON.parse(raw) as JourneyBest) : null;
  } catch {
    return null;
  }
}

// Record a full West Byfleet → Godalming run; keeps the fastest.
export function recordJourney(timeS: number, falls: number): void {
  const prev = journeyBest();
  if (!prev || timeS < prev.timeS) {
    localStorage.setItem(BEST_KEY, JSON.stringify({ timeS, falls }));
  }
}

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60)
    .toString()
    .padStart(2, '0')}`;
}
