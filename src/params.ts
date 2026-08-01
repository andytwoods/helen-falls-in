// Steering-model constants — see docs/STEERING.md. Lateral units: path half-width = 1.

export interface Params {
  initialCorrection: number;
  correctionRamp: number;
  maxCorrection: number;
  steerResponse: number;
  steerReturn: number;
  steeringAcceleration: number;
  lateralDrag: number;
  predictionTime: number;
  centreDeadzone: number;
  velocityDeadzone: number;
  resampleCooldown: number;
  leanDeadzone: number;
  noiseTau: number;
  noiseSigma: number;
  wobbleStrength: number;
  driftTau: number;
  driftSigma: number;
  driftStrength: number;
  grassStart: number;
  grassControlScale: number;
  grassWobbleScale: number;
  vergeControlScale: number;
  vergeWobbleScale: number;
  grooveGrip: number;
  rockKick: number;
  bumpKick: number;
  downhillBoost: number;
  difficultyRamp: number;
  forwardSpeed: number;
  meanderAmount: number;
  narrowAmount: number;
}

export const DEFAULT_PARAMS: Params = {
  initialCorrection: 0.10,
  correctionRamp: 2.2,
  maxCorrection: 1.0,
  steerResponse: 0.09,
  steerReturn: 0.18,
  steeringAcceleration: 3.0,
  lateralDrag: 0.75,
  predictionTime: 0.06,
  centreDeadzone: 0.025,
  velocityDeadzone: 0.03,
  resampleCooldown: 0.15,
  leanDeadzone: 0.02,
  noiseTau: 0.30,
  noiseSigma: 1.3,
  wobbleStrength: 0.34,
  driftTau: 2.5,
  driftSigma: 0.22,
  driftStrength: 0.34,
  grassStart: 0.82,
  grassControlScale: 0.55,
  grassWobbleScale: 1.5,
  vergeControlScale: 0.35,
  vergeWobbleScale: 2.8,
  grooveGrip: 8,
  rockKick: 2.0,
  bumpKick: 0.6,
  downhillBoost: 1.35,
  difficultyRamp: 0.018,
  forwardSpeed: 90,
  meanderAmount: 0.35,
  narrowAmount: 0.7,
};

export interface SliderSpec {
  key: keyof Params;
  label: string;
  min: number;
  max: number;
  step: number;
}

export const SLIDER_SPECS: SliderSpec[] = [
  { key: 'initialCorrection', label: 'initial correction', min: 0, max: 0.5, step: 0.01 },
  { key: 'correctionRamp', label: 'correction ramp /s', min: 0, max: 8, step: 0.1 },
  { key: 'maxCorrection', label: 'max correction', min: 0.2, max: 2, step: 0.05 },
  { key: 'steerResponse', label: 'steer response s', min: 0.02, max: 0.4, step: 0.005 },
  { key: 'steerReturn', label: 'steer return s', min: 0.02, max: 0.6, step: 0.005 },
  { key: 'steeringAcceleration', label: 'steer accel', min: 0.5, max: 8, step: 0.1 },
  { key: 'lateralDrag', label: 'lateral drag /s', min: 0, max: 3, step: 0.05 },
  { key: 'predictionTime', label: 'prediction s', min: 0, max: 0.2, step: 0.005 },
  { key: 'centreDeadzone', label: 'centre deadzone', min: 0, max: 0.15, step: 0.005 },
  { key: 'velocityDeadzone', label: 'velocity deadzone', min: 0, max: 0.2, step: 0.005 },
  { key: 'resampleCooldown', label: 'resample cooldown s', min: 0, max: 0.4, step: 0.01 },
  { key: 'leanDeadzone', label: 'lean deadzone rad', min: 0, max: 0.2, step: 0.005 },
  { key: 'noiseTau', label: 'noise tau s', min: 0.05, max: 1, step: 0.01 },
  { key: 'noiseSigma', label: 'noise sigma', min: 0, max: 4, step: 0.05 },
  { key: 'wobbleStrength', label: 'wobble strength', min: 0, max: 1.5, step: 0.01 },
  { key: 'driftTau', label: 'drift tau s', min: 0.3, max: 6, step: 0.1 },
  { key: 'driftSigma', label: 'drift sigma', min: 0, max: 1, step: 0.01 },
  { key: 'driftStrength', label: 'drift strength', min: 0, max: 1.5, step: 0.01 },
  { key: 'grassStart', label: 'grass start |x|', min: 0.5, max: 0.95, step: 0.01 },
  { key: 'grassControlScale', label: 'grass control ×', min: 0.1, max: 1, step: 0.05 },
  { key: 'grassWobbleScale', label: 'grass wobble ×', min: 1, max: 3, step: 0.1 },
  { key: 'vergeControlScale', label: 'verge control ×', min: 0.1, max: 1, step: 0.05 },
  { key: 'vergeWobbleScale', label: 'verge wobble ×', min: 1, max: 5, step: 0.1 },
  { key: 'grooveGrip', label: 'groove grip /s²/px', min: 0, max: 20, step: 0.5 },
  { key: 'rockKick', label: 'rock kick units/s', min: 0, max: 6, step: 0.1 },
  { key: 'bumpKick', label: 'bump kick units/s', min: 0, max: 2, step: 0.05 },
  { key: 'downhillBoost', label: 'downhill boost ×', min: 1, max: 1.8, step: 0.05 },
  { key: 'difficultyRamp', label: 'difficulty ramp /s', min: 0, max: 0.05, step: 0.001 },
  { key: 'forwardSpeed', label: 'forward speed px/s', min: 40, max: 200, step: 5 },
  { key: 'meanderAmount', label: 'meander amount', min: 0, max: 1.5, step: 0.05 },
  { key: 'narrowAmount', label: 'narrow amount', min: 0, max: 1.5, step: 0.05 },
];
