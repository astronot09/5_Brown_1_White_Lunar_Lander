import React, { useEffect, useRef, useState } from 'react';

const LUNAR_GRAVITY = 1.62; // m/s^2
const DRY_MASS_KG = 4000;
const INITIAL_FUEL_KG = 1200;
const MAX_THRUST_N = 17500;
const RCS_LAT_THRUST_N = 4200; // Lateral cold-gas RCS translation jets
const FUEL_BURN_RATE = 5.8; // kg/s at 100% main throttle

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function playSoundEffect(type: 'gear' | 'ring' | 'win' | 'crash', muted: boolean) {
  if (muted) return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === 'gear') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(190, now);
      osc.frequency.exponentialRampToValueAtTime(95, now + 0.16);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.18);
    } else if (type === 'ring') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(880, now + 0.09);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.start(now);
      osc.stop(now + 0.28);
    } else if (type === 'win') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(554.37, now + 0.12);
      osc.frequency.setValueAtTime(659.25, now + 0.24);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      osc.start(now);
      osc.stop(now + 0.55);
    } else if (type === 'crash') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(32, now + 0.45);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.start(now);
      osc.stop(now + 0.45);
    }
  } catch {
    // Ignore audio errors if blocked
  }
}

export default function LunarSurvivalGame() {
  const canvasRef: any = useRef(null);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const [highScore, setHighScore] = useState(0);
  const [streak, setStreak] = useState(0);

  const simRef = useRef({
    x: -135,
    y: 215,
    vx: 9.0,
    vy: -3.5,
    pitchDeg: -10,
    angularVel: 0,
    fuelKg: INITIAL_FUEL_KG,
    throttle: 0,
    prevThrottle: 0.45,
    gearDeployed: false,
    sasHold: true,
    hoverHold: false,
    spotlightOn: true,
    pitchLeft: false,
    pitchRight: false,
    rcsLeft: false,
    rcsRight: false,
    boostHeld: false,
    bonusRing: { x: -45, y: 115, collected: false },
    status: 'ready' as 'ready' | 'playing' | 'landed' | 'crashed',
    headline: '',
    summary: '',
    lastScore: 0,
    dust: [] as { x: number; y: number; vx: number; vy: number; life: number }[],
    sparks: [] as { x: number; y: number; vx: number; vy: number; life: number; color: string }[],
  });

  const [ui, setUi] = useState({
    altitude: 215,
    speedDown: 3.5,
    speedSide: 9.0,
    padDistance: -135,
    tiltDeg: -10,
    fuelPct: 100,
    throttlePct: 0,
    gearDeployed: false,
    sasHold: true,
    hoverHold: false,
    spotlightOn: true,
    status: 'ready' as 'ready' | 'playing' | 'landed' | 'crashed',
    headline: '',
    summary: '',
    lastScore: 0,
  });

  function syncUi() {
    const s = simRef.current;
    setUi({
      altitude: s.y,
      speedDown: Math.abs(s.vy),
      speedSide: s.vx,
      padDistance: s.x,
      tiltDeg: s.pitchDeg,
      fuelPct: Math.round((s.fuelKg / INITIAL_FUEL_KG) * 100),
      throttlePct: Math.round(s.throttle * 100),
      gearDeployed: s.gearDeployed,
      sasHold: s.sasHold,
      hoverHold: s.hoverHold,
      spotlightOn: s.spotlightOn,
      status: s.status,
      headline: s.headline,
      summary: s.summary,
      lastScore: s.lastScore,
    });
  }

  function launchMission() {
    const startLeft = Math.random() > 0.35;
    const startX = startLeft ? -135 - Math.random() * 35 : 135 + Math.random() * 35;
    const startVx = startLeft ? 8.5 + Math.random() * 3.5 : -8.5 - Math.random() * 3.5;

    simRef.current = {
      x: startX,
      y: 215,
      vx: startVx,
      vy: -3.5,
      pitchDeg: startLeft ? -8 : 8,
      angularVel: 0,
      fuelKg: INITIAL_FUEL_KG,
      throttle: 0,
      prevThrottle: 0.45,
      gearDeployed: false,
      sasHold: true,
      hoverHold: false,
      spotlightOn: true,
      pitchLeft: false,
      pitchRight: false,
      rcsLeft: false,
      rcsRight: false,
      boostHeld: false,
      bonusRing: {
        x: startX * 0.35 + (Math.random() - 0.5) * 25,
        y: 110 + Math.random() * 25,
        collected: false,
      },
      status: 'playing',
      headline: '',
      summary: '',
      lastScore: 0,
      dust: [],
      sparks: [],
    };
    syncUi();
  }

  // Blur buttons on click so Spacebar / Enter never accidentally re-triggers a UI button
  const blurBtn = (e: any) => {
    if (e?.currentTarget?.blur) e.currentTarget.blur();
  };

  // Keyboard Flight Controls
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = simRef.current;
      if (e.code === 'Space') e.preventDefault();

      if (s.status !== 'playing' && (e.code === 'Space' || e.code === 'Enter')) {
        launchMission();
        return;
      }
      if (s.status !== 'playing') return;

      // Attitude Pitch (A/D or Left/Right Arrows)
      if ((e.code === 'ArrowLeft' || e.code === 'KeyA') && !s.pitchLeft) {
        s.pitchLeft = true;
        s.angularVel -= 9; // Crisp initial attitude impulse
      }
      if ((e.code === 'ArrowRight' || e.code === 'KeyD') && !s.pitchRight) {
        s.pitchRight = true;
        s.angularVel += 9;
      }

      // Lateral RCS Translation Thrusters (Q / E)
      if ((e.code === 'KeyQ') && !s.rcsLeft) {
        s.rcsLeft = true;
        if (s.fuelKg > 0) s.vx -= 1.2; // Instant lateral RCS pulse
      }
      if ((e.code === 'KeyE') && !s.rcsRight) {
        s.rcsRight = true;
        if (s.fuelKg > 0) s.vx += 1.2;
      }

      // Main Engine Throttle
      if (e.code === 'Space' && !s.boostHeld) {
        s.prevThrottle = s.throttle;
        s.boostHeld = true;
        s.hoverHold = false;
      }
      if (e.code === 'ArrowUp' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        s.hoverHold = false;
        s.throttle = clamp(s.throttle + 0.1, 0, 1);
      }
      if (e.code === 'ArrowDown' || e.code === 'ControlLeft' || e.code === 'ControlRight') {
        s.hoverHold = false;
        s.throttle = clamp(s.throttle - 0.1, 0, 1);
      }
      if (e.code === 'KeyX') {
        s.hoverHold = false;
        s.throttle = 0;
      }
      if (e.code === 'KeyZ') {
        s.hoverHold = false;
        s.throttle = 1;
      }
      if (e.code === 'KeyG') {
        s.gearDeployed = !s.gearDeployed;
        playSoundEffect('gear', mutedRef.current);
      }
      if (e.code === 'KeyH') {
        s.hoverHold = !s.hoverHold;
      }
      if (e.code === 'KeyT') {
        s.sasHold = !s.sasHold;
      }
      if (e.code === 'KeyR') {
        s.pitchDeg = 0;
        s.angularVel = 0;
      }
      syncUi();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const s = simRef.current;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') s.pitchLeft = false;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') s.pitchRight = false;
      if (e.code === 'KeyQ') s.rcsLeft = false;
      if (e.code === 'KeyE') s.rcsRight = false;
      if (e.code === 'Space' && s.boostHeld) {
        s.boostHeld = false;
        s.throttle = s.prevThrottle;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // 60 FPS Realistic Lunar Physics & Canvas Render Loop
  useEffect(() => {
    let frameId = 0;
    let lastTime = performance.now();
    let lastSync = 0;

    const tick = (now: number) => {
      frameId = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const s = simRef.current;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 1. Physics Update
      if (s.status === 'playing') {
        const mass = DRY_MASS_KG + s.fuelKg;

        if (s.boostHeld) {
          s.throttle = 1.0;
        } else if (s.hoverHold && s.fuelKg > 0) {
          const cosP = Math.max(0.35, Math.cos((s.pitchDeg * Math.PI) / 180));
          // Proportional-derivative hover controller holds vertical velocity right at 0 m/s
          const neededThrust = (mass * (LUNAR_GRAVITY - s.vy * 2.4)) / cosP;
          s.throttle = clamp(neededThrust / MAX_THRUST_N, 0, 1);
        }

        // Attitude Pitch Rotation (Real SAS damps spin when released, does NOT fight your angle!)
        const pitchTorque = 92; // deg/s^2
        if (s.pitchLeft) s.angularVel -= pitchTorque * dt;
        if (s.pitchRight) s.angularVel += pitchTorque * dt;

        if (!s.pitchLeft && !s.pitchRight) {
          if (s.sasHold) {
            // SAS kills angular rotation smoothly and holds your current pitch angle
            s.angularVel *= Math.exp(-7.5 * dt);
            if (Math.abs(s.angularVel) < 0.2) s.angularVel = 0;
          } else {
            s.angularVel *= Math.exp(-0.8 * dt);
          }
        }
        s.angularVel = clamp(s.angularVel, -90, 90);
        s.pitchDeg = clamp(s.pitchDeg + s.angularVel * dt, -75, 75);

        // Main Descent Engine Thrust
        const activeThrottle = s.fuelKg > 0 ? s.throttle : 0;
        if (s.fuelKg <= 0) {
          s.throttle = 0;
          s.hoverHold = false;
        }
        s.fuelKg = Math.max(0, s.fuelKg - activeThrottle * FUEL_BURN_RATE * dt);

        const mainThrust = activeThrottle * MAX_THRUST_N;
        const rad = (s.pitchDeg * Math.PI) / 180;

        // Lateral RCS Cold-Gas Translation Jets (Q / E)
        let rcsForceX = 0;
        if (s.fuelKg > 0) {
          if (s.rcsLeft) {
            rcsForceX -= RCS_LAT_THRUST_N;
            s.fuelKg = Math.max(0, s.fuelKg - 0.6 * dt);
          }
          if (s.rcsRight) {
            rcsForceX += RCS_LAT_THRUST_N;
            s.fuelKg = Math.max(0, s.fuelKg - 0.6 * dt);
          }
        }

        const ax = (mainThrust * Math.sin(rad) + rcsForceX) / mass;
        const ay = (mainThrust * Math.cos(rad)) / mass - LUNAR_GRAVITY;

        s.vx += ax * dt;
        s.vy += ay * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;

        // Bonus Star Ring Collision
        if (!s.bonusRing.collected) {
          const distToRing = Math.hypot(s.x - s.bonusRing.x, s.y + 10 - s.bonusRing.y);
          if (distToRing < 20) {
            s.bonusRing.collected = true;
            playSoundEffect('ring', mutedRef.current);
            for (let i = 0; i < 18; i++) {
              const a = (i / 18) * Math.PI * 2;
              s.sparks.push({
                x: s.bonusRing.x,
                y: s.bonusRing.y,
                vx: Math.cos(a) * 24,
                vy: Math.sin(a) * 24,
                life: 1,
                color: '#facc15',
              });
            }
          }
        }

        // Regolith Dust Plume near ground
        if (activeThrottle > 0.08 && s.y < 38 && s.y > 0) {
          for (let i = 0; i < 3; i++) {
            s.dust.push({
              x: s.x + (Math.random() - 0.5) * 6,
              y: 0.5,
              vx: (Math.random() - 0.5) * 32 + Math.sin(rad) * 16,
              vy: 2 + Math.random() * 6,
              life: 1,
            });
          }
        }

        // Ground Touchdown Check
        if (s.y <= 0) {
          s.y = 0;
          const downSpeed = Math.abs(s.vy);
          const sideSpeed = Math.abs(s.vx);
          const tilt = Math.abs(s.pitchDeg);

          const safeLanding = downSpeed <= 4.2 && sideSpeed <= 3.0 && tilt <= 12 && s.gearDeployed;
          const onPad = Math.abs(s.x) <= 48;
          const bullseye = Math.abs(s.x) <= 16;

          if (safeLanding) {
            s.status = 'landed';
            s.throttle = 0;
            playSoundEffect('win', mutedRef.current);

            const softBonus = Math.round((4.2 - downSpeed) * 120);
            const fuelBonus = Math.round((s.fuelKg / INITIAL_FUEL_KG) * 400);
            const ringBonus = s.bonusRing.collected ? 250 : 0;
            const multiplier = bullseye ? 2 : onPad ? 1 : 0.5;
            const total = Math.round((500 + softBonus + fuelBonus + ringBonus) * multiplier);

            s.lastScore = total;
            s.headline = bullseye
              ? '🎯 BULLSEYE TOUCHDOWN! (2X SCORE)'
              : onPad
                ? '🚀 SMOOTH LANDING ON PAD 01!'
                : '🌖 SAFE CRATER FLOOR LANDING (0.5X)';
            s.summary = `Touchdown speed ${downSpeed.toFixed(1)} m/s · Fuel left ${Math.round(
              (s.fuelKg / INITIAL_FUEL_KG) * 100
            )}% · Score: +${total} pts!`;

            setHighScore((prev) => Math.max(prev, total));
            setStreak((prev) => prev + 1);
          } else {
            s.status = 'crashed';
            s.throttle = 0;
            playSoundEffect('crash', mutedRef.current);
            setStreak(0);

            for (let i = 0; i < 28; i++) {
              const a = Math.random() * Math.PI;
              const spd = 8 + Math.random() * 35;
              s.sparks.push({
                x: s.x,
                y: 2,
                vx: Math.cos(a) * spd * (Math.random() > 0.5 ? 1 : -1),
                vy: Math.sin(a) * spd,
                life: 1.2,
                color: i % 2 === 0 ? '#f97316' : '#facc15',
              });
            }

            const issues: string[] = [];
            if (!s.gearDeployed) issues.push('Landing Legs were NOT deployed!');
            if (downSpeed > 4.2) issues.push(`Too fast downward (${downSpeed.toFixed(1)} m/s)`);
            if (sideSpeed > 3.0) issues.push(`Too much sideways drift (${sideSpeed.toFixed(1)} m/s)`);
            if (tilt > 12) issues.push(`Tilted too far (${tilt.toFixed(0)}°)`);

            s.headline = '💥 HARD IMPACT — TRY AGAIN!';
            s.summary = issues.join(' · ');
          }
          syncUi();
        }
      }

      // Update particles
      s.dust = s.dust
        .map((d) => ({ ...d, x: d.x + d.vx * dt, y: d.y + d.vy * dt, vy: d.vy - LUNAR_GRAVITY * dt, life: d.life - dt * 1.5 }))
        .filter((d) => d.life > 0 && d.y >= 0);

      s.sparks = s.sparks
        .map((sp) => ({ ...sp, x: sp.x + sp.vx * dt, y: sp.y + sp.vy * dt, vy: sp.vy - LUNAR_GRAVITY * dt, life: sp.life - dt * 1.3 }))
        .filter((sp) => sp.life > 0);

      // 2. Render Descent Viewport
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
      skyGrad.addColorStop(0, '#02040a');
      skyGrad.addColorStop(1, '#0b1326');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = '#f8fafc';
      for (let i = 0; i < 70; i++) {
        const sx = (i * 149) % W;
        const sy = (i * 97) % (H - 70);
        ctx.globalAlpha = i % 3 === 0 ? 0.9 : 0.45;
        ctx.fillRect(sx, sy, i % 5 === 0 ? 2 : 1.5, i % 5 === 0 ? 2 : 1.5);
      }
      ctx.globalAlpha = 1;

      // Earth in Lunar Sky
      const ex = W * 0.82;
      const ey = 62;
      const eGrad = ctx.createRadialGradient(ex - 5, ey - 5, 2, ex, ey, 20);
      eGrad.addColorStop(0, '#bae6fd');
      eGrad.addColorStop(0.55, '#0284c7');
      eGrad.addColorStop(1, '#0c4a6e');
      ctx.beginPath();
      ctx.arc(ex, ey, 19, 0, Math.PI * 2);
      ctx.fillStyle = eGrad;
      ctx.fill();

      const pxPerMeter = 1.32;
      const cameraLiftY = Math.max(0, (s.y - 225) * pxPerMeter);
      const groundY = H - 44 + cameraLiftY;
      const camX = s.x * 0.55;

      const toScreenX = (wx: number) => W * 0.5 + (wx - camX) * pxPerMeter;
      const toScreenY = (wy: number) => groundY - wy * pxPerMeter;

      // Crater Rim Silhouette
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      for (let px = 0; px <= W; px += 10) {
        const worldWave = (px + camX * 0.4) * 0.015;
        const mHeight = 26 + Math.sin(worldWave) * 14 + Math.cos(worldWave * 2.3) * 8;
        ctx.lineTo(px, groundY - mHeight);
      }
      ctx.lineTo(W, groundY);
      ctx.closePath();
      ctx.fill();

      // Crater Floor
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, groundY, W, H - groundY + 100);
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(W, groundY);
      ctx.stroke();

      // Landing Pad 01 + 2X Bullseye Center
      const padL = toScreenX(-48);
      const padR = toScreenX(48);
      const bullL = toScreenX(-16);
      const bullR = toScreenX(16);

      ctx.fillStyle = '#334155';
      ctx.fillRect(padL, groundY - 4, padR - padL, 8);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.strokeRect(padL, groundY - 4, padR - padL, 8);

      ctx.fillStyle = '#facc15';
      ctx.fillRect(bullL, groundY - 4, bullR - bullL, 8);

      const blink = 0.5 + 0.5 * Math.sin(now * 0.01);
      ctx.fillStyle = `rgba(56, 189, 248, ${0.45 + blink * 0.55})`;
      ctx.beginPath();
      ctx.arc(padL, groundY - 7, 4, 0, Math.PI * 2);
      ctx.arc(padR, groundY - 7, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fde047';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🎯 2X BULLSEYE PAD', (padL + padR) * 0.5, groundY + 18);

      // Ballistic Trajectory Predictor Arc (shows where you will land!)
      if (s.status === 'playing' && s.y > 4) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let px = s.x;
        let py = s.y;
        let pvx = s.vx;
        let pvy = s.vy;
        ctx.moveTo(toScreenX(px), toScreenY(py));
        for (let step = 0; step < 32; step++) {
          const stepDt = 0.25;
          pvy -= LUNAR_GRAVITY * stepDt;
          px += pvx * stepDt;
          py += pvy * stepDt;
          if (py <= 0) {
            ctx.lineTo(toScreenX(px), groundY);
            break;
          }
          ctx.lineTo(toScreenX(px), toScreenY(py));
        }
        ctx.stroke();
        ctx.restore();
      }

      // Bonus Data Ring
      if (!s.bonusRing.collected) {
        const rx = toScreenX(s.bonusRing.x);
        const ry = toScreenY(s.bonusRing.y);
        const ringPulse = 18 + Math.sin(now * 0.006) * 2.5;
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(rx, ry, ringPulse, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#fde047';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText('+250 PTS', rx, ry - 24);
      }

      // Dust & Sparks
      s.dust.forEach((d) => {
        ctx.fillStyle = `rgba(203, 213, 225, ${d.life * 0.6})`;
        ctx.beginPath();
        ctx.arc(toScreenX(d.x), toScreenY(d.y), 3, 0, Math.PI * 2);
        ctx.fill();
      });
      s.sparks.forEach((sp) => {
        ctx.fillStyle = sp.color;
        ctx.globalAlpha = Math.max(0, sp.life);
        ctx.beginPath();
        ctx.arc(toScreenX(sp.x), toScreenY(sp.y), 3, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      // Draw Spaceship Lander
      const lx = toScreenX(s.x);
      const ly = toScreenY(s.y);

      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate((s.pitchDeg * Math.PI) / 180);

      // Spotlight
      if (s.spotlightOn && s.y < 150 && s.status !== 'crashed') {
        const cone = ctx.createLinearGradient(0, -6, 0, 110);
        cone.addColorStop(0, 'rgba(254, 249, 195, 0.32)');
        cone.addColorStop(1, 'rgba(254, 249, 195, 0)');
        ctx.fillStyle = cone;
        ctx.beginPath();
        ctx.moveTo(-7, -8);
        ctx.lineTo(7, -8);
        ctx.lineTo(42, 115);
        ctx.lineTo(-42, 115);
        ctx.closePath();
        ctx.fill();
      }

      // Main Engine Plume
      if (s.throttle > 0.02 && s.fuelKg > 0 && s.status === 'playing') {
        const flameH = 16 + s.throttle * 42 + Math.random() * 8;
        const fGrad = ctx.createLinearGradient(0, -4, 0, flameH);
        fGrad.addColorStop(0, '#ffffff');
        fGrad.addColorStop(0.35, '#facc15');
        fGrad.addColorStop(1, 'rgba(239, 68, 68, 0)');
        ctx.fillStyle = fGrad;
        ctx.beginPath();
        ctx.moveTo(-6, -4);
        ctx.lineTo(6, -4);
        ctx.lineTo(0, flameH);
        ctx.closePath();
        ctx.fill();
      }

      // Attitude Pitch Thruster Puffs (A / D)
      if (s.pitchLeft && s.status === 'playing') {
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.moveTo(10, -28);
        ctx.lineTo(25, -31);
        ctx.lineTo(25, -25);
        ctx.closePath();
        ctx.fill();
      }
      if (s.pitchRight && s.status === 'playing') {
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.moveTo(-10, -28);
        ctx.lineTo(-25, -31);
        ctx.lineTo(-25, -25);
        ctx.closePath();
        ctx.fill();
      }

      // Lateral RCS Translation Plumes (Q / E)
      if (s.rcsLeft && s.status === 'playing') {
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(12, -14);
        ctx.lineTo(32, -18);
        ctx.lineTo(32, -10);
        ctx.closePath();
        ctx.fill();
      }
      if (s.rcsRight && s.status === 'playing') {
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(-12, -14);
        ctx.lineTo(-32, -18);
        ctx.lineTo(-32, -10);
        ctx.closePath();
        ctx.fill();
      }

      // Landing Legs
      if (s.gearDeployed) {
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-9, -11);
        ctx.lineTo(-18, 0);
        ctx.moveTo(-23, 0);
        ctx.lineTo(-13, 0);

        ctx.moveTo(9, -11);
        ctx.lineTo(18, 0);
        ctx.moveTo(13, 0);
        ctx.lineTo(23, 0);
        ctx.stroke();
      }

      // Gold Foil Base + White Shuttle Cabin
      if (s.status !== 'crashed') {
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(-11, -18, 22, 11);
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 1;
        ctx.strokeRect(-11, -18, 22, 11);

        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.moveTo(-9, -18);
        ctx.lineTo(-5, -32);
        ctx.lineTo(5, -32);
        ctx.lineTo(9, -18);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#0284c7';
        ctx.fillRect(-4.5, -28, 9, 4);
      }
      ctx.restore();

      // Floating Sink Rate & Side Drift Callout
      if (s.status === 'playing') {
        const fastDrop = Math.abs(s.vy) > 4.2;
        ctx.fillStyle = fastDrop ? '#fca5a5' : '#86efac';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(
          `${fastDrop ? '⚠ BRAKE!' : '✓ SAFE'} ${Math.abs(s.vy).toFixed(1)} m/s`,
          lx + 26,
          ly - 20
        );
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px sans-serif';
        ctx.fillText(
          `Drift: ${s.vx > 0 ? '+' : ''}${s.vx.toFixed(1)} m/s`,
          lx + 26,
          ly - 7
        );
      }

      if (now - lastSync > 55) {
        lastSync = now;
        syncUi();
      }
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);

  const speedSafe = ui.speedDown <= 4.2;
  const tiltSafe = Math.abs(ui.tiltDeg) <= 12;

  return (
    <main style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={styles.badge}>🚀 SHUTTLE &amp; LM FLIGHT DECK</span>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>
              Use Attitude Pitch (<strong>A/D</strong>) + Side RCS Thrusters (<strong>Q/E</strong>) + Main Engine (<strong>Space</strong>)
            </span>
          </div>
          <h1 style={{ margin: '6px 0 0', fontSize: 23 }}>
            Moon Lander: Crater Touchdown
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={styles.scorePill}>
            🏆 HIGH SCORE: <strong style={{ color: '#facc15' }}>{highScore}</strong>
          </div>
          <div style={styles.scorePill}>
            🔥 STREAK: <strong style={{ color: '#38bdf8' }}>{streak}</strong>
          </div>
          <button
            type="button"
            onClick={(e) => {
              blurBtn(e);
              setMuted((m) => !m);
            }}
            style={styles.muteBtn}
            title="Toggle Sound Effects"
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      </header>

      {/* Main Split View: Left Descent Camera + Right Realistic Flight Console */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 18 }}>
        {/* Left: Descent Viewport */}
        <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', border: '1px solid #334155', background: '#02040a' }}>
          <canvas ref={canvasRef} width={580} height={415} style={{ width: '100%', height: 415, display: 'block' }} />

          {ui.status !== 'playing' && (
            <div style={styles.overlay}>
              {ui.status === 'ready' && (
                <>
                  <div style={{ fontSize: 38 }}>🛸</div>
                  <h2 style={{ margin: '8px 0 6px', fontSize: 22 }}>Ready for Powered Descent!</h2>
                  <p style={{ maxWidth: 400, fontSize: 13, color: '#cbd5e1', lineHeight: 1.5, marginBottom: 18 }}>
                    Your lander drops immediately on launch:<br />
                    • <strong>Throttle / Hold Space</strong> to brake below <strong>4.2 m/s</strong><br />
                    • <strong>A / D</strong> to tilt ship · <strong>Q / E</strong> to slide sideways with RCS jets<br />
                    • <strong>G</strong> to deploy Landing Legs before touching the <strong>2X Bullseye</strong>!
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      blurBtn(e);
                      launchMission();
                    }}
                    style={styles.bigLaunchBtn}
                  >
                    🚀 LAUNCH &amp; DROP!
                  </button>
                </>
              )}

              {ui.status === 'landed' && (
                <>
                  <div style={{ fontSize: 42 }}>🏆</div>
                  <h2 style={{ margin: '8px 0 6px', color: '#4ade80', fontSize: 22 }}>{ui.headline}</h2>
                  <p style={{ maxWidth: 400, fontSize: 13, color: '#e2e8f0', marginBottom: 18 }}>{ui.summary}</p>
                  <button
                    type="button"
                    onClick={(e) => {
                      blurBtn(e);
                      launchMission();
                    }}
                    style={styles.bigLaunchBtn}
                  >
                    🚀 PLAY AGAIN
                  </button>
                </>
              )}

              {ui.status === 'crashed' && (
                <>
                  <div style={{ fontSize: 42 }}>💥</div>
                  <h2 style={{ margin: '8px 0 6px', color: '#f87171', fontSize: 22 }}>{ui.headline}</h2>
                  <p style={{ maxWidth: 400, fontSize: 13, color: '#fca5a5', marginBottom: 18 }}>{ui.summary}</p>
                  <button
                    type="button"
                    onClick={(e) => {
                      blurBtn(e);
                      launchMission();
                    }}
                    style={styles.bigLaunchBtn}
                  >
                    🔄 TRY AGAIN
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Right: Realistic Shuttle / LM Push-Button & Throttle Console */}
        <div style={styles.cockpitPanel}>
          {/* Flight Telemetry Strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            <div style={styles.gauge}>
              <span style={styles.gaugeLabel}>HEIGHT</span>
              <strong style={{ fontSize: 17, color: '#38bdf8' }}>{Math.max(0, ui.altitude).toFixed(0)} m</strong>
            </div>

            <div style={styles.gauge}>
              <span style={styles.gaugeLabel}>DROP SPEED</span>
              <strong style={{ fontSize: 17, color: speedSafe ? '#4ade80' : '#f87171' }}>
                {ui.speedDown.toFixed(1)} m/s
              </strong>
            </div>

            <div style={styles.gauge}>
              <span style={styles.gaugeLabel}>TILT ANGLE</span>
              <strong style={{ fontSize: 17, color: tiltSafe ? '#e2e8f0' : '#facc15' }}>
                {ui.tiltDeg > 0 ? '+' : ''}{ui.tiltDeg.toFixed(0)}°
              </strong>
            </div>

            <div style={styles.gauge}>
              <span style={styles.gaugeLabel}>FUEL</span>
              <strong style={{ fontSize: 17, color: ui.fuelPct < 25 ? '#f87171' : '#4ade80' }}>
                {ui.fuelPct}%
              </strong>
            </div>
          </div>

          {/* 1. Analog Throttle Lever + Preset Push-Buttons */}
          <div style={styles.btnGroup}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={styles.groupTitle}>🔥 MAIN DESCENT THROTTLE: {ui.throttlePct}%</span>
              {ui.hoverHold && <span style={{ fontSize: 10, color: '#34d399', fontWeight: 800 }}>AUTO-HOVER LOCKED</span>}
            </div>

            {/* Analog Throttle Slider */}
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={ui.throttlePct}
              disabled={ui.status !== 'playing'}
              onChange={(e) => {
                simRef.current.hoverHold = false;
                simRef.current.throttle = Number(e.target.value) / 100;
                syncUi();
              }}
              style={{ width: '100%', marginTop: 8, accentColor: '#facc15', cursor: 'pointer' }}
            />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 8 }}>
              {[
                { label: 'CUTOFF 0%', val: 0, base: '#7f1d1d' },
                { label: '45% HOVER', val: 0.45, base: '#1e293b' },
                { label: '75% BRAKE', val: 0.75, base: '#1e293b' },
                { label: '100% MAX', val: 1.0, base: '#b45309' },
              ].map((b) => {
                const isOn = !ui.hoverHold && Math.abs(ui.throttlePct - b.val * 100) < 3;
                return (
                  <button
                    key={b.label}
                    type="button"
                    disabled={ui.status !== 'playing'}
                    onClick={(e) => {
                      blurBtn(e);
                      simRef.current.hoverHold = false;
                      simRef.current.throttle = b.val;
                      syncUi();
                    }}
                    style={{
                      ...styles.pushBtn,
                      background: isOn ? '#0284c7' : b.base,
                      borderColor: isOn ? '#38bdf8' : '#475569',
                    }}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 6, marginTop: 6 }}>
              <button
                type="button"
                disabled={ui.status !== 'playing'}
                onPointerDown={(e) => {
                  blurBtn(e);
                  simRef.current.prevThrottle = simRef.current.throttle;
                  simRef.current.boostHeld = true;
                  simRef.current.hoverHold = false;
                }}
                onPointerUp={() => {
                  if (simRef.current.boostHeld) {
                    simRef.current.boostHeld = false;
                    simRef.current.throttle = simRef.current.prevThrottle;
                  }
                }}
                onPointerLeave={() => {
                  if (simRef.current.boostHeld) {
                    simRef.current.boostHeld = false;
                    simRef.current.throttle = simRef.current.prevThrottle;
                  }
                }}
                style={{ ...styles.pushBtn, background: '#9a3412', borderColor: '#fb923c' }}
              >
                ⬆ HOLD BOOST (SPACE)
              </button>

              <button
                type="button"
                disabled={ui.status !== 'playing'}
                onClick={(e) => {
                  blurBtn(e);
                  simRef.current.hoverHold = !simRef.current.hoverHold;
                  syncUi();
                }}
                style={{
                  ...styles.pushBtn,
                  background: ui.hoverHold ? '#047857' : '#1e293b',
                  borderColor: ui.hoverHold ? '#34d399' : '#475569',
                }}
              >
                {ui.hoverHold ? '✨ AUTO-HOVER: ON' : '✨ AUTO-HOVER (H)'}
              </button>
            </div>
          </div>

          {/* 2. Attitude Pitch & SAS Hold */}
          <div style={styles.btnGroup}>
            <span style={styles.groupTitle}>🧭 ATTITUDE PITCH &amp; SAS HOLD</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.9fr 1fr', gap: 6, marginTop: 8 }}>
              <button
                type="button"
                disabled={ui.status !== 'playing'}
                onPointerDown={(e) => {
                  blurBtn(e);
                  simRef.current.pitchLeft = true;
                  simRef.current.angularVel -= 9;
                }}
                onPointerUp={() => {
                  simRef.current.pitchLeft = false;
                }}
                onPointerLeave={() => {
                  simRef.current.pitchLeft = false;
                }}
                style={styles.pushBtn}
              >
                ↺ PITCH L (A)
              </button>

              <button
                type="button"
                disabled={ui.status !== 'playing'}
                onPointerDown={(e) => {
                  blurBtn(e);
                  simRef.current.pitchRight = true;
                  simRef.current.angularVel += 9;
                }}
                onPointerUp={() => {
                  simRef.current.pitchRight = false;
                }}
                onPointerLeave={() => {
                  simRef.current.pitchRight = false;
                }}
                style={styles.pushBtn}
              >
                ↻ PITCH R (D)
              </button>

              <button
                type="button"
                disabled={ui.status !== 'playing'}
                onClick={(e) => {
                  blurBtn(e);
                  simRef.current.pitchDeg = 0;
                  simRef.current.angularVel = 0;
                  syncUi();
                }}
                style={{ ...styles.pushBtn, background: '#1e3a8a', borderColor: '#60a5fa' }}
              >
                LEVEL 0°
              </button>

              <button
                type="button"
                disabled={ui.status !== 'playing'}
                onClick={(e) => {
                  blurBtn(e);
                  simRef.current.sasHold = !simRef.current.sasHold;
                  syncUi();
                }}
                style={{
                  ...styles.pushBtn,
                  background: ui.sasHold ? '#0369a1' : '#1e293b',
                  borderColor: ui.sasHold ? '#38bdf8' : '#475569',
                }}
              >
                {ui.sasHold ? 'SAS: HOLD' : 'SAS: OFF'}
              </button>
            </div>
          </div>

          {/* 3. Lateral RCS Translation Thrusters (Slide Sideways onto Pad without Tilting!) */}
          <div style={styles.btnGroup}>
            <span style={styles.groupTitle}>💨 RCS SIDE THRUSTERS (SLIDE OVER PAD)</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                disabled={ui.status !== 'playing'}
                onPointerDown={(e) => {
                  blurBtn(e);
                  simRef.current.rcsLeft = true;
                  if (simRef.current.fuelKg > 0) simRef.current.vx -= 1.2;
                }}
                onPointerUp={() => {
                  simRef.current.rcsLeft = false;
                }}
                onPointerLeave={() => {
                  simRef.current.rcsLeft = false;
                }}
                style={{ ...styles.pushBtn, borderColor: '#38bdf8' }}
              >
                ◀ SLIDE LEFT (Q)
              </button>

              <button
                type="button"
                disabled={ui.status !== 'playing'}
                onPointerDown={(e) => {
                  blurBtn(e);
                  simRef.current.rcsRight = true;
                  if (simRef.current.fuelKg > 0) simRef.current.vx += 1.2;
                }}
                onPointerUp={() => {
                  simRef.current.rcsRight = false;
                }}
                onPointerLeave={() => {
                  simRef.current.rcsRight = false;
                }}
                style={{ ...styles.pushBtn, borderColor: '#38bdf8' }}
              >
                ▶ SLIDE RIGHT (E)
              </button>
            </div>
          </div>

          {/* 4. Landing Legs & Spotlight */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 8 }}>
            <button
              type="button"
              disabled={ui.status !== 'playing'}
              onClick={(e) => {
                blurBtn(e);
                simRef.current.gearDeployed = !simRef.current.gearDeployed;
                playSoundEffect('gear', mutedRef.current);
                syncUi();
              }}
              style={{
                ...styles.pushBtn,
                padding: '12px 10px',
                fontSize: 12,
                background: ui.gearDeployed ? '#15803d' : '#7c2d12',
                borderColor: ui.gearDeployed ? '#4ade80' : '#f97316',
              }}
            >
              {ui.gearDeployed ? '✅ LANDING LEGS READY' : '⚠ DEPLOY LANDING LEGS (G)'}
            </button>

            <button
              type="button"
              disabled={ui.status !== 'playing'}
              onClick={(e) => {
                blurBtn(e);
                simRef.current.spotlightOn = !simRef.current.spotlightOn;
                syncUi();
              }}
              style={{
                ...styles.pushBtn,
                padding: '12px 10px',
                background: ui.spotlightOn ? '#1e3a8a' : '#1e293b',
                borderColor: ui.spotlightOn ? '#60a5fa' : '#475569',
              }}
            >
              {ui.spotlightOn ? '🔦 SPOTLIGHT: ON' : '🔦 SPOTLIGHT: OFF'}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    background: '#060a14',
    color: '#e2e8f0',
    minHeight: '100vh',
    padding: '20px 28px',
    fontFamily: 'Inter, system-ui, sans-serif',
    maxWidth: '1240px',
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 18,
    paddingBottom: 14,
    borderBottom: '1px solid #1e293b',
  },
  badge: {
    background: '#0284c7',
    color: '#fff',
    fontSize: 11,
    fontWeight: 800,
    padding: '3px 9px',
    borderRadius: 5,
    letterSpacing: '0.05em',
  },
  scorePill: {
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: 20,
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 700,
  },
  muteBtn: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 15,
    cursor: 'pointer',
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(4, 7, 15, 0.84)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    textAlign: 'center',
  },
  bigLaunchBtn: {
    background: '#16a34a',
    color: '#fff',
    border: '1px solid #4ade80',
    borderRadius: 12,
    padding: '13px 26px',
    fontSize: 15,
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 0 22px rgba(74, 222, 128, 0.38)',
  },
  cockpitPanel: {
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: 14,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: 10,
  },
  gauge: {
    background: '#060a14',
    border: '1px solid #1e293b',
    borderRadius: 10,
    padding: '9px 6px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
  },
  gaugeLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: '#94a3b8',
    marginBottom: 3,
    letterSpacing: '0.05em',
  },
  btnGroup: {
    background: '#090f1d',
    border: '1px solid #1e293b',
    borderRadius: 12,
    padding: '10px 12px',
  },
  groupTitle: {
    fontSize: 11,
    fontWeight: 800,
    color: '#94a3b8',
    letterSpacing: '0.06em',
  },
  pushBtn: {
    background: '#1e293b',
    color: '#f8fafc',
    border: '1px solid #475569',
    borderRadius: 8,
    padding: '10px 6px',
    fontSize: 11,
    fontWeight: 800,
    cursor: 'pointer',
    textAlign: 'center',
    userSelect: 'none',
  },
};