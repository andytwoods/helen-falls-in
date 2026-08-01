// Per-run telemetry: seed + input log make any death replayable; summaries feed tuning.

import type { Params } from './params';

export interface InputEvent {
  t: number;
  type: 'down' | 'up';
}

export interface RunRecord {
  seed: number;
  duration: number;
  cause: 'canal' | 'ditch' | 'tree' | 'bush' | 'hedge';
  taps: number;
  meanTapRateHz: number;
  inputs: InputEvent[];
  params: Params;
}

const MAX_RUNS = 100;

export class Telemetry {
  runs: RunRecord[] = [];
  private inputs: InputEvent[] = [];

  startRun(): void {
    this.inputs = [];
  }

  logInput(t: number, type: 'down' | 'up'): void {
    this.inputs.push({ t, type });
  }

  endRun(seed: number, duration: number, cause: RunRecord['cause'], params: Params): RunRecord {
    const taps = this.inputs.filter((e) => e.type === 'down').length;
    const record: RunRecord = {
      seed,
      duration,
      cause,
      taps,
      meanTapRateHz: duration > 0 ? taps / duration : 0,
      inputs: this.inputs,
      params: { ...params },
    };
    this.runs.push(record);
    if (this.runs.length > MAX_RUNS) this.runs.shift();
    return record;
  }

  download(): void {
    const blob = new Blob([JSON.stringify(this.runs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `helen-runs-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
