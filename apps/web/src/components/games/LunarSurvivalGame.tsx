
import React, { useEffect, useMemo, useState } from "react";

/**
 * Lunar Survival Game
 *
 * DATA INTEGRATION CONTRACT:
 * The adapter below expects each visibility sample to expose:
 * - time_utc
 * - sun_azimuth_deg
 * - sun_elevation_deg
 * - solar_visible_fraction (0..1)
 * - earth_comms_visible (boolean)
 *
 * Map these properties to the actual VisibilityState schema in your
 * project if the names or structure differ.
 */

type VisibilityState = {
  time_utc: string;
  sun_azimuth_deg: number;
  sun_elevation_deg: number;
  solar_visible_fraction: number;
  earth_comms_visible: boolean;
  earth_elevation_deg?: number;
};

type LunarSite = {
  site_id: string;
  name: string;
  latitude_deg?: number;
  longitude_deg?: number;
  visibility: VisibilityState[];
};

type GameStatus = "ready" | "active" | "success" | "failure";

const SITE_URL = "/data/sites/shackleton_rim_01.json";

const INITIAL_BATTERY = 75;
const BATTERY_CAPACITY = 100;
const HOURLY_POWER_USE = 5;
const PACKET_POWER_COST = 8;
const MAX_SOLAR_POWER = 12;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normaliseAngle(angle: number) {
  return ((angle % 360) + 360) % 360;
}

function angularDifference(a: number, b: number) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function validateSite(data: unknown): LunarSite {
  const site = data as LunarSite;

  if (
    !site ||
    typeof site.site_id !== "string" ||
    !Array.isArray(site.visibility) ||
    site.visibility.length === 0
  ) {
    throw new Error(
      "Invalid lunar site data: expected site_id and visibility samples."
    );
  }

  for (const sample of site.visibility) {
    if (
      typeof sample.time_utc !== "string" ||
      typeof sample.sun_azimuth_deg !== "number" ||
      typeof sample.sun_elevation_deg !== "number" ||
      typeof sample.solar_visible_fraction !== "number" ||
      typeof sample.earth_comms_visible !== "boolean"
    ) {
      throw new Error(
        "VisibilityState does not match the game adapter contract."
      );
    }

    if (
      sample.solar_visible_fraction < 0 ||
      sample.solar_visible_fraction > 1
    ) {
      throw new Error("Solar visibility must be between 0 and 1.");
    }
  }

  return site;
}

function calculateSolarGeneration(
  visibility: VisibilityState,
  panelAzimuth: number
) {
  if (visibility.sun_elevation_deg <= 0) return 0;

  const difference = angularDifference(
    panelAzimuth,
    visibility.sun_azimuth_deg
  );

  const orientationEfficiency = Math.max(
    0,
    Math.cos((difference * Math.PI) / 180)
  );

  const elevationEfficiency = Math.sin(
    (visibility.sun_elevation_deg * Math.PI) / 180
  );

  return (
    MAX_SOLAR_POWER *
    visibility.solar_visible_fraction *
    orientationEfficiency *
    Math.max(0, elevationEfficiency)
  );
}

