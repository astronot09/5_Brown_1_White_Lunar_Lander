import React, { useEffect, useRef, useState, useCallback } from 'react';

type EnvironmentId = 'MOON' | 'MARS';
type FailureType = 'COMMS_BLACKOUT' | 'RCS_LOCK' | 'THROTTLE_JAM' | 'RADAR_STATIC';
type Severity = 'NOMINAL' | 'CAUTION' | 'CRITICAL';
type LunaPose = 'nominal' | 'caution' | 'critical' | 'celebrate' | 'blackout';

interface EnvConfig {
  id: EnvironmentId;
  label: string;
  gravity: number; // m/s^2
  atmoDensity: number; // kg/m^3
  dragArea: number; // m^2
  skyTop: string;
  skyBottom: string;
  groundFill: string;
  ridgeFill: string;
  horizonStroke: string;
  dustRgb: string;
  ambientLight: number; // 0..1
}

const ENVIRONMENTS: Record<EnvironmentId, EnvConfig> = {
  MOON: {
    id: 'MOON',
    label: 'MOON · Mare Tranquillitatis (Vacuum)',
    gravity: 1.62,
    atmoDensity: 0,
    dragArea: 0,
    skyTop: '#02040a',
    skyBottom: '#091122',
    groundFill: '#1e293b',
    ridgeFill: '#0f172a',
    horizonStroke: '#64748b',
    dustRgb: '203, 213, 225',
    ambientLight: 0.38,
  },
  MARS: {
    id: 'MARS',
    label: 'MARS · Jezero Crater (Thin CO₂ Atmo)',
    gravity: 3.72,
    atmoDensity: 0.02,
    dragArea: 11.5,
    skyTop: '#1c0f0a',
    skyBottom: '#451a0d',
    groundFill: '#5c2614',
    ridgeFill: '#3b160b',
    horizonStroke: '#c26d4a',
    dustRgb: '234, 158, 108',
    ambientLight: 0.62,
  },
};

const DRY_MASS_KG = 4000;
const INITIAL_FUEL_KG = 1200;
const MAX_THRUST_N = 19500;
const RCS_LAT_THRUST_N = 4600;
const FUEL_BURN_RATE = 5.8; // kg/s at 100% thrust
const SUB_DT = 0.005; // 200 Hz fixed physics integration step

interface LogEntry {
  id: number;
  timeStr: string;
  level: 'INFO' | 'WARN' | 'CRIT' | 'SYS';
  text: string;
}

interface FailureState {
  type: FailureType;
  phase: 'WARNING' | 'ACTIVE';
  timer: number;
  label: string;
  detail: string;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function formatMissionTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `T+${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

// Singleton AudioContext so repeated sound effects never leak audio hardware nodes
let sharedAudioCtx: AudioContext | null = null;
function playSoundEffect(type: 'gear' | 'ring' | 'win' | 'crash' | 'warn', muted: boolean) {
  if (muted) return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume();
    }
    const ctx = sharedAudioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === 'gear') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(190, now);
      osc.frequency.exponentialRampToValueAtTime(95, now + 0.16);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.18);
    } else if (type === 'ring') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(880, now + 0.09);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.start(now);
      osc.stop(now + 0.28);
    } else if (type === 'warn') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.setValueAtTime(440, now + 0.1);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
    } else if (type === 'win') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(554.37, now + 0.12);
      osc.frequency.setValueAtTime(659.25, now + 0.24);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      osc.start(now);
      osc.stop(now + 0.55);
    } else if (type === 'crash') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(32, now + 0.45);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.start(now);
      osc.stop(now + 0.45);
    }
  } catch {
    // Ignore blocked audio
  }
}

/**
 * Procedural crater terrain heightmap (meters relative to pad datum)
 */
function getTerrainHeight(wx: number, padSlopeDeg: number): number {
  const slopeRad = (padSlopeDeg * Math.PI) / 180;
  // Flat-ish sloped landing pad between -48m and +48m
  if (Math.abs(wx) <= 48) {
    return wx * Math.tan(slopeRad);
  }
  const edgeHeight = (wx > 0 ? 48 : -48) * Math.tan(slopeRad);
  const distOut = Math.abs(wx) - 48;
  const blend = clamp(distOut / 35, 0, 1);
  const rugged =
    Math.sin(wx * 0.045) * 9 +
    Math.cos(wx * 0.11) * 4.5 +
    Math.sin(wx * 0.27) * 1.8;
  return edgeHeight + blend * (rugged + 6);
}

function getTerrainSlopeDeg(wx: number, padSlopeDeg: number): number {
  const h1 = getTerrainHeight(wx - 1.5, padSlopeDeg);
  const h2 = getTerrainHeight(wx + 1.5, padSlopeDeg);
  return (Math.atan2(h2 - h1, 3.0) * 180) / Math.PI;
}

/**
 * Articulated Humanoid Assistant Avatar ("LUNA")
 */
function LunaHumanoidAvatar({
  pose,
  speaking,
  blackout,
}: {
  pose: LunaPose;
  speaking: boolean;
  blackout: boolean;
}) {
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      setBlink(true);
      window.setTimeout(() => setBlink(false), 150);
    }, 3400);
    return () => window.clearInterval(id);
  }, []);

  const accent =
    blackout || pose === 'blackout'
      ? '#94a3b8'
      : pose === 'critical'
        ? '#f87171'
        : pose === 'caution'
          ? '#facc15'
          : pose === 'celebrate'
            ? '#4ade80'
            : '#38bdf8';

  const leftArmPath =
    pose === 'celebrate'
      ? 'M 33 66 C 18 52, 16 36, 23 26'
      : pose === 'critical'
        ? 'M 33 66 C 18 62, 14 50, 22 42'
        : 'M 33 66 C 20 72, 18 86, 25 94';

  const rightArmPath =
    pose === 'celebrate'
      ? 'M 77 66 C 92 52, 94 36, 87 26'
      : pose === 'caution' || pose === 'critical'
        ? 'M 77 66 C 92 60, 96 48, 88 40'
        : 'M 77 66 C 90 72, 92 86, 85 94';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: `radial-gradient(circle at 50% 42%, ${accent}22, #060a14 75%)`,
        border: `1px solid ${accent}66`,
        borderRadius: 12,
        padding: '10px 8px 8px',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 10,
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.07em',
          color: accent,
        }}
      >
        ● {blackout ? 'LINK LOST' : pose.toUpperCase()}
      </div>

      <svg width="106" height="122" viewBox="0 0 110 128" fill="none">
        {/* EVA Backpack */}
        <rect x="30" y="54" width="50" height="36" rx="9" fill="#1e293b" stroke="#475569" strokeWidth="1.5" />
        {/* Comms Antenna */}
        <line x1="55" y1="8" x2="55" y2="18" stroke={accent} strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="55" cy="7" r="3.5" fill={accent} />

        {/* Helmet */}
        <rect x="31" y="17" width="48" height="38" rx="18" fill="#f8fafc" stroke="#94a3b8" strokeWidth="1.6" />
        {/* Visor */}
        <rect x="37" y="24" width="36" height="23" rx="11" fill="#060a14" stroke={accent} strokeWidth="1.5" />

        {/* Eyes or Static */}
        {blackout ? (
          <text x="55" y="39" textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="monospace" fontWeight="bold">
            NO SIG
          </text>
        ) : blink ? (
          <>
            <line x1="43" y1="34" x2="50" y2="34" stroke={accent} strokeWidth="2.2" strokeLinecap="round" />
            <line x1="60" y1="34" x2="67" y2="34" stroke={accent} strokeWidth="2.2" strokeLinecap="round" />
          </>
        ) : (
          <>
            <circle cx="46.5" cy="34" r="3" fill={accent} />
            <circle cx="63.5" cy="34" r="3" fill={accent} />
          </>
        )}

        {/* Voice Waveform Bars inside Visor */}
        {!blackout && (
          <g opacity={speaking ? 0.95 : 0.35}>
            <rect x="47" y={speaking ? 40 : 42} width="2.5" height={speaking ? 4 : 2} rx="1" fill={accent} />
            <rect x="51.5" y={speaking ? 39 : 42} width="2.5" height={speaking ? 6 : 2} rx="1" fill={accent} />
            <rect x="56" y={speaking ? 40 : 42} width="2.5" height={speaking ? 5 : 2} rx="1" fill={accent} />
            <rect x="60.5" y={speaking ? 41 : 42} width="2.5" height={speaking ? 3 : 2} rx="1" fill={accent} />
          </g>
        )}

        {/* Torso */}
        <rect x="34" y="58" width="42" height="34" rx="11" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1.6" />
        {/* Chest Telemetry Display */}
        <rect x="44" y="66" width="22" height="13" rx="3.5" fill="#0f172a" stroke={accent} strokeWidth="1.3" />
        <circle cx="51" cy="72.5" r="2.3" fill={accent} />
        <line x1="56" y1="71" x2="62" y2="71" stroke={accent} strokeWidth="1.5" />
        <line x1="56" y1="74.5" x2="60" y2="74.5" stroke="#94a3b8" strokeWidth="1.5" />

        {/* Articulated Arms */}
        <path d={leftArmPath} stroke="#e2e8f0" strokeWidth="7" strokeLinecap="round" />
        <path d={rightArmPath} stroke="#e2e8f0" strokeWidth="7" strokeLinecap="round" />

        {/* Legs & Boots */}
        <path d="M 45 92 L 42 114" stroke="#cbd5e1" strokeWidth="7.5" strokeLinecap="round" />
        <path d="M 65 92 L 68 114" stroke="#cbd5e1" strokeWidth="7.5" strokeLinecap="round" />
        <rect x="35" y="112" width="13" height="6" rx="3" fill="#334155" />
        <rect x="62" y="112" width="13" height="6" rx="3" fill="#334155" />
      </svg>

      <div style={{ fontSize: 11, fontWeight: 800, color: '#f8fafc', letterSpacing: '0.06em' }}>
        LUNA · AI CAPCOM
      </div>
    </div>
  );
}

