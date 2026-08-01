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

// (The greybox slider specs were removed with the tuning panel at release —
// see git history. Tuning changes go through these defaults + the harness.)
