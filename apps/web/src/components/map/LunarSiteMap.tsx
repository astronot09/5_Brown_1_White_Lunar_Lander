import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import './LunarSiteMap.css';
import type { LunarSite } from './lunarTypes';
import { useLunarSites } from './useLunarSites';

export interface LunarSiteMapProps {
  selectedSiteId?: string;
  onSiteSelect?: (site: LunarSite) => void;
  azimuthDeg?: number;
  className?: string;
}

type LightingFilter = 'SOLAR' | 'SURVEY';

function latLonToVector3(latDeg: number, lonDeg: number, radius: number): THREE.Vector3 {
  const phi = ((90 - latDeg) * Math.PI) / 180;
  const theta = ((lonDeg + 180) * Math.PI) / 180;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

/** Crisp SVG Lander Icon for the active site and Target Reticle for candidates */
function SiteMarkerIcon({ isSelected }: { isSelected: boolean }) {
  if (isSelected) {
    return (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10.5" stroke="#facc15" strokeWidth="1.5" strokeDasharray="3 2" fill="rgba(15,23,42,0.88)" />
        <rect x="8.5" y="7" width="7" height="5" rx="1" fill="#facc15" />
        <path d="M9.5 7L10.5 4.8H13.5L14.5 7H9.5Z" fill="#fde047" />
        <path d="M8.5 12L6 16.5M15.5 12L18 16.5M12 12V16.5" stroke="#facc15" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="4.5" y1="16.8" x2="7.5" y2="16.8" stroke="#facc15" strokeWidth="1.6" strokeLinecap="round" />
        <line x1="16.5" y1="16.8" x2="19.5" y2="16.8" stroke="#facc15" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8" stroke="#38bdf8" strokeWidth="1.5" fill="rgba(6,10,20,0.85)" />
      <circle cx="12" cy="12" r="2.5" fill="#38bdf8" />
      <path d="M12 2V5M12 19V22M2 12H5M19 12H22" stroke="#38bdf8" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

interface ScreenPin {
  site: LunarSite;
  x: number;
  y: number;
  labelX: number;
  labelY: number;
  visible: boolean;
  isSelected: boolean;
}

export function LunarSiteMap({
  selectedSiteId,
  onSiteSelect,
  azimuthDeg = 0,
  className = '',
}: LunarSiteMapProps) {
  const { sites } = useLunarSites();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [lightingFilter, setLightingFilter] = useState<LightingFilter>('SOLAR');
  const [viewingDarkSide, setViewingDarkSide] = useState<boolean>(false);
  const [screenPins, setScreenPins] = useState<ScreenPin[]>([]);

  const orbitRef = useRef({
    yaw: 0.35,
    pitch: -0.92,
    distance: 2.75,
    targetYaw: 0.35,
    targetPitch: -0.92,
    targetDistance: 2.75,
    isDragging: false,
    lastX: 0,
    lastY: 0,
  });

  const selectedIdRef = useRef(selectedSiteId);
  selectedIdRef.current = selectedSiteId;

  const sunAzRef = useRef(azimuthDeg);
  sunAzRef.current = azimuthDeg;

  const filterRef = useRef<LightingFilter>(lightingFilter);
  filterRef.current = lightingFilter;

  const flyToSite = (site: LunarSite) => {
    if (onSiteSelect) onSiteSelect(site);
    const phi = ((90 - site.coordinates.latDeg) * Math.PI) / 180;
    const theta = ((site.coordinates.lonDeg + 180) * Math.PI) / 180;
    const targetVec = new THREE.Vector3(
      -Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta),
    ).normalize();

    orbitRef.current.targetPitch = Math.max(-1.42, Math.min(1.42, Math.asin(targetVec.y)));
    orbitRef.current.targetYaw = Math.atan2(targetVec.x, targetVec.z);
    orbitRef.current.targetDistance = 2.25;
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 560;
    const height = 380;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Starfield
    const starGeo = new THREE.BufferGeometry();
    const starPositions = new Float32Array(1400 * 3);
    for (let i = 0; i < 1400 * 3; i += 3) {
      const r = 20 + Math.random() * 25;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[i] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i + 1] = r * Math.cos(phi);
      starPositions[i + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    scene.add(
      new THREE.Points(
        starGeo,
        new THREE.PointsMaterial({ color: 0xf8fafc, size: 0.075, transparent: true, opacity: 0.85 }),
      ),
    );

    // High-resolution smooth sphere using real NASA LRO Lunar Mosaic
    const loader = new THREE.TextureLoader();
    const colorMap = loader.load('/textures/lroc_color_poles_1k.jpg');
    colorMap.colorSpace = THREE.SRGBColorSpace;
    colorMap.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const bumpMap = loader.load('/textures/lroc_color_poles_1k.jpg');
    bumpMap.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const moonGeo = new THREE.SphereGeometry(1, 160, 160);
    const moonMat = new THREE.MeshStandardMaterial({
      map: colorMap,
      bumpMap: bumpMap,
      bumpScale: 0.024,
      displacementMap: bumpMap,
      displacementScale: 0.01,
      roughness: 0.94,
      metalness: 0.02,
    });
    const moonMesh = new THREE.Mesh(moonGeo, moonMat);
    scene.add(moonMesh);

    // Subtle -85° South Pole Latitude Circle
    const ringRadius = Math.cos((85 * Math.PI) / 180);
    const poleRingGeo = new THREE.RingGeometry(ringRadius - 0.0012, ringRadius + 0.0012, 128);
    poleRingGeo.rotateX(Math.PI / 2);
    const poleRing = new THREE.Mesh(
      poleRingGeo,
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.3 }),
    );
    poleRing.position.y = -Math.sin((85 * Math.PI) / 180);
    scene.add(poleRing);

    // Sunlight + Survey Fill Light
    const sunLight = new THREE.DirectionalLight(0xfffdf5, 2.8);
    scene.add(sunLight);

    const ambientLight = new THREE.AmbientLight(0x1e3a5f, 0.32);
    scene.add(ambientLight);

    const surveyFillLight = new THREE.DirectionalLight(0xe2e8f0, 0);
    scene.add(surveyFillLight);

    const anchors = sites.map((site) => ({
      site,
      pos: latLonToVector3(site.coordinates.latDeg, site.coordinates.lonDeg, 1.01),
    }));

    const onPointerDown = (e: PointerEvent) => {
      orbitRef.current.isDragging = true;
      orbitRef.current.lastX = e.clientX;
      orbitRef.current.lastY = e.clientY;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!orbitRef.current.isDragging) return;
      const dx = e.clientX - orbitRef.current.lastX;
      const dy = e.clientY - orbitRef.current.lastY;
      orbitRef.current.targetYaw -= dx * 0.0065;
      orbitRef.current.targetPitch = Math.max(-1.48, Math.min(1.48, orbitRef.current.targetPitch + dy * 0.0065));
      orbitRef.current.yaw = orbitRef.current.targetYaw;
      orbitRef.current.pitch = orbitRef.current.targetPitch;
      orbitRef.current.lastX = e.clientX;
      orbitRef.current.lastY = e.clientY;
    };

    const onPointerUp = () => {
      orbitRef.current.isDragging = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      orbitRef.current.targetDistance = Math.max(1.55, Math.min(4.2, orbitRef.current.targetDistance + e.deltaY * 0.0014));
    };

    const dom = renderer.domElement;
    dom.style.cursor = 'grab';
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('wheel', onWheel, { passive: false });

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 560;
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
      renderer.setSize(w, height);
    };
    window.addEventListener('resize', onResize);

    let frameId = 0;
    let lastUiSync = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      const o = orbitRef.current;
      o.yaw += (o.targetYaw - o.yaw) * 0.12;
      o.pitch += (o.targetPitch - o.pitch) * 0.12;
      o.distance += (o.targetDistance - o.distance) * 0.14;

      camera.position.set(
        o.distance * Math.cos(o.pitch) * Math.sin(o.yaw),
        o.distance * Math.sin(o.pitch),
        o.distance * Math.cos(o.pitch) * Math.cos(o.yaw),
      );
      camera.lookAt(0, 0, 0);

      const sunRad = (sunAzRef.current * Math.PI) / 180;
      const sunDir = new THREE.Vector3(Math.sin(sunRad), -0.18, Math.cos(sunRad)).normalize();
      sunLight.position.copy(sunDir).multiplyScalar(6);

      if (filterRef.current === 'SURVEY') {
        sunLight.intensity = 1.65;
        ambientLight.intensity = 1.45;
        surveyFillLight.position.copy(camera.position).normalize().multiplyScalar(5);
        surveyFillLight.intensity = 1.1;
      } else {
        sunLight.intensity = 2.9;
        ambientLight.intensity = 0.28;
        surveyFillLight.intensity = 0;
      }

      renderer.render(scene, camera);

      if (t - lastUiSync > 0.04) {
        lastUiSync = t;
        const w = renderer.domElement.clientWidth || width;
        const h = renderer.domElement.clientHeight || height;
        const camDir = camera.position.clone().normalize();

        setViewingDarkSide(camDir.dot(sunDir) < -0.15);

        const rawPins = anchors.map(({ site, pos }, idx) => {
          const normal = pos.clone().normalize();
          const front = normal.dot(camDir) > 0.08;
          const v = pos.clone().project(camera);
          const x = (v.x * 0.5 + 0.5) * w;
          const y = (-v.y * 0.5 + 0.5) * h;
          const angle = ((idx / Math.max(1, anchors.length)) * Math.PI * 2) - Math.PI / 4;
          return {
            site,
            x,
            y,
            labelX: x + Math.cos(angle) * 78,
            labelY: y + Math.sin(angle) * 48,
            visible: front && v.z < 1,
            isSelected: site.siteId === selectedIdRef.current,
          };
        });

        const boxW = 136;
        const boxH = 26;
        for (let iter = 0; iter < 6; iter++) {
          for (let i = 0; i < rawPins.length; i++) {
            const a = rawPins[i]!;
            if (!a.visible) continue;
            for (let j = i + 1; j < rawPins.length; j++) {
              const b = rawPins[j]!;
              if (!b.visible) continue;
              const dx = b.labelX - a.labelX;
              const dy = b.labelY - a.labelY;
              const overlapX = boxW - Math.abs(dx);
              const overlapY = boxH - Math.abs(dy);
              if (overlapX > 0 && overlapY > 0) {
                const pushY = (overlapY * 0.55) * (dy >= 0 ? 1 : -1);
                const pushX = (overlapX * 0.25) * (dx >= 0 ? 1 : -1);
                a.labelY -= pushY;
                b.labelY += pushY;
                a.labelX -= pushX;
                b.labelX += pushX;
              }
            }
            a.labelX = Math.max(76, Math.min(w - 76, a.labelX));
            a.labelY = Math.max(54, Math.min(h - 32, a.labelY));
          }
        }

        setScreenPins(rawPins);
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    };
  }, [sites]);

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 3D Interactive Moon Viewport */}
      <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid #1e293b', background: '#03050a' }}>
        <div ref={containerRef} style={{ width: '100%', height: 380 }} />

        {/* Top Control Bar */}
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            right: 10,
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            gap: 6,
            pointerEvents: 'none',
          }}
        >
          <div style={{ display: 'flex', gap: 6, pointerEvents: 'auto' }}>
            <button
              type="button"
              onClick={() => {
                orbitRef.current.targetPitch = -1.25;
                orbitRef.current.targetDistance = 2.2;
              }}
              style={{
                background: 'rgba(15, 23, 42, 0.88)',
                color: '#38bdf8',
                border: '1px solid #334155',
                borderRadius: 6,
                padding: '5px 9px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              South Pole Orbit
            </button>
            <button
              type="button"
              onClick={() => {
                orbitRef.current.targetPitch = 0.05;
                orbitRef.current.targetYaw = 0;
                orbitRef.current.targetDistance = 3.05;
              }}
              style={{
                background: 'rgba(15, 23, 42, 0.88)',
                color: '#e2e8f0',
                border: '1px solid #334155',
                borderRadius: 6,
                padding: '5px 9px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Full Globe
            </button>
          </div>

          <div style={{ display: 'flex', gap: 6, pointerEvents: 'auto' }}>
            <button
              type="button"
              onClick={() => setLightingFilter('SOLAR')}
              style={{
                background: lightingFilter === 'SOLAR' ? '#0284c7' : 'rgba(15, 23, 42, 0.88)',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: 6,
                padding: '5px 9px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              1. True Solar
            </button>
            <button
              type="button"
              onClick={() => setLightingFilter('SURVEY')}
              style={{
                background: lightingFilter === 'SURVEY' ? '#059669' : 'rgba(15, 23, 42, 0.88)',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: 6,
                padding: '5px 9px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              2. Dark-Side Survey
            </button>
          </div>
        </div>

        {/* Dynamic Dark Side / Lunar Night Hemisphere Indicator Badge */}
        {viewingDarkSide && (
          <div
            style={{
              position: 'absolute',
              top: 44,
              right: 10,
              background: lightingFilter === 'SURVEY' ? 'rgba(6, 95, 70, 0.92)' : 'rgba(30, 41, 59, 0.92)',
              border: lightingFilter === 'SURVEY' ? '1px solid #34d399' : '1px solid #64748b',
              color: lightingFilter === 'SURVEY' ? '#6ee7b7' : '#cbd5e1',
              borderRadius: 6,
              padding: '4px 9px',
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            {lightingFilter === 'SURVEY'
              ? '🌑 DARK SIDE / LUNAR NIGHT — SURVEY FILTER ACTIVE'
              : '🌑 DARK SIDE / LUNAR NIGHT (Click "2. Dark-Side Survey" to illuminate)'}
          </div>
        )}

        {/* SVG Leader Lines + Collision-Separated Lander Icons */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          {screenPins.map((item) => {
            if (!item.visible) return null;
            return (
              <line
                key={item.site.siteId}
                x1={item.x}
                y1={item.y}
                x2={item.labelX}
                y2={item.labelY}
                stroke={item.isSelected ? '#facc15' : 'rgba(56, 189, 248, 0.7)'}
                strokeWidth={item.isSelected ? 1.6 : 1}
              />
            );
          })}
        </svg>

        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {screenPins.map((item) => {
            if (!item.visible) return null;
            return (
              <div key={item.site.siteId}>
                <button
                  type="button"
                  onClick={() => flyToSite(item.site)}
                  title={item.site.name}
                  style={{
                    position: 'absolute',
                    left: item.x,
                    top: item.y,
                    transform: 'translate(-50%, -50%)',
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    pointerEvents: 'auto',
                  }}
                >
                  <SiteMarkerIcon isSelected={item.isSelected} />
                </button>

                <button
                  type="button"
                  onClick={() => flyToSite(item.site)}
                  style={{
                    position: 'absolute',
                    left: item.labelX,
                    top: item.labelY,
                    transform: 'translate(-50%, -50%)',
                    background: item.isSelected ? 'rgba(15, 23, 42, 0.95)' : 'rgba(6, 10, 20, 0.88)',
                    border: item.isSelected ? '1px solid #facc15' : '1px solid rgba(56, 189, 248, 0.45)',
                    color: item.isSelected ? '#facc15' : '#e2e8f0',
                    padding: '2px 7px',
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: item.isSelected ? 700 : 500,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    pointerEvents: 'auto',
                  }}
                >
                  {item.site.name.replace(' Crater', '').replace(' Ridge', '')}
                </button>
              </div>
            );
          })}
        </div>

        {/* Bottom Hint */}
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: 12,
            right: 12,
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 10,
            color: '#94a3b8',
            pointerEvents: 'none',
          }}
        >
          <span>Drag to spin Moon · Scroll to zoom · Click lander icon or card below</span>
          <span>NASA LRO / LOLA Global Mosaic</span>
        </div>
      </div>

      {/* Clickable Candidate Site Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        {sites.map((site) => {
          const isSelected = site.siteId === selectedSiteId;
          return (
            <button
              key={site.siteId}
              type="button"
              onClick={() => flyToSite(site)}
              style={{
                textAlign: 'left',
                background: isSelected ? 'rgba(250, 204, 21, 0.12)' : '#090f1d',
                border: isSelected ? '1px solid #facc15' : '1px solid #1e293b',
                borderRadius: 8,
                padding: '8px 10px',
                cursor: 'pointer',
                color: '#e2e8f0',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: isSelected ? '#facc15' : '#38bdf8' }}>
                  {site.name.replace(' Crater', '').replace(' Ridge', '')}
                </span>
                {isSelected && <span style={{ fontSize: 10 }}>🛸</span>}
              </div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3 }}>
                {site.coordinates.latDeg.toFixed(2)}°, {site.coordinates.lonDeg.toFixed(2)}°
              </div>
              <div style={{ fontSize: 10, color: '#cbd5e1', marginTop: 1 }}>
                Elev: {(site.coordinates.elevationM ?? 0).toFixed(0)} m
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}