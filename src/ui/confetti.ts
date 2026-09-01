// Canvas confetti for the champion screen. Presentation-only: Math.random and
// requestAnimationFrame are fine here (src/ui is outside the pure boundary).

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  w: number; h: number;
  rot: number; vrot: number;
  color: string;
}

export interface ConfettiOptions {
  colors: readonly string[];
  count?: number;
  gravity?: number;
}

export class Confetti {
  private particles: Particle[] = [];
  private raf: number | null = null;
  private last = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly opts: ConfettiOptions,
  ) {}

  start(): void {
    if (this.raf !== null) return;
    this.resize();
    this.spawn(this.opts.count ?? 160);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    const ctx = this.canvas.getContext('2d');
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private spawn(count: number): void {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    const colors = this.opts.colors.length > 0 ? this.opts.colors : ['#ffffff'];
    this.particles = [];
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * w,
        // Seed the whole column so the screen is already full on the first frame.
        y: Math.random() * (h * 1.3) - h * 0.3,
        vx: (Math.random() - 0.5) * 40,
        vy: 60 + Math.random() * 110,
        w: 4 + Math.random() * 6,
        h: 6 + Math.random() * 10,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 6,
        color: colors[i % colors.length] ?? '#ffffff',
      });
    }
  }

  private readonly frame = (now: number): void => {
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    const ctx = this.canvas.getContext('2d');
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    if (ctx) {
      ctx.clearRect(0, 0, w, h);
      const gravity = this.opts.gravity ?? 55;
      for (const p of this.particles) {
        p.vy += gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;
        if (p.y > h + 20) {
          p.y = -20;
          p.x = Math.random() * w;
          p.vy = 60 + Math.random() * 110;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
    }
    this.raf = requestAnimationFrame(this.frame);
  };
}
