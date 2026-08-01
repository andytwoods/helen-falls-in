// Tuning panel: one slider per constant, persisted to localStorage, exportable as JSON.

import { DEFAULT_PARAMS, SLIDER_SPECS, type Params } from './params';

// Versioned: bump when retuning defaults, so stale saved params don't mask them.
const STORAGE_KEY = 'hfi-params-v2';

export function loadParams(): Params {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return { ...DEFAULT_PARAMS };
  try {
    return { ...DEFAULT_PARAMS, ...(JSON.parse(stored) as Partial<Params>) };
  } catch {
    return { ...DEFAULT_PARAMS };
  }
}

export function buildPanel(
  params: Params,
  onDownloadRuns: () => void,
  sound: { muted: boolean; toggleMuted(): boolean },
): void {
  const panel = document.getElementById('panel')!;
  const toggle = document.getElementById('panel-toggle')!;

  toggle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    panel.classList.toggle('open');
  });
  // Interactions inside the panel must never reach the steering surface.
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  panel.addEventListener('pointerup', (e) => e.stopPropagation());

  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(params));

  const rows: Array<() => void> = [];
  for (const spec of SLIDER_SPECS) {
    const row = document.createElement('label');
    row.className = 'slider-row';

    const name = document.createElement('span');
    name.textContent = spec.label;

    const value = document.createElement('span');
    value.className = 'slider-value';

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);

    const refresh = () => {
      input.value = String(params[spec.key]);
      value.textContent = String(params[spec.key]);
    };
    rows.push(refresh);
    refresh();

    input.addEventListener('input', () => {
      params[spec.key] = Number(input.value);
      value.textContent = input.value;
      save();
    });

    row.append(name, value, input);
    panel.appendChild(row);
  }

  const buttons = document.createElement('div');
  buttons.className = 'panel-buttons';

  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset defaults';
  resetBtn.addEventListener('click', () => {
    Object.assign(params, DEFAULT_PARAMS);
    save();
    rows.forEach((r) => r());
  });

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy params JSON';
  copyBtn.addEventListener('click', () => {
    void navigator.clipboard.writeText(JSON.stringify(params, null, 2));
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = 'Copy params JSON'), 1000);
  });

  const runsBtn = document.createElement('button');
  runsBtn.textContent = 'Download run telemetry';
  runsBtn.addEventListener('click', onDownloadRuns);

  const soundBtn = document.createElement('button');
  soundBtn.textContent = sound.muted ? 'Sound: off' : 'Sound: on';
  soundBtn.addEventListener('click', () => {
    soundBtn.textContent = sound.toggleMuted() ? 'Sound: off' : 'Sound: on';
  });

  buttons.append(resetBtn, copyBtn, runsBtn, soundBtn);
  panel.appendChild(buttons);
}
