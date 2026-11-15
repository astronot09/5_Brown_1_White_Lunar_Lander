import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { EarthMoonTransferPlan } from '../../lib/orbit';
import { lunarCoordinatesToUnitVector } from '../../../../packages/lunar-core/src/lunarCoordinates';

interface EarthMoonTransferProps {
  plan: EarthMoonTransferPlan;
  destinationName: string;
  latitudeDeg: number;
  longitudeDeg: number;
}

function createEarthTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create Earth texture canvas');

  context.fillStyle = '#123b69';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#6d9068';
  const landShapes = [
    [88, 82, 54, 36], [142, 133, 23, 42], [230, 78, 42, 25],
    [254, 135, 33, 55], [340, 75, 72, 36], [420, 164, 31, 23],
  ];
  landShapes.forEach(([x, y, rx, ry]) => {
    context.beginPath();
    context.ellipse(x!, y!, rx!, ry!, -0.18, 0, Math.PI * 2);
    context.fill();
  });
  context.fillStyle = 'rgba(238, 226, 180, 0.5)';
  context.beginPath();
  context.ellipse(350, 92, 42, 17, 0.2, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#dce8ef';
  context.fillRect(0, 0, canvas.width, 12);
  context.fillRect(0, canvas.height - 12, canvas.width, 12);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function solveKepler(meanAnomaly: number, eccentricity: number): number {
  let eccentricAnomaly = meanAnomaly;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const f = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly;
    const fp = 1 - eccentricity * Math.cos(eccentricAnomaly);
    eccentricAnomaly -= f / fp;
  }
  return eccentricAnomaly;
}

function transferPosition(progress: number): THREE.Vector3 {
  // The drawing deliberately uses a schematic scale so that Earth, the orbit,
  // the Moon and the manoeuvre points remain visible together.
  const periapsis = 1.05;
  const apoapsis = 4.8;
  const semiMajorAxis = (periapsis + apoapsis) / 2;
  const eccentricity = (apoapsis - periapsis) / (apoapsis + periapsis);
  const meanAnomaly = Math.PI * Math.max(0, Math.min(1, progress));
  const eccentricAnomaly = solveKepler(meanAnomaly, eccentricity);
  return new THREE.Vector3(
    semiMajorAxis * (Math.cos(eccentricAnomaly) - eccentricity),
    semiMajorAxis * Math.sqrt(1 - eccentricity ** 2) * Math.sin(eccentricAnomaly),
    0,
  );
}

function formatUtc(value: string): string {
  return new Date(value).toLocaleString('en-GB', {
    timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }) + ' UTC';
}

