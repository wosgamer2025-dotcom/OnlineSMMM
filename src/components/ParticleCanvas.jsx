import React, { useEffect, useRef, useCallback } from 'react';

// Antigravity-style connected particle network with a cursor orbit halo.
// Canvas is pointer-events:none, so it never blocks typing, clicks, or form use.

const CONNECTION_DISTANCE = 140;
const CURSOR_INFLUENCE_RADIUS = 260;
const CURSOR_ORBIT_RADIUS = 72;
const CURSOR_ORBIT_FORCE = 0.0028;
const CURSOR_SWIRL_FORCE = 0.0038;
const CURSOR_MAX_AGE_MS = 1800;

// Dark, cool palette: deep navy, slate, electric blue, silver-grey
const COLORS = [
  [30, 58, 138],   // deep navy
  [37, 99, 235],   // electric blue
  [51, 65, 85],    // slate-700
  [100, 116, 139], // slate-500
  [71, 85, 105],   // slate-600
  [15, 23, 42],    // darkest navy
  [96, 165, 250],  // sky blue
  [148, 163, 184], // light slate
  [56, 189, 248],  // cyan accent
];

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function createParticle(w, h) {
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  return {
    x: rand(0, w),
    y: rand(0, h),
    vx: rand(-0.32, 0.32),
    vy: rand(-0.32, 0.32),
    radius: rand(1.1, 3.4),
    alpha: rand(0.22, 0.66),
    alphaDir: Math.random() > 0.5 ? 1 : -1,
    alphaSpeed: rand(0.003, 0.009),
    color,
    wobblePhase: rand(0, Math.PI * 2),
    wobbleSpeed: rand(0.008, 0.022),
    wobbleAmp: rand(0.06, 0.24),
  };
}

