import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { OrbEngine } from '../../lib/orbEngine';
import eunhaSvg from '../../assets/eunha.svg';

export type StageHandle = {
  engine: OrbEngine | null;
};

export const Stage = forwardRef<StageHandle, Record<string, never>>(function Stage(_, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<OrbEngine | null>(null);
  const reducedMotion = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  useImperativeHandle(ref, () => ({
    get engine() { return engineRef.current; },
  }), []);

  useEffect(() => {
    if (reducedMotion.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);

    let engine: OrbEngine | null = null;
    try {
      engine = new OrbEngine();
      engine.attach(canvas, dpr);
      engineRef.current = engine;
    } catch (e) {
      console.warn('OrbEngine attach failed, falling back to static orb:', e);
      engineRef.current = null;
    }

    return () => {
      engine?.detach();
      engineRef.current = null;
    };
  }, []);

  return (
    <div className="relative w-[480px] h-[480px] mx-auto">
      {/* Static orb image — always visible underneath the canvas */}
      <img
        src={eunhaSvg}
        alt=""
        className="absolute left-1/2 top-1/2 w-32 h-32 -translate-x-1/2 -translate-y-1/2 select-none pointer-events-none"
        draggable={false}
      />
      {/* Canvas overlay for particles + glow (skipped under reduced-motion) */}
      {!reducedMotion.current && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 pointer-events-none"
        />
      )}
    </div>
  );
});
