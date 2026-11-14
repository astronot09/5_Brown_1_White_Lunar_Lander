import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  calculateVisibility,
  getEphemerisSeries,
  type EphemerisVectorSample,
  type SiteHorizonProfile,
} from '../../../packages/lunar-core/src/index';
import {
  HorizonSkylineChart,
  VisibilityTimelineChart,
  type SkyTrackPoint,
} from './components/charts';
import { LunarSiteMap, useLunarSites, type LunarSite, type VisibilityState } from './components/map';

/**
 * Generates a realistic 29.5-day (708-hour) Moon-centered MEAN_ME ephemeris
 * series for the Lunar South Pole so the browser engine computes full synodic
 * illumination and Earth libration cycles without needing external servers.
 */
function buildSynodicSamples(startIso: string, hours = 708, stepHours = 3): EphemerisVectorSample[] {
  const startMs = Date.parse(startIso);
  const synodicPeriodSec = 29.53059 * 86400;
  const anomalisticPeriodSec = 27.55455 * 86400;
  const samples: EphemerisVectorSample[] = [];

  for (let h = 0; h <= hours; h += stepHours) {
    const tSec = h * 3600;
    const sunAngle = (2 * Math.PI * tSec) / synodicPeriodSec;
    const sunDeclRad = ((1.48 * Math.sin(sunAngle * 0.5 + 0.4)) * Math.PI) / 180;
    const sunDistKm = 149_597_870.7;

    const libLonRad = ((6.8 * Math.sin((2 * Math.PI * tSec) / anomalisticPeriodSec)) * Math.PI) / 180;
    const libLatRad = ((6.5 * Math.cos((2 * Math.PI * tSec) / anomalisticPeriodSec + 0.3)) * Math.PI) / 180;
    const earthDistKm = 384_400;

    samples.push({
      timestamp: new Date(startMs + tSec * 1000).toISOString(),
      frame: 'MEAN_ME',
      correctionModel: 'LT+S',
      sunPositionKm: {
        x: sunDistKm * Math.cos(sunDeclRad) * Math.cos(sunAngle),
        y: sunDistKm * Math.cos(sunDeclRad) * Math.sin(sunAngle),
        z: sunDistKm * Math.sin(sunDeclRad),
      },
      earthPositionKm: {
        x: earthDistKm * Math.cos(libLatRad) * Math.cos(libLonRad),
        y: earthDistKm * Math.cos(libLatRad) * Math.sin(libLonRad),
        z: earthDistKm * Math.sin(libLatRad),
      },
    });
  }
  return samples;
}

function sampleHorizonDeg(mask: number[], azimuthDeg: number): number {
  if (!mask || mask.length === 0) return 2.0;
  const n = mask.length;
  const wrapped = ((azimuthDeg % 360) + 360) % 360;
  const exactIdx = (wrapped / 360) * n;
  const i0 = Math.floor(exactIdx) % n;
  const i1 = (i0 + 1) % n;
  const frac = exactIdx - Math.floor(exactIdx);
  return mask[i0]! * (1 - frac) + mask[i1]! * frac;
}

