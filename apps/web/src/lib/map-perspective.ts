import type { SupremacyAnglePreset } from "./map-preferences.js";

export interface PerspectiveCameraConfig {
  perspectivePx: number;
  originYRatio: number;
  pitchDeg: number;
  yawDeg: number;
  rollDeg: number;
}

export interface ViewportRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Preset oblique 2.5D tabletop camera angles inspired by Supremacy WW3. */
export const SUPREMACY_ANGLE_PRESETS: Record<SupremacyAnglePreset, PerspectiveCameraConfig> = {
  right: {
    perspectivePx: 1080,
    originYRatio: 0.43,
    pitchDeg: 34,
    yawDeg: 4,
    rollDeg: 5.5,
  },
  center: {
    perspectivePx: 1080,
    originYRatio: 0.43,
    pitchDeg: 35,
    yawDeg: 0,
    rollDeg: 0,
  },
  left: {
    perspectivePx: 1080,
    originYRatio: 0.43,
    pitchDeg: 34,
    yawDeg: -4,
    rollDeg: -5.5,
  },
};

export function clampSupremacyPitch(deg: number): number {
  return Math.max(18, Math.min(46, deg));
}

export function clampSupremacyRoll(deg: number): number {
  return Math.max(-14, Math.min(14, deg));
}

/** Builds the CSS 3D transform string matching CSS right-to-left rotation composition. */
export function buildSupremacyStageTransform(config: PerspectiveCameraConfig): string {
  return `rotateX(${config.pitchDeg.toFixed(2)}deg) rotateY(${config.yawDeg.toFixed(2)}deg) rotateZ(${config.rollDeg.toFixed(2)}deg)`;
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Computes the orthonormal basis vectors (tu, tv, normal) of R = Rx(pitch) * Ry(yaw) * Rz(roll)
 * matching CSS 3D right-handed coordinate conventions (+X right, +Y down, +Z toward viewer).
 */
function computeStageBasis(config: PerspectiveCameraConfig): { tu: Vec3; tv: Vec3; normal: Vec3 } {
  const rx = degToRad(config.pitchDeg);
  const ry = degToRad(config.yawDeg);
  const rz = degToRad(config.rollDeg);

  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);

  // R = Rx * Ry * Rz
  // First Ry * Rz columns:
  // col0: (cy*cz, sz, -sy*cz) -> wait: Ry * (cz, sz, 0) = (cy*cz, sz, -sy*cz)
  // col1: (-cy*sz, cz, sy*sz)
  // col2: (sy, 0, cy)
  const a00 = cy * cz;
  const a10 = sz;
  const a20 = -sy * cz;

  const a01 = -cy * sz;
  const a11 = cz;
  const a21 = sy * sz;

  const a02 = sy;
  const a12 = 0;
  const a22 = cy;

  // Apply Rx to each column: (x, y*cx - z*sx, y*sx + z*cx)
  return {
    tu: {
      x: a00,
      y: a10 * cx - a20 * sx,
      z: a10 * sx + a20 * cx,
    },
    tv: {
      x: a01,
      y: a11 * cx - a21 * sx,
      z: a11 * sx + a21 * cx,
    },
    normal: {
      x: a02,
      y: a12 * cx - a22 * sx,
      z: a12 * sx + a22 * cx,
    },
  };
}

/**
 * Unprojects a viewport screen point (clientX, clientY) onto the tilted 2.5D map stage plane,
 * returning flat local offsets (x, y) in CSS pixels relative to the stage center.
 */
export function screenToMapPlane(
  screenX: number,
  screenY: number,
  rect: ViewportRectLike,
  config: PerspectiveCameraConfig
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0 || config.perspectivePx <= 0) return null;

  const stageOrigin: Vec3 = {
    x: rect.left + rect.width * 0.5,
    y: rect.top + rect.height * 0.5,
    z: 0,
  };
  const eye: Vec3 = {
    x: rect.left + rect.width * 0.5,
    y: rect.top + rect.height * config.originYRatio,
    z: config.perspectivePx,
  };
  const rayDir: Vec3 = {
    x: screenX - eye.x,
    y: screenY - eye.y,
    z: -config.perspectivePx,
  };

  const { tu, tv, normal } = computeStageBasis(config);
  const denom = dot(rayDir, normal);
  if (Math.abs(denom) < 1e-4) return null;

  const toOrigin: Vec3 = {
    x: stageOrigin.x - eye.x,
    y: stageOrigin.y - eye.y,
    z: stageOrigin.z - eye.z,
  };
  const lambda = dot(toOrigin, normal) / denom;
  if (lambda <= 0) return null;

  const delta: Vec3 = {
    x: eye.x + lambda * rayDir.x - stageOrigin.x,
    y: eye.y + lambda * rayDir.y - stageOrigin.y,
    z: eye.z + lambda * rayDir.z - stageOrigin.z,
  };

  return {
    x: dot(delta, tu),
    y: dot(delta, tv),
  };
}

/** Projects flat stage coordinates (planeX, planeY) to viewport screen coordinates under CSS perspective. */
export function projectMapPlaneToScreen(
  planeX: number,
  planeY: number,
  rect: ViewportRectLike,
  config: PerspectiveCameraConfig
): { x: number; y: number } {
  const { tu, tv } = computeStageBasis(config);
  const originX = rect.left + rect.width * 0.5;
  const originY = rect.top + rect.height * 0.5;
  const eyeX = rect.left + rect.width * 0.5;
  const eyeY = rect.top + rect.height * config.originYRatio;

  const worldX = originX + tu.x * planeX + tv.x * planeY;
  const worldY = originY + tu.y * planeX + tv.y * planeY;
  const worldZ = tu.z * planeX + tv.z * planeY;

  const pScale = config.perspectivePx / (config.perspectivePx - worldZ);
  return {
    x: eyeX + (worldX - eyeX) * pScale,
    y: eyeY + (worldY - eyeY) * pScale,
  };
}

/** Computes SVG units per CSS pixel matching SVG preserveAspectRatio="xMidYMid slice". */
export function computeSvgSliceScale(
  viewportWidth: number,
  viewportHeight: number,
  mapWidth: number,
  mapHeight: number
): number {
  const safeW = Math.max(viewportWidth, 320);
  const safeH = Math.max(viewportHeight, 240);
  const pxPerUnit = Math.max(safeW / mapWidth, safeH / mapHeight);
  return 1 / pxPerUnit;
}
