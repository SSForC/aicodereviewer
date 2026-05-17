// Shared micro-interactions and utilities for all landing variants
// Magnetic hover, text scramble, scroll reveal, cursor glow, marquee, etc.

import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Magnetic hover ─────────────────────────────────────────
export function useMagnetic(strength = 0.35) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2);
      const y = e.clientY - (r.top + r.height / 2);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(raf);
      el.style.transform = 'translate(0,0)';
    };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
      cancelAnimationFrame(raf);
    };
  }, [strength]);
  return ref;
}

export function Magnetic({ children, strength = 0.35, style, className, ...rest }) {
  const ref = useMagnetic(strength);
  return (
    <span
      ref={ref}
      className={className}
      style={{ display: 'inline-block', transition: 'transform .25s cubic-bezier(.2,.7,.3,1)', ...style }}
      {...rest}
    >
      {children}
    </span>
  );
}

// ─── Text scramble ──────────────────────────────────────────
const SCRAMBLE_CHARS = '!<>-_\\/[]{}—=+*^?#________';

export function TextScramble({ text, trigger = 'hover', duration = 700, className, style }) {
  const ref = useRef(null);
  const [display, setDisplay] = useState(text);
  const rafRef = useRef(0);
  const runningRef = useRef(false);

  const scramble = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    const start = performance.now();
    const target = text;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration);
      let out = '';
      for (let i = 0; i < target.length; i++) {
        const reveal = p * target.length;
        if (i < reveal - 1) out += target[i];
        else if (target[i] === ' ') out += ' ';
        else out += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
      }
      setDisplay(out);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else {
        setDisplay(target);
        runningRef.current = false;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [text, duration]);

  useEffect(() => {
    if (trigger === 'mount') scramble();
    return () => cancelAnimationFrame(rafRef.current);
  }, [trigger, scramble]);

  useEffect(() => { setDisplay(text); }, [text]);

  const handlers = trigger === 'hover' ? { onMouseEnter: scramble } : {};
  return (
    <span ref={ref} className={className} style={style} {...handlers}>
      {display}
    </span>
  );
}

// ─── Scroll reveal ──────────────────────────────────────────
export function Reveal({ children, delay = 0, y = 24, className, style, once = true }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setShown(true);
            if (once) io.unobserve(el);
          } else if (!once) setShown(false);
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once]);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'translateY(0)' : `translateY(${y}px)`,
        transition: `opacity .8s cubic-bezier(.2,.7,.3,1) ${delay}ms, transform .8s cubic-bezier(.2,.7,.3,1) ${delay}ms`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── Counter / value tick-up on view ────────────────────────
export function Ticker({ value, duration = 1400, suffix = '', className, style }) {
  const ref = useRef(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        io.unobserve(el);
        const start = performance.now();
        const step = (t) => {
          const p = Math.min(1, (t - start) / duration);
          const ease = 1 - Math.pow(1 - p, 3);
          setN(Math.floor(ease * value));
          if (p < 1) requestAnimationFrame(step);
          else setN(value);
        };
        requestAnimationFrame(step);
      });
    });
    io.observe(el);
    return () => io.disconnect();
  }, [value, duration]);
  return <span ref={ref} className={className} style={style}>{n.toLocaleString('tr-TR')}{suffix}</span>;
}

// ─── Marquee (infinite tape) ────────────────────────────────
export function Marquee({ children, speed = 40, style, className }) {
  return (
    <div className={className} style={{ overflow: 'hidden', whiteSpace: 'nowrap', ...style }}>
      <div style={{ display: 'inline-flex', animation: `mq ${speed}s linear infinite`, gap: '3rem' }}>
        {children}{children}{children}
      </div>
      <style>{`@keyframes mq { from{transform:translateX(0)} to{transform:translateX(-33.333%)} }`}</style>
    </div>
  );
}

// ─── Accordion for FAQ ──────────────────────────────────────
export function Accordion({ items, accent = '#fff', styleVariant = 'minimal' }) {
  const [open, setOpen] = useState(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map((it, i) => {
        const isOpen = open === i;
        return (
          <div
            key={i}
            style={{
              borderTop: i === 0 ? '1px solid rgba(255,255,255,0.08)' : 'none',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                padding: '28px 4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 24,
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 'clamp(16px, 1.2vw, 20px)',
                textAlign: 'left',
                letterSpacing: '-0.01em',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                <span style={{ opacity: 0.4, fontSize: '0.75em', fontVariantNumeric: 'tabular-nums' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span>{it.q}</span>
              </span>
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  border: '1px solid rgba(255,255,255,0.2)',
                  display: 'grid',
                  placeItems: 'center',
                  transition: 'transform .3s, background .2s, border-color .2s',
                  transform: isOpen ? 'rotate(45deg)' : 'rotate(0)',
                  background: isOpen ? accent : 'transparent',
                  color: isOpen ? '#000' : 'inherit',
                  borderColor: isOpen ? accent : 'rgba(255,255,255,0.2)',
                  flexShrink: 0,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.2"/></svg>
              </span>
            </button>
            <div
              style={{
                display: 'grid',
                gridTemplateRows: isOpen ? '1fr' : '0fr',
                transition: 'grid-template-rows .35s cubic-bezier(.2,.7,.3,1)',
              }}
            >
              <div style={{ overflow: 'hidden' }}>
                <p style={{
                  margin: 0,
                  padding: '0 0 28px 56px',
                  opacity: 0.65,
                  maxWidth: 640,
                  lineHeight: 1.6,
                  fontSize: 15,
                }}>
                  {it.a}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Cursor glow (moved to hero-only by each variant) ───────
export function CursorGlow({ color = 'rgba(255,255,255,0.06)', size = 420, targetRef }) {
  const [p, setP] = useState({ x: -999, y: -999, on: false });
  useEffect(() => {
    const el = targetRef?.current;
    if (!el) return;
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      setP({ x: e.clientX - r.left, y: e.clientY - r.top, on: true });
    };
    const onLeave = () => setP((s) => ({ ...s, on: false }));
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, [targetRef]);
  return (
    <div
      style={{
        position: 'absolute',
        pointerEvents: 'none',
        left: p.x - size / 2,
        top: p.y - size / 2,
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        opacity: p.on ? 1 : 0,
        transition: 'opacity .3s',
        filter: 'blur(8px)',
      }}
    />
  );
}

if (typeof window !== 'undefined') {
  Object.assign(window, { Magnetic, useMagnetic, TextScramble, Reveal, Ticker, Marquee, Accordion, CursorGlow });
}
