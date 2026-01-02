/* Twister simulator (client-only, Canvas 2D). Physics runs in world units scaled to pixels. */

/* Utility */
const TWO_PI = Math.PI * 2;
const DEG_TO_RAD = Math.PI / 180;
const FORK_ANGLE_RAD = 60 * DEG_TO_RAD;

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function randUnit() { return Math.random(); }
function randRange(min, max) { return min + (max - min) * Math.random(); }
function distance(a, b) { const dx = a.x - b.x; const dy = a.y - b.y; return Math.hypot(dx, dy); }

// Minimal DOM cache to avoid repeated lookups
const __domCache = new Map();
function el(id) {
  let node = __domCache.get(id);
  if (!node) { node = document.getElementById(id); __domCache.set(id, node); }
  return node;
}

// Screen/world conversions (world normalized to arena radius)
function toWorldNorm(sim, px, py) {
  const cx = sim.width / 2, cy = sim.height / 2;
  return {
    x: (px - cx) / (sim.scale * ARENA_RADIUS_UNITS),
    y: (py - cy) / (sim.scale * ARENA_RADIUS_UNITS),
  };
}
function fromWorldNorm(sim, wx, wy) {
  const cx = sim.width / 2, cy = sim.height / 2;
  return {
    x: cx + (wx * ARENA_RADIUS_UNITS) * sim.scale,
    y: cy + (wy * ARENA_RADIUS_UNITS) * sim.scale,
  };
}
const URL_UPDATE_MIN_INTERVAL_MS = 500;
const __urlUpdate = { lastAt: 0, timer: null, pending: null };

function buildURLState(sim) {
  const casterW = toWorldNorm(sim, sim.caster.x, sim.caster.y);
  const bossW = toWorldNorm(sim, sim.boss.x, sim.boss.y);
  return {
    a: sim.config.arenaType,
    ah: sim.config.avgHit,
    ps: sim.config.projSpeedMod,
    d: sim.config.duration,
    pc: sim.config.projectileCount,
    cs: sim.config.castSpeed,
    shape: sim.config.castShape,
    pr: sim.config.pierceCount,
    fk: sim.config.forkTimes,
    fc: sim.config.forkChance,
    ch: sim.config.chainCount,
    sp: sim.config.splitCount,
    er: sim.config.bossRadius,
    ts: sim.metrics.windowSec,
    bc: sim.config.barrageCount,
    bti: sim.config.barrageTimeInterval,
    tbr: sim.config.timeBetweenBarrageRepeats,
    cxu: casterW.x, cyu: casterW.y,
    bxu: bossW.x, byu: bossW.y,
  };
}
function throttledWriteURL(state) {
  __urlUpdate.pending = state;
  if (__urlUpdate.timer != null) return;
  const now = performance.now();
  const elapsed = now - __urlUpdate.lastAt;
  const delay = Math.max(0, URL_UPDATE_MIN_INTERVAL_MS - elapsed);
  __urlUpdate.timer = window.setTimeout(() => {
    __urlUpdate.timer = null;
    const current = __urlUpdate.pending;
    if (!current) return;
    __urlUpdate.pending = null;
    writeURLParams(current);
    __urlUpdate.lastAt = performance.now();
    // If additional updates queued while writing, schedule next flush
    if (__urlUpdate.pending) throttledWriteURL(__urlUpdate.pending);
  }, delay);
}

function updateURL(sim) { throttledWriteURL(buildURLState(sim)); }

// Human-readable short number formatting (compact, trims trailing zeros)
function formatShortNumber(value, preferDecimals = 1) {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  let unit = '';
  let div = 1;
  let decimals = preferDecimals;

  const trimZeros = (s) => s.replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1');

  if (abs >= 1e15) { unit = 'Q'; div = 1e15; decimals = 1; }
  else if (abs >= 1e12) { unit = 'T'; div = 1e12; decimals = 1; }
  else if (abs >= 1e9) { unit = 'B'; div = 1e9; decimals = 1; }
  else if (abs >= 1e6) { unit = 'M'; div = 1e6; decimals = (abs / div) < 100 ? 1 : 0; }
  else if (abs >= 1e3) { unit = 'K'; div = 1e3; decimals = (abs / div) < 100 ? 1 : 0; }
  else if (abs >= 1) { unit = ''; div = 1; decimals = 0; }
  else { unit = ''; div = 1; decimals = Math.min(2, preferDecimals || 1); }

  if (unit) {
    const s = (abs / div).toFixed(decimals);
    return sign + trimZeros(s) + unit;
  }
  const rounded = decimals > 0 ? trimZeros(abs.toFixed(decimals)) : Math.round(abs).toString();
  return sign + rounded;
}

// URL helpers: serialize/deserialize UI + positions for deep links
function parseURLParams() {
  const p = new URLSearchParams(window.location.search);
  const num = (k) => (p.has(k) ? Number(p.get(k)) : undefined);
  const str = (k) => (p.has(k) ? p.get(k) : undefined);
  const out = {
    a: str('a'), // arenaType (short code)
    ah: num('ah'), // avgHit
    ps: num('ps'), // projSpeed
    d: num('d'), // duration
    pc: num('pc'), // projectileCount
    cs: num('cs'), // castSpeed
    shape: str('shape'), // castShape (short code)
    pr: num('pr'), // pierceCount
    fk: num('fk'), // forkTimes
    fc: num('fc'), // forkChance
    ch: num('ch'), // chainCount
    sp: num('sp'), // splitCount
    bc: num('bc'), // barrageCount
    bti: num('bti'), // barrageTimeInterval
    tbr: num('tbr'), // timeBetweenBarrageRepeats
    er: num('er'), // bossRadius
    ts: num('ts'), // chart window (seconds)
    // Positions: support both canvas-normalized (0..1) and world-normalized (relative to arena radius)
    cx: num('cx'), cy: num('cy'), // legacy canvas-normalized positions
    bx: num('bx'), by: num('by'),
    cxu: num('cxu'), cyu: num('cyu'), // world-normalized positions (relative to ARENA_RADIUS_UNITS)
    bxu: num('bxu'), byu: num('byu'),
  };
  return out;
}

function applyParamsToDOM(params) {
  const setIf = (id, v) => { 
    const elem = el(id);
    if (elem && v !== undefined && !Number.isNaN(v)) elem.value = String(v); 
  };
  const setSelIf = (id, v) => { 
    const elem = el(id);
    if (elem && v !== undefined) elem.value = v; 
  };
  setSelIf('arenaType', decodeArena(params.a));
  setIf('avgHit', params.ah);
  setIf('projSpeedMod', params.ps);
  setIf('duration', params.d);
  setIf('projectileCount', params.pc);
  setIf('baseProjSpeed', params.baseProjSpeed);
  setIf('baseSealGainFrequency', params.baseSealGainFrequency);
  setIf('maxSeals', params.maxSeals);
  setIf('salvoSealCount', params.salvoSealCount);
  setIf('barrageCount', params.bc);
  setIf('barrageTimeInterval', params.bti);
  setIf('timeBetweenBarrageRepeats', params.tbr);
  setIf('twisterRadius', params.twisterRadius);
  setIf('increasedSealGainFrequency', params.increasedSealGainFrequency);
  setIf('bossRadius', params.er);
  const timeScaleElem = el('timeScale');
  if (timeScaleElem && params.ts !== undefined && !Number.isNaN(params.ts)) timeScaleElem.value = String(params.ts);
  return {
    casterWorld: (params.cxu !== undefined && params.cyu !== undefined) ? { x: params.cxu, y: params.cyu } : undefined,
    bossWorld: (params.bxu !== undefined && params.byu !== undefined) ? { x: params.bxu, y: params.byu } : undefined,
    caster: (params.cx !== undefined && params.cy !== undefined) ? { x: clamp(params.cx, 0, 1), y: clamp(params.cy, 0, 1) } : undefined,
    boss: (params.bx !== undefined && params.by !== undefined) ? { x: clamp(params.bx, 0, 1), y: clamp(params.by, 0, 1) } : undefined,
  };
}