export default function ParticleCanvas({
  layer = 'background',
  density = layer === 'foreground' ? 0.5 : 1,
  opacity = layer === 'foreground' ? 0.26 : 0.5,
  zIndex = layer === 'foreground' ? 6 : 0,
}) {
  const canvasRef = useRef(null);
  const stateRef = useRef({
    particles: [],
    mouse: { x: -9999, y: -9999, active: false, lastMoveAt: 0 },
    raf: null,
    w: 0,
    h: 0,
  });

  const getParticleCount = useCallback(() => {
    const w = window.innerWidth;
    const baseCount = w < 480 ? 40 : w < 768 ? 60 : 90;
    return Math.max(18, Math.round(baseCount * density));
  }, [density]);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    stateRef.current.w = w;
    stateRef.current.h = h;
  }, []);

  const init = useCallback(() => {
    const { w, h } = stateRef.current;
    const count = getParticleCount();
    stateRef.current.particles = Array.from({ length: count }, () =>
      createParticle(w, h)
    );
  }, [getParticleCount]);

  useEffect(() => {
    // Respect prefers-reduced-motion
    const prefersReduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    resize();
    init();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function draw() {
      const { particles, mouse, w, h } = stateRef.current;
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      const frameNow = Date.now();
      const mouseFresh = mouse.active && frameNow - mouse.lastMoveAt < CURSOR_MAX_AGE_MS;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Wobble movement
        p.wobblePhase += p.wobbleSpeed;
        const wobbleX = Math.cos(p.wobblePhase) * p.wobbleAmp;
        const wobbleY = Math.sin(p.wobblePhase * 1.3) * p.wobbleAmp;

        // Cursor orbit halo: particles near the pointer settle around an
        // invisible ring instead of sitting directly under the cursor.
        const toMouseX = mouse.x - p.x;
        const toMouseY = mouse.y - p.y;
        const dist = Math.sqrt(toMouseX * toMouseX + toMouseY * toMouseY);
        if (mouseFresh && dist < CURSOR_INFLUENCE_RADIUS && dist > 0.1) {
          const proximity = 1 - dist / CURSOR_INFLUENCE_RADIUS;
          const ringJitter = Math.sin(p.wobblePhase * 0.7) * 10;
          const targetRadius = CURSOR_ORBIT_RADIUS + ringJitter;
          const radialError = dist - targetRadius;
          const nx = toMouseX / dist;
          const ny = toMouseY / dist;
          const radialForce = radialError * CURSOR_ORBIT_FORCE * proximity;
          const swirlForce = CURSOR_SWIRL_FORCE * proximity * (layer === 'foreground' ? 1.22 : 0.82);
          p.vx += nx * radialForce + -ny * swirlForce;
          p.vy += ny * radialForce + nx * swirlForce;
        }

        // Velocity damping
        p.vx *= 0.997;
        p.vy *= 0.997;

        // Move
        p.x += p.vx + wobbleX;
        p.y += p.vy + wobbleY;

        // Wrap around edges
        if (p.x < -20) p.x = w + 20;
        if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        if (p.y > h + 20) p.y = -20;

        // Pulse alpha
        p.alpha += p.alphaDir * p.alphaSpeed;
        if (p.alpha > 0.68 || p.alpha < 0.14) {
          p.alphaDir *= -1;
        }

        // Draw particle
        const [r, g, b] = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        const particleAlpha = layer === 'foreground' ? p.alpha * 0.48 : p.alpha;
        ctx.fillStyle = `rgba(${r},${g},${b},${particleAlpha})`;
        ctx.fill();

        // Subtle glow for larger/brighter particles
        if (p.radius > 2.2 && p.alpha > 0.44) {
          const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 3);
          grd.addColorStop(0, `rgba(${r},${g},${b},${layer === 'foreground' ? 0.04 : 0.1})`);
          grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * 3, 0, Math.PI * 2);
          ctx.fillStyle = grd;
          ctx.fill();
        }
      }

      if (mouseFresh) {
        const ringAlpha = layer === 'foreground' ? 0.16 : 0.07;
        const ringGradient = ctx.createRadialGradient(
          mouse.x,
          mouse.y,
          CURSOR_ORBIT_RADIUS * 0.72,
          mouse.x,
          mouse.y,
          CURSOR_ORBIT_RADIUS * 1.35,
        );
        ringGradient.addColorStop(0, `rgba(37,99,235,0)`);
        ringGradient.addColorStop(0.55, `rgba(37,99,235,${ringAlpha})`);
        ringGradient.addColorStop(1, `rgba(56,189,248,0)`);
        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, CURSOR_ORBIT_RADIUS * 1.35, 0, Math.PI * 2);
        ctx.fillStyle = ringGradient;
        ctx.fill();
      }

      // Draw connection lines
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const ddx = a.x - b.x;
          const ddy = a.y - b.y;
          const d = Math.sqrt(ddx * ddx + ddy * ddy);

          if (d < CONNECTION_DISTANCE) {
            const proximity = 1 - d / CONNECTION_DISTANCE;
            const lineAlpha = proximity * (layer === 'foreground' ? 0.1 : 0.24);
            const [r1, g1, b1] = a.color;
            const [r2, g2, b2] = b.color;

            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(${Math.round((r1+r2)/2)},${Math.round((g1+g2)/2)},${Math.round((b1+b2)/2)},${lineAlpha})`;
            ctx.lineWidth = proximity * 1.0;
            ctx.stroke();
          }
        }
      }

      stateRef.current.raf = requestAnimationFrame(draw);
    }

    stateRef.current.raf = requestAnimationFrame(draw);

    const handleResize = () => { resize(); init(); };
    const handlePointerMove = (e) => {
      if (e.pointerType === 'touch') return;
      stateRef.current.mouse = {
        x: e.clientX,
        y: e.clientY,
        active: true,
        lastMoveAt: Date.now(),
      };
    };
    const handlePointerLeave = () => {
      stateRef.current.mouse = { x: -9999, y: -9999, active: false, lastMoveAt: 0 };
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      cancelAnimationFrame(stateRef.current.raf);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [resize, init]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`particle-canvas particle-canvas-${layer}`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex,
        pointerEvents: 'none',
        opacity,
        mixBlendMode: layer === 'foreground' ? 'multiply' : 'normal',
      }}
    />
  );
}