export default function LunarSurvivalGame() {
  const [site, setSite] = useState<LunarSite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [status, setStatus] = useState<GameStatus>("ready");
  const [hour, setHour] = useState(0);

  const [battery, setBattery] = useState(INITIAL_BATTERY);
  const [panelAzimuth, setPanelAzimuth] = useState(0);

  const [sciencePackets, setSciencePackets] = useState(0);
  const [transmittedPackets, setTransmittedPackets] = useState(0);
  const [survivalHours, setSurvivalHours] = useState(0);

  const [message, setMessage] = useState(
    "Select your solar panel orientation and begin the mission."
  );

  const [showEducation, setShowEducation] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadSite() {
      try {
        setLoading(true);

        const response = await fetch(SITE_URL);

        if (!response.ok) {
          throw new Error(
            `Could not load lunar site data (${response.status}).`
          );
        }

        const json = await response.json();
        const validated = validateSite(json);

        if (!cancelled) {
          setSite(validated);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load site."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSite();

    return () => {
      cancelled = true;
    };
  }, []);

  const currentVisibility = useMemo(() => {
    if (!site) return null;
    return site.visibility[hour];
  }, [site, hour]);

  const solarGeneration = useMemo(() => {
    if (!currentVisibility) return 0;

    return calculateSolarGeneration(
      currentVisibility,
      panelAzimuth
    );
  }, [currentVisibility, panelAzimuth]);

  const score =
    transmittedPackets * 100 +
    survivalHours * 5 +
    Math.round(battery * 0.5);

  const batteryColour =
    battery > 50 ? "#4ade80" :
    battery > 20 ? "#facc15" :
    "#f87171";

  function startMission() {
    if (!site) return;

    setBattery(INITIAL_BATTERY);
    setHour(0);
    setSciencePackets(0);
    setTransmittedPackets(0);
    setSurvivalHours(0);
    setStatus("active");

    setMessage(
      "Mission started. Manage your energy and monitor Earth visibility."
    );
  }

  function advanceHour() {
    if (!site || status !== "active" || !currentVisibility) return;

    const generated = solarGeneration;

    const nextBattery = clamp(
      battery + generated - HOURLY_POWER_USE,
      0,
      BATTERY_CAPACITY
    );

    const nextSurvival = survivalHours + 1;

    if (nextBattery <= 0) {
      setBattery(0);
      setSurvivalHours(nextSurvival);
      setStatus("failure");
      setMessage(
        "Mission failure: the lander has exhausted its battery reserves."
      );
      return;
    }

    setBattery(nextBattery);
    setSurvivalHours(nextSurvival);

    if (hour + 1 >= site.visibility.length) {
      setStatus("success");
      setMessage(
        "Mission complete! You survived the full simulation."
      );
      return;
    }

    setHour(hour + 1);

    setMessage(
      generated > HOURLY_POWER_USE
        ? "Solar generation exceeded consumption. Battery reserves increased."
        : generated > 0
          ? "Solar power supplemented your battery reserves."
          : "The Sun is blocked by the surrounding terrain. Battery reserves are decreasing."
    );
  }

  function transmitScience() {
    if (!currentVisibility || status !== "active") return;

    if (!currentVisibility.earth_comms_visible) {
      setMessage(
        "Transmission failed: Earth is currently below the local terrain horizon."
      );
      return;
    }

    if (battery < PACKET_POWER_COST) {
      setMessage(
        "Insufficient battery power. Wait for solar generation before transmitting."
      );
      return;
    }

    setBattery((previous) =>
      clamp(previous - PACKET_POWER_COST, 0, BATTERY_CAPACITY)
    );

    setSciencePackets((previous) => previous + 1);
    setTransmittedPackets((previous) => previous + 1);

    setMessage(
      "Science packet successfully transmitted to Earth!"
    );
  }

  function resetMission() {
    setStatus("ready");
    setHour(0);
    setBattery(INITIAL_BATTERY);
    setSciencePackets(0);
    setTransmittedPackets(0);
    setSurvivalHours(0);
    setPanelAzimuth(0);

    setMessage("Mission reset. Ready for another attempt.");
  }

  if (loading) {
    return (
      <div style={styles.container}>
        Loading Shackleton Rim landing site...
      </div>
    );
  }

  if (error || !site) {
    return (
      <div style={styles.container}>
        <h2>Unable to initialise mission</h2>
        <p>{error || "Site data unavailable."}</p>
        <p>
          Check that {SITE_URL} exists and follows the VisibilityState
          adapter contract.
        </p>
      </div>
    );
  }

  const earthVisible = currentVisibility?.earth_comms_visible ?? false;
  const solarVisible =
    (currentVisibility?.solar_visible_fraction ?? 0) > 0;

  return (
    <main style={styles.container}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>LUNAR SURVIVAL SIMULATOR</p>
          <h1>Shackleton Rim Mission</h1>
          <p style={styles.subtitle}>
            Survive the lunar south pole using solar power and
            carefully timed communications.
          </p>
        </div>

        <div style={styles.missionBadge}>
          {status.toUpperCase()}
        </div>
      </header>

      <section style={styles.siteCard}>
        <div>
          <p style={styles.eyebrow}>SELECTED LANDING SITE</p>
          <h2>{site.name || site.site_id}</h2>
          <p>
            Site ID: {site.site_id}
            {site.latitude_deg !== undefined &&
              ` | Latitude: ${site.latitude_deg.toFixed(3)}°`}
          </p>
        </div>

        <div style={styles.locationIcon}>🌑</div>
      </section>

      <section style={styles.statsGrid}>
        <StatCard
          label="BATTERY CHARGE"
          value={`${battery.toFixed(1)}%`}
          detail="Available energy reserves"
          colour={batteryColour}
        />

        <StatCard
          label="SOLAR GENERATION"
          value={`${solarGeneration.toFixed(1)} units`}
          detail="Current hourly generation"
        />

        <StatCard
          label="SCIENCE PACKETS"
          value={`${transmittedPackets}`}
          detail="Successfully transmitted"
        />

        <StatCard
          label="MISSION SCORE"
          value={`${score}`}
          detail="Current performance"
        />
      </section>

      <section style={styles.panel}>
        <h2>Mission timeline</h2>

        <div style={styles.timeline}>
          <div>
            <span style={styles.eyebrow}>CURRENT SAMPLE</span>
            <strong>{hour + 1} / {site.visibility.length}</strong>
          </div>

          <div>
            <span style={styles.eyebrow}>MISSION TIME</span>
            <strong>{currentVisibility?.time_utc}</strong>
          </div>

          <div>
            <span style={styles.eyebrow}>SUN ELEVATION</span>
            <strong>
              {currentVisibility?.sun_elevation_deg.toFixed(2)}°
            </strong>
          </div>

          <div>
            <span style={styles.eyebrow}>SUN AZIMUTH</span>
            <strong>
              {currentVisibility?.sun_azimuth_deg.toFixed(2)}°
            </strong>
          </div>
        </div>

        <div style={styles.progressTrack}>
          <div
            style={{
              ...styles.progressFill,
              width: `${((hour + 1) / site.visibility.length) * 100}%`,
            }}
          />
        </div>
      </section>

      <section style={styles.panel}>
        <h2>Solar panel orientation</h2>

        <p>
          Rotate your panels towards the Sun to maximise incoming
          solar energy. Terrain shadowing may still reduce available
          sunlight.
        </p>

        <div style={styles.controlRow}>
          <label htmlFor="panel-angle">
            Panel azimuth: <strong>{normaliseAngle(panelAzimuth).toFixed(0)}°</strong>
          </label>

          <input
            id="panel-angle"
            type="range"
            min="0"
            max="359"
            step="1"
            value={normaliseAngle(panelAzimuth)}
            disabled={status !== "active"}
            onChange={(event) =>
              setPanelAzimuth(Number(event.target.value))
            }
            style={styles.slider}
          />
        </div>

        <p style={styles.hint}>
          Current alignment error:{" "}
          {currentVisibility
            ? angularDifference(
                panelAzimuth,
                currentVisibility.sun_azimuth_deg
              ).toFixed(1)
            : "--"}°
        </p>

        <p style={styles.hint}>
          The panel model uses azimuth alignment and solar elevation.
          Its generation rate is a simplified educational model.
        </p>
      </section>

      <section style={styles.panel}>
        <h2>Environmental visibility</h2>

        <div style={styles.visibilityGrid}>
          <VisibilityIndicator
            label="SUN VISIBILITY"
            visible={solarVisible}
            description={
              solarVisible
                ? "Some sunlight reaches the site."
                : "The Sun is occulted by local terrain."
            }
          />

          <VisibilityIndicator
            label="EARTH COMMUNICATIONS"
            visible={earthVisible}
            description={
              earthVisible
                ? "Earth is visible. Transmission is possible."
                : "Earth is below the local terrain horizon."
            }
          />
        </div>

        <p style={styles.hint}>
          Solar visibility fraction:{" "}
          {(
            (currentVisibility?.solar_visible_fraction ?? 0) * 100
          ).toFixed(1)}%
        </p>
      </section>

      <section style={styles.panel}>
        <h2>Mission operations</h2>

        <div style={styles.buttonGrid}>
          {status === "ready" && (
            <button style={styles.primaryButton} onClick={startMission}>
              Start mission
            </button>
          )}

          {status === "active" && (
            <>
              <button
                style={styles.primaryButton}
                onClick={advanceHour}
              >
                Advance one hour
              </button>

              <button
                style={{
                  ...styles.secondaryButton,
                  opacity: earthVisible ? 1 : 0.5,
                }}
                onClick={transmitScience}
              >
                Transmit science packet
              </button>
            </>
          )}

          {(status === "success" || status === "failure") && (
            <button style={styles.primaryButton} onClick={resetMission}>
              Restart mission
            </button>
          )}
        </div>

        <div style={styles.messageBox} role="status" aria-live="polite">
          {message}
        </div>
      </section>

      <section style={styles.educationPanel}>
        <button
          style={styles.educationToggle}
          onClick={() => setShowEducation(!showEducation)}
          aria-expanded={showEducation}
        >
          <span>Why is the lunar south pole challenging?</span>
          <span>{showEducation ? "−" : "+"}</span>
        </button>

        {showEducation && (
          <div>
            <h3>1. Terrain-induced shadowing</h3>
            <p>
              The Moon has almost no atmosphere to scatter sunlight
              around obstacles. Mountains, crater rims and ridges can
              therefore block direct sunlight and create sharply
              defined shadow regions.
            </p>

            <h3>2. Low-angle sunlight</h3>
            <p>
              Near the lunar south pole, the Sun follows a low path
              across the horizon. Small differences in terrain
              elevation can therefore produce substantial changes
              in illumination.
            </p>

            <h3>3. Solar power management</h3>
            <p>
              A lander must orient its solar panels towards the Sun
              while maintaining sufficient stored energy to survive
              periods when terrain blocks direct sunlight.
            </p>

            <h3>4. Earth communications</h3>
            <p>
              Earth visibility is a separate geometric constraint.
              A site can receive sunlight while Earth is hidden
              behind a ridge, or have a communications window while
              solar illumination is poor.
            </p>

            <p style={styles.hint}>
              The simulator distinguishes Sun visibility from
              Earth visibility. These should be calculated using
              separate lines of sight in the underlying scientific
              model.
            </p>
          </div>
        )}
      </section>

      <footer style={styles.footer}>
        <p>
          Educational simulation. Not an operational lunar landing
          or spacecraft power model.
        </p>
        <p>Mission score: {score} points</p>
      </footer>
    </main>
  );
}

function StatCard({
  label,
  value,
  detail,
  colour = "#e2e8f0",
}: {
  label: string;
  value: string;
  detail: string;
  colour?: string;
}) {
  return (
    <div style={styles.statCard}>
      <span style={styles.eyebrow}>{label}</span>
      <strong style={{ ...styles.statValue, color: colour }}>
        {value}
      </strong>
      <span style={styles.hint}>{detail}</span>
    </div>
  );
}

function VisibilityIndicator({
  label,
  visible,
  description,
}: {
  label: string;
  visible: boolean;
  description: string;
}) {
  return (
    <div style={styles.visibilityCard}>
      <div style={styles.visibilityHeader}>
        <strong>{label}</strong>
        <span
          style={{
            ...styles.visibilityBadge,
            background: visible ? "#14532d" : "#7f1d1d",
          }}
        >
          {visible ? "VISIBLE" : "OCCULTED"}
        </span>
      </div>
      <p>{description}</p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: "#080f1d",
    color: "#e2e8f0",
    minHeight: "100vh",
    padding: "28px",
    fontFamily: "Inter, system-ui, sans-serif",
    maxWidth: "1100px",
    margin: "0 auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "16px",
    flexWrap: "wrap",
    marginBottom: "24px",
  },
  eyebrow: {
    display: "block",
    color: "#94a3b8",
    fontSize: "11px",
    letterSpacing: "1.5px",
    marginBottom: "8px",
  },
  subtitle: {
    color: "#94a3b8",
    maxWidth: "600px",
    lineHeight: 1.6,
  },
  missionBadge: {
    padding: "9px 15px",
    border: "1px solid #475569",
    borderRadius: "20px",
    fontSize: "12px",
    letterSpacing: "1px",
  },
  siteCard: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#17243a",
    border: "1px solid #334155",
    borderRadius: "14px",
    padding: "20px",
    marginBottom: "20px",
  },
  locationIcon: {
    fontSize: "42px",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "12px",
    marginBottom: "20px",
  },
  statCard: {
    background: "#17243a",
    padding: "18px",
    borderRadius: "12px",
    border: "1px solid #334155",
  },
  statValue: {
    display: "block",
    fontSize: "27px",
    marginBottom: "8px",
  },
  panel: {
    background: "#111d30",
    border: "1px solid #334155",
    borderRadius: "14px",
    padding: "22px",
    marginBottom: "18px",
  },
  timeline: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: "16px",
    margin: "18px 0",
  },
  progressTrack: {
    background: "#334155",
    height: "8px",
    borderRadius: "10px",
    overflow: "hidden",
  },
  progressFill: {
    background: "#38bdf8",
    height: "100%",
    transition: "width 0.3s",
  },
  controlRow: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    marginTop: "20px",
  },
  slider: {
    width: "100%",
    accentColor: "#38bdf8",
  },
  hint: {
    color: "#94a3b8",
    fontSize: "12px",
    lineHeight: 1.6,
  },
  visibilityGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "12px",
  },
  visibilityCard: {
    background: "#1e293b",
    borderRadius: "10px",
    padding: "16px",
  },
  visibilityHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px",
  },
  visibilityBadge: {
    padding: "5px 9px",
    borderRadius: "12px",
    fontSize: "10px",
    fontWeight: 700,
  },
  buttonGrid: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
    marginTop: "16px",
  },
  primaryButton: {
    background: "#0284c7",
    color: "white",
    border: "none",
    borderRadius: "9px",
    padding: "13px 20px",
    cursor: "pointer",
    fontWeight: 700,
  },
  secondaryButton: {
    background: "#334155",
    color: "white",
    border: "1px solid #64748b",
    borderRadius: "9px",
    padding: "13px 20px",
    cursor: "pointer",
    fontWeight: 700,
  },
  messageBox: {
    background: "#1e293b",
    borderLeft: "4px solid #38bdf8",
    padding: "14px",
    marginTop: "18px",
    borderRadius: "5px",
    lineHeight: 1.5,
  },
  educationPanel: {
    background: "#17243a",
    border: "1px solid #334155",
    borderRadius: "14px",
    padding: "20px",
    lineHeight: 1.7,
    marginBottom: "20px",
  },
  educationToggle: {
    background: "transparent",
    color: "#e2e8f0",
    border: "none",
    cursor: "pointer",
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    fontSize: "17px",
    fontWeight: 700,
    padding: "5px 0",
  },
  footer: {
    textAlign: "center",
    color: "#64748b",
    fontSize: "12px",
    padding: "15px",
  },
};
