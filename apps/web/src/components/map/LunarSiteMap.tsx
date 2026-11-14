import { useEffect, useMemo, useRef, useState } from 'react';
import Feature from 'ol/Feature';
import OlMap from 'ol/Map';
import View from 'ol/View';
import { defaults as defaultControls, ScaleLine } from 'ol/control';
import { LineString, Point } from 'ol/geom';
import { addCoordinateTransforms, addProjection, get as getProjection } from 'ol/proj';
import Projection from 'ol/proj/Projection';
import type { Coordinate } from 'ol/coordinate';
import { fromLonLat } from 'ol/proj';
import { Vector as VectorLayer } from 'ol/layer';
import VectorSource from 'ol/source/Vector';
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style';
import type { StyleFunction } from 'ol/style/Style';
import 'ol/ol.css';
import './LunarSiteMap.css';
import type { LunarSite } from './lunarTypes';
import { useLunarSites } from './useLunarSites';

const LUNAR_RADIUS_M = 1_737_400;
const PROJECTION_CODE = 'LUNAR:SOUTH_POLAR_STEREOGRAPHIC';
const LUNAR_PROJECTION = new Projection({
  code: PROJECTION_CODE,
  units: 'm',
  extent: [-2_000_000, -2_000_000, 2_000_000, 2_000_000],
  worldExtent: [-180, -90, 180, -60],
});

function geographicToPolar([longitude, latitude]: Coordinate): Coordinate {
  const lat = (latitude * Math.PI) / 180;
  const lon = (longitude * Math.PI) / 180;
  const rho = 2 * LUNAR_RADIUS_M * Math.tan((Math.PI / 2 + lat) / 2);
  return [rho * Math.sin(lon), rho * Math.cos(lon)];
}

function polarToGeographic([x, y]: Coordinate): Coordinate {
  const rho = Math.hypot(x, y);
  const latitude = (-Math.PI / 2 + 2 * Math.atan(rho / (2 * LUNAR_RADIUS_M))) * (180 / Math.PI);
  const longitude = (Math.atan2(x, y) * 180) / Math.PI;
  return [longitude, latitude];
}

if (!getProjection(PROJECTION_CODE)) {
  addProjection(LUNAR_PROJECTION);
  addCoordinateTransforms('EPSG:4326', LUNAR_PROJECTION, geographicToPolar, polarToGeographic);
}

