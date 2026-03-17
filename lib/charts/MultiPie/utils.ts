export const PIE_SIZE = 1.6
const PRECISION = 10000
const RAD = Math.PI / 180
export const OTHER_COLOR = '#4f5a69'

const polarToCartesian = (r: number, angle: number) => {
  const rad = (angle - 90) * RAD
  return {
    x: Math.round(r * Math.cos(rad) * PRECISION) / PRECISION,
    y: Math.round(r * Math.sin(rad) * PRECISION) / PRECISION,
  }
}

export const createPath = (start: number, end: number, rOut: number, rIn: number) => {
  if (end - start >= 360) {
    const out = `M0,-${rOut}A${rOut},${rOut},0,1,1,0,${rOut}A${rOut},${rOut},0,1,1,0,-${rOut}Z`
    const inC = rIn ? `M0,-${rIn}A${rIn},${rIn},0,1,0,0,${rIn}A${rIn},${rIn},0,1,0,0,-${rIn}Z` : ''
    return rIn ? `${out} ${inC}` : out
  }
  const [s, e] = [polarToCartesian(rOut, end), polarToCartesian(rOut, start)]
  const [inS, inE] = [polarToCartesian(rIn, end), polarToCartesian(rIn, start)]
  const large = end - start <= 180 ? 0 : 1
  const outer = `M${s.x},${s.y}A${rOut},${rOut},0,${large},0,${e.x},${e.y}`
  return rIn ? `${outer}L${inE.x},${inE.y}A${rIn},${rIn},0,${large},1,${inS.x},${inS.y}Z` : `${outer}L0,0Z`
}

// Radii configuration
const SCALED_RADII = [41, 34, 33, 31, 18, 32, 29, 27, 25.5, 23, 18.5, 17, 14, 12, 9.5]
const getRadius = (v: number) => (SCALED_RADII.includes(v) ? v * PIE_SIZE : v)
export const RADIUS_MAPS: Record<string, { outer: number; inner: number }[][]> = {
  pie: [
    [{ outer: 41, inner: 0 }],
    [
      { outer: 41, inner: 25.5 },
      { outer: 25.5, inner: 0 },
    ],
    [
      { outer: 41, inner: 29 },
      { outer: 29, inner: 17 },
      { outer: 17, inner: 0 },
    ],
    [
      { outer: 41, inner: 32 },
      { outer: 32, inner: 23 },
      { outer: 23, inner: 14 },
      { outer: 14, inner: 0 },
    ],
  ],
  donut: [
    [{ outer: 41, inner: 31 }],
    [
      { outer: 41, inner: 33 },
      { outer: 25.5, inner: 18 },
    ],
    [
      { outer: 41, inner: 34 },
      { outer: 30, inner: 23 },
      { outer: 18.5, inner: 12 },
    ],
    [
      { outer: 41, inner: 36 },
      { outer: 32, inner: 27 },
      { outer: 23, inner: 18.5 },
      { outer: 14, inner: 9.5 },
    ],
  ],
}

// Helper to map radii to scaled values
export const getScaledRadius = (radiusConfig: { outer: number; inner: number }[]) =>
  radiusConfig.map((r) => ({ outer: getRadius(r.outer), inner: getRadius(r.inner) }))
