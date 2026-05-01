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

  private tickScene(now: number): void {
    if (this.transitionMs <= 0) {
      this.current = { ...this.target };
      return;
    }
    const elapsed = now - this.transitionStart;
    const t = Math.min(1, elapsed / this.transitionMs);
    // ease-in-out cubic
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const lerp = (a: number, b: number) => a + (b - a) * eased;

    this.current = {
      spawnRate:          lerp(this.current.spawnRate,          this.target.spawnRate),
      gravityToCenter:    lerp(this.current.gravityToCenter,    this.target.gravityToCenter),
      drag:               lerp(this.current.drag,               this.target.drag),
      trailLength:        lerp(this.current.trailLength,        this.target.trailLength),
      ambientCount:       lerp(this.current.ambientCount,       this.target.ambientCount),
      orbGlowMultiplier:  lerp(this.current.orbGlowMultiplier,  this.target.orbGlowMultiplier),
    };
    if (t >= 1) this.transitionMs = 0;
  }

  private tickSpawn(dt: number): void {
    if (!this.canvas) return;
    this.spawnAccumulator += this.current.spawnRate * dt;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const cx = w / 2;
    const cy = h / 2;

    while (this.spawnAccumulator >= 1 && (this.spawnQueue > 0 || this.current.ambientCount > this.particles.length)) {
      this.spawnAccumulator -= 1;

      // Pick a random edge spawn point.
      const edge = Math.floor(Math.random() * 4); // 0=top 1=right 2=bottom 3=left
      let sx = 0, sy = 0;
      if (edge === 0) { sx = Math.random() * w; sy = -8; }
      else if (edge === 1) { sx = w + 8; sy = Math.random() * h; }
      else if (edge === 2) { sx = Math.random() * w; sy = h + 8; }
      else { sx = -8; sy = Math.random() * h; }

      // Initial velocity gently toward center (refined by gravity each frame).
      const dx = cx - sx;
      const dy = cy - sy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const speed = 30 + Math.random() * 30;

      this.particles.push({
        x: sx,
        y: sy,
        vx: (dx / dist) * speed,
        vy: (dy / dist) * speed,
        life: 1,
        maxLife: 2 + Math.random() * 1.5,
      });

      if (this.spawnQueue > 0) this.spawnQueue -= 1;
    }
  }

  private tickParticles(dt: number): void {
    if (!this.canvas) return;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const cx = w / 2;
    const cy = h / 2;
    const absorbRadius = 18; // particles within this distance of orb center disappear
    const dragPerFrame = Math.pow(this.current.drag, dt);

    const next: Particle[] = [];
    for (const p of this.particles) {
      const dx = cx - p.x;
      const dy = cy - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      if (dist < absorbRadius) continue; // absorbed

      // Apply gravity (negative = orbital tangent)
      if (this.current.gravityToCenter >= 0) {
        const a = this.current.gravityToCenter * dt;
        p.vx += (dx / dist) * a;
        p.vy += (dy / dist) * a;
      } else {
        // Tangential: 90° rotation of (dx, dy)
        const a = -this.current.gravityToCenter * dt;
        p.vx += (-dy / dist) * a;
        p.vy += (dx / dist) * a;
      }

      p.vx *= dragPerFrame;
      p.vy *= dragPerFrame;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt / p.maxLife;

      if (p.life <= 0) continue;
      next.push(p);
    }
    this.particles = next;
  }
  private render(): void {
    // Filled in Task 7.
    const ctx = this.ctx!;
    const canvas = this.canvas!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    void this.dpr;
  }
}