function createEarthTexture(): THREE.CanvasTexture {
  const width = 512;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0b4f9f';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#2e7d32';
  const landmasses = [
    [125, 75, 42, 32],
    [145, 115, 22, 18],
    [168, 155, 28, 45],
    [275, 68, 35, 22],
    [282, 122, 34, 48],
    [355, 78, 65, 38],
    [405, 165, 26, 20],
  ];
  landmasses.forEach(([x, y, rx, ry]) => {
    ctx.beginPath();
    ctx.ellipse(x!, y!, rx!, ry!, 0.15, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = 'rgba(217, 179, 108, 0.55)';
  ctx.beginPath();
  ctx.ellipse(282, 106, 26, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(360, 82, 34, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, 16);
  ctx.fillRect(0, height - 16, width, 16);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.52)';
  for (let i = 0; i < 42; i++) {
    const cx = (i * 73) % width;
    const cy = 28 + ((i * 41) % (height - 56));
    const cw = 26 + (i % 5) * 14;
    ctx.beginPath();
    ctx.ellipse(cx, cy, cw, 4.5, -0.1, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Interactive 3D Lunar Crater Basin, Artemis Lander, Sun & Textured Earth Globe
 * sculpted from the site's 360-degree LOLA horizon elevation mask.
 */
function Terrain3DViewport({
  site,
  sunAzimuthDeg,
  sunElevationDeg,
  sunVisible,
  earthAzimuthDeg = 180,
  earthElevationDeg = 4,
  earthVisible = true,
}: {
  site: LunarSite;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  sunVisible: boolean;
  earthAzimuthDeg?: number;
  earthElevationDeg?: number;
  earthVisible?: boolean;
}) {
  const containerRef: any = useRef(null);
  const [viewMode, setViewMode] = useState('ORBIT');
  const [skyLabels, setSkyLabels] = useState({
    sun: { x: 0, y: 0, visible: false },
    earth: { x: 0, y: 0, visible: false },
  });

  const orbitRef = useRef({
    yaw: 0.65,
    pitch: 0.48,
    distance: 4.8,
    targetYaw: 0.65,
    targetPitch: 0.48,
    targetDistance: 4.8,
    isDragging: false,
    lastX: 0,
    lastY: 0,
  });

  const isSunBlocked = !sunVisible;
  const isEarthBlocked = !earthVisible;

  const sunRef = useRef({ az: sunAzimuthDeg, el: sunElevationDeg, blocked: isSunBlocked });
  sunRef.current = { az: sunAzimuthDeg, el: sunElevationDeg, blocked: isSunBlocked };

  const earthRef = useRef({ az: earthAzimuthDeg, el: earthElevationDeg, blocked: isEarthBlocked });
  earthRef.current = { az: earthAzimuthDeg, el: earthElevationDeg, blocked: isEarthBlocked };

  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 540;
    const height = 380;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x03050a, 0.045);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.05, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(1200 * 3);
    for (let i = 0; i < 1200 * 3; i += 3) {
      const r = 22 + Math.random() * 20;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.48;
      starPos[i] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i + 1] = r * Math.cos(phi) + 0.5;
      starPos[i + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(
      new THREE.Points(
        starGeo,
        new THREE.PointsMaterial({ color: 0xf8fafc, size: 0.09, transparent: true, opacity: 0.85 }),
      ),
    );

    const loader = new THREE.TextureLoader();
    const regolithTex = loader.load('/textures/lroc_color_poles_1k.jpg');
    regolithTex.wrapS = THREE.RepeatWrapping;
    regolithTex.wrapT = THREE.RepeatWrapping;
    regolithTex.repeat.set(6, 6);
    regolithTex.colorSpace = THREE.SRGBColorSpace;

    const horizonMaskDeg = site.horizonMaskDeg ?? new Array(360).fill(2);
    const maxRadius = 3.2;
    const radialSegs = 96;
    const angularSegs = 180;
    const terrainGeo = new THREE.RingGeometry(0.001, maxRadius, angularSegs, radialSegs);
    terrainGeo.rotateX(-Math.PI / 2);

    const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(posAttr.count * 3);

    let seed = 1337;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const localCraters: { x: number; z: number; r: number; d: number }[] = [];
    for (let i = 0; i < 65; i++) {
      const dist = 0.25 + rand() * 2.6;
      const ang = rand() * Math.PI * 2;
      localCraters.push({
        x: Math.cos(ang) * dist,
        z: Math.sin(ang) * dist,
        r: 0.05 + rand() * 0.18,
        d: 0.015 + rand() * 0.035,
      });
    }

    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      const r = Math.hypot(x, z);

      const azRad = Math.atan2(x, -z);
      const azDeg = ((azRad * 180) / Math.PI + 360) % 360;
      const maskAngleDeg = sampleHorizonDeg(horizonMaskDeg, azDeg);

      const t = Math.max(0, Math.min(1, (r - 0.22) / (maxRadius - 0.22)));
      const smoothRise = t * t * (3 - 2 * t);
      const ridgeHeight = Math.tan((Math.max(0, maskAngleDeg) * Math.PI) / 180) * r * 3.2 * smoothRise;
      const ridgeNoise =
        (Math.sin(azRad * 7 + r * 2.1) * 0.035 + Math.cos(azRad * 13 - r * 3.4) * 0.02) * smoothRise;

      let craterOffset = 0;
      if (r > 0.18) {
        for (let c = 0; c < localCraters.length; c++) {
          const cr = localCraters[c]!;
          const d = Math.hypot(x - cr.x, z - cr.z);
          if (d < cr.r * 1.2) {
            const norm = d / cr.r;
            if (norm < 0.85) {
              craterOffset -= Math.cos((norm / 0.85) * (Math.PI / 2)) * cr.d;
            } else {
              craterOffset += Math.sin(((norm - 0.85) / 0.35) * Math.PI) * cr.d * 0.45;
            }
          }
        }
      }

      const y = Math.max(-0.08, ridgeHeight + ridgeNoise + craterOffset);
      posAttr.setY(i, y);

      const shade = Math.max(0.45, Math.min(1.0, 0.68 + y * 0.45));
      colors[i * 3] = shade;
      colors[i * 3 + 1] = shade;
      colors[i * 3 + 2] = Math.min(1, shade * 1.03);
    }

    terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      map: regolithTex,
      bumpMap: regolithTex,
      bumpScale: 0.018,
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = true;
    scene.add(terrainMesh);

    const rimPoints: THREE.Vector3[] = [];
    for (let deg = 0; deg <= 360; deg += 2) {
      const rad = (deg * Math.PI) / 180;
      const r = maxRadius * 0.98;
      const x = Math.sin(rad) * r;
      const z = -Math.cos(rad) * r;
      const maskDeg = sampleHorizonDeg(horizonMaskDeg, deg);
      const y = Math.tan((Math.max(0, maskDeg) * Math.PI) / 180) * r * 3.2 + 0.015;
      rimPoints.push(new THREE.Vector3(x, y, z));
    }
    scene.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(rimPoints),
        new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.65 }),
      ),
    );

    const landerGroup = new THREE.Group();
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.85, roughness: 0.25 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.2, roughness: 0.4 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.6, roughness: 0.5 });

    const descent = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.045, 8), goldMat);
    descent.position.y = 0.045;
    descent.castShadow = true;
    landerGroup.add(descent);

    const ascent = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.048, 0.055, 8), whiteMat);
    ascent.position.y = 0.095;
    ascent.castShadow = true;
    landerGroup.add(ascent);

    for (let i = 0; i < 4; i++) {
      const ang = (i * Math.PI) / 2 + Math.PI / 4;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.075, 6), darkMat);
      leg.position.set(Math.cos(ang) * 0.068, 0.032, Math.sin(ang) * 0.068);
      leg.rotation.z = -Math.cos(ang) * 0.55;
      leg.rotation.x = Math.sin(ang) * 0.55;
      landerGroup.add(leg);

      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.005, 10), goldMat);
      pad.position.set(Math.cos(ang) * 0.088, 0.003, Math.sin(ang) * 0.088);
      landerGroup.add(pad);
    }

    const padRing = new THREE.Mesh(
      new THREE.RingGeometry(0.14, 0.15, 48),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.45 }),
    );
    padRing.rotation.x = -Math.PI / 2;
    padRing.position.y = 0.002;
    landerGroup.add(padRing);
    scene.add(landerGroup);

    const sunLight = new THREE.DirectionalLight(0xfffbeb, 3.1);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 15;
    const d = 3.6;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0015;
    scene.add(sunLight);

    scene.add(new THREE.AmbientLight(0x1e3a5f, 0.58));

    const sunOrb = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0xfde047 }),
    );
    scene.add(sunOrb);

    const sunRayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.08, 0), new THREE.Vector3(0, 1, -3)]);
    const sunRayMat = new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.85 });
    const sunRay = new THREE.Line(sunRayGeo, sunRayMat);
    scene.add(sunRay);

    const earthGroup = new THREE.Group();
    const earthTex = createEarthTexture();
    const earthSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 32, 32),
      new THREE.MeshBasicMaterial({ map: earthTex }),
    );
    earthGroup.add(earthSphere);

    const earthAtmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.185, 32, 32),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.28,
        side: THREE.BackSide,
      }),
    );
    earthGroup.add(earthAtmosphere);
    scene.add(earthGroup);

    const earthRayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.11, 0), new THREE.Vector3(0, 1, 3)]);
    const earthRayMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85 });
    const earthRay = new THREE.Line(earthRayGeo, earthRayMat);
    scene.add(earthRay);

    const onPointerDown = (e: PointerEvent) => {
      orbitRef.current.isDragging = true;
      orbitRef.current.lastX = e.clientX;
      orbitRef.current.lastY = e.clientY;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!orbitRef.current.isDragging) return;
      const dx = e.clientX - orbitRef.current.lastX;
      const dy = e.clientY - orbitRef.current.lastY;
      orbitRef.current.targetYaw -= dx * 0.007;
      orbitRef.current.targetPitch = Math.max(0.06, Math.min(1.45, orbitRef.current.targetPitch + dy * 0.007));
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
      orbitRef.current.targetDistance = Math.max(1.2, Math.min(7.5, orbitRef.current.targetDistance + e.deltaY * 0.002));
    };

    const dom = renderer.domElement;
    dom.style.cursor = 'grab';
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('wheel', onWheel, { passive: false });

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 540;
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
      renderer.setSize(w, height);
    };
    window.addEventListener('resize', onResize);

    let frameId = 0;
    let lastLabelSync = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      const o = orbitRef.current;
      o.yaw += (o.targetYaw - o.yaw) * 0.12;
      o.pitch += (o.targetPitch - o.pitch) * 0.12;
      o.distance += (o.targetDistance - o.distance) * 0.14;

      if (viewModeRef.current === 'SURFACE') {
        camera.position.set(Math.sin(o.yaw) * 0.28, 0.16, Math.cos(o.yaw) * 0.28);
        camera.lookAt(-Math.sin(o.yaw) * 2.5, 0.22, -Math.cos(o.yaw) * 2.5);
      } else {
        camera.position.set(
          o.distance * Math.cos(o.pitch) * Math.sin(o.yaw),
          o.distance * Math.sin(o.pitch),
          o.distance * Math.cos(o.pitch) * Math.cos(o.yaw),
        );
        camera.lookAt(0, 0.15, 0);
      }

      const sAzRad = (sunRef.current.az * Math.PI) / 180;
      const sElRad = Math.atan(Math.tan((sunRef.current.el * Math.PI) / 180) * 3.2);
      const skyDist = 3.5;
      const sunPos = new THREE.Vector3(
        Math.sin(sAzRad) * Math.cos(sElRad) * skyDist,
        Math.max(-0.25, Math.sin(sElRad) * skyDist),
        -Math.cos(sAzRad) * Math.cos(sElRad) * skyDist,
      );
      sunOrb.position.copy(sunPos);
      sunLight.position.copy(sunPos).multiplyScalar(1.8);
      sunLight.intensity = sunRef.current.el > -1 ? 3.2 : 0.25;

      sunRay.geometry.setFromPoints([new THREE.Vector3(0, 0.08, 0), sunPos]);
      sunRayMat.color.setHex(sunRef.current.blocked ? 0xef4444 : 0xfacc15);
      sunOrb.material.color.setHex(sunRef.current.blocked ? 0xf97316 : 0xfde047);

      const eAzRad = (earthRef.current.az * Math.PI) / 180;
      const eElRad = Math.atan(Math.tan((earthRef.current.el * Math.PI) / 180) * 3.2);
      const earthPos = new THREE.Vector3(
        Math.sin(eAzRad) * Math.cos(eElRad) * skyDist,
        Math.max(0.18, Math.sin(eElRad) * skyDist),
        -Math.cos(eAzRad) * Math.cos(eElRad) * skyDist,
      );
      earthGroup.position.copy(earthPos);
      earthSphere.rotation.y = t * 0.25;
      earthRay.geometry.setFromPoints([new THREE.Vector3(0, 0.11, 0), earthPos]);
      earthRayMat.color.setHex(earthRef.current.blocked ? 0xf43f5e : 0x38bdf8);

      renderer.render(scene, camera);

      if (t - lastLabelSync > 0.04) {
        lastLabelSync = t;
        const w = renderer.domElement.clientWidth || width;
        const h = renderer.domElement.clientHeight || height;

        const sv = sunPos.clone().project(camera);
        const ev = earthPos.clone().project(camera);

        setSkyLabels({
          sun: {
            x: (sv.x * 0.5 + 0.5) * w,
            y: (-sv.y * 0.5 + 0.5) * h - 18,
            visible: sv.z < 1,
          },
          earth: {
            x: (ev.x * 0.5 + 0.5) * w,
            y: (-ev.y * 0.5 + 0.5) * h - 22,
            visible: ev.z < 1,
          },
        });
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
  }, [site]);

  return (
    <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid #1e293b', background: '#03050a' }}>
      <div ref={containerRef} style={{ width: '100%', height: 380 }} />

      {/* Clear Floating Sky Callout Labels for EARTH and SUN */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {skyLabels.sun.visible && (
          <div
            style={{
              position: 'absolute',
              left: Math.max(40, Math.min(480, skyLabels.sun.x)),
              top: Math.max(44, Math.min(340, skyLabels.sun.y)),
              transform: 'translate(-50%, -50%)',
              background: 'rgba(15, 23, 42, 0.88)',
              border: `1px solid ${isSunBlocked ? '#ef4444' : '#facc15'}`,
              color: isSunBlocked ? '#fca5a5' : '#fde047',
              padding: '2px 7px',
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            ☀ SUN ({sunElevationDeg.toFixed(1)}°)
          </div>
        )}

        {skyLabels.earth.visible && (
          <div
            style={{
              position: 'absolute',
              left: Math.max(55, Math.min(470, skyLabels.earth.x)),
              top: Math.max(44, Math.min(340, skyLabels.earth.y)),
              transform: 'translate(-50%, -50%)',
              background: 'rgba(15, 23, 42, 0.92)',
              border: `1px solid ${isEarthBlocked ? '#f43f5e' : '#38bdf8'}`,
              color: isEarthBlocked ? '#fda4af' : '#7dd3fc',
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            🌍 EARTH DTE ({earthElevationDeg.toFixed(1)}°)
          </div>
        )}
      </div>

      {/* Top Camera Mode Toggle */}
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
              setViewMode('ORBIT');
              orbitRef.current.targetPitch = 0.48;
              orbitRef.current.targetDistance = 4.8;
            }}
            style={{
              background: viewMode === 'ORBIT' ? '#0284c7' : 'rgba(15, 23, 42, 0.88)',
              color: '#fff',
              border: '1px solid #334155',
              borderRadius: 6,
              padding: '5px 9px',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            1. 3D Ridge Overview
          </button>
          <button
            type="button"
            onClick={() => {
              setViewMode('SURFACE');
              orbitRef.current.targetYaw = ((sunAzimuthDeg + 180) * Math.PI) / 180;
            }}
            style={{
              background: viewMode === 'SURFACE' ? '#059669' : 'rgba(15, 23, 42, 0.88)',
              color: '#fff',
              border: '1px solid #334155',
              borderRadius: 6,
              padding: '5px 9px',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            2. Lander Surface View
          </button>
        </div>

        {/* Live Line-of-Sight Legend Badges */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span
            style={{
              background: 'rgba(15, 23, 42, 0.88)',
              border: `1px solid ${isSunBlocked ? '#ef4444' : '#facc15'}`,
              color: isSunBlocked ? '#fca5a5' : '#fde047',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            ☀ {isSunBlocked ? 'SUN BLOCKED BY RIM' : 'SOLAR LINE-OF-SIGHT'}
          </span>
          <span
            style={{
              background: 'rgba(15, 23, 42, 0.88)',
              border: `1px solid ${isEarthBlocked ? '#f43f5e' : '#38bdf8'}`,
              color: isEarthBlocked ? '#fda4af' : '#7dd3fc',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            📡 {isEarthBlocked ? 'DTE OCCULTED' : 'EARTH DTE CLEAR'}
          </span>
        </div>
      </div>

      {/* Bottom Controls Hint */}
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
        <span>
          {viewMode === 'SURFACE'
            ? 'Drag left/right to pan 360° horizon skyline from lander deck'
            : 'Drag to orbit crater basin · Scroll to zoom · Real-time ridge shadow casting'}
        </span>
        <span>3D LOLA Horizon DEM</span>
      </div>
    </div>
  );
}

export function App() {
  const { sites, loading, error } = useLunarSites();
  const [selectedSiteId, setSelectedSiteId] = useState('malapert_massif_01');
  const [selectedTimeIndex, setSelectedTimeIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const selectedSite: LunarSite | null = useMemo(() => {
    if (sites.length === 0) return null;
    return sites.find((s) => s.siteId === selectedSiteId) ?? sites[0] ?? null;
  }, [sites, selectedSiteId]);

  const samples = useMemo(() => buildSynodicSamples('2026-11-14T00:00:00Z', 708, 3), []);

  const { timelineStates, sunTrack, earthTrack } = useMemo(() => {
    if (!selectedSite || !selectedSite.horizonMaskDeg?.length) {
      return {
        timelineStates: [] as VisibilityState[],
        sunTrack: [] as SkyTrackPoint[],
        earthTrack: [] as SkyTrackPoint[],
      };
    }

    const coreProfile: SiteHorizonProfile = {
      siteId: selectedSite.siteId,
      name: selectedSite.name,
      latitudeDeg: selectedSite.coordinates.latDeg,
      longitudeDeg: selectedSite.coordinates.lonDeg,
      siteElevationM: selectedSite.coordinates.elevationM ?? 0,
      horizonAzimuthStepDeg: selectedSite.azimuthStepDeg ?? 1,
      horizonElevationDeg: selectedSite.horizonMaskDeg,
    };

    const ephemeris = getEphemerisSeries(coreProfile, samples);
    const analysis = calculateVisibility(coreProfile, ephemeris);

    const mappedStates: VisibilityState[] = analysis.states.map((st, idx) => {
      const ep = ephemeris[idx]!;
      return {
        timeUtc: st.timestamp,
        solarIrradianceWm2: st.solarIrradianceWm2,
        sunlitFraction: st.sunVisibleFraction,
        earthClearanceDeg: st.earthCommsClearanceDeg,
        sunVisible: st.sunIlluminated,
        earthVisible: st.earthCommsAvailable,
        sunAzimuthDeg: ep.sun.azimuthDeg,
        sunElevationDeg: ep.sun.elevationDeg,
        earthAzimuthDeg: ep.earth.azimuthDeg,
        earthElevationDeg: ep.earth.elevationDeg,
        powerIndex: st.sunVisibleFraction,
        operationsWindow: st.sunIlluminated && st.earthCommsAvailable,
      };
    });

    const sunPts: SkyTrackPoint[] = ephemeris.slice(0, 80).map((ep) => ({
      timeUtc: ep.timestamp,
      position: {
        azimuthDeg: ep.sun.azimuthDeg,
        elevationDeg: ep.sun.elevationDeg,
        angularRadiusDeg: ep.sun.angularRadiusDeg,
      },
    }));

    const earthPts: SkyTrackPoint[] = ephemeris.slice(0, 80).map((ep) => ({
      timeUtc: ep.timestamp,
      position: {
        azimuthDeg: ep.earth.azimuthDeg,
        elevationDeg: ep.earth.elevationDeg,
        angularRadiusDeg: ep.earth.angularRadiusDeg,
      },
    }));

    return { timelineStates: mappedStates, sunTrack: sunPts, earthTrack: earthPts };
  }, [selectedSite, samples]);

  useEffect(() => {
    if (!isPlaying || timelineStates.length === 0) return;
    const id = window.setInterval(() => {
      setSelectedTimeIndex((prev) => (prev + 1) % timelineStates.length);
    }, 180);
    return () => window.clearInterval(id);
  }, [isPlaying, timelineStates.length]);

  const currentState = timelineStates[Math.min(selectedTimeIndex, Math.max(0, timelineStates.length - 1))] ?? null;

  const summaryStats = useMemo(() => {
    if (timelineStates.length === 0) return { sunPct: 0, commsPct: 0, peakWm2: 0 };
    const sunCount = timelineStates.filter((s) => s.sunVisible).length;
    const commsCount = timelineStates.filter((s) => s.earthVisible).length;
    const peakWm2 = Math.max(...timelineStates.map((s) => s.solarIrradianceWm2));
    return {
      sunPct: (sunCount / timelineStates.length) * 100,
      commsPct: (commsCount / timelineStates.length) * 100,
      peakWm2,
    };
  }, [timelineStates]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#060a14', color: '#e2e8f0', display: 'grid', placeItems: 'center', fontFamily: 'system-ui, sans-serif' }}>
        Initializing Lunar South Pole Ephemeris &amp; DEM Telemetry...
      </div>
    );
  }

  if (error || !selectedSite) {
    return (
      <div style={{ minHeight: '100vh', background: '#060a14', color: '#f87171', padding: 32, fontFamily: 'system-ui, sans-serif' }}>
        Failed to load lunar site profiles: {error ?? 'No sites available'}
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#060a14', color: '#e2e8f0', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Top NASA Mission Control Header */}
      <header
        style={{
          borderBottom: '1px solid #1e293b',
          background: 'linear-gradient(90deg, #0b1222 0%, #0f172a 100%)',
          padding: '14px 28px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ background: '#0284c7', color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4, letterSpacing: '0.06em' }}>
              ARTEMIS SOUTH POLE
            </span>
            <span style={{ background: '#065f46', color: '#6ee7b7', fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4 }}>
              DE441 GATE &lt; 0.05°
            </span>
          </div>
          <h1 style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
            Lunar Skyline — Terrain-Aware Landing Site Navigator
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label htmlFor="site-select" style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>
            Candidate Landing Zone:
          </label>
          <select
            id="site-select"
            value={selectedSite.siteId}
            onChange={(e) => setSelectedSiteId(e.target.value)}
            style={{
              background: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {sites.map((s) => (
              <option key={s.siteId} value={s.siteId}>
                {s.name} ({s.coordinates.latDeg.toFixed(2)}°, {s.coordinates.lonDeg.toFixed(2)}°)
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Main Telemetry Grid */}
      <main style={{ maxWidth: 1440, margin: '0 auto', padding: '20px 28px', display: 'grid', gap: 20 }}>
        {/* KPI Telemetry Strip */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Site Coordinates &amp; Altitude</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
              {selectedSite.coordinates.latDeg.toFixed(2)}°, {selectedSite.coordinates.lonDeg.toFixed(2)}°
            </div>
            <div style={{ fontSize: 12, color: '#38bdf8', marginTop: 2 }}>
              Elevation: {(selectedSite.coordinates.elevationM ?? 0).toFixed(1)} m
            </div>
          </div>

          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Instant Solar Power</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: currentState?.sunVisible ? '#facc15' : '#94a3b8' }}>
              {(currentState?.solarIrradianceWm2 ?? 0).toFixed(0)} W/m²
            </div>
            <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 2 }}>
              Disc Visible: {((currentState?.sunlitFraction ?? 0) * 100).toFixed(1)}% · Synodic Sun: {summaryStats.sunPct.toFixed(1)}%
            </div>
          </div>

          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Direct-To-Earth (DTE) Link</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: currentState?.earthVisible ? '#34d399' : '#f87171' }}>
              {currentState?.earthVisible ? 'LINE-OF-SIGHT ACTIVE' : 'OCCULTED BY RIDGE'}
            </div>
            <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 2 }}>
              Clearance: {(currentState?.earthClearanceDeg ?? 0).toFixed(2)}° · Cycle Comms: {summaryStats.commsPct.toFixed(1)}%
            </div>
          </div>

          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Simulation Timestamp (UTC)</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>
                {currentState ? currentState.timeUtc.replace('T', ' ').slice(0, 16) + ' UTC' : '—'}
              </span>
              <button
                type="button"
                onClick={() => setIsPlaying((p) => !p)}
                style={{
                  background: isPlaying ? '#dc2626' : '#0284c7',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {isPlaying ? '⏸ Pause' : '▶ Play Orbit'}
              </button>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0, timelineStates.length - 1)}
              value={selectedTimeIndex}
              onChange={(e) => setSelectedTimeIndex(Number(e.target.value))}
              style={{ width: '100%', marginTop: 6, accentColor: '#38bdf8' }}
            />
          </div>
        </section>

        {/* Middle Row: 3D Moon Globe + 3D Terrain Rim Viewport */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: 20 }}>
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>South Polar Stereographic Landing Map</h2>
              <span style={{ fontSize: 11, color: '#38bdf8' }}>Sun Azimuth Ray: {(currentState?.sunAzimuthDeg ?? 0).toFixed(1)}°</span>
            </div>
            <LunarSiteMap
              selectedSiteId={selectedSite.siteId}
              onSiteSelect={(site) => setSelectedSiteId(site.siteId)}
              azimuthDeg={currentState?.sunAzimuthDeg}
            />
          </div>

          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>3D Horizon Rim &amp; Solar Illumination Geometry</h2>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{selectedSite.demSource ?? 'LOLA DEM'}</span>
            </div>
            <Terrain3DViewport
              site={selectedSite}
              sunAzimuthDeg={currentState?.sunAzimuthDeg ?? 0}
              sunElevationDeg={currentState?.sunElevationDeg ?? 0}
              sunVisible={currentState?.sunVisible ?? false}
              earthAzimuthDeg={currentState?.earthAzimuthDeg ?? 180}
              earthElevationDeg={currentState?.earthElevationDeg ?? 4}
              earthVisible={currentState?.earthVisible ?? true}
            />
          </div>
        </section>

        {/* Bottom Row: D3 360° Horizon Skyline Chart + D3 Multi-Day Visibility Timeline */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: 20 }}>
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 600 }}>360° Terrain Skyline &amp; Sun/Earth Ephemeris</h2>
            <HorizonSkylineChart
              site={selectedSite}
              sunPosition={
                currentState
                  ? { azimuthDeg: currentState.sunAzimuthDeg ?? 0, elevationDeg: currentState.sunElevationDeg ?? 0, angularRadiusDeg: 0.266 }
                  : null
              }
              earthPosition={
                currentState
                  ? { azimuthDeg: currentState.earthAzimuthDeg ?? 0, elevationDeg: currentState.earthElevationDeg ?? 0, angularRadiusDeg: 0.95 }
                  : null
              }
              currentVisibility={currentState}
              sunPath={sunTrack}
              earthPath={earthTrack}
              height={310}
            />
          </div>

          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 600 }}>29.5-Day Synodic Illumination &amp; Comms Windows</h2>
            <VisibilityTimelineChart
              data={timelineStates}
              selectedIndex={selectedTimeIndex}
              onTimeChange={(_, idx) => setSelectedTimeIndex(idx)}
              height={310}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;