function writeURLParams(state) {
  const p = new URLSearchParams();
  const set = (k, v) => { if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); };
  set('a', encodeArena(state.a));
  set('ah', state.ah);
  set('ps', state.ps);
  set('d', state.d);
  set('pc', state.pc);
  set('cs', state.cs);
  set('shape', encodeShape(state.shape));
  set('face', state.face);
  set('pr', state.pr);
  set('fk', state.fk);
  set('fc', state.fc);
  set('ch', state.ch);
  set('sp', state.sp);
  set('bc', state.bc);
  set('bti', state.bti);
  set('tbr', state.tbr);
  set('er', state.er);
  set('ts', state.ts);
  const fmtN = (n) => (v) => {
    const s = Number(v).toFixed(n);
    return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  };
  const fmt3 = fmtN(3);
  const fmt5 = fmtN(5);
  if (state.cx !== undefined) set('cx', fmt3(state.cx));
  if (state.cy !== undefined) set('cy', fmt3(state.cy));
  if (state.bx !== undefined) set('bx', fmt3(state.bx));
  if (state.by !== undefined) set('by', fmt3(state.by));
  // Also persist world-normalized positions for cross-resolution stability (higher precision)
  if (state.cxu !== undefined) set('cxu', fmt5(state.cxu));
  if (state.cyu !== undefined) set('cyu', fmt5(state.cyu));
  if (state.bxu !== undefined) set('bxu', fmt5(state.bxu));
  if (state.byu !== undefined) set('byu', fmt5(state.byu));
  const url = window.location.pathname + '?' + p.toString();
  window.history.replaceState(null, '', url);
}

// Short code encoders/decoders
function encodeArena(v) {
  if (v === 'tjunction' || v === 't') return 't';
  if (v === 'square' || v === 's') return 's';
  return 'c'; // circle
}
function decodeArena(v) {
  if (v === 't') return 'tjunction';
  if (v === 's') return 'square';
  if (v === 'c') return 'circle';
  return v || 'circle';
}
function encodeShape(v) {
  if (v === 'cone' || v === 'n') return 'n';
  return 'c'; // circular
}
function decodeShape(v) {
  if (v === 'n') return 'cone';
  if (v === 'c') return 'circular';
  return v || 'circular';
}

// Returns earliest t in [0,1] for moving circle vs target circle (ray-circle intersection).
function sweptCircleHitT(px, py, dx, dy, cx, cy, R) {
  // Solve |(p + t d) - c|^2 = R^2 => (d·d) t^2 + 2 d·(p-c) t + |p-c|^2 - R^2 = 0
  const mx = px - cx, my = py - cy;
  const a = dx * dx + dy * dy;
  const b = 2 * (dx * mx + dy * my);
  const c = mx * mx + my * my - R * R;
  // If starting already inside, treat as immediate hit
  if (c <= 0) return 0;
  if (a === 0) return null; // no movement
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sqrt = Math.sqrt(disc);
  const t1 = (-b - sqrt) / (2 * a);
  const t2 = (-b + sqrt) / (2 * a);
  // We need the smallest non-negative within [0,1]
  let t = null;
  if (t1 >= 0 && t1 <= 1) t = t1;
  else if (t2 >= 0 && t2 <= 1) t = t2;
  return t;
}

// Closest points between segments P0->P1 and Q0->Q1; used for CCD support.
function closestPointsBetweenSegments(p0x, p0y, p1x, p1y, q0x, q0y, q1x, q1y) {
  const ux = p1x - p0x, uy = p1y - p0y;
  const vx = q1x - q0x, vy = q1y - q0y;
  const wx = p0x - q0x, wy = p0y - q0y;
  const a = ux * ux + uy * uy;      // |u|^2
  const b = ux * vx + uy * vy;      // u·v
  const c = vx * vx + vy * vy;      // |v|^2
  const d = ux * wx + uy * wy;      // u·w
  const e = vx * wx + vy * wy;      // v·w
  const D = a * c - b * b;
  let sc, sN, sD = D;
  let tc, tN, tD = D;

  const EPS = 1e-9;
  if (D < EPS) {
    // parallel
    sN = 0.0; sD = 1.0; tN = e; tD = c;
  } else {
    sN = (b * e - c * d);
    tN = (a * e - b * d);
    if (sN < 0) { sN = 0; tN = e; tD = c; }
    else if (sN > sD) { sN = sD; tN = e + b; tD = c; }
  }

  if (tN < 0) {
    tN = 0;
    if (-d < 0) sN = 0; else if (-d > a) sN = sD; else { sN = -d; sD = a; }
  } else if (tN > tD) {
    tN = tD;
    if ((-d + b) < 0) sN = 0; else if ((-d + b) > a) sN = sD; else { sN = (-d + b); sD = a; }
  }

  sc = Math.abs(sD) < EPS ? 0 : sN / sD;
  tc = Math.abs(tD) < EPS ? 0 : tN / tD;

  const px = p0x + sc * ux, py = p0y + sc * uy;
  const qx = q0x + tc * vx, qy = q0y + tc * vy;
  const dx = px - qx, dy = py - qy;
  return { sc, tc, px, py, qx, qy, dist: Math.hypot(dx, dy) };
}

// Closest point from a point P to segment AB (projection clamped to [0,1]).
function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const vLen2 = vx * vx + vy * vy || 1;
  let t = (wx * vx + wy * vy) / vLen2;
  t = clamp(t, 0, 1);
  const cx = ax + t * vx;
  const cy = ay + t * vy;
  const dx = px - cx, dy = py - cy;
  return { t, cx, cy, dist: Math.hypot(dx, dy) };
}

// Exact time-of-impact for moving circle vs capsule segment; returns {t, nx, ny} or null.
function sweptCircleSegmentTOI(p0x, p0y, dx, dy, ax, ay, bx, by, r) {
  // Precompute segment basis
  const ux = bx - ax, uy = by - ay;
  const L = Math.hypot(ux, uy);
  if (L === 0) {
    // Degenerates to circle at A
    const tCircle = sweptCircleHitT(p0x, p0y, dx, dy, ax, ay, r);
    if (tCircle == null) return null;
    const cx = ax, cy = ay;
    const px = p0x + dx * tCircle, py = p0y + dy * tCircle;
    const nx = (px - cx) / (Math.hypot(px - cx, py - cy) || 1);
    const ny = (py - cy) / (Math.hypot(px - cx, py - cy) || 1);
    return { t: tCircle, nx, ny };
  }
  const unx = ux / L, uny = uy / L; // tangent
  const nx0 = -uny, ny0 = unx;      // unit normal

  // Infinite strip intersections: solve n·(P0 + t d - A) = ±r
  const p0n = nx0 * (p0x - ax) + ny0 * (p0y - ay);
  const dn = nx0 * dx + ny0 * dy;
  const candidates = [];
  const EPS = 1e-9;
  if (Math.abs(dn) > EPS) {
    for (const sgn of [+1, -1]) {
      const t = (sgn * r - p0n) / dn;
      if (t >= -EPS && t <= 1 + EPS) {
        const px = p0x + dx * t;
        const py = p0y + dy * t;
        const s = unx * (px - ax) + uny * (py - ay); // projection along segment
        if (s >= -EPS && s <= L + EPS) {
          const normSign = Math.sign(nx0 * (px - ax) + ny0 * (py - ay));
          const nx = (normSign >= 0) ? nx0 : -nx0;
          const ny = (normSign >= 0) ? ny0 : -ny0;
          candidates.push({ t: Math.max(0, Math.min(1, t)), nx, ny });
        }
      }
    }
  }

  // Endcap circles at A and B
  const tA = sweptCircleHitT(p0x, p0y, dx, dy, ax, ay, r);
  if (tA != null && tA >= 0 && tA <= 1) {
    const px = p0x + dx * tA, py = p0y + dy * tA;
    const vax = px - ax, vay = py - ay; const len = Math.hypot(vax, vay) || 1;
    candidates.push({ t: tA, nx: vax / len, ny: vay / len });
  }
  const tB = sweptCircleHitT(p0x, p0y, dx, dy, bx, by, r);
  if (tB != null && tB >= 0 && tB <= 1) {
    const px = p0x + dx * tB, py = p0y + dy * tB;
    const vbx = px - bx, vby = py - by; const len = Math.hypot(vbx, vby) || 1;
    candidates.push({ t: tB, nx: vbx / len, ny: vby / len });
  }

  if (!candidates.length) return null;
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].t < best.t) best = candidates[i];
  }
  return best;
}

// Per-cast, per-target hit cooldown in seconds
const PER_CAST_TARGET_COOLDOWN = 0.66;

// World unit references
const ARENA_RADIUS_UNITS = 160; // circle arena radius in world units
const BOSS_RADIUS_UNITS = 3;
const CASTER_RADIUS_UNITS = 3;
const PROJ_RADIUS_UNITS = 0.5;
const BASE_PROJ_SPEED_UNITS = 75;
const WANDER_INTENSITY = 0.0;

/**
 * Straight-line movement for Twisters:
 * - Twisters travel in a single direction with no jitter or heading changes
 * - No wander behavior needed
 */
