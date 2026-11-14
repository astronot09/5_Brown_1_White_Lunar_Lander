import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { CuratedLunarSite } from '../../data/siteCatalogue';
import type { SimulationStepState } from '../../engine/physicsEngine';

export type MapPerspective = 'GLOBE' | 'STREET_VIEW' | 'ORBITAL_SYSTEM';

export interface LunarSiteMapProps {
  sites: CuratedLunarSite[];
  selectedSite: CuratedLunarSite;
  currentState: SimulationStepState;
  perspective: MapPerspective;
  onSelectSite: (site: CuratedLunarSite) => void;
  onDropCustomPin: (latDeg: number, lonDeg: number) => void;
  compact?: boolean;
}

const LANDMARKS = [
  { name: 'South Pole (90°S)', lat: -89.8, lon: 0 },
  { name: 'Tycho Crater', lat: -43.3, lon: 348.8 },
  { name: 'Mare Tranquillitatis', lat: 1.5, lon: 25.0 },
  { name: 'Lunar Far Side', lat: -10.0, lon: 180.0 },
];

function latLonToVector3(latDeg: number, lonDeg: number, radius: number): THREE.Vector3 {
  const phi = ((90 - latDeg) * Math.PI) / 180;
  const theta = ((lonDeg + 180) * Math.PI) / 180;
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return new THREE.Vector3(x, y, z);
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

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, 16);
  ctx.fillRect(0, height - 16, width, 16);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  for (let i = 0; i < 38; i++) {
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

export function LunarSiteMap({
  sites,
  selectedSite,
  currentState,
  perspective,
  onSelectSite,
  onDropCustomPin,
  compact = false,
}: LunarSiteMapProps) {
  const mountRef: any = useRef(null);
  const [skyBadges, setSkyBadges] = useState({
    sun: { x: 0, y: 0, visible: false },
    earth: { x: 0, y: 0, visible: false },
    headingDeg: 0,
  });

  const dragRef = useRef({ isDragging: false, lastX: 0, lastY: 0, moved: false });
  const cameraCtrlRef = useRef({
    globeRotX: 1.15,
    globeRotY: 0.35,
    targetGlobeRotX: 1.15,
    targetGlobeRotY: 0.35,
    globeZoom: 2.35,
    targetGlobeZoom: 2.35,
    streetYaw: 0,
    streetPitch: 0.08,
  });

  const stateRef = useRef(currentState);
  stateRef.current = currentState;

  const siteRef = useRef(selectedSite);
  siteRef.current = selectedSite;

  useEffect(() => {
    const latRad = (selectedSite.coordinates.latDeg * Math.PI) / 180;
    const lonRad = ((selectedSite.coordinates.lonDeg + 90) * Math.PI) / 180;
    cameraCtrlRef.current.targetGlobeRotX = Math.max(-1.48, Math.min(1.48, -latRad * 0.92));
    cameraCtrlRef.current.targetGlobeRotY = -lonRad;
    cameraCtrlRef.current.streetYaw = (currentState.sunAzimuthDeg * Math.PI) / 180;
  }, [selectedSite.siteId]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || (compact ? 340 : 680);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.05, 150);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.38;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const starGeo = new THREE.BufferGeometry();
    const starCount = compact ? 600 : 1600;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i += 3) {
      const r = 28 + Math.random() * 25;
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(2 * Math.random() - 1);
      starPos[i] = r * Math.sin(v) * Math.cos(u);
      starPos[i + 1] = r * Math.sin(v) * Math.sin(u);
      starPos[i + 2] = r * Math.cos(v);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(
      new THREE.Points(
        starGeo,
        new THREE.PointsMaterial({ color: 0xf8fafc, size: 0.08, transparent: true, opacity: 0.78 }),
      ),
    );

    const texLoader = new THREE.TextureLoader();
    const moonTex = texLoader.load('/textures/lroc_color_poles_1k.jpg');
    moonTex.colorSpace = THREE.SRGBColorSpace;

    const globeGroup = new THREE.Group();
    const moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 80, 80),
      new THREE.MeshStandardMaterial({
        map: moonTex,
        bumpMap: moonTex,
        bumpScale: 0.018,
        roughness: 0.86,
        metalness: 0.02,
      }),
    );
    globeGroup.add(moonMesh);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1.028, 48, 48),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.11, side: THREE.BackSide }),
    );
    globeGroup.add(halo);

    const gridMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.22 });
    [-60, -30, 0, 30, 60].forEach((lat) => {
      const pts: THREE.Vector3[] = [];
      for (let lon = 0; lon <= 360; lon += 5) pts.push(latLonToVector3(lat, lon, 1.002));
      globeGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
    });

    const pinMeshes: { mesh: THREE.Mesh; site: CuratedLunarSite }[] = [];
    let beaconRing: THREE.Mesh | null = null;

    sites.forEach((s) => {
      const isSel = s.siteId === selectedSite.siteId;
      const color = isSel
        ? 0xfacc15
        : s.program === 'APOLLO'
          ? 0x38bdf8
          : s.program === 'CLPS'
            ? 0xf97316
            : s.program === 'CSA'
              ? 0xf43f5e
              : s.program === 'INTERNATIONAL'
                ? 0xc084fc
                : 0x34d399;

      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(isSel ? 0.026 : 0.016, 16, 16),
        new THREE.MeshBasicMaterial({ color }),
      );
      const pos = latLonToVector3(s.coordinates.latDeg, s.coordinates.lonDeg, 1.012);
      pin.position.copy(pos);
      globeGroup.add(pin);
      pinMeshes.push({ mesh: pin, site: s });

      if (isSel) {
        beaconRing = new THREE.Mesh(
          new THREE.RingGeometry(0.036, 0.052, 32),
          new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide }),
        );
        beaconRing.position.copy(latLonToVector3(s.coordinates.latDeg, s.coordinates.lonDeg, 1.014));
        beaconRing.lookAt(pos.clone().multiplyScalar(2));
        globeGroup.add(beaconRing);
      }
    });

    const streetGroup = new THREE.Group();
    const regolithRepeat = moonTex.clone();
    regolithRepeat.wrapS = THREE.RepeatWrapping;
    regolithRepeat.wrapT = THREE.RepeatWrapping;
    regolithRepeat.repeat.set(8, 8);
    regolithRepeat.needsUpdate = true;

    const maxR = 6.0;
    const terrainGeo = new THREE.RingGeometry(0.01, maxR, 180, 64);
    terrainGeo.rotateX(-Math.PI / 2);
    const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
    const mask = selectedSite.horizonMaskDeg;

    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      const r = Math.hypot(x, z);
      const azRad = Math.atan2(x, -z);
      const azDeg = ((azRad * 180) / Math.PI + 360) % 360;
      const maskDeg = sampleHorizonDeg(mask, azDeg);

      const t = Math.max(0, Math.min(1, (r - 0.35) / (maxR - 0.35)));
      const smooth = t * t * (3 - 2 * t);
      const ridgeY = Math.tan((Math.max(0, maskDeg) * Math.PI) / 180) * r * 2.4 * smooth;
      const microBump = Math.sin(x * 7) * Math.cos(z * 7) * 0.012 * (1 - smooth);
      posAttr.setY(i, ridgeY + microBump);
    }
    terrainGeo.computeVertexNormals();

    const surfaceTerrain = new THREE.Mesh(
      terrainGeo,
      new THREE.MeshStandardMaterial({
        map: regolithRepeat,
        bumpMap: regolithRepeat,
        bumpScale: 0.02,
        roughness: 0.95,
        side: THREE.DoubleSide,
      }),
    );
    surfaceTerrain.receiveShadow = true;
    streetGroup.add(surfaceTerrain);

    const skySun = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xfef08a }),
    );
    streetGroup.add(skySun);

    const earthTex = createEarthTexture();
    const skyEarth = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 32, 32),
      new THREE.MeshBasicMaterial({ map: earthTex }),
    );
    streetGroup.add(skyEarth);

    const orbitSystemGroup = new THREE.Group();
    const centralEarth = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 40, 40),
      new THREE.MeshStandardMaterial({ map: earthTex, roughness: 0.6 }),
    );
    orbitSystemGroup.add(centralEarth);

    const orbitRingPts: THREE.Vector3[] = [];
    const orbitRadius = 2.4;
    for (let deg = 0; deg <= 360; deg += 3) {
      const rad = (deg * Math.PI) / 180;
      orbitRingPts.push(new THREE.Vector3(Math.cos(rad) * orbitRadius, 0, Math.sin(rad) * orbitRadius));
    }
    orbitSystemGroup.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(orbitRingPts),
        new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45 }),
      ),
    );

    const orbitingMoon = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 36, 36),
      new THREE.MeshStandardMaterial({ map: moonTex, roughness: 0.85 }),
    );
    orbitSystemGroup.add(orbitingMoon);

    const siteMarkerOnOrbitMoon = new THREE.Mesh(
      new THREE.SphereGeometry(0.032, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xfacc15 }),
    );
    orbitingMoon.add(siteMarkerOnOrbitMoon);

    if (perspective === 'GLOBE') scene.add(globeGroup);
    else if (perspective === 'STREET_VIEW') scene.add(streetGroup);
    else scene.add(orbitSystemGroup);

    const sunDirLight = new THREE.DirectionalLight(0xffffff, perspective === 'GLOBE' ? 1.8 : 2.8);
    sunDirLight.position.set(4, 3, 5);
    scene.add(sunDirLight);

    const fillHemi = new THREE.HemisphereLight(
      0xffffff,
      0x475569,
      perspective === 'GLOBE' ? 1.55 : perspective === 'ORBITAL_SYSTEM' ? 1.2 : 0.75,
    );
    scene.add(fillHemi);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const onPointerDown = (e: PointerEvent) => {
      dragRef.current = { isDragging: true, lastX: e.clientX, lastY: e.clientY, moved: false };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current.isDragging) return;
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragRef.current.moved = true;

      const ctrl = cameraCtrlRef.current;
      if (perspective === 'STREET_VIEW') {
        ctrl.streetYaw -= dx * 0.005;
        ctrl.streetPitch = Math.max(-0.18, Math.min(0.85, ctrl.streetPitch + dy * 0.004));
      } else {
        ctrl.targetGlobeRotY += dx * 0.007;
        ctrl.targetGlobeRotX = Math.max(-1.55, Math.min(1.55, ctrl.targetGlobeRotX + dy * 0.008));
      }

      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      const wasClick = dragRef.current.isDragging && !dragRef.current.moved;
      dragRef.current.isDragging = false;
      if (!wasClick || perspective !== 'GLOBE') return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const hitPins = raycaster.intersectObjects(pinMeshes.map((p) => p.mesh));
      if (hitPins.length > 0) {
        const found = pinMeshes.find((p) => p.mesh === hitPins[0]!.object);
        if (found) {
          onSelectSite(found.site);
          return;
        }
      }

      const hitMoon = raycaster.intersectObject(moonMesh);
      if (hitMoon.length > 0) {
        const localPt = globeGroup.worldToLocal(hitMoon[0]!.point.clone()).normalize();
        const latDeg = (Math.asin(Math.max(-1, Math.min(1, localPt.y))) * 180) / Math.PI;
        const lonDeg = (((Math.atan2(localPt.z, -localPt.x) * 180) / Math.PI - 180) % 360 + 360) % 360;
        onDropCustomPin(Number(latDeg.toFixed(2)), Number(lonDeg.toFixed(2)));
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (perspective !== 'STREET_VIEW') {
        cameraCtrlRef.current.targetGlobeZoom = Math.max(
          1.38,
          Math.min(4.2, cameraCtrlRef.current.targetGlobeZoom + e.deltaY * 0.0018),
        );
      }
    };

    const dom = renderer.domElement;
    dom.style.cursor = perspective === 'STREET_VIEW' ? 'move' : 'grab';
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('wheel', onWheel, { passive: false });

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || (compact ? 340 : 680);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    let frameId = 0;
    let lastSync = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const ctrl = cameraCtrlRef.current;
      const st = stateRef.current;

      ctrl.globeRotX += (ctrl.targetGlobeRotX - ctrl.globeRotX) * 0.14;
      ctrl.globeRotY += (ctrl.targetGlobeRotY - ctrl.globeRotY) * 0.14;
      ctrl.globeZoom += (ctrl.targetGlobeZoom - ctrl.globeZoom) * 0.14;

      if (perspective === 'GLOBE') {
        globeGroup.rotation.x = ctrl.globeRotX;
        globeGroup.rotation.y = ctrl.globeRotY;
        camera.position.set(0, 0, ctrl.globeZoom);
        camera.lookAt(0, 0, 0);

        const sunAzRad = (st.sunAzimuthDeg * Math.PI) / 180;
        sunDirLight.position.set(Math.sin(sunAzRad) * 6, 0.4, Math.cos(sunAzRad) * 6);

        if (beaconRing) {
          const pulse = 1 + 0.18 * Math.sin(t * 4);
          beaconRing.scale.set(pulse, pulse, 1);
        }
      } else if (perspective === 'STREET_VIEW') {
        camera.position.set(0, 0.22, 0);
        const lookDist = 5;
        const lookX = Math.sin(ctrl.streetYaw) * Math.cos(ctrl.streetPitch) * lookDist;
        const lookY = 0.22 + Math.sin(ctrl.streetPitch) * lookDist;
        const lookZ = -Math.cos(ctrl.streetYaw) * Math.cos(ctrl.streetPitch) * lookDist;
        camera.lookAt(lookX, lookY, lookZ);

        const skyR = 7.2;
        const sAz = (st.sunAzimuthDeg * Math.PI) / 180;
        const sEl = Math.atan(Math.tan((st.sunElevationDeg * Math.PI) / 180) * 2.4);
        const sunPos = new THREE.Vector3(
          Math.sin(sAz) * Math.cos(sEl) * skyR,
          0.22 + Math.sin(sEl) * skyR,
          -Math.cos(sAz) * Math.cos(sEl) * skyR,
        );
        skySun.position.copy(sunPos);
        sunDirLight.position.copy(sunPos);
        sunDirLight.intensity = st.sunVisible ? 2.8 : 0.25;

        const eAz = (st.earthAzimuthDeg * Math.PI) / 180;
        const eEl = Math.atan(Math.tan((st.earthElevationDeg * Math.PI) / 180) * 2.4);
        const earthPos = new THREE.Vector3(
          Math.sin(eAz) * Math.cos(eEl) * skyR,
          0.22 + Math.sin(eEl) * skyR,
          -Math.cos(eAz) * Math.cos(eEl) * skyR,
        );
        skyEarth.position.copy(earthPos);
        skyEarth.rotation.y = t * 0.2;

        if (t - lastSync > 0.06) {
          lastSync = t;
          const w = renderer.domElement.clientWidth || width;
          const h = renderer.domElement.clientHeight || height;
          const sv = sunPos.clone().project(camera);
          const ev = earthPos.clone().project(camera);
          const headingDeg = (((ctrl.streetYaw * 180) / Math.PI) % 360 + 360) % 360;
          setSkyBadges({
            sun: { x: (sv.x * 0.5 + 0.5) * w, y: (-sv.y * 0.5 + 0.5) * h - 22, visible: sv.z < 1 },
            earth: { x: (ev.x * 0.5 + 0.5) * w, y: (-ev.y * 0.5 + 0.5) * h - 26, visible: ev.z < 1 },
            headingDeg,
          });
        }
      } else {
        const phaseRad = ((st.sunAzimuthDeg + siteRef.current.coordinates.lonDeg) * Math.PI) / 180;
        orbitingMoon.position.set(Math.cos(phaseRad) * orbitRadius, 0.12 * Math.sin(phaseRad), Math.sin(phaseRad) * orbitRadius);
        orbitingMoon.lookAt(0, 0, 0);
        siteMarkerOnOrbitMoon.position.copy(
          latLonToVector3(siteRef.current.coordinates.latDeg, siteRef.current.coordinates.lonDeg, 0.226),
        );

        centralEarth.rotation.y = t * 0.25;
        sunDirLight.position.set(8, 1.5, 0);

        const camDist = ctrl.globeZoom * 2.1;
        camera.position.set(
          camDist * Math.sin(ctrl.globeRotY) * Math.cos(ctrl.globeRotX * 0.5),
          camDist * Math.max(0.25, Math.sin(ctrl.globeRotX * 0.7)),
          camDist * Math.cos(ctrl.globeRotY) * Math.cos(ctrl.globeRotX * 0.5),
        );
        camera.lookAt(0, 0, 0);
      }

      renderer.render(scene, camera);
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
  }, [perspective, sites, selectedSite.siteId, compact]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* ASU Quickmap Link Overlay */}
      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 15, display: 'flex', gap: 6 }}>
        <a
          href={`https://quickmap.lroc.asu.edu/?lat=${selectedSite.coordinates.latDeg}&lon=${selectedSite.coordinates.lonDeg}&zoom=9`}
          target="_blank"
          rel="noreferrer"
          style={{
            background: 'rgba(15, 23, 42, 0.9)',
            color: '#38bdf8',
            border: '1px solid #334155',
            borderRadius: 6,
            padding: '5px 10px',
            fontSize: 10,
            fontWeight: 800,
            textDecoration: 'none',
          }}
        >
          🔍 Quickmap ↗
        </a>
      </div>

      {perspective === 'STREET_VIEW' && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          <div
            style={{
              position: 'absolute',
              top: compact ? 44 : 84,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(15, 23, 42, 0.85)',
              border: '1px solid #334155',
              borderRadius: 20,
              padding: '4px 14px',
              fontSize: 11,
              fontWeight: 800,
              color: '#38bdf8',
            }}
          >
            🧭 SURFACE COMPASS: {Math.round(skyBadges.headingDeg)}° · Drag to look 360° around horizon
          </div>

          {skyBadges.sun.visible && (
            <div
              style={{
                position: 'absolute',
                left: skyBadges.sun.x,
                top: skyBadges.sun.y,
                transform: 'translate(-50%, -50%)',
                background: 'rgba(15, 23, 42, 0.9)',
                border: `1px solid ${currentState.sunVisible ? '#facc15' : '#ef4444'}`,
                color: currentState.sunVisible ? '#fde047' : '#fca5a5',
                padding: '2px 8px',
                borderRadius: 5,
                fontSize: 11,
                fontWeight: 800,
                whiteSpace: 'nowrap',
              }}
            >
              ☀ SUN ({currentState.sunElevationDeg.toFixed(1)}°) {currentState.sunVisible ? '' : '[BEHIND RIDGE]'}
            </div>
          )}

          {skyBadges.earth.visible && (
            <div
              style={{
                position: 'absolute',
                left: skyBadges.earth.x,
                top: skyBadges.earth.y,
                transform: 'translate(-50%, -50%)',
                background: 'rgba(15, 23, 42, 0.9)',
                border: `1px solid ${currentState.earthVisible ? '#38bdf8' : '#f43f5e'}`,
                color: currentState.earthVisible ? '#7dd3fc' : '#fda4af',
                padding: '2px 8px',
                borderRadius: 5,
                fontSize: 11,
                fontWeight: 800,
                whiteSpace: 'nowrap',
              }}
            >
              🌍 EARTH ({currentState.earthElevationDeg.toFixed(1)}°)
            </div>
          )}
        </div>
      )}

      {perspective === 'ORBITAL_SYSTEM' && (
        <div
          style={{
            position: 'absolute',
            top: compact ? 44 : 84,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid #334155',
            borderRadius: 20,
            padding: '4px 14px',
            fontSize: 11,
            fontWeight: 700,
            color: '#e2e8f0',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          🪐 Earth–Moon Orbital Frame (29.53d Synodic Revolution) · Yellow dot = {selectedSite.name}
        </div>
      )}
    </div>
  );
}