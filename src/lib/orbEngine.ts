import type { SceneParams } from './orbScenes';
import { WELCOME } from './orbScenes';

type Particle = {
  x: number; y: number;
  vx: number; vy: number;
  life: number;        // 0..1, 1 = newborn
  maxLife: number;     // seconds
};

export class OrbEngine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private dpr: number = 1;
  private rafId: number | null = null;
  private lastFrameTime: number = 0;

  // Scene state — current values are lerped toward `target` over `transitionMs`.
  private current: SceneParams = { ...WELCOME };
  private target: SceneParams = { ...WELCOME };
  private transitionStart: number = 0;
  private transitionMs: number = 0;

  // Particles in flight + spawn queue (drained at current.spawnRate).
  private particles: Particle[] = [];
  private spawnQueue: number = 0;
  private spawnAccumulator: number = 0;

  private reducedMotion: boolean = false;

  attach(canvas: HTMLCanvasElement, dpr: number): void {
    this.canvas = canvas;
    this.dpr = dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable');
    }
    this.ctx = ctx;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.reducedMotion) return;
    this.lastFrameTime = performance.now();
    this.loop();
  }

  detach(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.particles = [];
    this.spawnQueue = 0;
    this.canvas = null;
    this.ctx = null;
  }

  setScene(target: SceneParams, transitionMs: number = 600): void {
    if (this.reducedMotion) {
      this.current = { ...target };
      this.target = { ...target };
      return;
    }
    this.target = { ...target };
    this.transitionStart = performance.now();
    this.transitionMs = transitionMs;
  }

  spawn(n: number): void {
    if (this.reducedMotion) return;
    this.spawnQueue += n;
  }

  private loop = (): void => {
    if (!this.ctx || !this.canvas) return;
    if (document.visibilityState === 'hidden') {
      this.rafId = requestAnimationFrame(this.loop);
      this.lastFrameTime = performance.now();
      return;
    }
    const now = performance.now();
    const dtRaw = (now - this.lastFrameTime) / 1000;
    const dt = Math.min(dtRaw, 0.033); // clamp to 33ms
    this.lastFrameTime = now;

    this.tickScene(now);
    this.tickSpawn(dt);
    this.tickParticles(dt);
    this.render();

    this.rafId = requestAnimationFrame(this.loop);
  };

  private tickScene(_now: number): void {
    // Filled in Task 6.
    void this.current; void this.target; void this.transitionStart; void this.transitionMs;
  }
  private tickSpawn(_dt: number): void {
    // Filled in Task 6.
    void this.spawnAccumulator;
  }
  private tickParticles(_dt: number): void {
    // Filled in Task 6.
    void this.particles;
  }
  private render(): void {
    // Filled in Task 7.
    const ctx = this.ctx!;
    const canvas = this.canvas!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    void this.dpr;
  }
}
