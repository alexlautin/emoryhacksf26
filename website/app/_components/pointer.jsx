'use client';
import { useEffect } from 'react';

// Site-wide pointer effects, set as CSS variables so the styling stays in site.css.
// [data-spot]: --mx/--my, the cursor position inside the element, for a soft spotlight.
// [data-tilt]: --rx/--ry, a small 3D tilt toward the cursor.
// Mouse and pen only, and nothing when the visitor prefers reduced motion (spotlight still runs).
const MAX_TILT = 5; // degrees

export default function Pointer() {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let tilted = null;
    let frame = 0;
    let last = null;

    const untilt = () => {
      if (!tilted) return;
      tilted.style.removeProperty('--rx');
      tilted.style.removeProperty('--ry');
      tilted.classList.remove('is-tilting');
      tilted = null;
    };

    const apply = () => {
      frame = 0;
      const e = last;
      const target = e.target instanceof Element ? e.target : null;
      const spot = target?.closest('[data-spot]');
      if (spot) {
        const r = spot.getBoundingClientRect();
        spot.style.setProperty('--mx', `${e.clientX - r.left}px`);
        spot.style.setProperty('--my', `${e.clientY - r.top}px`);
      }
      if (still) return;
      const tilt = target?.closest('[data-tilt]');
      if (tilt !== tilted) untilt();
      if (tilt) {
        const r = tilt.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        tilt.style.setProperty('--ry', `${(x * MAX_TILT * 2).toFixed(2)}deg`);
        tilt.style.setProperty('--rx', `${(-y * MAX_TILT * 2).toFixed(2)}deg`);
        tilt.classList.add('is-tilting');
        tilted = tilt;
      }
    };

    const onMove = (e) => {
      if (e.pointerType === 'touch') return;
      last = e;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onLeave = () => untilt();

    document.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
