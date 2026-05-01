export type SceneParams = {
  /** particles spawned per second from screen edges (engine queue drain rate) */
  spawnRate: number;
  /** px/s² acceleration toward orb center (negative = orbital) */
  gravityToCenter: number;
  /** velocity decay per second; 1.0 = no drag, 0.9 = strong drag */
  drag: number;
  /** number of prior frames retained for streak rendering (0..8) */
  trailLength: number;
  /** baseline orbiting particle count (Step 4 only) */
  ambientCount: number;
  /** modulates the orb's outer glow radius (0.6..2.0) */
  orbGlowMultiplier: number;
};

export const WELCOME: SceneParams = {
  spawnRate: 0.3,
  gravityToCenter: 0,
  drag: 1.0,
  trailLength: 0,
  ambientCount: 0,
  orbGlowMultiplier: 1.0,
};

export const CONNECT_IDLE: SceneParams = {
  spawnRate: 0.5,
  gravityToCenter: 0,
  drag: 1.0,
  trailLength: 0,
  ambientCount: 0,
  orbGlowMultiplier: 1.0,
};

export const CONNECT_VALIDATED: SceneParams = {
  spawnRate: 1.5,
  gravityToCenter: 200,
  drag: 0.95,
  trailLength: 2,
  ambientCount: 0,
  orbGlowMultiplier: 1.3,
};

export const IMPORT_PEAK: SceneParams = {
  spawnRate: 30,
  gravityToCenter: 600,
  drag: 0.9,
  trailLength: 6,
  ambientCount: 0,
  orbGlowMultiplier: 1.6,
};

export const IMPORT_CALMED: SceneParams = {
  spawnRate: 4,
  gravityToCenter: 400,
  drag: 0.92,
  trailLength: 3,
  ambientCount: 0,
  orbGlowMultiplier: 1.4,
};

export const DONE: SceneParams = {
  spawnRate: 0,
  gravityToCenter: -50,
  drag: 0.99,
  trailLength: 0,
  ambientCount: 8,
  orbGlowMultiplier: 1.2,
};