function gaussian() {
  // Box-Muller transform
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

class Wander {
  constructor() {
    this.t = 0;
    // Event rate ~3 Hz, matching observed low-velocity samples
    this.lambda = 3.0;
    // Probability that an event uses the larger-angle distribution
    this.pLarge = 0.35;
    // Probability to spawn a short burst (1-2 extra events) around the main event
    this.pBurst = 0.25;
    // Angular deltas (radians)
    this.sigmaSmall = 22 * DEG_TO_RAD;  // ~22°
    this.sigmaLarge = 75 * DEG_TO_RAD;  // ~75°
    this.truncSmall = 60 * DEG_TO_RAD;  // cap small at 60°
    this.truncLarge = 120 * DEG_TO_RAD; // cap large at 120°
    // Micro jitter: per sqrt(second)
    this.sigmaMicro = 4 * DEG_TO_RAD;
    this.intensity = WANDER_INTENSITY;

    this.nextEventAt = this.t + this.sampleExp(this.lambda);
    this.pendingEvents = [];
  }

  sampleExp(rate) { return -Math.log(1 - Math.random()) / rate; }

  sampleTruncatedNormal(sigma, maxAbs) {
    // Centered at 0; accept-reject
    for (let i = 0; i < 8; i++) {
      const x = gaussian() * sigma;
      if (Math.abs(x) <= maxAbs) return x;
    }
    return clamp(gaussian() * sigma, -maxAbs, maxAbs);
  }

  scheduleBurst(anchorTime) {
    const extra = Math.random() < 0.5 ? 1 : 2;
    for (let i = 0; i < extra; i++) {
      const dt = randRange(0.03, 0.12); // ~30–120 ms
      this.pendingEvents.push(anchorTime + dt);
    }
    this.pendingEvents.sort((a, b) => a - b);
  }

  step(angle, dt) {
    this.t += dt;
    // Continuous micro jitter
    angle += gaussian() * this.sigmaMicro * Math.sqrt(Math.max(dt, 0)) * this.intensity;

    // Process any due events (base or burst)
    while (true) {
      let eventTime = null;
      if (this.pendingEvents.length && this.pendingEvents[0] <= this.t) {
        eventTime = this.pendingEvents.shift();
      } else if (this.t >= this.nextEventAt) {
        eventTime = this.nextEventAt;
        this.nextEventAt = this.t + this.sampleExp(this.lambda);
        if (Math.random() < this.pBurst) this.scheduleBurst(eventTime);
      } else {
        break;
      }

      const useLarge = Math.random() < this.pLarge;
      const sigma = useLarge ? this.sigmaLarge : this.sigmaSmall;
      const trunc = useLarge ? this.truncLarge : this.truncSmall;
      const delta = this.sampleTruncatedNormal(sigma, trunc) * this.intensity;
      angle += delta;
    }

    return angle;
  }
}

// Arena shape base + variants
class Arena {
  constructor(width, height) { this.width = width; this.height = height; }
  // return {hit:boolean, nx:number, ny:number, reflect:boolean, x:number, y:number}
  collideCircle(x, y, r) { return { hit: false }; }
  draw(ctx) {}
}

class CircleArena extends Arena {
  constructor(width, height, scale) {
    super(width, height);
    const radius = ARENA_RADIUS_UNITS * scale;
    this.center = { x: width / 2, y: height / 2 };
    this.radius = radius;
  }
  collideCircle(x, y, r) {
    const dx = x - this.center.x; const dy = y - this.center.y;
    const dist = Math.hypot(dx, dy);
    const limit = this.radius - r;
    if (dist > limit) {
      const nx = dx / dist; const ny = dy / dist;
      const px = this.center.x + nx * limit;
      const py = this.center.y + ny * limit;
      return { hit: true, nx, ny, reflect: true, x: px, y: py };
    }
    return { hit: false };
  }
  draw(ctx) {
    ctx.save();
    ctx.strokeStyle = '#334';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.center.x, this.center.y, this.radius, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();
  }
}

class SquareArena extends Arena {
  constructor(width, height, scale) {
    super(width, height);
    const side = ARENA_RADIUS_UNITS * 2 * scale; // match circle arena diameter
    this.rect = {
      x: (width - side) / 2,
      y: (height - side) / 2,
      w: side,
      h: side,
    };
  }
  collideCircle(x, y, r) {
    const { x: rx, y: ry, w, h } = this.rect;
    let nx = 0, ny = 0, hit = false;
    let px = x, py = y;
    if (x - r < rx) { px = rx + r; nx = -1; hit = true; }
    if (x + r > rx + w) { px = rx + w - r; nx = 1; hit = true; }
    if (y - r < ry) { py = ry + r; ny = -1; hit = true; }
    if (y + r > ry + h) { py = ry + h - r; ny = 1; hit = true; }
    if (!hit) return { hit: false };
    const norm = Math.hypot(nx, ny) || 1;
    return { hit: true, nx: nx / norm, ny: ny / norm, reflect: true, x: px, y: py };
  }
  draw(ctx) {
    const { x, y, w, h } = this.rect;
    ctx.save();
    ctx.strokeStyle = '#334';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
}

class TJunctionArena extends Arena {
  constructor(width, height, scale) {
    super(width, height);
    // Build a hollow T corridor: open connection between vertical stem and horizontal bar
    const cx = width / 2; const cy = height / 2;
    // World units (inner corridor sizes)
    const stemWidthU = 100;
    const stemHeightU = 260;
    const barWidthU = 320;
    const barHeightU = 80;

    // Fit the full T height within the baseline circle footprint (320u) so it's centered and not clipped
    const targetHUnits = ARENA_RADIUS_UNITS * 2; // 320u
    const tHeightUnits = stemHeightU + barHeightU; // 340u by default
    const fitFactor = Math.min(1, targetHUnits / tHeightUnits);
    const sW = stemWidthU * scale * fitFactor;      // inner stem width
    const sH = stemHeightU * scale * fitFactor;     // stem length
    const bW = barWidthU * scale * fitFactor;       // inner bar width
    const bH = barHeightU * scale * fitFactor;      // inner bar height

    // Connection Y (where stem meets bar, at center of bar vertically)
    const connectY = cy - sH / 2;
    const barCenterY = connectY; // center of bar along Y
    const barTopY = barCenterY - bH / 2;
    const barBotY = barCenterY + bH / 2;

    // Stem vertical walls terminate at bar bottom to leave opening
    const stemLeftX = cx - sW / 2;
    const stemRightX = cx + sW / 2;
    const stemBotY = cy + sH / 2;

    const barLeftX = cx - bW / 2;
    const barRightX = cx + bW / 2;

    // Build segments: two stem sides, stem bottom cap, bar top wall, bar bottom walls left/right (gap at stem), bar end caps
    this.segments = [
      // Stem sides (stop at bar bottom)
      { x1: stemLeftX, y1: barBotY, x2: stemLeftX, y2: stemBotY },
      { x1: stemRightX, y1: barBotY, x2: stemRightX, y2: stemBotY },
      // Stem bottom cap
      { x1: stemLeftX, y1: stemBotY, x2: stemRightX, y2: stemBotY },
      // Bar top wall (continuous)
      { x1: barLeftX, y1: barTopY, x2: barRightX, y2: barTopY },
      // Bar bottom wall split into left and right to leave opening for stem
      { x1: barLeftX, y1: barBotY, x2: stemLeftX, y2: barBotY },
      { x1: stemRightX, y1: barBotY, x2: barRightX, y2: barBotY },
      // Bar end caps
      { x1: barLeftX, y1: barTopY, x2: barLeftX, y2: barBotY },
      { x1: barRightX, y1: barTopY, x2: barRightX, y2: barBotY },
    ];
  }
  // Reflect off segments, simple circle-line collision correction
  collideCircle(x, y, r) {
    for (const s of this.segments) {
      const vx = s.x2 - s.x1; const vy = s.y2 - s.y1;
      const wx = x - s.x1; const wy = y - s.y1;
      const vLen2 = vx * vx + vy * vy;
      const t = clamp((wx * vx + wy * vy) / vLen2, 0, 1);
      const cx = s.x1 + t * vx; const cy = s.y1 + t * vy;
      const dx = x - cx; const dy = y - cy; const d = Math.hypot(dx, dy);
      if (d < r) {
        const nx = dx / (d || 1); const ny = dy / (d || 1);
        return { hit: true, nx, ny, reflect: true, x: cx + nx * r, y: cy + ny * r };
      }
    }
    return { hit: false };
  }
  draw(ctx) {
    ctx.save();
    ctx.strokeStyle = '#334';
    ctx.lineWidth = 4;
    for (const s of this.segments) {
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// Entity (player/boss)
class Entity {
  constructor(x, y, r, color) { this.x = x; this.y = y; this.r = r; this.color = color; this.drag = false; }
  draw(ctx) {
    ctx.save();
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }
  contains(px, py) { return Math.hypot(px - this.x, py - this.y) <= this.r; }
}

// Projectile
let nextCastId = 1;
class Projectile {
  constructor(config) {
    this.id = Math.random().toString(36).slice(2);
    this.castId = config.castId;
    this.instanceId = config.instanceId; // groups main cast + all barrage repeats
    this.barrageRepeatIndex = config.barrageRepeatIndex || 0; // 0 = main, 1+ = barrage repeat number
    this.x = config.x;
    this.y = config.y;
    this.vx = Math.cos(config.angle) * config.speed;
    this.vy = Math.sin(config.angle) * config.speed;
    this.speed = config.speed;
    this.angle = config.angle;
    // Store the twister radius in world units and scale to pixels
    this.twisterRadiusUnits = config.twisterRadius || PROJ_RADIUS_UNITS;
    this.radius = this.twisterRadiusUnits * window.__currentScale;
    this.spawnTime = config.now;
    this.duration = config.duration;
    this.casterRef = config.casterRef; // live reference to caster entity (for 150u leash)
    this.wander = new Wander(Math.PI * 2, 0.8);
    this.pierceRemaining = config.pierceCount;
    this.forkRemaining = config.forkTimes;
    this.chainRemaining = config.chainCount;
    this.splitCount = config.splitCount; // number of new projectiles when split triggers
    this.hasSplit = false;
    // Salvo grouping: base projectiles (0), then seal groups (1, 2, 3, ...)
    this.salvoGroup = config.salvoGroup || 0;
    // Damage multiplier for barrage repeats (0.6 for 40% less damage)
    this.damageMultiplier = config.damageMultiplier !== undefined ? config.damageMultiplier : 1.0;
  }
  age(now) { return (now - this.spawnTime) / 1000; }
  isExpired(now) {
    if (this.age(now) > this.duration && this.duration >= 0) return true;
    return false;
  }
  think(dt) {
    // Twisters move in straight lines; no direction changes
    // Velocity remains constant from spawn
  }
  move(dt) { this.x += this.vx * dt; this.y += this.vy * dt; }
  reflect(nx, ny) {
    // reflect velocity vector over normal
    const vdotn = this.vx * nx + this.vy * ny;
    this.vx = this.vx - 2 * vdotn * nx;
    this.vy = this.vy - 2 * vdotn * ny;
    this.angle = Math.atan2(this.vy, this.vx);
  }
  draw(ctx, colorOverride) {
    ctx.save();
    ctx.fillStyle = colorOverride || '#7cc5ff';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }
}

/** Simulation */
class Simulation {
  constructor(canvas) {
    try {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.width = canvas.width;
      this.height = canvas.height;
      this.scale = this.computeScale(); // pixels per world unit
      this.lastTime = performance.now();
      this.accum = 0;
      this.fixedDt = 1 / 120; // high fidelity physics
      this.maxTerrainStepPx = 2.0; // CCD safety step for terrain (pixels)

      // Entities (positions in pixels, radii scaled from world units)
      const cx = this.width / 2; const cy = this.height / 2;
      this.caster = new Entity(cx - 40 * this.scale, cy + 30 * this.scale, CASTER_RADIUS_UNITS * this.scale, '#4aa3ff');
      this.boss = new Entity(cx + 30 * this.scale, cy - 30 * this.scale, BOSS_RADIUS_UNITS * this.scale, '#ff6b6b');
      this.casterLeash = true;

      // State
      this.projectiles = [];
      this.running = false;
      this.castAccumulator = 0;
      this.castCooldown = 0; // computed from cast speed
      this.currentSeals = 0; // Salvo seal tracking
      this.lastSealAccumTime = 0; // for seal gain timing
      this.barrageCastSchedule = []; // scheduled barrage repeats: {time, castNumber}
      // Load from URL params first
      const __params = parseURLParams();
      const __pos = applyParamsToDOM(__params);
      this.config = this.readConfigFromDOM();
      this.arena = this.createArena(this.config.arenaType);
      // Metrics history for twister charts
      this.metrics = {
        windowSec: 10,
        samples: [], // {t, hitsTotal, hitsPerSec, dps, totalDamage, projAlive, cooldownPct}
        lastSampleAt: performance.now(),
        sampleIntervalMs: 200,
      };
      // Apply initial enemy radius from config
      this.boss.r = clamp(this.config.bossRadius || BOSS_RADIUS_UNITS, 0.1, 999) * this.scale;

      // Apply positions from URL
      if (__pos.casterWorld) {
        const p = fromWorldNorm(this, __pos.casterWorld.x, __pos.casterWorld.y);
        this.caster.x = p.x; this.caster.y = p.y;
      } else if (__pos.caster) {
        this.caster.x = __pos.caster.x * this.width; this.caster.y = __pos.caster.y * this.height;
      }
      if (__pos.bossWorld) {
        const p = fromWorldNorm(this, __pos.bossWorld.x, __pos.bossWorld.y);
        this.boss.x = p.x; this.boss.y = p.y;
      } else if (__pos.boss) {
        this.boss.x = __pos.boss.x * this.width; this.boss.y = __pos.boss.y * this.height;
      }

      // Ensure we always populate world-normalized positions in URL for sharing (prefer world coords only)
      updateURL(this);

    // Hit tracking
    this.hitsTotal = 0;
    this.totalDamage = 0;
    this.hitTimestamps = []; // for recent rate window
    this.castTargetLocks = new Map(); // key: castId+targetId -> nextAllowedHitTime
    
    // Per-cast hit tracking
    this.currentInstanceId = null; // the instance id for current full cast (includes barrage)
    this.currentCastHits = 0; // hits in current cast (including barrage repeats)
    this.castHitHistory = []; // history of max hits per cast for averaging
    this.projPerCastHistory = []; // history of max projectiles per cast
    this.completedCastInstances = new Map(); // instanceId -> { hits: count, projCount: count, completed: bool }

    // Input
    this.dragging = null; // 'caster' | 'boss'
    this.installInput();

    // UI
    this.installUI();

      requestAnimationFrame((t) => this.loop(t));
    } catch (err) {
      console.error('Simulation constructor error:', err);
      // At minimum, ensure we have a valid canvas context to draw error message
      if (this.ctx) {
        this.ctx.fillStyle = '#ff6666';
        this.ctx.font = '16px Arial';
        this.ctx.fillText('Error initializing simulation. Check console.', 20, 40);
      }
    }
  }

  // Enemy behavior helpers (separate for clarity and testability)
  applySplit(proj, nowTs) {
    const n = Math.max(1, proj.splitCount);
    for (let i = 0; i < n; i++) {
      const theta = (i / n) * TWO_PI;
      this.projectiles.push(new Projectile({
        castId: proj.castId,
        instanceId: proj.instanceId,
        barrageRepeatIndex: proj.barrageRepeatIndex,
        x: proj.x,
        y: proj.y,
        angle: theta,
        speed: proj.speed,
        now: nowTs,
        duration: Math.max(0, proj.duration - proj.age(nowTs)),
        casterRef: this.caster,
        pierceCount: proj.pierceRemaining,
        forkTimes: proj.forkRemaining,
        chainCount: proj.chainRemaining,
        splitCount: 0,
        twisterRadius: this.config.twisterRadius,
        salvoGroup: proj.salvoGroup,
        damageMultiplier: proj.damageMultiplier,
      }));
    }
    return 'remove';
  }

  applyPierce(proj, dx, dy, d) {
    proj.pierceRemaining -= 1;
    // Nudge forward to avoid persistent overlap on the rim after a pierce
    const nx = dx / (d || 1); const ny = dy / (d || 1);
    proj.x = this.boss.x + nx * (this.boss.r + proj.radius + 0.5);
    return 'keep';
  }

  applyFork(proj, nowTs) {
    const base = Math.atan2(proj.vy, proj.vx);
    const childAngles = [base + FORK_ANGLE_RAD, base - FORK_ANGLE_RAD];
    if (Math.random() * 100 < this.config.forkChance) childAngles.push(base);
    for (const a of childAngles) {
      this.projectiles.push(new Projectile({
        castId: proj.castId,
        instanceId: proj.instanceId,
        barrageRepeatIndex: proj.barrageRepeatIndex,
        x: proj.x,
        y: proj.y,
        angle: a,
        speed: proj.speed,
        now: nowTs,
        duration: Math.max(0, proj.duration - proj.age(nowTs)),
        casterRef: this.caster,
        pierceCount: proj.pierceRemaining,
        forkTimes: proj.forkRemaining - 1,
        chainCount: proj.chainRemaining,
        splitCount: 0,
        twisterRadius: this.config.twisterRadius,
        salvoGroup: proj.salvoGroup,
        damageMultiplier: proj.damageMultiplier,
      }));
    }
    return 'remove';
  }

  applyChain(proj, dx, dy, d) {
    // Behave like pierce when no alternate target exists: decrement and continue through
    if (proj.chainRemaining > 0) proj.chainRemaining -= 1;
    const nx = dx / (d || 1); const ny = dy / (d || 1);
    proj.x = this.boss.x + nx * (this.boss.r + proj.radius + 0.5);
    return 'keep';
  }

  computeScale() {
    // Fit target arena diameter inside the canvas with margin; keep scale >= 0.5 to avoid extremes
    const diameter = ARENA_RADIUS_UNITS * 2;
    const marginPx = 20;
    const sx = (this.width - marginPx * 2) / diameter;
    const sy = (this.height - marginPx * 2) / diameter;
    return Math.max(0.5, Math.min(sx, sy));
  }

  readConfigFromDOM() {
    const getNum = (id) => {
      const elem = el(id);
      return elem ? Number(elem.value) : 0;
    };
    const getSel = (id) => {
      const elem = el(id);
      return elem ? elem.value : 'circle';
    };
    return {
      arenaType: getSel('arenaType'),
      avgHit: getNum('avgHit'),
      increasedProjSpeed: getNum('projSpeedMod') || 0, // percentage increase
      projectileCount: getNum('projectileCount'),
      whirlwindStages: getNum('whirlwindStages'),
      twisterRadius: getNum('twisterRadius'),
      duration: getNum('duration'),
      pierceCount: 999, // Twisters always pierce
      forkTimes: 0,
      chainCount: 0,
      splitCount: 0,
      forkChance: 0,
      bossRadius: getNum('bossRadius') || BOSS_RADIUS_UNITS,
      maxSeals: getNum('maxSeals'),
      salvoSealCount: getNum('salvoSealCount'),
      barrageCount: getNum('barrageCount'),
      barrageTimeInterval: getNum('barrageTimeInterval'),
      timeBetweenBarrageRepeats: getNum('timeBetweenBarrageRepeats'),
      baseSealGainFrequency: getNum('baseSealGainFrequency'),
      baseProjSpeed: getNum('baseProjSpeed'),
      increasedSealGainFrequency: getNum('increasedSealGainFrequency'),
    };
  }

  createArena(type) {
    if (type === 'square') return new SquareArena(this.width, this.height, this.scale);
    if (type === 'tjunction') return new TJunctionArena(this.width, this.height, this.scale);
    return new CircleArena(this.width, this.height, this.scale);
  }

  installUI() {
    const ids = [
      'arenaType','avgHit','projSpeedMod','projectileCount','whirlwindStages','twisterRadius','duration','bossRadius','maxSeals','salvoSealCount','barrageCount','barrageTimeInterval','timeBetweenBarrageRepeats','baseSealGainFrequency','baseProjSpeed','increasedSealGainFrequency'
    ];
    for (const id of ids) {
      const elem = document.getElementById(id);
      if (elem) {
        elem.addEventListener('input', () => {
          // Ensure simulation is not running when updating config
          this.running = false;
          this.config = this.readConfigFromDOM();
          this.arena = this.createArena(this.config.arenaType);
          // live-apply enemy radius
          this.boss.r = clamp(this.config.bossRadius, 0.1, 999) * this.scale;

          // write URL params on any config change
          updateURL(this);
        });
      }
    }

    // Link barrageCount, timeBetweenBarrageRepeats, and barrageTimeInterval
    // Total Time = Number of Barrages × Time between repeats
    const barrageCountElem = document.getElementById('barrageCount');
    const timeBetweenElem = document.getElementById('timeBetweenBarrageRepeats');
    const totalTimeElem = document.getElementById('barrageTimeInterval');
    
    const updateLinkedValues = () => {
      const barrageCount = Number(barrageCountElem?.value || 0);
      const timeBetween = Number(timeBetweenElem?.value || 0);
      const totalTime = barrageCount * timeBetween;
      if (totalTimeElem) totalTimeElem.value = totalTime.toFixed(2);
      this.config = this.readConfigFromDOM();
      updateURL(this);
    };
    
    if (barrageCountElem) {
      barrageCountElem.addEventListener('input', updateLinkedValues);
    }
    if (timeBetweenElem) {
      timeBetweenElem.addEventListener('input', updateLinkedValues);
    }

    const timeScaleElem = document.getElementById('timeScale');
    if (timeScaleElem) {
      timeScaleElem.addEventListener('change', (e) => {
        const sec = Number(e.target.value);
        this.metrics.windowSec = clamp(sec, 1, 600);
        updateURL(this);
      });
    }

    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
      startBtn.addEventListener('click', () => { 
        this.running = true;
        this.castAccumulator = 0; // Reset cast accumulator to prevent immediate cast
        // Set to max seals and emit immediately
        this.currentSeals = this.config.maxSeals;
        this.emitCast(performance.now());
      });
    }
    
    const stopBtn = document.getElementById('stopBtn');
    if (stopBtn) {
      stopBtn.addEventListener('click', () => { 
        this.running = false;
        this.castAccumulator = 0; // Reset cast accumulator when stopping
      });
    }
    
    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => { this.reset(); });
    }
  }

  installInput() {
    const rect = () => this.canvas.getBoundingClientRect();
    const toCanvas = (e) => ({ x: e.clientX - rect().left, y: e.clientY - rect().top });

    this.canvas.addEventListener('mousedown', (e) => {
      const p = toCanvas(e);
      if (this.caster.contains(p.x, p.y)) { this.dragging = 'caster'; this.caster.drag = true; }
      else if (this.boss.contains(p.x, p.y)) { this.dragging = 'boss'; this.boss.drag = true; }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      const p = toCanvas(e);
      if (this.dragging === 'caster') { this.caster.x = p.x; this.caster.y = p.y; }
      if (this.dragging === 'boss') { this.boss.x = p.x; this.boss.y = p.y; }
      // update URL for positions
      updateURL(this);
    });
    window.addEventListener('mouseup', () => {
      this.dragging = null; this.caster.drag = false; this.boss.drag = false;
    });
  }

  reset() {
    this.running = false;
    this.castAccumulator = 0;
    this.projectiles = [];
    this.hitsTotal = 0;
    this.totalDamage = 0;
    this.hitTimestamps = [];
    this.castTargetLocks.clear();
    this.currentSeals = 0;
    this.lastSealAccumTime = 0;
    this.barrageCastSchedule = [];
    this.currentInstanceId = null;
    this.currentCastHits = 0;
    this.castHitHistory = [];
    this.projPerCastHistory = [];
    this.completedCastInstances.clear();
    nextCastId += 1;
  }

  // Calculate barrage repeat timing based on barrage count
  getBarrageTimingWindow(barrageCount) {
    // Data points from testing:
    // 2 barrage stacks: ~2.5 seconds
    // 3 barrage stacks: ~2.5 seconds
    // 16 barrage stacks: ~4.5 seconds
    // This represents total cast window for all repeats
    if (barrageCount <= 0) return 0;
    if (barrageCount <= 3) return 2.5;
    // Linear interpolation for barrage counts > 3
    // At 16 stacks: 4.5 seconds
    return 2.5 + (barrageCount - 3) * ((4.5 - 2.5) / (16 - 3));
  }

  // Calculate expected projectile count for a full cast instance using formula:
  // Proj Count = (1 + W + 2S)(1 + B)
  // W = whirlwind stages, S = seals, B = barrage count
  calculateExpectedProjectileCount(config, sealCount) {
    const w = config.whirlwindStages || 0;
    const s = sealCount || 0;
    const b = config.barrageCount || 0;
    const projectileCountPerCast = (1 + w + 2 * s) * (1 + b);
    return projectileCountPerCast;
  }

  // Helper: emit projectiles for a single cast instance
  // barrageRepeatIndex: 0 for main cast, 1+ for barrage repeats
  // This method is called once for the main cast and once for each barrage repeat
  // Each call emits: baseCount + (sealCount * 2) projectiles
  // sealCount: if provided, use this seal count; otherwise use current seals
  // angles: if provided, use these angles; otherwise generate random. Returns array of angles used if barrageRepeatIndex === 0
  emitCastProjectiles(castId, now, barrageRepeatIndex = 0, sealCount = null, angles = null, instanceId = null) {
    const cfg = this.config;
    // With Salvo: fire base projectiles + stages + 2 per seal consumed
    // Base: projectileCount + whirlwindStages
    // Seals: 2 projectiles per seal
    // Total per emission: (1 + W + 2S)
    // This gets emitted (1 + B) times total (once for main, once for each barrage)
    // Overall per cast instance: (1 + W + 2S) * (1 + B)
    const projectilesPerSeal = 2;
    // Base projectiles: 1 (base) + W (whirlwind stages)
    // cfg.projectileCount represents the base count which should contribute to the 1
    const baseCount = 1 + (cfg.whirlwindStages || 0);
    const actualSealCount = sealCount !== null ? sealCount : this.currentSeals;
    
    // Calculate effective projectile speed with increased modifier
    const increasePercent = (this.config.increasedProjSpeed || 0) / 100;
    const effectiveSpeed = (this.config.baseProjSpeed || 75) * (1 + increasePercent);
    
    // Calculate damage multiplier: 80% more damage per whirlwind stage (stacks additively)
    // 0 stages = 1.0x, 1 stage = 1.8x, 2 stages = 2.6x, 3 stages = 3.4x, etc.
    const whirlwindDamageMultiplier = 1.0 + (cfg.whirlwindStages || 0) * 0.8;
    
    // If this is the main cast (barrageRepeatIndex === 0) and no angles provided, generate and track them
    const capturedAngles = (barrageRepeatIndex === 0 && !angles) ? [] : null;
    let angleIdx = 0;
    
    // Fire base projectiles (group 0)
    for (let i = 0; i < baseCount; i++) {
      const angle = angles ? angles[angleIdx++] : randRange(0, TWO_PI);
      if (capturedAngles) capturedAngles.push(angle);
      // Apply barrage repeat damage reduction if needed, combined with whirlwind boost
      const barrageMultiplier = barrageRepeatIndex > 0 ? 0.55 : 1.0; // 45% less damage for repeats
      const damageMultiplier = barrageMultiplier * whirlwindDamageMultiplier;
      this.projectiles.push(new Projectile({
        castId,
        instanceId,
        barrageRepeatIndex,
        x: this.caster.x,
        y: this.caster.y,
        angle,
        speed: effectiveSpeed * this.scale, // convert to pixels per second
        now,
        duration: this.config.duration,
        casterRef: this.caster,
        pierceCount: this.config.pierceCount,
        forkTimes: this.config.forkTimes,
        chainCount: this.config.chainCount,
        splitCount: this.config.splitCount,
        twisterRadius: this.config.twisterRadius,
        salvoGroup: 0, // base projectiles
        damageMultiplier,
      }));
    }
    
    // Fire seal projectiles (groups 1, 2, 3, ...)
    for (let sealIdx = 0; sealIdx < actualSealCount; sealIdx++) {
      for (let i = 0; i < projectilesPerSeal; i++) {
        const angle = angles ? angles[angleIdx++] : randRange(0, TWO_PI);
        if (capturedAngles) capturedAngles.push(angle);
        // Apply barrage repeat damage reduction if needed, combined with whirlwind boost
        const barrageMultiplier = barrageRepeatIndex > 0 ? 0.55 : 1.0; // 45% less damage for repeats
        const damageMultiplier = barrageMultiplier * whirlwindDamageMultiplier;
        this.projectiles.push(new Projectile({
          castId,
          instanceId,
          barrageRepeatIndex,
          x: this.caster.x,
          y: this.caster.y,
          angle,
          speed: effectiveSpeed * this.scale, // convert to pixels per second
          now,
          duration: this.config.duration,
          casterRef: this.caster,
          pierceCount: this.config.pierceCount,
          forkTimes: this.config.forkTimes,
          chainCount: this.config.chainCount,
          splitCount: this.config.splitCount,
          twisterRadius: this.config.twisterRadius,
          salvoGroup: sealIdx + 1, // seal groups start at 1
          damageMultiplier,
        }));
      }
    }
    
    // Return captured angles and projectile count for barrage repeats to use
    const projCount = baseCount + (actualSealCount * projectilesPerSeal);
    return { angles: capturedAngles, projCount };
  }

  emitCast(now) {
    const cfg = this.config;
    const castId = nextCastId++;
    const instanceId = castId; // use castId as the instance identifier
    
    // Track the instance and reset hits for this cast
    this.currentInstanceId = instanceId;
    this.currentCastHits = 0;
    // Register this instance in the tracking map
    this.completedCastInstances.set(instanceId, { hits: 0, projCount: 0, completed: false });
    
    // Emit main cast and capture the angles and projectile count
    const castResult = this.emitCastProjectiles(castId, now, 0, null, null, instanceId);
    const castAngles = castResult.angles;
    const projCountPerEmission = castResult.projCount;
    
    // Add main cast projectile count to instance total
    this.completedCastInstances.get(instanceId).projCount += projCountPerEmission;
    
    // Schedule barrage repeats if enabled
    if (cfg.barrageCount > 0) {
      // Use timeBetweenBarrageRepeats to space repeats
      const timeBetweenRepeats = cfg.timeBetweenBarrageRepeats || 0.15;
      // Capture the seal count for all repeats to use
      const castSealCount = this.currentSeals;
      // Space each repeat based on timeBetweenBarrageRepeats
      for (let repeatIdx = 1; repeatIdx <= cfg.barrageCount; repeatIdx++) {
        // Space repeats linearly: first repeat at timeBetweenRepeats, second at 2x, etc.
        const repeatTime = timeBetweenRepeats * repeatIdx;
        const repeatTimeMs = repeatTime * 1000;
        // Each barrage repeat gets a unique castId for independent hit groups
        const barrageRepeatCastId = nextCastId++;
        this.barrageCastSchedule.push({
          time: now + repeatTimeMs,
          castId: barrageRepeatCastId,
          instanceId: instanceId,
          barrageRepeatIndex: repeatIdx,
          sealCount: castSealCount,
          angles: castAngles,
        });
      }
    }
    
    // Consume all seals after casting
    this.currentSeals = 0;
  }

  tryApplyHit(proj, now) {
    // Per-group cooldown: each barrage repeat + each seal group combination is independent
    // Key: instanceId | barrageRepeatIndex | salvoGroup | targetId
    const targetId = 'boss';
    const key = proj.instanceId + '|' + proj.barrageRepeatIndex + '|' + proj.salvoGroup + '|' + targetId;
    const nextOk = this.castTargetLocks.get(key) || 0;
    if (now >= nextOk) {
      this.hitsTotal += 1;
      const damage = this.config.avgHit * (proj.damageMultiplier || 1.0);
      this.totalDamage += damage;
      this.hitTimestamps.push(now);
      
      // Track hits for current full cast instance (including barrage repeats)
      if (proj.instanceId === this.currentInstanceId) {
        this.currentCastHits += 1;
      }
      
      // Also update the tracking map for this instance
      if (this.completedCastInstances.has(proj.instanceId)) {
        const entry = this.completedCastInstances.get(proj.instanceId);
        entry.hits = Math.max(entry.hits, this.currentCastHits); // track max hits
      }
      
      this.castTargetLocks.set(key, now + PER_CAST_TARGET_COOLDOWN * 1000);
      return true;
    }
    return false;
  }

  getGroupColor(salvoGroup, onCooldown = false) {
    // Return highly distinct colors for each salvo group
    // Bright colors when on cooldown (hit just occurred), dimmed/dark when idle
    const brightColors = [
      '#00FFFF',  // Group 0 (base) - bright cyan
      '#00FF00',  // Group 1 (seal 1) - bright lime green
      '#FFFF00',  // Group 2 (seal 2) - bright yellow
      '#FF1493',  // Group 3 (seal 3) - deep pink/magenta
      '#FF6600',  // Group 4+ - bright orange
    ];
    const dimmColors = [
      '#004466',  // Group 0 (base) - dark teal
      '#004400',  // Group 1 (seal 1) - dark green
      '#666600',  // Group 2 (seal 2) - dark olive/yellow
      '#660033',  // Group 3 (seal 3) - dark pink
      '#663300',  // Group 4+ - dark orange/brown
    ];
    const colors = onCooldown ? brightColors : dimmColors;
    if (salvoGroup < colors.length) {
      return colors[salvoGroup];
    }
    return colors[colors.length - 1];
  }

  handleProjectileEnemyCollision(proj, now) {
    // Check circle overlap
    const dx = proj.x - this.boss.x; const dy = proj.y - this.boss.y;
    const d = Math.hypot(dx, dy);
    if (d <= proj.radius + this.boss.r) {
      const hitRegistered = this.tryApplyHit(proj, now);
      if (hitRegistered) {
        // Only one behavior can occur per collision; priority: Split -> Pierce -> Fork -> Chain

        // 1) Split (even 360° emission).
        if (!proj.hasSplit && proj.splitCount > 0) {
          proj.hasSplit = true;
          return this.applySplit(proj, performance.now());
        }

        // 2) Pierce
        if (proj.pierceRemaining > 0) {
          return this.applyPierce(proj, dx, dy, d);
        }

        // 3) Fork
        if (proj.forkRemaining > 0) {
          return this.applyFork(proj, performance.now());
        }

        // 4) Chain (no other enemy → behave like pierce)
        if (proj.chainRemaining > 0) {
          return this.applyChain(proj, dx, dy, d);
        }

        // No remaining behaviors -> absorbed on hit
        return 'remove';
      } else {
        // No hit registered due to per-cast cooldown; pass through without behaviors
      }
    }
    return 'keep';
  }

  attemptBehavioursOnTerrainCollision(proj) {
    // Behaviors (split/pierce/fork/chain) are enemy-only in this sim. Terrain only reflects.
    return 'keep';
  }

  step(dt) {
    const now = performance.now();

    // Seal accumulation (Salvo mechanic)
    if (this.running) {
      this.lastSealAccumTime += dt;
      // Calculate effective seal gain frequency with increased modifier
      const baseSealFreq = this.config.baseSealGainFrequency;
      const increasePercent = (this.config.increasedSealGainFrequency || 0) / 100;
      const effectiveSealFreq = baseSealFreq * (1 + increasePercent);
      const sealAccumInterval = 1.0 / effectiveSealFreq; // time between seals
      while (this.lastSealAccumTime >= sealAccumInterval && this.currentSeals < this.config.maxSeals) {
        this.lastSealAccumTime -= sealAccumInterval;
        this.currentSeals += 1;
      }
      
      // Cast when we have enough seals (based on salvoSealCount config)
      // If salvoSealCount is 0, treat it as 1 for timing purposes
      this.castAccumulator += dt;
      const sealThreshold = this.config.salvoSealCount === 0 ? 1 : this.config.salvoSealCount;
      while (this.castAccumulator >= 0.01 && this.currentSeals >= sealThreshold) {
        this.castAccumulator -= 0.01;
        this.emitCast(now);
      }
      
      // Process scheduled barrage repeats
      for (let i = this.barrageCastSchedule.length - 1; i >= 0; i--) {
        const scheduled = this.barrageCastSchedule[i];
        if (now >= scheduled.time) {
          // Time to emit this barrage repeat with the same angles as the original cast
          const barrageResult = this.emitCastProjectiles(scheduled.castId, scheduled.time, scheduled.barrageRepeatIndex, scheduled.sealCount, scheduled.angles, scheduled.instanceId);
          // Add barrage repeat projectile count to instance total
          if (this.completedCastInstances.has(scheduled.instanceId)) {
            this.completedCastInstances.get(scheduled.instanceId).projCount += barrageResult.projCount;
          }
          this.barrageCastSchedule.splice(i, 1);
        }
      }
    }

    // Update projectiles with sub-stepped CCD (prevents tunneling at high speeds)
    const survivors = [];
    for (const proj of this.projectiles) {
      if (proj.isExpired(now)) continue;
      proj.think(dt);

      const speed = Math.hypot(proj.vx, proj.vy);
      const totalDist = speed * dt;
      const steps = Math.max(1, Math.ceil(totalDist / this.maxTerrainStepPx));
      const subdt = dt / steps;

      let removed = false;
      for (let s = 0; s < steps && !removed; s++) {
        // CCD vs boss within substep
        const dx = proj.vx * subdt;
        const dy = proj.vy * subdt;
        const R = proj.radius + this.boss.r;
        const tHit = sweptCircleHitT(proj.x, proj.y, dx, dy, this.boss.x, this.boss.y, R);
        if (tHit !== null) {
          proj.x += dx * tHit;
          proj.y += dy * tHit;
          const collisionTimeMs = now + (s * subdt + subdt * tHit) * 1000;
          const enemyRes = this.handleProjectileEnemyCollision(proj, collisionTimeMs);
          if (enemyRes === 'remove') { removed = true; break; }
          const remainFrac = 1 - tHit;
          if (remainFrac > 0) {
            proj.move(subdt * remainFrac);
          }
        } else {
          proj.move(subdt);
        }

        // Terrain collision (reflect). Use swept test against T-junction segments if applicable
        if (this.arena instanceof TJunctionArena) {
          // Exact TOI: moving circle vs each wall capsule (segment thickened by radius)
          const dx = proj.vx * subdt; const dy = proj.vy * subdt;
          const p0x = proj.x - dx, p0y = proj.y - dy;
          let best = null;
          for (const seg of this.arena.segments) {
            const hit = sweptCircleSegmentTOI(p0x, p0y, dx, dy, seg.x1, seg.y1, seg.x2, seg.y2, proj.radius);
            if (hit && hit.t >= 0 && hit.t <= 1) {
              if (!best || hit.t < best.t) best = hit;
            }
          }
          if (best) {
            // advance to contact and reflect by provided normal
            proj.x = p0x + dx * best.t + best.nx * (proj.radius * 1.001);
            proj.y = p0y + dy * best.t + best.ny * (proj.radius * 1.001);
            proj.reflect(best.nx, best.ny);
          } else {
            // no terrain hit in substep
          }
        } else {
          const hit = this.arena.collideCircle(proj.x, proj.y, proj.radius);
          if (hit.hit) {
            proj.x = hit.x; proj.y = hit.y;
            if (hit.reflect) proj.reflect(hit.nx, hit.ny);
            const res = this.attemptBehavioursOnTerrainCollision(proj);
            if (res === 'remove') { removed = true; break; }
          }
        }
      }
      if (removed) continue;

      survivors.push(proj);
    }
    this.projectiles = survivors;

    // Cleanup old hit timestamps beyond 5s window
    const windowMs = 5000;
    const cutoff = now - windowMs;
    while (this.hitTimestamps.length && this.hitTimestamps[0] < cutoff) this.hitTimestamps.shift();

    // Check if cast instances are complete (no projectiles from that instance remain)
    for (const [instanceId, entry] of this.completedCastInstances) {
      if (!entry.completed) {
        const hasProjectilesFromInstance = this.projectiles.some(p => p.instanceId === instanceId);
        if (!hasProjectilesFromInstance) {
          // All projectiles from this instance are gone, mark as complete
          entry.completed = true;
          this.castHitHistory.push(entry.hits);
          this.projPerCastHistory.push(entry.projCount);
          // Keep only last 10 cast histories for averaging
          if (this.castHitHistory.length > 10) {
            this.castHitHistory.shift();
          }
          if (this.projPerCastHistory.length > 10) {
            this.projPerCastHistory.shift();
          }
        }
      }
    }
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // Arena
    this.arena.draw(ctx);

    // Leash radius removed

    // Entities
    this.caster.draw(ctx);
    this.boss.draw(ctx);

    // Projectiles: bright group color when hit (on cooldown), dimmed when idle
    for (const p of this.projectiles) {
      const key = p.instanceId + '|' + p.barrageRepeatIndex + '|' + p.salvoGroup + '|boss';
      const nextOk = this.castTargetLocks.get(key) || 0;
      const onCooldown = performance.now() < nextOk;
      const color = this.getGroupColor(p.salvoGroup, onCooldown);
      p.draw(ctx, color);
    }

    // Legend
    ctx.save();
    ctx.fillStyle = '#a8b0c0';
    ctx.font = '12px ui-sans-serif, system-ui, -apple-system';
    ctx.fillText('Caster', this.caster.x + 12, this.caster.y + 4);
    ctx.fillText('Boss', this.boss.x + 24, this.boss.y + 4);
    ctx.restore();

    // Update distance display
    this.updateDistanceDisplay();
  }

  updateDistanceDisplay() {
    // Calculate distance between caster and boss in world units
    const dx = this.boss.x - this.caster.x;
    const dy = this.boss.y - this.caster.y;
    const distancePixels = Math.hypot(dx, dy);
    
    // Convert from pixels to world units (scale is pixels per world unit)
    const distanceUnits = distancePixels / this.scale;
    
    // Convert units to meters (10 units = 1 meter)
    const distanceMeters = distanceUnits / 10;
    
    // Update the display
    const distanceValueElem = document.getElementById('distanceValue');
    const distanceMetersElem = document.getElementById('distanceMeters');
    
    if (distanceValueElem) {
      distanceValueElem.textContent = distanceUnits.toFixed(1) + ' U';
    }
    if (distanceMetersElem) {
      distanceMetersElem.textContent = distanceMeters.toFixed(2) + ' m';
    }
  }

  updateStats() {
    // Update seal display
    const sealDisplay = document.getElementById('currentSealsDisplay');
    if (sealDisplay) {
      sealDisplay.textContent = `${this.currentSeals} / ${this.config.maxSeals}`;
    }
    
    const hitsPerSec = this.hitTimestamps.length / 5;
    document.getElementById('hitsTotal').textContent = formatShortNumber(this.hitsTotal, 1);
    document.getElementById('hitsPerSec').textContent = hitsPerSec.toFixed(2);
    const dps = hitsPerSec * this.config.avgHit;
    document.getElementById('dps').textContent = formatShortNumber(dps, 1);
    document.getElementById('totalDmg').textContent = formatShortNumber(this.totalDamage, 1);
    document.getElementById('projAlive').textContent = formatShortNumber(this.projectiles.length, 0);
    
    // Calculate and display expected total projectiles using formula: (1 + W + 2S)(1 + B)
    // W = whirlwind stages, S = seals waited for (salvoSealCount), B = barrage count
    const expectedProjCount = this.calculateExpectedProjectileCount(this.config, this.config.salvoSealCount);
    const expectedTotalDiv = document.getElementById('expectedTotalProj');
    expectedTotalDiv.textContent = expectedProjCount;
    
    // Display last 5 completed casts (or fewer if less than 5 exist)
    const last5Casts = this.castHitHistory.slice(-5);
    const hitsPerCastDiv = document.getElementById('hitsPerCast');
    if (last5Casts.length > 0) {
      hitsPerCastDiv.textContent = last5Casts.map(h => h).join(', ');
    } else {
      hitsPerCastDiv.textContent = '-';
    }
    
    // Display last 5 projectiles per cast and verify against expected
    const last5ProjPerCast = this.projPerCastHistory.slice(-5);
    const projPerCastDiv = document.getElementById('projPerCast');
    if (last5ProjPerCast.length > 0) {
      const projPerCastText = last5ProjPerCast.map(p => p).join(', ');
      projPerCastDiv.textContent = projPerCastText;
      // Verify the most recent completed cast matches expected
      const mostRecentProj = last5ProjPerCast[last5ProjPerCast.length - 1];
      if (mostRecentProj !== expectedProjCount) {
        projPerCastDiv.title = `Expected: ${expectedProjCount}, Got: ${mostRecentProj} - MISMATCH`;
        projPerCastDiv.style.color = '#ff6b6b'; // red for mismatch
      } else {
        projPerCastDiv.title = 'Matches expected formula';
        projPerCastDiv.style.color = '#7cc5ff'; // normal blue
      }
    } else {
      projPerCastDiv.textContent = '-';
      projPerCastDiv.style.color = '#7cc5ff';
    }
    
    // Display percentage of total projectiles hit per cast (last 5)
    const last5HitsPerCast = this.castHitHistory.slice(-5);
    const last5ProjPerCastForPercent = this.projPerCastHistory.slice(-5);
    const percentHitPerCastDiv = document.getElementById('percentHitPerCast');
    if (last5HitsPerCast.length > 0 && last5ProjPerCastForPercent.length > 0 && last5HitsPerCast.length === last5ProjPerCastForPercent.length) {
      const percentages = [];
      for (let i = 0; i < last5HitsPerCast.length; i++) {
        const hits = last5HitsPerCast[i];
        const projs = last5ProjPerCastForPercent[i];
        if (projs > 0) {
          const percent = ((hits / projs) * 100).toFixed(1);
          percentages.push(percent + '%');
        }
      }
      percentHitPerCastDiv.textContent = percentages.length > 0 ? percentages.join(', ') : '-';
    } else {
      percentHitPerCastDiv.textContent = '-';
    }
    
    // Display average hits over last 10 casts
    let avgHits = 0;
    if (this.castHitHistory.length > 0) {
      const totalHits = this.castHitHistory.reduce((a, b) => a + b, 0);
      avgHits = totalHits / this.castHitHistory.length;
    }
    document.getElementById('avgHitsPerCast').textContent = avgHits.toFixed(1);
    
    this.updateCharts(hitsPerSec, dps);
  }

  updateCharts(hitsPerSec, dps) {
    const now = performance.now();
    if (now - this.metrics.lastSampleAt >= this.metrics.sampleIntervalMs) {
      this.metrics.lastSampleAt = now;
      this.metrics.samples.push({
        t: now,
        hitsTotal: this.hitsTotal,
        hitsPerSec,
        dps,
        totalDamage: this.totalDamage,
        projAlive: this.projectiles.length,
      });
      // drop old samples beyond window
      const cutoff = now - this.metrics.windowSec * 1000;
      while (this.metrics.samples.length && this.metrics.samples[0].t < cutoff) this.metrics.samples.shift();
    }

    const s = this.metrics.samples;
    this.drawSpark('sparkHits', s.map(p => p.hitsTotal));
    this.drawSpark('sparkRate', s.map(p => p.hitsPerSec));
    this.drawSpark('sparkDps', s.map(p => p.dps));
    this.drawSpark('sparkDmg', s.map(p => p.totalDamage));
    this.drawSpark('sparkAlive', s.map(p => p.projAlive));
  }

  drawSpark(canvasId, values) {
    const c = document.getElementById(canvasId);
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width; const h = c.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    // grid baseline
    ctx.strokeStyle = '#2a3146';
    ctx.beginPath();
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
    ctx.stroke();

    if (values.length < 2) { ctx.restore(); return; }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    ctx.strokeStyle = '#7cc5ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < values.length; i++) {
      const x = (i / (values.length - 1)) * (w - 1);
      const y = h - ((values[i] - min) / span) * (h - 1) - 1;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  loop(t) {
    const now = t;
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    // Clamp dt to avoid spiral after tab switch
    dt = Math.min(dt, 0.05);
    this.accum += dt;
    while (this.accum >= this.fixedDt) {
      this.step(this.fixedDt);
      this.accum -= this.fixedDt;
    }
    this.draw();
    this.updateStats();
    requestAnimationFrame((t2) => this.loop(t2));
  }
}

// Bootstrap
window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('canvas');
  // Fit canvas to container size
  const parent = canvas.parentElement;
  const resize = () => {
    const rect = parent.getBoundingClientRect();
    canvas.width = Math.floor(rect.width);
    canvas.height = Math.floor(rect.height);
    // Recreate sim to rescale arenas while preserving entities
    if (window.__sim) {
      const prev = window.__sim;
      const sim = new Simulation(canvas);
      const ratio = sim.scale / prev.scale;
      // propagate scale globally for projectile radius construction
      window.__currentScale = sim.scale;
      // Rescale entities using world-space relative to center to handle aspect changes
      const prevCenterX = prev.width / 2, prevCenterY = prev.height / 2;
      const newCenterX = sim.width / 2, newCenterY = sim.height / 2;
      const toWorldUnits = (px, py) => ({ ux: (px - prevCenterX) / prev.scale, uy: (py - prevCenterY) / prev.scale });
      const toScreen = (ux, uy) => ({ x: newCenterX + ux * sim.scale, y: newCenterY + uy * sim.scale });

      const cWU = toWorldUnits(prev.caster.x, prev.caster.y);
      const cPX = toScreen(cWU.ux, cWU.uy);
      sim.caster.x = cPX.x; sim.caster.y = cPX.y;
      const bWU = toWorldUnits(prev.boss.x, prev.boss.y);
      const bPX = toScreen(bWU.ux, bWU.uy);
      sim.boss.x = bPX.x; sim.boss.y = bPX.y;
      if (prev.running) {
        // If actively resizing while running, reset to avoid unstable state
        sim.projectiles = [];
        sim.hitsTotal = 0;
        sim.totalDamage = 0;
        sim.hitTimestamps = [];
        sim.castTargetLocks.clear();
        sim.running = true;
      } else {
        // Carry-over projectiles with rescale when paused
        sim.projectiles = prev.projectiles.map(p => {
          const w = toWorldUnits(p.x, p.y);
          const mapped = toScreen(w.ux, w.uy);
          p.x = mapped.x; p.y = mapped.y;
          p.vx *= ratio; p.vy *= ratio;
          p.speed *= ratio;
          p.radius = (p.twisterRadiusUnits || PROJ_RADIUS_UNITS) * sim.scale;
          return p;
        });
        sim.running = prev.running;
      }
      window.__sim = sim;
    }
  };
  window.addEventListener('resize', resize);
  window.__sim = new Simulation(canvas);
  window.__currentScale = window.__sim.scale;
  resize();

  // Initialize collapsible sections
  initializeCollapsibles();
});

function initializeCollapsibles() {
  const skillBehaviourToggle = el('skillBehaviourToggle');
  const skillBehaviourContent = el('skillBehaviourContent');

  if (skillBehaviourToggle && skillBehaviourContent) {
    // Load saved state from localStorage, default to collapsed
    const isExpanded = localStorage.getItem('skillBehaviourCollapsed') === 'false';
    if (!isExpanded) {
      skillBehaviourToggle.classList.add('collapsed');
      skillBehaviourContent.classList.add('collapsed');
    }

    // Toggle on click
    skillBehaviourToggle.addEventListener('click', () => {
      skillBehaviourToggle.classList.toggle('collapsed');
      skillBehaviourContent.classList.toggle('collapsed');
      const collapsed = skillBehaviourToggle.classList.contains('collapsed');
      localStorage.setItem('skillBehaviourCollapsed', collapsed);
    });
  }

  // Add validation for salvoSealCount - correct 0 to 1
  const salvoSealCountInput = el('salvoSealCount');
  if (salvoSealCountInput) {
    salvoSealCountInput.addEventListener('change', () => {
      const value = parseInt(salvoSealCountInput.value, 10);
      if (isNaN(value) || value < 1) {
        salvoSealCountInput.value = 1;
      }
    });
  }
}