export default function LunarSurvivalGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [muted, setMuted] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const voiceRef = useRef(voiceOn);
  voiceRef.current = voiceOn;

  const [envId, setEnvId] = useState<EnvironmentId>('MOON');
  const envRef = useRef<EnvironmentId>(envId);
  envRef.current = envId;

  const [highScore, setHighScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [logList, setLogList] = useState<LogEntry[]>([
    {
      id: 1,
      timeStr: 'T+00:00.0',
      level: 'SYS',
      text: 'LUNA CAPCOM online. Guidance aligned to Crater Pad 01.',
    },
  ]);
  const logIdRef = useRef(2);

  const pushLog = useCallback((level: LogEntry['level'], text: string, simTimeSec = 0) => {
    setLogList((prev) => {
      const entry: LogEntry = {
        id: logIdRef.current++,
        timeStr: formatMissionTime(simTimeSec),
        level,
        text,
      };
      return [entry, ...prev].slice(0, 26);
    });
  }, []);

  const speakLine = useCallback((text: string) => {
    if (!voiceRef.current || mutedRef.current) return;
    try {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.06;
        u.pitch = 1.08;
        window.speechSynthesis.speak(u);
      }
    } catch {
      // Ignore speech synthesis errors
    }
  }, []);

  const simRef = useRef({
    missionTime: 0,
    x: -135,
    y: 215, // World Y above datum (m)
    vx: 9.0,
    vy: -3.5,
    prevVy: -3.5,
    pitchDeg: -8,
    angularVel: 0,
    fuelKg: INITIAL_FUEL_KG,
    cmdThrottle: 0,
    actualThrottle: 0,
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
    padSlopeDeg: 2.2,
    dustAccumulation: 0, // 0..100%
    stormIntensity: 0, // 0..1 (Mars dust storm or lunar electrostatic ejecta)
    stormWindX: 0,
    failure: null as FailureState | null,
    nextFailureAt: 11,
    balancingTimer: 0,
    isBalancing: false,
    bonusRing: { x: -45, y: 115, collected: false },
    status: 'ready' as 'ready' | 'playing' | 'landed' | 'crashed',
    headline: '',
    summary: '',
    lastScore: 0,
    lunaSpeech: 'Systems nominal. Press LAUNCH & START DESCENT when ready for powered approach.',
    lunaPose: 'nominal' as LunaPose,
    lunaSpeakingTimer: 0,
    lastAdviceTime: -10,
    dust: [] as { x: number; y: number; vx: number; vy: number; life: number }[],
    sparks: [] as { x: number; y: number; vx: number; vy: number; life: number; color: string }[],
  });

  const [ui, setUi] = useState({
    altitudeAgl: 215,
    speedDown: 3.5,
    speedSide: 9.0,
    padDistance: -135,
    padSlopeDeg: 2.2,
    tiltDeg: -8,
    fuelPct: 100,
    fuelKg: INITIAL_FUEL_KG,
    cmdThrottlePct: 0,
    actualThrottlePct: 0,
    gearDeployed: false,
    sasHold: true,
    hoverHold: false,
    spotlightOn: true,
    dustPct: 0,
    stormPct: 0,
    failure: null as FailureState | null,
    isBalancing: false,
    balancingPct: 0,
    status: 'ready' as 'ready' | 'playing' | 'landed' | 'crashed',
    headline: '',
    summary: '',
    lastScore: 0,
    lunaSpeech: 'Systems nominal. Press LAUNCH & START DESCENT when ready for powered approach.',
    lunaPose: 'nominal' as LunaPose,
    lunaSpeaking: false,
  });

  const setLunaMessage = useCallback(
    (msg: string, pose: LunaPose, level: LogEntry['level'] = 'INFO', speak = false) => {
      const s = simRef.current;
      if (s.failure?.type === 'COMMS_BLACKOUT' && s.failure.phase === 'ACTIVE') return;
      if (s.lunaSpeech === msg && s.missionTime - s.lastAdviceTime < 4.5) return;
      s.lunaSpeech = msg;
      s.lunaPose = pose;
      s.lunaSpeakingTimer = 2.4;
      s.lastAdviceTime = s.missionTime;
      pushLog(level, msg, s.missionTime);
      if (speak) speakLine(msg);
    },
    [pushLog, speakLine],
  );

  const syncUi = useCallback(() => {
    const s = simRef.current;
    const terrainH = getTerrainHeight(s.x, s.padSlopeDeg);
    const agl = Math.max(0, s.y - terrainH);
    const radarScrambled = s.failure?.type === 'RADAR_STATIC' && s.failure.phase === 'ACTIVE';

    setUi({
      altitudeAgl: radarScrambled ? agl + (Math.random() - 0.5) * 28 : agl,
      speedDown: radarScrambled ? Math.abs(s.vy) + (Math.random() - 0.5) * 2.5 : Math.abs(s.vy),
      speedSide: s.vx,
      padDistance: s.x,
      padSlopeDeg: s.padSlopeDeg,
      tiltDeg: s.pitchDeg,
      fuelPct: Math.round((s.fuelKg / INITIAL_FUEL_KG) * 100),
      fuelKg: Math.round(s.fuelKg),
      cmdThrottlePct: Math.round(s.cmdThrottle * 100),
      actualThrottlePct: Math.round(s.actualThrottle * 100),
      gearDeployed: s.gearDeployed,
      sasHold: s.sasHold,
      hoverHold: s.hoverHold,
      spotlightOn: s.spotlightOn,
      dustPct: Math.round(s.dustAccumulation),
      stormPct: Math.round(s.stormIntensity * 100),
      failure: s.failure ? { ...s.failure } : null,
      isBalancing: s.isBalancing,
      balancingPct: Math.round((s.balancingTimer / 1.6) * 100),
      status: s.status,
      headline: s.headline,
      summary: s.summary,
      lastScore: s.lastScore,
      lunaSpeech: s.lunaSpeech,
      lunaPose: s.lunaPose,
      lunaSpeaking: s.lunaSpeakingTimer > 0,
    });
  }, []);

  const triggerFailure = useCallback(
    (type: FailureType) => {
      const s = simRef.current;
      if (s.status !== 'playing' || s.failure) return;

      const meta: Record<FailureType, { label: string; detail: string; warnMsg: string }> = {
        COMMS_BLACKOUT: {
          label: 'S-BAND COMMS BLACKOUT',
          detail: 'Terrain multipath & solar interference disrupting CAPCOM downlink.',
          warnMsg: 'Heads up! S-Band interference rising—CAPCOM link may drop out in 2.5 seconds.',
        },
        RCS_LOCK: {
          label: 'RCS MANIFOLD VALVE LOCK',
          detail: 'Lateral cold-gas translation jets (Q/E) temporarily locked.',
          warnMsg: 'Caution! Lateral RCS manifold pressure spiking—Q/E side jets will lock in 2.5 seconds!',
        },
        THROTTLE_JAM: {
          label: 'THROTTLE ACTUATOR JAM',
          detail: 'Main engine throttle valve frozen at current setting.',
          warnMsg: 'Warning! Main throttle actuator sluggish—set desired thrust now before valve locks!',
        },
        RADAR_STATIC: {
          label: 'LANDING RADAR INTERFERENCE',
          detail: 'Altimeter and sink-rate readouts experiencing multipath noise.',
          warnMsg: 'Caution! Landing radar noise increasing—watch visual horizon and terrain spotlight!',
        },
      };

      const info = meta[type];
      s.failure = {
        type,
        phase: 'WARNING',
        timer: 2.5,
        label: info.label,
        detail: info.detail,
      };
      playSoundEffect('warn', mutedRef.current);
      setLunaMessage(info.warnMsg, 'caution', 'WARN', true);
      syncUi();
    },
    [setLunaMessage, syncUi],
  );

  const launchMission = useCallback(() => {
    const startLeft = Math.random() > 0.35;
    const startX = startLeft ? -135 - Math.random() * 30 : 135 + Math.random() * 30;
    const startVx = startLeft ? 8.5 + Math.random() * 3.0 : -8.5 - Math.random() * 3.0;
    const padSlopeDeg = Number(((Math.random() - 0.5) * 8.4).toFixed(1)); // -4.2° to +4.2°

    simRef.current = {
      missionTime: 0,
      x: startX,
      y: 215,
      vx: startVx,
      vy: -3.5,
      prevVy: -3.5,
      pitchDeg: startLeft ? -8 : 8,
      angularVel: 0,
      fuelKg: INITIAL_FUEL_KG,
      cmdThrottle: 0,
      actualThrottle: 0,
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
      padSlopeDeg,
      dustAccumulation: 0,
      stormIntensity: envRef.current === 'MARS' ? 0.35 : 0.08,
      stormWindX: 0,
      failure: null,
      nextFailureAt: 9 + Math.random() * 6,
      balancingTimer: 0,
      isBalancing: false,
      bonusRing: {
        x: startX * 0.35 + (Math.random() - 0.5) * 24,
        y: 112 + Math.random() * 22,
        collected: false,
      },
      status: 'playing',
      headline: '',
      summary: '',
      lastScore: 0,
      lunaSpeech: `Powered descent initiated! Pad 01 grade is ${padSlopeDeg > 0 ? '+' : ''}${padSlopeDeg.toFixed(1)}°. Null lateral drift with Q/E and deploy gear (G) before touchdown.`,
      lunaPose: 'nominal',
      lunaSpeakingTimer: 3.0,
      lastAdviceTime: 0,
      dust: [],
      sparks: [],
    };
    pushLog('SYS', `Mission started (${ENVIRONMENTS[envRef.current].label}). Pad grade ${padSlopeDeg}°.`, 0);
    syncUi();
  }, [pushLog, syncUi]);

  const blurBtn = (e: React.SyntheticEvent<HTMLButtonElement>) => {
    if (e.currentTarget?.blur) e.currentTarget.blur();
  };

  // Keyboard Flight Controls + Blur/Visibility Safety
  useEffect(() => {
    const clearHeldInputs = () => {
      const s = simRef.current;
      s.pitchLeft = false;
      s.pitchRight = false;
      s.rcsLeft = false;
      s.rcsRight = false;
      if (s.boostHeld) {
        s.boostHeld = false;
        s.cmdThrottle = s.prevThrottle;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const s = simRef.current;
      if (e.code === 'Space') e.preventDefault();

      if (s.status !== 'playing' && (e.code === 'Space' || e.code === 'Enter')) {
        launchMission();
        return;
      }
      if (s.status !== 'playing') return;

      const rcsLocked = s.failure?.type === 'RCS_LOCK' && s.failure.phase === 'ACTIVE';
      const throttleJammed = s.failure?.type === 'THROTTLE_JAM' && s.failure.phase === 'ACTIVE';

      // Attitude Pitch (A/D or Arrows)
      if ((e.code === 'ArrowLeft' || e.code === 'KeyA') && !s.pitchLeft) {
        s.pitchLeft = true;
        s.angularVel -= 8;
      }
      if ((e.code === 'ArrowRight' || e.code === 'KeyD') && !s.pitchRight) {
        s.pitchRight = true;
        s.angularVel += 8;
      }

      // Lateral RCS Jets (Q / E)
      if (e.code === 'KeyQ' && !s.rcsLeft) {
        if (rcsLocked) {
          setLunaMessage('RCS manifold is locked! Tilt slightly left with A and pulse main engine instead.', 'caution', 'WARN');
        } else {
          s.rcsLeft = true;
          if (s.fuelKg > 0) s.vx -= 0.95;
          if (s.x < -55 && s.vx < -3) {
            setLunaMessage('Careful! Firing Q pushes you further left away from Pad 01. Use E to slide right.', 'caution', 'WARN');
          }
        }
      }
      if (e.code === 'KeyE' && !s.rcsRight) {
        if (rcsLocked) {
          setLunaMessage('RCS manifold is locked! Tilt slightly right with D and pulse main engine instead.', 'caution', 'WARN');
        } else {
          s.rcsRight = true;
          if (s.fuelKg > 0) s.vx += 0.95;
          if (s.x > 55 && s.vx > 3) {
            setLunaMessage('Careful! Firing E pushes you further right past Pad 01. Use Q to brake left.', 'caution', 'WARN');
          }
        }
      }

      // Throttle Commands
      if (e.code === 'Space' && !s.boostHeld) {
        if (throttleJammed) {
          setLunaMessage('Throttle actuator is jammed! Use pitch attitude (A/D) to manage descent vector until recovery.', 'caution', 'WARN');
        } else {
          s.prevThrottle = s.cmdThrottle;
          s.boostHeld = true;
          s.hoverHold = false;
        }
      }
      if (e.code === 'ArrowUp' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (!throttleJammed) {
          s.hoverHold = false;
          s.cmdThrottle = clamp(s.cmdThrottle + 0.1, 0, 1);
        }
      }
      if (e.code === 'ArrowDown' || e.code === 'ControlLeft' || e.code === 'ControlRight') {
        if (!throttleJammed) {
          s.hoverHold = false;
          s.cmdThrottle = clamp(s.cmdThrottle - 0.1, 0, 1);
        }
      }
      if (e.code === 'KeyX' && !throttleJammed) {
        s.hoverHold = false;
        s.cmdThrottle = 0;
        if (s.y - getTerrainHeight(s.x, s.padSlopeDeg) < 70 && Math.abs(s.vy) > 4.5) {
          setLunaMessage('Warning! Engine cut off at low altitude while descending fast—increase throttle immediately!', 'critical', 'CRIT');
        }
      }
      if (e.code === 'KeyZ' && !throttleJammed) {
        s.hoverHold = false;
        s.cmdThrottle = 1;
      }
      if (e.code === 'KeyH' && !throttleJammed) {
        s.hoverHold = !s.hoverHold;
      }

      // Landing Legs (G)
      if (e.code === 'KeyG') {
        s.gearDeployed = !s.gearDeployed;
        playSoundEffect('gear', mutedRef.current);
        const agl = s.y - getTerrainHeight(s.x, s.padSlopeDeg);
        if (!s.gearDeployed && agl < 65) {
          setLunaMessage('Warning! You retracted the landing legs below 65 meters! Press G to re-deploy before touchdown.', 'critical', 'CRIT');
        }
      }

      if (e.code === 'KeyT') {
        s.sasHold = !s.sasHold;
      }
      if (e.code === 'KeyR') {
        s.pitchDeg = 0;
        s.angularVel = 0;
      }
      if (e.code === 'KeyL') {
        s.spotlightOn = !s.spotlightOn;
      }
      if (e.code === 'KeyC') {
        s.dustAccumulation = 0;
        setLunaMessage('Optical sensor wiper cycled. Viewport clarity restored to 100%.', 'nominal', 'SYS');
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
        if (!(s.failure?.type === 'THROTTLE_JAM' && s.failure.phase === 'ACTIVE')) {
          s.cmdThrottle = s.prevThrottle;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearHeldInputs);
    document.addEventListener('visibilitychange', clearHeldInputs);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearHeldInputs);
      document.removeEventListener('visibilitychange', clearHeldInputs);
    };
  }, [launchMission, setLunaMessage, syncUi]);

  // 200 Hz Physics Integration & 60 FPS Canvas Renderer
  useEffect(() => {
    let frameId = 0;
    let lastTime = performance.now();
    let lastUiSync = 0;
    let accumulator = 0;

    const tick = (now: number) => {
      frameId = requestAnimationFrame(tick);
      const frameDt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const s = simRef.current;
      const env = ENVIRONMENTS[envRef.current];
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (s.lunaSpeakingTimer > 0) {
        s.lunaSpeakingTimer = Math.max(0, s.lunaSpeakingTimer - frameDt);
      }

      // 1. Sub-stepped SI Physics Loop (200 Hz)
      if (s.status === 'playing') {
        accumulator += frameDt;
        while (accumulator >= SUB_DT) {
          accumulator -= SUB_DT;
          s.missionTime += SUB_DT;

          // Scheduled static failure progression
          if (s.failure) {
            s.failure.timer -= SUB_DT;
            if (s.failure.timer <= 0) {
              if (s.failure.phase === 'WARNING') {
                s.failure.phase = 'ACTIVE';
                s.failure.timer = 9.0;
                if (s.failure.type === 'COMMS_BLACKOUT') {
                  s.lunaPose = 'blackout';
                  s.lunaSpeech = '[S-BAND CARRIER LOST — AUTONOMOUS DESCENT ACTIVE]';
                  pushLog('CRIT', 'S-Band communications blackout active (9.0s).', s.missionTime);
                } else {
                  setLunaMessage(`Alert! ${s.failure.label} is now active for 9 seconds. Adapt your approach!`, 'critical', 'CRIT', true);
                }
              } else {
                const recovered = s.failure.label;
                s.failure = null;
                s.nextFailureAt = s.missionTime + 15 + Math.random() * 8;
                setLunaMessage(`${recovered} cleared. Nominal cockpit authority restored.`, 'nominal', 'SYS');
              }
            }
          } else if (s.missionTime >= s.nextFailureAt && s.y - getTerrainHeight(s.x, s.padSlopeDeg) > 38) {
            const pool: FailureType[] = ['COMMS_BLACKOUT', 'RCS_LOCK', 'THROTTLE_JAM', 'RADAR_STATIC'];
            const pick = pool[Math.floor(Math.random() * pool.length)]!;
            triggerFailure(pick);
          }

          const mass = DRY_MASS_KG + s.fuelKg;
          const inertiaFactor = mass / (DRY_MASS_KG + INITIAL_FUEL_KG); // Lighter ship rotates faster
          const throttleJammed = s.failure?.type === 'THROTTLE_JAM' && s.failure.phase === 'ACTIVE';

          if (!throttleJammed) {
            if (s.boostHeld) {
              s.cmdThrottle = 1.0;
            } else if (s.hoverHold && s.fuelKg > 0) {
              const cosP = Math.max(0.35, Math.cos((s.pitchDeg * Math.PI) / 180));
              const neededThrust = (mass * (env.gravity - s.vy * 2.4)) / cosP;
              s.cmdThrottle = clamp(neededThrust / MAX_THRUST_N, 0, 1);
            }
          }

          if (s.fuelKg <= 0) {
            s.cmdThrottle = 0;
            s.hoverHold = false;
          }

          // First-order engine spool lag (tau = 0.16s)
          const spoolTau = 0.16;
          s.actualThrottle += ((s.fuelKg > 0 ? s.cmdThrottle : 0) - s.actualThrottle) * (SUB_DT / spoolTau);
          if (s.actualThrottle < 0.002) s.actualThrottle = 0;

          // Propellant burn
          s.fuelKg = Math.max(0, s.fuelKg - s.actualThrottle * FUEL_BURN_RATE * SUB_DT);

          // Attitude pitch dynamics
          const pitchTorque = 96 / Math.max(0.72, inertiaFactor);
          if (s.pitchLeft) s.angularVel -= pitchTorque * SUB_DT;
          if (s.pitchRight) s.angularVel += pitchTorque * SUB_DT;

          if (!s.pitchLeft && !s.pitchRight) {
            if (s.sasHold) {
              s.angularVel *= Math.exp(-8.0 * SUB_DT);
              if (Math.abs(s.angularVel) < 0.15) s.angularVel = 0;
            } else {
              s.angularVel *= Math.exp(-0.6 * SUB_DT);
            }
          }
          s.angularVel = clamp(s.angularVel, -95, 95);
          s.pitchDeg = clamp(s.pitchDeg + s.angularVel * SUB_DT, -78, 78);

          // Main engine thrust vector
          const thrustN = s.actualThrottle * MAX_THRUST_N;
          const rad = (s.pitchDeg * Math.PI) / 180;

          // Lateral RCS cold-gas translation jets
          const rcsLocked = s.failure?.type === 'RCS_LOCK' && s.failure.phase === 'ACTIVE';
          let rcsForceX = 0;
          if (!rcsLocked && s.fuelKg > 0) {
            if (s.rcsLeft) {
              rcsForceX -= RCS_LAT_THRUST_N;
              s.fuelKg = Math.max(0, s.fuelKg - 0.55 * SUB_DT);
            }
            if (s.rcsRight) {
              rcsForceX += RCS_LAT_THRUST_N;
              s.fuelKg = Math.max(0, s.fuelKg - 0.55 * SUB_DT);
            }
          }

          // Environmental disturbance (Mars dust storm gust vs Moon vacuum plume/electrostatic ejecta)
          const terrainH = getTerrainHeight(s.x, s.padSlopeDeg);
          const agl = Math.max(0, s.y - terrainH);

          if (env.id === 'MARS') {
            const wave = 0.5 + 0.5 * Math.sin(s.missionTime * 0.35);
            s.stormIntensity = clamp(0.25 + wave * 0.65, 0, 1);
            s.stormWindX = Math.sin(s.missionTime * 0.9) * 14 * s.stormIntensity;
          } else {
            // Moon has NO atmosphere: dust is purely from supersonic engine exhaust blowback near surface
            const plumeBlowback = agl < 46 ? (1 - agl / 46) * s.actualThrottle : 0;
            s.stormIntensity = clamp(plumeBlowback * 1.15, 0, 1);
            s.stormWindX = 0;
          }

          if (s.stormIntensity > 0.15) {
            s.dustAccumulation = clamp(s.dustAccumulation + s.stormIntensity * 4.2 * SUB_DT, 0, 100);
          }

          // Aerodynamic drag (0 on Moon, active on Mars)
          const relVx = s.vx - s.stormWindX;
          const dragFx = -0.5 * env.atmoDensity * env.dragArea * relVx * Math.abs(relVx);
          const dragFy = -0.5 * env.atmoDensity * env.dragArea * s.vy * Math.abs(s.vy);

          const ax = (thrustN * Math.sin(rad) + rcsForceX + dragFx) / mass;
          const ay = (thrustN * Math.cos(rad) + dragFy) / mass - env.gravity;

          s.prevVy = s.vy;
          s.vx += ax * SUB_DT;
          s.vy += ay * SUB_DT;
          s.x += s.vx * SUB_DT;
          s.y += s.vy * SUB_DT;

          // Bonus Star Ring check
          if (!s.bonusRing.collected) {
            const dRing = Math.hypot(s.x - s.bonusRing.x, s.y + 10 - s.bonusRing.y);
            if (dRing < 20) {
              s.bonusRing.collected = true;
              playSoundEffect('ring', mutedRef.current);
              setLunaMessage('Telemetry ring captured! +250 bonus points logged.', 'celebrate', 'INFO');
              for (let i = 0; i < 16; i++) {
                const a = (i / 16) * Math.PI * 2;
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

          // Ground Touchdown & Strut Slope Balancing
          const localGroundY = getTerrainHeight(s.x, s.padSlopeDeg);
          if (s.y <= localGroundY) {
            s.y = localGroundY;
            const downSpeed = Math.abs(s.vy);
            const sideSpeed = Math.abs(s.vx);
            const localSlope = getTerrainSlopeDeg(s.x, s.padSlopeDeg);
            const relTilt = Math.abs(s.pitchDeg - localSlope);

            if (!s.isBalancing) {
              const initialSafe = downSpeed <= 4.3 && sideSpeed <= 3.1 && relTilt <= 12 && s.gearDeployed;
              if (!initialSafe) {
                s.status = 'crashed';
                s.cmdThrottle = 0;
                s.actualThrottle = 0;
                playSoundEffect('crash', mutedRef.current);
                setStreak(0);

                const issues: string[] = [];
                if (!s.gearDeployed) issues.push('Landing legs were NOT deployed (G)');
                if (downSpeed > 4.3) issues.push(`Vertical impact too hard (${downSpeed.toFixed(1)} m/s > 4.3 m/s)`);
                if (sideSpeed > 3.1) issues.push(`Lateral drift too high (${sideSpeed.toFixed(1)} m/s)`);
                if (relTilt > 12) issues.push(`Slope mismatch too steep (${relTilt.toFixed(0)}° off terrain)`);

                s.headline = '💥 HARD IMPACT — LANDER DAMAGED';
                s.summary = issues.join(' · ');
                setLunaMessage(`Touchdown failure! ${issues[0] ?? 'Excessive impact energy'}.`, 'critical', 'CRIT', true);

                for (let i = 0; i < 28; i++) {
                  const a = Math.random() * Math.PI;
                  const spd = 8 + Math.random() * 34;
                  s.sparks.push({
                    x: s.x,
                    y: localGroundY + 2,
                    vx: Math.cos(a) * spd * (Math.random() > 0.5 ? 1 : -1),
                    vy: Math.sin(a) * spd,
                    life: 1.2,
                    color: i % 2 === 0 ? '#f97316' : '#facc15',
                  });
                }
                break;
              } else {
                s.isBalancing = true;
                s.balancingTimer = 0;
                s.vy = 0;
                s.vx *= 0.25;
                setLunaMessage(
                  `Contact! Struts settling on ${localSlope.toFixed(1)}° slope—hold attitude steady with A/D for 1.6s!`,
                  'caution',
                  'WARN',
                );
              }
            }

            if (s.isBalancing) {
              s.vy = 0;
              s.vx *= Math.exp(-4.5 * SUB_DT);
              // Gravity tipping torque if ship tilt deviates from terrain slope
              const slopeError = s.pitchDeg - localSlope;
              s.angularVel += slopeError * 1.4 * SUB_DT;
              s.balancingTimer += SUB_DT;

              if (Math.abs(slopeError) > 16) {
                s.status = 'crashed';
                s.cmdThrottle = 0;
                s.actualThrottle = 0;
                playSoundEffect('crash', mutedRef.current);
                setStreak(0);
                s.headline = '💥 TIP-OVER ON SLOPED TERRAIN!';
                s.summary = `Lander tipped ${Math.abs(slopeError).toFixed(0)}° past slope stability limit during strut settling.`;
                setLunaMessage('Tip-over! Align pitch with the pad slope using A/D during touchdown.', 'critical', 'CRIT', true);
                break;
              }

              if (s.balancingTimer >= 1.6) {
                s.status = 'landed';
                s.cmdThrottle = 0;
                s.actualThrottle = 0;
                playSoundEffect('win', mutedRef.current);

                const onPad = Math.abs(s.x) <= 48;
                const bullseye = Math.abs(s.x) <= 16;
                const fuelBonus = Math.round((s.fuelKg / INITIAL_FUEL_KG) * 450);
                const ringBonus = s.bonusRing.collected ? 250 : 0;
                const multiplier = bullseye ? 2 : onPad ? 1 : 0.5;
                const total = Math.round((500 + fuelBonus + ringBonus) * multiplier);

                s.lastScore = total;
                s.headline = bullseye
                  ? '🎯 BULLSEYE TOUCHDOWN! (2X SCORE)'
                  : onPad
                    ? '🚀 SMOOTH LANDING ON PAD 01!'
                    : '🌖 SAFE CRATER FLOOR LANDING (0.5X)';
                s.summary = `Propellant remaining: ${Math.round((s.fuelKg / INITIAL_FUEL_KG) * 100)}% · Slope: ${localSlope.toFixed(1)}° · Score: +${total} pts`;
                setHighScore((prev) => Math.max(prev, total));
                setStreak((prev) => prev + 1);
                setLunaMessage(`Engine stop! Tranquility base locked—safe landing with +${total} pts!`, 'celebrate', 'INFO', true);
                break;
              }
            }
          }
        }

        // Contextual LUNA Guidance Checks (connected to real physics & player behavior)
        const terrainH = getTerrainHeight(s.x, s.padSlopeDeg);
        const agl = Math.max(0, s.y - terrainH);
        const vertAccel = (s.vy - s.prevVy) / Math.max(0.001, frameDt);

        if (s.status === 'playing' && !s.isBalancing) {
          if (vertAccel > 3.6 && s.vy > 1.5 && agl > 45) {
            setLunaMessage("Warning! You're accelerating upward too rapidly—reduce main throttle to save propellant!", 'caution', 'WARN');
          } else if (agl < 52 && Math.abs(s.vy) > 5.0) {
            setLunaMessage(`Critical warning! Vertical descent rate is ${Math.abs(s.vy).toFixed(1)} m/s—fire main engine now!`, 'critical', 'CRIT', true);
          } else if (agl < 42 && !s.gearDeployed) {
            setLunaMessage('Critical warning! Altitude below 42 meters and landing legs are still stowed—press G immediately!', 'critical', 'CRIT', true);
          } else if (s.fuelKg < INITIAL_FUEL_KG * 0.12 && s.fuelKg > 0) {
            setLunaMessage('Critical fuel! Under 12% propellant left—commit directly to touchdown without hovering.', 'critical', 'CRIT', true);
          } else if (s.fuelKg < INITIAL_FUEL_KG * 0.25 && s.fuelKg >= INITIAL_FUEL_KG * 0.12) {
            setLunaMessage('Caution: Propellant below 25%. Minimize unnecessary lateral RCS pulses.', 'caution', 'WARN');
          } else if (agl < 65 && Math.abs(s.vx) > 4.2) {
            setLunaMessage(`Horizontal drift is ${Math.abs(s.vx).toFixed(1)} m/s—null sideways speed with ${s.vx > 0 ? 'Q' : 'E'} before landing.`, 'caution', 'WARN');
          } else if (s.dustAccumulation > 72) {
            setLunaMessage('Optical sensors heavily coated in regolith dust—press C to cycle the sensor wiper.', 'caution', 'WARN');
          }
        }

        // Surface Regolith Plume Particles
        if (s.actualThrottle > 0.08 && agl < 44 && agl >= 0) {
          const rad = (s.pitchDeg * Math.PI) / 180;
          for (let i = 0; i < 3; i++) {
            s.dust.push({
              x: s.x + (Math.random() - 0.5) * 6,
              y: terrainH + 0.5,
              vx: (Math.random() - 0.5) * 34 + Math.sin(rad) * 18,
              vy: 2 + Math.random() * 6,
              life: 1,
            });
          }
        }
      }

      // Update Particles
      s.dust = s.dust
        .map((d) => ({
          ...d,
          x: d.x + d.vx * frameDt,
          y: d.y + d.vy * frameDt,
          vy: d.vy - env.gravity * frameDt,
          life: d.life - frameDt * 1.4,
        }))
        .filter((d) => d.life > 0);

      s.sparks = s.sparks
        .map((sp) => ({
          ...sp,
          x: sp.x + sp.vx * frameDt,
          y: sp.y + sp.vy * frameDt,
          vy: sp.vy - env.gravity * frameDt,
          life: sp.life - frameDt * 1.25,
        }))
        .filter((sp) => sp.life > 0);

      // 2. Render Descent Viewport
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
      skyGrad.addColorStop(0, env.skyTop);
      skyGrad.addColorStop(1, env.skyBottom);
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H);

      // Stars
      ctx.fillStyle = '#f8fafc';
      for (let i = 0; i < 75; i++) {
        const sx = (i * 149) % W;
        const sy = (i * 97) % (H - 80);
        ctx.globalAlpha = env.id === 'MARS' ? 0.35 : i % 3 === 0 ? 0.9 : 0.45;
        ctx.fillRect(sx, sy, i % 5 === 0 ? 2 : 1.4, i % 5 === 0 ? 2 : 1.4);
      }
      ctx.globalAlpha = 1;

      // Earth (Moon sky) or Phobos (Mars sky)
      const ex = W * 0.84;
      const ey = 56;
      const eGrad = ctx.createRadialGradient(ex - 5, ey - 5, 2, ex, ey, 19);
      if (env.id === 'MOON') {
        eGrad.addColorStop(0, '#bae6fd');
        eGrad.addColorStop(0.55, '#0284c7');
        eGrad.addColorStop(1, '#0c4a6e');
      } else {
        eGrad.addColorStop(0, '#fed7aa');
        eGrad.addColorStop(1, '#7c2d12');
      }
      ctx.beginPath();
      ctx.arc(ex, ey, env.id === 'MOON' ? 18 : 10, 0, Math.PI * 2);
      ctx.fillStyle = eGrad;
      ctx.fill();

      const pxPerMeter = 1.32;
      const cameraLiftY = Math.max(0, (s.y - 220) * pxPerMeter);
      const datumScreenY = H - 52 + cameraLiftY;
      const camX = s.x * 0.55;

      const toScreenX = (wx: number) => W * 0.5 + (wx - camX) * pxPerMeter;
      const toScreenY = (wy: number) => datumScreenY - wy * pxPerMeter;

      // Distant Crater Rim Silhouette
      ctx.fillStyle = env.ridgeFill;
      ctx.beginPath();
      ctx.moveTo(0, datumScreenY + 30);
      for (let px = 0; px <= W; px += 10) {
        const worldWave = (px + camX * 0.4) * 0.015;
        const mHeight = 28 + Math.sin(worldWave) * 14 + Math.cos(worldWave * 2.3) * 8;
        ctx.lineTo(px, datumScreenY - mHeight);
      }
      ctx.lineTo(W, datumScreenY + 30);
      ctx.closePath();
      ctx.fill();

      // Procedural Sloped Crater Terrain
      ctx.fillStyle = env.groundFill;
      ctx.beginPath();
      ctx.moveTo(0, H + 40);
      for (let px = 0; px <= W; px += 6) {
        const wx = camX + (px - W * 0.5) / pxPerMeter;
        const wy = getTerrainHeight(wx, s.padSlopeDeg);
        ctx.lineTo(px, toScreenY(wy));
      }
      ctx.lineTo(W, H + 40);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = env.horizonStroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let px = 0; px <= W; px += 6) {
        const wx = camX + (px - W * 0.5) / pxPerMeter;
        const wy = getTerrainHeight(wx, s.padSlopeDeg);
        if (px === 0) ctx.moveTo(px, toScreenY(wy));
        else ctx.lineTo(px, toScreenY(wy));
      }
      ctx.stroke();

      // Sloped Landing Pad 01 + 2X Bullseye Center
      const padL_X = toScreenX(-48);
      const padL_Y = toScreenY(getTerrainHeight(-48, s.padSlopeDeg));
      const padR_X = toScreenX(48);
      const padR_Y = toScreenY(getTerrainHeight(48, s.padSlopeDeg));

      const bullL_X = toScreenX(-16);
      const bullL_Y = toScreenY(getTerrainHeight(-16, s.padSlopeDeg));
      const bullR_X = toScreenX(16);
      const bullR_Y = toScreenY(getTerrainHeight(16, s.padSlopeDeg));

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(padL_X, padL_Y);
      ctx.lineTo(padR_X, padR_Y);
      ctx.stroke();

      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(bullL_X, bullL_Y);
      ctx.lineTo(bullR_X, bullR_Y);
      ctx.stroke();

      const blink = 0.5 + 0.5 * Math.sin(now * 0.01);
      ctx.fillStyle = `rgba(56, 189, 248, ${0.45 + blink * 0.55})`;
      ctx.beginPath();
      ctx.arc(padL_X, padL_Y - 6, 4, 0, Math.PI * 2);
      ctx.arc(padR_X, padR_Y - 6, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fde047';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        `🎯 2X BULLSEYE PAD (${s.padSlopeDeg > 0 ? '+' : ''}${s.padSlopeDeg.toFixed(1)}°)`,
        (padL_X + padR_X) * 0.5,
        Math.max(padL_Y, padR_Y) + 18,
      );

      // Ballistic Trajectory Predictor Arc
      if (s.status === 'playing' && !s.isBalancing) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let px = s.x;
        let py = s.y;
        let pvx = s.vx;
        let pvy = s.vy;
        ctx.moveTo(toScreenX(px), toScreenY(py));
        for (let step = 0; step < 34; step++) {
          const stepDt = 0.25;
          pvy -= env.gravity * stepDt;
          px += pvx * stepDt;
          py += pvy * stepDt;
          const th = getTerrainHeight(px, s.padSlopeDeg);
          if (py <= th) {
            ctx.lineTo(toScreenX(px), toScreenY(th));
            break;
          }
          ctx.lineTo(toScreenX(px), toScreenY(py));
        }
        ctx.stroke();
        ctx.restore();
      }

      // Radar Altimeter Laser Beam
      const lx = toScreenX(s.x);
      const ly = toScreenY(s.y);
      const groundAtLanderY = toScreenY(getTerrainHeight(s.x, s.padSlopeDeg));
      if (s.status === 'playing') {
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.28)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(lx, groundAtLanderY);
        ctx.stroke();
      }

      // Bonus Telemetry Ring
      if (!s.bonusRing.collected) {
        const rx = toScreenX(s.bonusRing.x);
        const ry = toScreenY(s.bonusRing.y);
        const ringPulse = 17 + Math.sin(now * 0.006) * 2.5;
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.arc(rx, ry, ringPulse, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#fde047';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText('+250 PTS', rx, ry - 23);
      }

      // Regolith Dust & Sparks
      s.dust.forEach((d) => {
        ctx.fillStyle = `rgba(${env.dustRgb}, ${clamp(d.life * 0.65, 0, 1)})`;
        ctx.beginPath();
        ctx.arc(toScreenX(d.x), toScreenY(d.y), 3.2, 0, Math.PI * 2);
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

      // Lander Spacecraft
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate((s.pitchDeg * Math.PI) / 180);

      // Landing Spotlight Cone
      if (s.spotlightOn && s.status !== 'crashed') {
        const cone = ctx.createLinearGradient(0, -6, 0, 120);
        cone.addColorStop(0, 'rgba(254, 249, 195, 0.36)');
        cone.addColorStop(1, 'rgba(254, 249, 195, 0)');
        ctx.fillStyle = cone;
        ctx.beginPath();
        ctx.moveTo(-7, -8);
        ctx.lineTo(7, -8);
        ctx.lineTo(44, 125);
        ctx.lineTo(-44, 125);
        ctx.closePath();
        ctx.fill();
      }

      // Main Engine Exhaust Plume
      if (s.actualThrottle > 0.02 && s.fuelKg > 0 && s.status === 'playing') {
        const flameH = 16 + s.actualThrottle * 46 + Math.random() * 8;
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

      // Attitude Pitch Thrusters (A/D)
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

      // Cold-Gas RCS Translation Plumes (Q/E)
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

      // Landing Struts
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

      // Descent Stage + Ascent Cabin
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

      // Atmospheric / Plume Dust Haze Overlay
      const hazeAlpha = clamp(s.stormIntensity * 0.28 + (s.dustAccumulation / 100) * 0.34, 0, 0.58);
      if (hazeAlpha > 0.02) {
        ctx.fillStyle = `rgba(${env.dustRgb}, ${hazeAlpha})`;
        ctx.fillRect(0, 0, W, H);
      }

      // Floating Telemetry Callout next to Lander
      if (s.status === 'playing') {
        const fastDrop = Math.abs(s.vy) > 4.3;
        ctx.fillStyle = fastDrop ? '#fca5a5' : '#86efac';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(
          `${fastDrop ? '⚠ BRAKE!' : '✓ SAFE'} ${Math.abs(s.vy).toFixed(1)} m/s`,
          lx + 26,
          ly - 20,
        );
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '10px sans-serif';
        ctx.fillText(`Drift: ${s.vx > 0 ? '+' : ''}${s.vx.toFixed(1)} m/s`, lx + 26, ly - 7);
      }

      if (now - lastUiSync > 55) {
        lastUiSync = now;
        syncUi();
      }
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [pushLog, setLunaMessage, syncUi, triggerFailure]);

  const speedSeverity: Severity = ui.speedDown > 4.3 ? 'CRITICAL' : ui.speedDown > 3.4 ? 'CAUTION' : 'NOMINAL';
  const tiltSeverity: Severity = Math.abs(ui.tiltDeg) > 12 ? 'CRITICAL' : Math.abs(ui.tiltDeg) > 7 ? 'CAUTION' : 'NOMINAL';
  const fuelSeverity: Severity = ui.fuelPct < 15 ? 'CRITICAL' : ui.fuelPct < 28 ? 'CAUTION' : 'NOMINAL';

  const severityColor = (sev: Severity) =>
    sev === 'CRITICAL' ? '#f87171' : sev === 'CAUTION' ? '#facc15' : '#4ade80';

  const rcsLocked = ui.failure?.type === 'RCS_LOCK' && ui.failure.phase === 'ACTIVE';
  const throttleJammed = ui.failure?.type === 'THROTTLE_JAM' && ui.failure.phase === 'ACTIVE';
  const commsBlackout = ui.failure?.type === 'COMMS_BLACKOUT' && ui.failure.phase === 'ACTIVE';

  return (
    <section style={styles.root}>
      {/* Top Flight-Deck Header */}
      <header style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={styles.badge}>🚀 NASA FLIGHT DECK SIMULATOR</span>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: '#f8fafc' }}>
            Crater Touchdown &amp; Slope Stabilization
          </h2>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select
            value={envId}
            onChange={(e) => {
              const next = e.target.value as EnvironmentId;
              setEnvId(next);
              pushLog('SYS', `Environment switched to ${ENVIRONMENTS[next].label}.`, simRef.current.missionTime);
            }}
            style={styles.selectControl}
            title="Select Planetary Environment"
          >
            <option value="MOON">🌕 Moon (Vacuum · 1.62 m/s²)</option>
            <option value="MARS">🔴 Mars (Dust Storms · 3.72 m/s²)</option>
          </select>

          <select
            value=""
            disabled={ui.status !== 'playing' || Boolean(ui.failure)}
            onChange={(e) => {
              if (e.target.value) triggerFailure(e.target.value as FailureType);
            }}
            style={styles.selectControl}
            title="Simulate Mission Anomaly"
          >
            <option value="">⚡ Simulate Anomaly...</option>
            <option value="COMMS_BLACKOUT">📡 Comms Blackout</option>
            <option value="RCS_LOCK">💨 RCS Valve Lock</option>
            <option value="THROTTLE_JAM">🔥 Throttle Actuator Jam</option>
            <option value="RADAR_STATIC">📶 Radar Static</option>
          </select>

          <div style={styles.scorePill}>
            🏆 HIGH: <strong style={{ color: '#facc15' }}>{highScore}</strong>
          </div>
          <div style={styles.scorePill}>
            🔥 STREAK: <strong style={{ color: '#38bdf8' }}>{streak}</strong>
          </div>

          <button
            type="button"
            onClick={(e) => {
              blurBtn(e);
              setVoiceOn((v) => !v);
            }}
            style={{
              ...styles.iconBtn,
              borderColor: voiceOn ? '#38bdf8' : '#334155',
              color: voiceOn ? '#38bdf8' : '#cbd5e1',
            }}
            title="Toggle LUNA Voice Synthesis"
          >
            {voiceOn ? '🗣️ VOICE ON' : '🗣️ VOICE'}
          </button>

          <button
            type="button"
            onClick={(e) => {
              blurBtn(e);
              setMuted((m) => !m);
            }}
            style={styles.iconBtn}
            title="Mute / Unmute Sound Effects"
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      </header>

      {/* Active Anomaly / Balancing Banner */}
      {(ui.failure || ui.isBalancing) && (
        <div
          style={{
            marginBottom: 12,
            padding: '9px 14px',
            borderRadius: 10,
            background: ui.isBalancing
              ? 'rgba(234, 179, 8, 0.16)'
              : ui.failure?.phase === 'WARNING'
                ? 'rgba(245, 158, 11, 0.16)'
                : 'rgba(239, 68, 68, 0.18)',
            border: `1px solid ${ui.isBalancing ? '#facc15' : ui.failure?.phase === 'WARNING' ? '#f59e0b' : '#ef4444'}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {ui.isBalancing ? (
            <>
              <span style={{ color: '#fde047' }}>
                ⚖️ STRUT SLOPE BALANCING IN PROGRESS — Keep pitch aligned with {ui.padSlopeDeg.toFixed(1)}° pad using A / D!
              </span>
              <span style={{ color: '#4ade80' }}>STABILIZING: {ui.balancingPct}%</span>
            </>
          ) : (
            ui.failure && (
              <>
                <span style={{ color: ui.failure.phase === 'WARNING' ? '#fcd34d' : '#fca5a5' }}>
                  {ui.failure.phase === 'WARNING' ? '⚠️ INCOMING ANOMALY:' : '🚨 ACTIVE SYSTEM FAILURE:'}{' '}
                  <strong>{ui.failure.label}</strong> — {ui.failure.detail}
                </span>
                <span style={{ color: '#f8fafc', fontVariantNumeric: 'tabular-nums' }}>
                  {ui.failure.phase === 'WARNING' ? 'IMPACT IN' : 'RECOVERY IN'} {ui.failure.timer.toFixed(1)}s
                </span>
              </>
            )
          )}
        </div>
      )}

      {/* Main 3-Column Flight Deck Grid */}
      <div style={styles.mainGrid}>
        {/* COLUMN 1: Descent Viewport */}
        <div style={styles.viewportCard}>
          <canvas
            ref={canvasRef}
            width={620}
            height={440}
            style={{ width: '100%', height: 440, display: 'block', background: '#02040a' }}
          />

          {/* Bottom Viewport Status Strip */}
          <div style={styles.viewportFooter}>
            <span>
              PAD GRADE: <strong>{ui.padSlopeDeg > 0 ? '+' : ''}{ui.padSlopeDeg.toFixed(1)}°</strong> · PAD DIST:{' '}
              <strong>{ui.padDistance.toFixed(0)} m</strong>
            </span>
            <span>
              OPTICS DUST:{' '}
              <strong style={{ color: ui.dustPct > 60 ? '#facc15' : '#38bdf8' }}>{ui.dustPct}%</strong>
              {envId === 'MARS' && (
                <>
                  {' '}
                  · STORM: <strong style={{ color: '#fb923c' }}>{ui.stormPct}%</strong>
                </>
              )}
            </span>
          </div>

          {/* Ready / Landed / Crashed Overlay */}
          {ui.status !== 'playing' && (
            <div style={styles.overlay}>
              {ui.status === 'ready' && (
                <>
                  <div style={{ fontSize: 36 }}>🛸</div>
                  <h3 style={{ margin: '8px 0 6px', fontSize: 21, fontWeight: 800 }}>
                    Ready for Powered Descent
                  </h3>
                  <p style={{ maxWidth: 390, fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.55, margin: '0 0 16px' }}>
                    • <strong>Throttle / Hold Space</strong> to keep sink rate below <strong>4.3 m/s</strong>
                    <br />• <strong>A / D</strong> to tilt attitude · <strong>Q / E</strong> to slide sideways with RCS jets
                    <br />• <strong>G</strong> for Landing Legs · Balance struts on sloped crater pads!
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      blurBtn(e);
                      launchMission();
                    }}
                    style={styles.launchBtn}
                  >
                    🚀 LAUNCH &amp; START DESCENT
                  </button>
                </>
              )}

              {ui.status === 'landed' && (
                <>
                  <div style={{ fontSize: 40 }}>🏆</div>
                  <h3 style={{ margin: '8px 0 6px', fontSize: 20, fontWeight: 800, color: '#4ade80' }}>
                    {ui.headline}
                  </h3>
                  <p style={{ maxWidth: 390, fontSize: 12.5, color: '#e2e8f0', margin: '0 0 16px' }}>{ui.summary}</p>
                  <button
                    type="button"
                    onClick={(e) => {
                      blurBtn(e);
                      launchMission();
                    }}
                    style={styles.launchBtn}
                  >
                    🚀 NEXT MISSION
                  </button>
                </>
              )}

              {ui.status === 'crashed' && (
                <>
                  <div style={{ fontSize: 40 }}>💥</div>
                  <h3 style={{ margin: '8px 0 6px', fontSize: 20, fontWeight: 800, color: '#f87171' }}>
                    {ui.headline}
                  </h3>
                  <p style={{ maxWidth: 390, fontSize: 12.5, color: '#fca5a5', margin: '0 0 16px' }}>{ui.summary}</p>
                  <button
                    type="button"
                    onClick={(e) => {
                      blurBtn(e);
                      launchMission();
                    }}
                    style={styles.launchBtn}
                  >
                    🔄 RETRY DESCENT
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* COLUMN 2: Cockpits Gauges & Flight Controls */}
        <div style={styles.cockpitCard}>
          {/* 4 Primary Flight Gauges */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            <div style={styles.gaugeBox}>
              <span style={styles.gaugeLabel}>HEIGHT AGL</span>
              <strong style={{ fontSize: 18, color: '#38bdf8', fontVariantNumeric: 'tabular-nums' }}>
                {ui.altitudeAgl.toFixed(0)} m
              </strong>
            </div>

            <div style={{ ...styles.gaugeBox, borderColor: `${severityColor(speedSeverity)}66` }}>
              <span style={styles.gaugeLabel}>DROP SPEED</span>
              <strong style={{ fontSize: 18, color: severityColor(speedSeverity), fontVariantNumeric: 'tabular-nums' }}>
                {ui.speedDown.toFixed(1)} m/s
              </strong>
            </div>

            <div style={{ ...styles.gaugeBox, borderColor: `${severityColor(tiltSeverity)}66` }}>
              <span style={styles.gaugeLabel}>TILT ANGLE</span>
              <strong style={{ fontSize: 18, color: severityColor(tiltSeverity), fontVariantNumeric: 'tabular-nums' }}>
                {ui.tiltDeg > 0 ? '+' : ''}
                {ui.tiltDeg.toFixed(0)}°
              </strong>
            </div>

            <div style={{ ...styles.gaugeBox, borderColor: `${severityColor(fuelSeverity)}66` }}>
              <span style={styles.gaugeLabel}>FUEL</span>
              <strong style={{ fontSize: 18, color: severityColor(fuelSeverity), fontVariantNumeric: 'tabular-nums' }}>
                {ui.fuelPct}%
              </strong>
            </div>
          </div>

          {/* Propellant & Engine Spool Bar */}
          <div style={styles.subPanel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#94a3b8', fontWeight: 700 }}>
              <span>PROPELLANT MASS: {ui.fuelKg} / {INITIAL_FUEL_KG} kg</span>
              <span>SPOOL: {ui.actualThrottlePct}% / CMD {ui.cmdThrottlePct}%</span>
            </div>
            <div style={{ height: 6, background: '#1e293b', borderRadius: 999, overflow: 'hidden', marginTop: 6 }}>
              <div
                style={{
                  width: `${ui.fuelPct}%`,
                  height: '100%',
                  background: severityColor(fuelSeverity),
                  transition: 'width 120ms linear',
                }}
              />
            </div>
          </div>

          {/* Main Engine Throttle Section */}
          <div style={{ ...styles.subPanel, position: 'relative' }}>
            {throttleJammed && (
              <div style={styles.lockOverlay}>
                🔒 THROTTLE ACTUATOR JAMMED ({ui.failure?.timer.toFixed(1)}s)
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={styles.sectionTitle}>🔥 MAIN ENGINE THROTTLE: {ui.cmdThrottlePct}%</span>
              {ui.hoverHold && <span style={{ fontSize: 10, color: '#34d399', fontWeight: 800 }}>AUTO-HOVER ON</span>}
            </div>

            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={ui.cmdThrottlePct}
              disabled={ui.status !== 'playing' || throttleJammed}
              onChange={(e) => {
                simRef.current.hoverHold = false;
                simRef.current.cmdThrottle = Number(e.target.value) / 100;
                syncUi();
              }}
              style={{ width: '100%', marginTop: 8, accentColor: '#facc15', cursor: 'pointer' }}
            />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 8 }}>
              {[
                { label: '0% CUT', val: 0, bg: '#7f1d1d' },
                { label: '45% HOV', val: 0.45, bg: '#1e293b' },
                { label: '75% BRK', val: 0.75, bg: '#1e293b' },
                { label: '100% MAX', val: 1.0, bg: '#b45309' },
              ].map((b) => {
                const active = !ui.hoverHold && Math.abs(ui.cmdThrottlePct - b.val * 100) < 3;
                return (
                  <button
                    key={b.label}
                    type="button"
                    disabled={ui.status !== 'playing' || throttleJammed}
                    onClick={(e) => {
                      blurBtn(e);
                      simRef.current.hoverHold = false;
                      simRef.current.cmdThrottle = b.val;
                      syncUi();
                    }}
                    style={{
                      ...styles.ctrlBtn,
                      background: active ? '#0284c7' : b.bg,
                      borderColor: active ? '#38bdf8' : '#475569',
                    }}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
              <button
                type="button"
                disabled={ui.status !== 'playing' || throttleJammed}
                onPointerDown={(e) => {
                  blurBtn(e);
                  simRef.current.prevThrottle = simRef.current.cmdThrottle;
                  simRef.current.boostHeld = true;
                  simRef.current.hoverHold = false;
                }}
                onPointerUp={() => {
                  if (simRef.current.boostHeld) {
                    simRef.current.boostHeld = false;
                    simRef.current.cmdThrottle = simRef.current.prevThrottle;
                  }
                }}
                onPointerLeave={() => {
                  if (simRef.current.boostHeld) {
                    simRef.current.boostHeld = false;
                    simRef.current.cmdThrottle = simRef.current.prevThrottle;
                  }
                }}
                style={{ ...styles.ctrlBtn, background: '#9a3412', borderColor: '#fb923c' }}
              >
                ⬆ BOOST (SPACE)
              </button>

              <button
                type="button"
                disabled={ui.status !== 'playing' || throttleJammed}
                onClick={(e) => {
                  blurBtn(e);
                  simRef.current.hoverHold = !simRef.current.hoverHold;
                  syncUi();
                }}
                style={{
                  ...styles.ctrlBtn,
                  background: ui.hoverHold ? '#047857' : '#1e293b',
                  borderColor: ui.hoverHold ? '#34d399' : '#475569',
                }}
              >
                {ui.hoverHold ? '✨ HOVER: ON' : '✨ HOVER (H)'}
              </button>
            </div>
          </div>

          {/* Attitude Pitch & SAS */}
          <div style={styles.subPanel}>
            <span style={styles.sectionTitle}>🧭 ATTITUDE PITCH &amp; SAS DAMPING</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 8 }}>
              <button
                type="button"
                disabled={ui.status !== 'playing'}
                onPointerDown={(e) => {
                  blurBtn(e);
                  simRef.current.pitchLeft = true;
                  simRef.current.angularVel -= 8;
                }}
                onPointerUp={() => {
                  simRef.current.pitchLeft = false;
                }}
                onPointerLeave={() => {
                  simRef.current.pitchLeft = false;
                }}
                style={styles.ctrlBtn}
              >
                ↺ L (A)
              </button>

              <button
                type="button"
                disabled={ui.status !== 'playing'}
                onPointerDown={(e) => {
                  blurBtn(e);
                  simRef.current.pitchRight = true;
                  simRef.current.angularVel += 8;
                }}
                onPointerUp={() => {
                  simRef.current.pitchRight = false;
                }}
                onPointerLeave={() => {
                  simRef.current.pitchRight = false;
                }}
                style={styles.ctrlBtn}
              >
                ↻ R (D)
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
                style={{ ...styles.ctrlBtn, background: '#1e3a8a', borderColor: '#60a5fa' }}
              >
                LVL 0°
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
                  ...styles.ctrlBtn,
                  background: ui.sasHold ? '#0369a1' : '#1e293b',
                  borderColor: ui.sasHold ? '#38bdf8' : '#475569',
                }}
              >
                {ui.sasHold ? 'SAS: ON' : 'SAS: OFF'}
              </button>
            </div>
          </div>

          {/* Lateral RCS Translation Thrusters */}
          <div style={{ ...styles.subPanel, position: 'relative' }}>
            {rcsLocked && (
              <div style={styles.lockOverlay}>
                🔒 RCS MANIFOLD LOCKED ({ui.failure?.timer.toFixed(1)}s)
              </div>
            )}
            <span style={styles.sectionTitle}>💨 RCS SIDE THRUSTERS (SLIDE OVER PAD)</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
              <button
                type="button"
                disabled={ui.status !== 'playing' || rcsLocked}
                onPointerDown={(e) => {
                  blurBtn(e);
                  simRef.current.rcsLeft = true;
                  if (simRef.current.fuelKg > 0) simRef.current.vx -= 0.95;
                }}
                onPointerUp={() => {
                  simRef.current.rcsLeft = false;
                }}
                onPointerLeave={() => {
                  simRef.current.rcsLeft = false;
                }}
                style={{ ...styles.ctrlBtn, borderColor: '#38bdf8' }}
              >
                ◀ SLIDE LEFT (Q)
              </button>

              <button
                type="button"
                disabled={ui.status !== 'playing' || rcsLocked}
                onPointerDown={(e) => {
                  blurBtn(e);
                  simRef.current.rcsRight = true;
                  if (simRef.current.fuelKg > 0) simRef.current.vx += 0.95;
                }}
                onPointerUp={() => {
                  simRef.current.rcsRight = false;
                }}
                onPointerLeave={() => {
                  simRef.current.rcsRight = false;
                }}
                style={{ ...styles.ctrlBtn, borderColor: '#38bdf8' }}
              >
                ▶ SLIDE RIGHT (E)
              </button>
            </div>
          </div>

          {/* Gear, Spotlight & Optics Wiper */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 0.9fr', gap: 6 }}>
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
                ...styles.ctrlBtn,
                padding: '10px 6px',
                background: ui.gearDeployed ? '#15803d' : '#7c2d12',
                borderColor: ui.gearDeployed ? '#4ade80' : '#f97316',
              }}
            >
              {ui.gearDeployed ? '✅ LEGS READY' : '⚠ LEGS (G)'}
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
                ...styles.ctrlBtn,
                padding: '10px 6px',
                background: ui.spotlightOn ? '#1e3a8a' : '#1e293b',
                borderColor: ui.spotlightOn ? '#60a5fa' : '#475569',
              }}
            >
              {ui.spotlightOn ? '🔦 LIGHT: ON' : '🔦 LIGHT'}
            </button>

            <button
              type="button"
              disabled={ui.status !== 'playing'}
              onClick={(e) => {
                blurBtn(e);
                simRef.current.dustAccumulation = 0;
                syncUi();
              }}
              style={{
                ...styles.ctrlBtn,
                padding: '10px 6px',
                background: ui.dustPct > 40 ? '#854d0e' : '#1e293b',
                borderColor: ui.dustPct > 40 ? '#facc15' : '#475569',
              }}
              title="Clean optical sensor dust (C)"
            >
              🧹 WIPE (C)
            </button>
          </div>
        </div>

        {/* COLUMN 3: Humanoid Assistant LUNA & Mission Event Log */}
        <aside style={styles.lunaCard}>
          <LunaHumanoidAvatar pose={ui.lunaPose} speaking={ui.lunaSpeaking} blackout={commsBlackout} />

          {/* LUNA Live Telemetry Dialogue */}
          <div
            style={{
              background: '#060a14',
              border: `1px solid ${commsBlackout ? '#475569' : '#334155'}`,
              borderRadius: 10,
              padding: '10px 12px',
              minHeight: 74,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 800, color: '#38bdf8', marginBottom: 4, letterSpacing: '0.06em' }}>
              CAPCOM TRANSMISSION
            </div>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: commsBlackout ? '#94a3b8' : '#e2e8f0' }}>
              {ui.lunaSpeech}
            </p>
          </div>

          {/* Quick Guidance Queries */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            <button
              type="button"
              disabled={commsBlackout}
              onClick={(e) => {
                blurBtn(e);
                setLunaMessage(
                  `Telemetry: Alt ${ui.altitudeAgl.toFixed(0)}m, sink ${ui.speedDown.toFixed(1)} m/s, lateral ${ui.speedSide.toFixed(1)} m/s, fuel ${ui.fuelPct}%.`,
                  'nominal',
                  'INFO',
                  true,
                );
                syncUi();
              }}
              style={styles.ctrlBtn}
            >
              STATUS
            </button>

            <button
              type="button"
              disabled={commsBlackout}
              onClick={(e) => {
                blurBtn(e);
                const dir = ui.padDistance < -16 ? 'slide right (E)' : ui.padDistance > 16 ? 'slide left (Q)' : 'hold center';
                setLunaMessage(
                  `Approach vector: ${dir} to align with Pad 01 (${ui.padSlopeDeg.toFixed(1)}° grade). Keep descent under 4.3 m/s.`,
                  'nominal',
                  'INFO',
                  true,
                );
                syncUi();
              }}
              style={styles.ctrlBtn}
            >
              ADVICE
            </button>

            <button
              type="button"
              disabled={commsBlackout}
              onClick={(e) => {
                blurBtn(e);
                setLunaMessage(
                  `Diagnostics: Optics dust ${ui.dustPct}%, SAS ${ui.sasHold ? 'active' : 'off'}, gear ${ui.gearDeployed ? 'deployed' : 'stowed'}.`,
                  'nominal',
                  'SYS',
                  true,
                );
                syncUi();
              }}
              style={styles.ctrlBtn}
            >
              DIAG
            </button>
          </div>

          {/* Timestamped Mission Event Log */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 150 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.06em', marginBottom: 6 }}>
              MISSION EVENT LOG
            </div>
            <div style={styles.logBox}>
              {logList.map((item) => {
                const badgeCol =
                  item.level === 'CRIT'
                    ? '#f87171'
                    : item.level === 'WARN'
                      ? '#facc15'
                      : item.level === 'SYS'
                        ? '#38bdf8'
                        : '#94a3b8';
                return (
                  <div key={item.id} style={{ fontSize: 11, lineHeight: 1.4, borderBottom: '1px solid #1e293b', paddingBottom: 5 }}>
                    <span style={{ color: '#64748b', fontFamily: 'monospace', marginRight: 6 }}>{item.timeStr}</span>
                    <span style={{ color: badgeCol, fontWeight: 800, marginRight: 6 }}>[{item.level}]</span>
                    <span style={{ color: '#cbd5e1' }}>{item.text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    background: '#060a14',
    color: '#e2e8f0',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    textAlign: 'left',
    width: '100%',
    maxWidth: 1320,
    margin: '0 auto',
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    paddingBottom: 12,
    marginBottom: 12,
    borderBottom: '1px solid #1e293b',
  },
  badge: {
    background: '#0284c7',
    color: '#fff',
    fontSize: 10,
    fontWeight: 800,
    padding: '4px 9px',
    borderRadius: 6,
    letterSpacing: '0.06em',
  },
  selectControl: {
    background: '#0f172a',
    color: '#f8fafc',
    border: '1px solid #334155',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
  },
  scorePill: {
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: 999,
    padding: '5px 12px',
    fontSize: 11,
    fontWeight: 800,
  },
  iconBtn: {
    background: '#1e293b',
    color: '#f8fafc',
    border: '1px solid #334155',
    borderRadius: 8,
    padding: '5px 10px',
    fontSize: 11,
    fontWeight: 800,
    cursor: 'pointer',
  },
  mainGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))',
    gap: 14,
    alignItems: 'stretch',
  },
  viewportCard: {
    position: 'relative',
    background: '#02040a',
    border: '1px solid #334155',
    borderRadius: 14,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    minHeight: 472,
  },
  viewportFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    padding: '8px 12px',
    background: '#090f1d',
    borderTop: '1px solid #1e293b',
    fontSize: 11,
    color: '#94a3b8',
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(3, 6, 14, 0.86)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: 20,
    zIndex: 10,
  },
  launchBtn: {
    background: '#16a34a',
    color: '#fff',
    border: '1px solid #4ade80',
    borderRadius: 10,
    padding: '12px 24px',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 0 20px rgba(74, 222, 128, 0.35)',
  },
  cockpitCard: {
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: 14,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: 9,
  },
  gaugeBox: {
    background: '#060a14',
    border: '1px solid #1e293b',
    borderRadius: 10,
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
  },
  gaugeLabel: {
    fontSize: 9.5,
    fontWeight: 800,
    color: '#94a3b8',
    letterSpacing: '0.06em',
    marginBottom: 2,
  },
  subPanel: {
    background: '#090f1d',
    border: '1px solid #1e293b',
    borderRadius: 10,
    padding: '9px 10px',
    overflow: 'hidden',
  },
  sectionTitle: {
    fontSize: 10.5,
    fontWeight: 800,
    color: '#94a3b8',
    letterSpacing: '0.05em',
  },
  ctrlBtn: {
    background: '#1e293b',
    color: '#f8fafc',
    border: '1px solid #475569',
    borderRadius: 7,
    padding: '8px 6px',
    fontSize: 11,
    fontWeight: 800,
    cursor: 'pointer',
    textAlign: 'center',
    userSelect: 'none',
  },
  lockOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(127, 29, 29, 0.88)',
    color: '#fecaca',
    display: 'grid',
    placeItems: 'center',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.05em',
    zIndex: 5,
    textAlign: 'center',
    padding: 8,
  },
  lunaCard: {
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: 14,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  logBox: {
    background: '#060a14',
    border: '1px solid #1e293b',
    borderRadius: 10,
    padding: 8,
    overflowY: 'auto',
    maxHeight: 165,
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  },
};