export function EarthMoonTransfer({ plan, destinationName, latitudeDeg, longitudeDeg }: EarthMoonTransferProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const progressRef = useRef(0);
  progressRef.current = progress;

  useEffect(() => {
    setProgress(0);
    setIsPlaying(false);
  }, [plan.arrivalTimeUtc]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setProgress((current) => Math.min(1, current + 0.0025));
    }, 40);
    return () => window.clearInterval(timer);
  }, [isPlaying]);

  useEffect(() => {
    if (progress >= 1) setIsPlaying(false);
  }, [progress]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 100);
    camera.position.set(0, 4.8, 11.8);
    camera.lookAt(0, 0.5, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setClearColor(0x050914, 1);
    container.replaceChildren(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    const system = new THREE.Group();
    scene.add(system);

    const starPositions = new Float32Array(900 * 3);
    for (let index = 0; index < starPositions.length; index += 3) {
      const radius = 16 + Math.random() * 14;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[index] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[index + 1] = radius * Math.cos(phi);
      starPositions[index + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    const starsGeometry = new THREE.BufferGeometry();
    starsGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    scene.add(new THREE.Points(
      starsGeometry,
      new THREE.PointsMaterial({ color: 0xdbeafe, size: 0.045, transparent: true, opacity: 0.8 }),
    ));

    system.add(new THREE.AmbientLight(0x8294b0, 0.62));
    const sun = new THREE.DirectionalLight(0xfff1d3, 2.6);
    sun.position.set(-5, 7, 8);
    system.add(sun);

    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(0.66, 64, 64),
      new THREE.MeshStandardMaterial({ map: createEarthTexture(), roughness: 0.86, metalness: 0.02 }),
    );
    system.add(earth);
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.705, 48, 48),
      new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.17, side: THREE.BackSide }),
    );
    system.add(atmosphere);

    const moonOrbitRadius = 4.8;
    const orbitPoints: THREE.Vector3[] = [];
    for (let index = 0; index <= 240; index += 1) {
      const angle = (index / 240) * Math.PI * 2;
      orbitPoints.push(new THREE.Vector3(
        moonOrbitRadius * Math.cos(angle),
        moonOrbitRadius * Math.sin(angle),
        0,
      ));
    }
    const moonOrbit = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(orbitPoints),
      new THREE.LineDashedMaterial({ color: 0x64748b, dashSize: 0.12, gapSize: 0.1, transparent: true, opacity: 0.62 }),
    );
    moonOrbit.computeLineDistances();
    system.add(moonOrbit);

    const transferPoints: THREE.Vector3[] = [];
    for (let index = 0; index <= 240; index += 1) {
      transferPoints.push(transferPosition(index / 240));
    }
    const transferPath = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(transferPoints),
      new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.95 }),
    );
    system.add(transferPath);

    const moonTexture = new THREE.TextureLoader().load('/textures/lroc_color_poles_1k.jpg');
    moonTexture.colorSpace = THREE.SRGBColorSpace;
    const moonMaterial = new THREE.MeshStandardMaterial({ map: moonTexture, roughness: 0.98 });
    const moonGroup = new THREE.Group();
    moonGroup.position.set(-moonOrbitRadius, 0, 0);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(0.2, 48, 48), moonMaterial);
    moonGroup.add(moon);
    const destinationVector = lunarCoordinatesToUnitVector({
      latDeg: latitudeDeg,
      lonDeg: longitudeDeg,
    });
    const destinationNormal = new THREE.Vector3(
      destinationVector.x,
      destinationVector.y,
      destinationVector.z,
    );
    const destinationMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xfacc15, depthTest: false }),
    );
    destinationMarker.position.copy(destinationNormal.clone().multiplyScalar(0.205));
    const destinationHalo = new THREE.Mesh(
      new THREE.RingGeometry(0.035, 0.045, 32),
      new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide, depthTest: false }),
    );
    destinationHalo.position.copy(destinationNormal.clone().multiplyScalar(0.207));
    destinationHalo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), destinationNormal);
    moonGroup.add(destinationMarker, destinationHalo);
    system.add(moonGroup);

    const departureMoon = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.38, wireframe: true }),
    );
    const departurePhase = THREE.MathUtils.degToRad(plan.phaseAngleAtDepartureDeg);
    departureMoon.position.set(
      moonOrbitRadius * Math.cos(departurePhase),
      moonOrbitRadius * Math.sin(departurePhase),
      0,
    );
    system.add(departureMoon);

    const spacecraft = new THREE.Group();
    const bus = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.1, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.7, roughness: 0.35 }),
    );
    spacecraft.add(bus);
    const solarPanelMaterial = new THREE.MeshStandardMaterial({ color: 0x2563eb, metalness: 0.4, roughness: 0.45 });
    const panelLeft = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.018, 0.12), solarPanelMaterial);
    panelLeft.position.x = -0.22;
    const panelRight = panelLeft.clone();
    panelRight.position.x = 0.22;
    spacecraft.add(panelLeft, panelRight);
    const antenna = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xf8fafc }),
    );
    antenna.position.y = 0.07;
    spacecraft.add(antenna);
    system.add(spacecraft);

    const burnMaterial = new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide });
    const departureBurn = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 40), burnMaterial);
    departureBurn.position.set(1.05, 0, 0.015);
    system.add(departureBurn);
    const arrivalBurn = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.26, 40),
      new THREE.MeshBasicMaterial({ color: 0x34d399, side: THREE.DoubleSide }),
    );
    arrivalBurn.position.set(-moonOrbitRadius, 0, 0.015);
    system.add(arrivalBurn);

    const cameraState = {
      yaw: 0,
      pitch: 0.28,
      distance: 12.8,
      dragging: false,
      lastX: 0,
      lastY: 0,
    };
    const pointerDown = (event: PointerEvent) => {
      cameraState.dragging = true;
      cameraState.lastX = event.clientX;
      cameraState.lastY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = 'grabbing';
    };
    const pointerMove = (event: PointerEvent) => {
      if (!cameraState.dragging) return;
      cameraState.yaw -= (event.clientX - cameraState.lastX) * 0.006;
      cameraState.pitch = THREE.MathUtils.clamp(
        cameraState.pitch + (event.clientY - cameraState.lastY) * 0.004,
        -0.2,
        1.2,
      );
      cameraState.lastX = event.clientX;
      cameraState.lastY = event.clientY;
    };
    const pointerUp = () => {
      cameraState.dragging = false;
      renderer.domElement.style.cursor = 'grab';
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      cameraState.distance = THREE.MathUtils.clamp(cameraState.distance + event.deltaY * 0.008, 8, 19);
    };
    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', pointerUp);
    renderer.domElement.addEventListener('wheel', wheel, { passive: false });

    const resizeObserver = new ResizeObserver(() => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(container);
    renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight), false);

    let frameId = 0;
    let disposed = false;
    const render = () => {
      if (disposed) return;
      frameId = requestAnimationFrame(render);
      camera.position.set(
        cameraState.distance * Math.sin(cameraState.yaw),
        cameraState.distance * Math.sin(cameraState.pitch),
        cameraState.distance * Math.cos(cameraState.yaw),
      );
      camera.lookAt(0, 0.45, 0);
      earth.rotation.y += 0.0002;
      moon.rotation.y += 0.0005;
      spacecraft.position.copy(transferPosition(progressRef.current));
      renderer.render(scene, camera);
    };
    render();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerUp);
      renderer.domElement.removeEventListener('wheel', wheel);
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : mesh.material ? [mesh.material] : [];
        materials.forEach((material) => {
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) value.dispose();
          }
          material.dispose();
        });
      });
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, [plan.phaseAngleAtDepartureDeg, latitudeDeg, longitudeDeg]);

  const elapsedDays = plan.transferTimeDays * progress;
  const eventText = progress < 0.015
    ? 'TLI · Trans-lunar injection'
    : progress > 0.985
      ? 'LOI · Lunar orbit insertion'
      : 'Trans-lunar cruise';

  return (
    <section className="transfer-visual" aria-label="Schematic Earth to Moon transfer visualisation">
      <div className="transfer-scene-wrap">
        <div ref={containerRef} className="transfer-scene" role="img" aria-label="Interactive 3D schematic showing Earth, the Moon, the transfer arc and the spacecraft position" />
        <div className="transfer-scene-topline">
          <span><i className="legend-dot earth-dot" /> Earth</span>
          <span><i className="legend-dot moon-dot" /> Moon at arrival</span>
          <span><i className="legend-dot selected-dot" /> Landing site</span>
          <span><i className="legend-dot ghost-dot" /> Moon at departure</span>
          <span><i className="legend-dot path-dot" /> Transfer arc</span>
        </div>
        <div className="transfer-event-chip">{eventText}</div>
        <div className="transfer-spacecraft-readout">
          <strong>{destinationName}</strong>
          <span>{latitudeDeg.toFixed(2)}°, {longitudeDeg.toFixed(2)}°</span>
          <span>{elapsedDays.toFixed(2)} / {plan.transferTimeDays.toFixed(2)} days elapsed</span>
        </div>
      </div>
      <div className="transfer-controls">
        <button type="button" className="primary-button compact" onClick={() => {
          if (progress >= 1) setProgress(0);
          setIsPlaying((playing) => !playing);
        }}>
          {isPlaying ? 'Pause flight' : progress >= 1 ? 'Replay transfer' : 'Play transfer'}
        </button>
        <label className="scrub-control">
          <span className="sr-only">Transfer progress</span>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(progress * 1000)}
            onChange={(event) => {
              setIsPlaying(false);
              setProgress(Number(event.target.value) / 1000);
            }}
          />
        </label>
        <span className="transfer-stage-time">{(progress * 100).toFixed(0)}%</span>
      </div>
      <div className="transfer-burn-grid">
        <div className="burn-card">
          <span className="burn-index">01 · DEPARTURE</span>
          <strong>Trans-lunar injection</strong>
          <span>{formatUtc(plan.nominalLaunchTimeUtc)}</span>
          <b>{plan.tliDeltaVKmS.toFixed(2)} km/s Δv</b>
        </div>
        <div className="burn-card">
          <span className="burn-index">02 · ARRIVAL</span>
          <strong>Lunar orbit insertion</strong>
          <span>{formatUtc(plan.arrivalTimeUtc)}</span>
          <b>{plan.loiDeltaVKmS.toFixed(2)} km/s Δv</b>
        </div>
      </div>
      <p className="model-note">
        Schematic, not to scale. The spacecraft marker follows an idealised Hohmann transfer arc; the Moon positions are phase illustrations, not a JPL ephemeris. Surface descent is not included.
      </p>
    </section>
  );
}