function destination(latDeg: number, lonDeg: number, bearingDeg: number, distanceM: number): [number, number] {
  const angularDistance = distanceM / LUNAR_RADIUS_M;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (latDeg * Math.PI) / 180;
  const lon1 = (lonDeg * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );
  return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

export interface LunarSiteMapProps {
  selectedSiteId?: string;
  onSiteSelect?: (site: LunarSite) => void;
  /** Optional heading for a specific direction ray, in degrees clockwise from north. */
  azimuthDeg?: number;
  className?: string;
}

export function LunarSiteMap({
  selectedSiteId: controlledSiteId,
  onSiteSelect,
  azimuthDeg,
  className = '',
}: LunarSiteMapProps) {
  const [internalSiteId, setInternalSiteId] = useState('shackleton_rim_01');
  const selectedSiteId = controlledSiteId ?? internalSiteId;
  const { sites, selectedSite, loading, error } = useLunarSites(selectedSiteId);
  const mapElement = useRef<HTMLDivElement>(null);
  const onSiteSelectRef = useRef(onSiteSelect);
  onSiteSelectRef.current = onSiteSelect;
  const mapRef = useRef<OlMap | null>(null);
  const markerSource = useRef(new VectorSource<Feature<Point>>());
  const raySource = useRef(new VectorSource<Feature<LineString>>());
  const gridSource = useRef(new VectorSource<Feature<LineString>>());
  const sitesById = useMemo(() => new globalThis.Map<string, LunarSite>(
    sites.map((site): [string, LunarSite] => [site.siteId, site]),
  ), [sites]);
  const sitesByIdRef = useRef(sitesById);
  sitesByIdRef.current = sitesById;

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;

    // A polar stereographic coordinate frame keeps the pole at the map centre.
    // No terrestrial basemap is used: this is a lunar coordinate grid, not Earth imagery.
    const gridFeatures: Feature<LineString>[] = [];
    for (const latitude of [-89, -88, -87, -86, -85, -84]) {
      const coordinates: Coordinate[] = [];
      for (let longitude = -180; longitude <= 180; longitude += 2) {
        coordinates.push(fromLonLat([longitude, latitude], LUNAR_PROJECTION));
      }
      gridFeatures.push(new Feature(new LineString(coordinates)));
    }
    for (let longitude = -180; longitude < 180; longitude += 30) {
      const coordinates: Coordinate[] = [];
      for (let latitude = -90; latitude <= -84; latitude += 0.25) {
        coordinates.push(fromLonLat([longitude, latitude], LUNAR_PROJECTION));
      }
      gridFeatures.push(new Feature(new LineString(coordinates)));
    }
    gridSource.current.clear();
    raySource.current.clear();
    markerSource.current.clear();
    gridSource.current.addFeatures(gridFeatures);

    const gridLayer = new VectorLayer({
      source: gridSource.current,
      style: new Style({ stroke: new Stroke({ color: 'rgba(137, 165, 184, 0.2)', width: 1 }) }),
    });
    const rayLayer = new VectorLayer({
      source: raySource.current,
      style: (feature) => new Style({
        stroke: new Stroke({
          color: feature.get('highlight') ? '#f6bd60' : 'rgba(118, 191, 214, 0.62)',
          width: feature.get('highlight') ? 2.2 : 1.15,
          lineDash: feature.get('highlight') ? undefined : [5, 5],
        }),
        text: new Text({
          text: `${feature.get('azimuth')}°`,
          placement: 'line',
          font: '10px system-ui',
          fill: new Fill({ color: '#d5e5ec' }),
          stroke: new Stroke({ color: '#101b26', width: 3 }),
        }),
      }),
    });
    const markerStyle: StyleFunction = (feature) => {
      const selected = feature.get('selected') === true;
      return new Style({
        image: new CircleStyle({
          radius: selected ? 8 : 5.5,
          fill: new Fill({ color: selected ? '#f6bd60' : '#79c7df' }),
          stroke: new Stroke({ color: '#101b26', width: selected ? 3 : 2 }),
        }),
        text: new Text({
          text: String(feature.get('label') ?? ''),
          font: selected ? '600 12px system-ui' : '11px system-ui',
          offsetY: -17,
          fill: new Fill({ color: '#e8f0f5' }),
          stroke: new Stroke({ color: '#101b26', width: 3 }),
        }),
      });
    };
    const markerLayer = new VectorLayer({ source: markerSource.current, style: markerStyle });

    const map = new OlMap({
      target: mapElement.current,
      layers: [gridLayer, rayLayer, markerLayer],
      view: new View({
        projection: LUNAR_PROJECTION,
        center: [0, 0],
        zoom: 3.25,
        minZoom: 1,
        maxZoom: 9,
        enableRotation: true,
      }),
      controls: defaultControls({ attribution: false, rotate: true, zoom: true })
        .extend([new ScaleLine({ units: 'metric', bar: true, steps: 4 })]),
    });

    map.on('singleclick', (event) => {
      const feature = map.forEachFeatureAtPixel(event.pixel, (candidate) => candidate);
      const siteId = feature?.get('siteId') as string | undefined;
      const site = siteId ? sitesByIdRef.current.get(siteId) : undefined;
      if (site) {
        setInternalSiteId(site.siteId);
        onSiteSelectRef.current?.(site);
      }
    });
    map.on('pointermove', (event) => {
      if (!mapElement.current) return;
      const hit = map.hasFeatureAtPixel(event.pixel, { layerFilter: (layer) => layer === markerLayer });
      mapElement.current.style.cursor = hit ? 'pointer' : 'grab';
    });
    mapRef.current = map;

    return () => {
      map.setTarget(undefined);
      map.dispose();
      mapRef.current = null;
    };
    // The map is created once; sources and selected state are updated in separate effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    markerSource.current.clear();
    const features = sites.map((site) => {
      const feature = new Feature(new Point(fromLonLat(
        [site.coordinates.lonDeg, site.coordinates.latDeg],
        LUNAR_PROJECTION,
      )));
      feature.setProperties({
        siteId: site.siteId,
        label: site.name.replace(' Crater', '').replace(' Ridge (Mock)', ''),
        selected: site.siteId === selectedSiteId,
      });
      return feature;
    });
    markerSource.current.addFeatures(features);
  }, [sites, selectedSiteId]);

  useEffect(() => {
    raySource.current.clear();
    if (!selectedSite) return;
    const bearings = azimuthDeg === undefined
      ? [0, 45, 90, 135, 180, 225, 270, 315]
      : [azimuthDeg];
    const rays = bearings.map((bearing) => {
      const end = destination(
        selectedSite.coordinates.latDeg,
        selectedSite.coordinates.lonDeg,
        bearing,
        22_000,
      );
      const feature = new Feature(new LineString([
        fromLonLat([selectedSite.coordinates.lonDeg, selectedSite.coordinates.latDeg], LUNAR_PROJECTION),
        fromLonLat(end, LUNAR_PROJECTION),
      ]));
      feature.set('highlight', azimuthDeg !== undefined);
      feature.set('azimuth', ((bearing % 360) + 360) % 360);
      return feature;
    });
    raySource.current.addFeatures(rays);
  }, [selectedSite, azimuthDeg]);

  useEffect(() => {
    if (!mapRef.current || !selectedSite) return;
    const center = fromLonLat(
      [selectedSite.coordinates.lonDeg, selectedSite.coordinates.latDeg],
      LUNAR_PROJECTION,
    );
    mapRef.current.getView().animate({ center, duration: 350 });
  }, [selectedSite]);

  return (
    <section className={`lunar-map-panel ${className}`} aria-label="Lunar south-polar landing site map">
      <div className="lunar-map-heading">
        <div>
          <p className="lunar-eyebrow">SOUTH POLAR REGION · MEAN-EARTH FRAME</p>
          <h2>Landing site map</h2>
        </div>
        <span className="lunar-map-status">{loading ? 'Loading catalogue…' : `${sites.length} sites`}</span>
      </div>
      <div className="lunar-map-canvas-wrap">
        <div ref={mapElement} className="lunar-map-canvas" />
        <div className="lunar-map-north" aria-hidden="true"><span>N</span><i /></div>
        <div className="lunar-map-caption">Polar stereographic grid · no terrain basemap loaded</div>
      </div>
      {error && <p className="lunar-map-error" role="status">Site data warning: {error}</p>}
      {selectedSite && (
        <div className="lunar-map-selected" aria-live="polite">
          <div>
            <span className="lunar-eyebrow">SELECTED LANDING SITE</span>
            <strong>{selectedSite.name}</strong>
            <span>{selectedSite.coordinates.latDeg.toFixed(3)}° · {selectedSite.coordinates.lonDeg.toFixed(3)}°</span>
            <span className="lunar-map-provenance">DEM source: {selectedSite.demSource ?? 'not specified'}</span>
          </div>
          <span className="lunar-map-elevation">
            {selectedSite.coordinates.elevationM === undefined
              ? 'Elevation unavailable'
              : `${selectedSite.coordinates.elevationM.toLocaleString()} m`}
          </span>
        </div>
      )}
      <div className="lunar-map-site-list" aria-label="Choose a landing site">
        {sites.map((site) => (
          <button
            type="button"
            key={site.siteId}
            className={site.siteId === selectedSiteId ? 'is-selected' : ''}
            onClick={() => {
              setInternalSiteId(site.siteId);
              onSiteSelectRef.current?.(site);
            }}
            aria-pressed={site.siteId === selectedSiteId}
          >
            <span className="lunar-site-dot" />{site.name}
          </button>
        ))}
      </div>
    </section>
  );
}

export default LunarSiteMap;
