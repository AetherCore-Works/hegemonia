import { describe, expect, it } from "vitest";
import {
  SUPREMACY_ANGLE_PRESETS,
  buildSupremacyStageTransform,
  clampSupremacyPitch,
  clampSupremacyRoll,
  computeSvgSliceScale,
  projectMapPlaneToScreen,
  screenToMapPlane,
} from "./map-perspective.js";

describe("Supremacy 2.5D Perspective Camera Math", () => {
  const viewport = { left: 0, top: 0, width: 1920, height: 1080 };

  it("builds valid CSS 3D transform strings for all angle presets", () => {
    expect(buildSupremacyStageTransform(SUPREMACY_ANGLE_PRESETS.right)).toBe(
      "rotateX(34.00deg) rotateY(4.00deg) rotateZ(5.50deg)"
    );
    expect(buildSupremacyStageTransform(SUPREMACY_ANGLE_PRESETS.center)).toBe(
      "rotateX(35.00deg) rotateY(0.00deg) rotateZ(0.00deg)"
    );
    expect(buildSupremacyStageTransform(SUPREMACY_ANGLE_PRESETS.left)).toBe(
      "rotateX(34.00deg) rotateY(-4.00deg) rotateZ(-5.50deg)"
    );
  });

  it("clamps interactive pitch and roll angles within safe viewing bounds", () => {
    expect(clampSupremacyPitch(5)).toBe(18);
    expect(clampSupremacyPitch(34)).toBe(34);
    expect(clampSupremacyPitch(80)).toBe(46);

    expect(clampSupremacyRoll(-30)).toBe(-14);
    expect(clampSupremacyRoll(5.5)).toBe(5.5);
    expect(clampSupremacyRoll(40)).toBe(14);
  });

  it("inverts tilted CSS perspective projection with sub-pixel precision across viewport points", () => {
    const sampleScreenPoints = [
      { x: 960, y: 540 },
      { x: 180, y: 120 },
      { x: 1740, y: 150 },
      { x: 240, y: 940 },
      { x: 1680, y: 920 },
    ];

    for (const preset of Object.values(SUPREMACY_ANGLE_PRESETS)) {
      for (const sp of sampleScreenPoints) {
        const plane = screenToMapPlane(sp.x, sp.y, viewport, preset);
        expect(plane).not.toBeNull();
        const reprojected = projectMapPlaneToScreen(plane!.x, plane!.y, viewport, preset);
        expect(reprojected.x).toBeCloseTo(sp.x, 4);
        expect(reprojected.y).toBeCloseTo(sp.y, 4);
      }
    }
  });

  it("accounts for foreshortening: dragging near top horizon covers more map depth than bottom foreground", () => {
    const config = SUPREMACY_ANGLE_PRESETS.center;
    const topA = screenToMapPlane(960, 140, viewport, config)!;
    const topB = screenToMapPlane(960, 240, viewport, config)!;
    const botA = screenToMapPlane(960, 840, viewport, config)!;
    const botB = screenToMapPlane(960, 940, viewport, config)!;

    expect(Math.abs(topB.y - topA.y)).toBeGreaterThan(Math.abs(botB.y - botA.y));
  });

  it("computes SVG slice scale matching xMidYMid slice across aspect ratios", () => {
    expect(computeSvgSliceScale(1920, 1080, 1200, 620)).toBeCloseTo(620 / 1080, 5);
    expect(computeSvgSliceScale(2560, 1080, 1200, 620)).toBeCloseTo(1200 / 2560, 5);
  });
});
