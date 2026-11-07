import { WebcamClient, WebEyeTrackProxy } from 'webeyetrack';

// ======================= Config =======================
const STORAGE_KEY = 'webeyetrack-demo-model-v3';

const GRID9 = [[.08,.08],[.5,.08],[.92,.08],[.08,.5],[.5,.5],[.92,.5],[.08,.92],[.5,.92],[.92,.92]];
const GRID5 = [[.08,.08],[.92,.08],[.5,.5],[.08,.92],[.92,.92]];

// Three passes: still, rotate the head, change distance. The model can only
// compensate for head poses it has seen during calibration.
const PASSES = [
  { points: GRID9, samples: 15, text: 'Look at each dot. Keep your head still.' },
  { points: GRID5, samples: 40, text: 'Look at each dot while slowly turning and tilting your head a little.' },
  { points: GRID5, samples: 40, text: 'Look at each dot while slowly leaning a little closer, then a little farther.' },
];
const INTRO_PAUSE_MS = 2200;      // time to read each pass's instruction
const SETTLE_MS = 700;            // let the eyes land on a new dot
const COLLECT_TIMEOUT_MS = 6000;

const LAMBDAS = [0.001, 0.01, 0.1, 1];  // ridge strengths; the best is chosen automatically
const LEARN_FROM_CLICKS = true;
const CLICK_WEIGHT = 3;

// Minimum spread used when judging "outside calibrated range". faceOrigin3D is
// assumed to be in cm; if your logged values look different, adjust these.
const MIN_SD = { head: 0.03, origin: 1.0 };
const COVERAGE_Z = 3.5;

// Feature vector layout
// 0 bias | 1,2 normPog x,y | 3-5 headVector | 6-8 faceOrigin3D | 9,10 normPog * depth
const SD_FLOOR = [0, 1e-3, 1e-3, MIN_SD.head, MIN_SD.head, MIN_SD.head,
                  MIN_SD.origin, MIN_SD.origin, MIN_SD.origin, 1e-3, 1e-3];
const N_FEAT = SD_FLOOR.length;

// ======================= DOM / state =======================
const $ = id => document.getElementById(id);
const statusEl = $('status'), gazeEl = $('gaze'), calibEl = $('calib'),
      targetEl = $('target'), calibMsg = $('calibMsg');
const startBtn = $('startBtn'), calibBtn = $('calibBtn'), resetBtn = $('resetBtn');

let client = null, proxy = null, sink = null, model = null, calibrating = false;
let lastF = null, lastFTime = 0, misses = 0, loggedFirst = false;

let lastStatus = '';
const setStatus = t => { if (t !== lastStatus) { lastStatus = t; statusEl.textContent = t; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp01 = v => Math.min(Math.max(v, 0), 1);

// ======================= Linear algebra =======================
function solve(A, b) {                       // Gaussian elimination, mutates A and b
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}
const dot = (w, z) => w.reduce((s, wi, i) => s + wi * z[i], 0);

// Normal equations for both screen axes at once.
function accumulate(Z, yx, yy, w) {
  const n = Z[0].length;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const bx = new Array(n).fill(0), by = new Array(n).fill(0);
  let W = 0;
  for (let k = 0; k < Z.length; k++) {
    const wk = w ? w[k] : 1, z = Z[k];
    W += wk;
    for (let i = 0; i < n; i++) {
      bx[i] += wk * z[i] * yx[k];
      by[i] += wk * z[i] * yy[k];
      for (let j = 0; j < n; j++) A[i][j] += wk * z[i] * z[j];
    }
  }
  return { A, bx, by, W };
}

// Ridge penalty scales with the total sample weight so lambda means the same
// thing whether you have 300 samples or 3000. The bias is not penalized.
function solveRidge(A, b, lambda, W) {
  const M = A.map((row, i) => row.map((v, j) => v + (i > 0 && i === j ? lambda * W : 0)));
  return solve(M, b.slice());
}

// ======================= Features =======================
function features(result) {
  if (!result || result.gazeState === 'closed') return null;       // blink
  const p = result.normPog, h = result.headVector, o = result.faceOrigin3D;
  const ok = (a, n) => a && a.length >= n && Array.from(a).slice(0, n).every(Number.isFinite);
  if (!ok(p, 2) || !ok(h, 3) || !ok(o, 3)) return null;
  const [nx, ny] = p;
  return [1, nx, ny, h[0], h[1], h[2], o[0], o[1], o[2], nx * o[2], ny * o[2]];
}

function computeStats(X) {
  const mu = new Array(N_FEAT).fill(0), sd = new Array(N_FEAT).fill(1);
  for (let i = 1; i < N_FEAT; i++) {
    mu[i] = X.reduce((s, r) => s + r[i], 0) / X.length;
    const v = X.reduce((s, r) => s + (r[i] - mu[i]) ** 2, 0) / X.length;
    sd[i] = Math.max(Math.sqrt(v), SD_FLOOR[i]);
  }
  return { mu, sd };
}
const standardize = (f, m) => f.map((v, i) => (i === 0 ? 1 : (v - m.mu[i]) / m.sd[i]));

// ======================= Model =======================
function resolveModel(m) {
  m.wx = solveRidge(m.A, m.bx, m.lambda, m.W);
  m.wy = solveRidge(m.A, m.by, m.lambda, m.W);
}
function predict(m, f) {
  const z = standardize(f, m);
  return [dot(m.wx, z), dot(m.wy, z)];
}
function addSample(m, f, px, py, weight) {
  const z = standardize(f, m);
  for (let i = 0; i < N_FEAT; i++) {
    m.bx[i] += weight * z[i] * px;
    m.by[i] += weight * z[i] * py;
    for (let j = 0; j < N_FEAT; j++) m.A[i][j] += weight * z[i] * z[j];
  }
  m.W += weight;
}

// Leave-one-location-out validation: hold out every sample taken at one dot
// location, train on the rest, measure the error there. Pessimistic for corner
// dots (they must be extrapolated), but fair for comparing settings.
function validate(Z, yx, yy, groups, lambda) {
  let sum = 0, cnt = 0;
  for (const g of new Set(groups)) {
    const tr = [], te = [];
    groups.forEach((gi, k) => (gi === g ? te : tr).push(k));
    if (!tr.length || !te.length) continue;
    const { A, bx, by, W } = accumulate(tr.map(k => Z[k]), tr.map(k => yx[k]), tr.map(k => yy[k]));
    const wx = solveRidge(A, bx, lambda, W), wy = solveRidge(A, by, lambda, W);
    for (const k of te) {
      const ex = (dot(wx, Z[k]) - yx[k]) * innerWidth;
      const ey = (dot(wy, Z[k]) - yy[k]) * innerHeight;
      sum += Math.hypot(ex, ey); cnt++;
    }
  }
  return cnt ? sum / cnt : Infinity;
}

function buildModel(samples) {
  const X = samples.map(s => s.f);
  const { mu, sd } = computeStats(X);
  const Z = X.map(f => standardize(f, { mu, sd }));
  const yx = samples.map(s => s.px), yy = samples.map(s => s.py);
  const groups = samples.map(s => s.px + ',' + s.py);

  let best = null;
  for (const lambda of LAMBDAS) {
    const err = validate(Z, yx, yy, groups, lambda);
    if (!best || err < best.err) best = { lambda, err };
  }
  const { A, bx, by, W } = accumulate(Z, yx, yy);
  const m = { v: 3, mu, sd, lambda: best.lambda, valErr: best.err, A, bx, by, W };
  resolveModel(m);
  return m;
}

function saveModel() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(model)); } catch {} }
function loadModel() {
  try {
    const m = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (m && m.v === 3 && m.A && m.A.length === N_FEAT && m.wx && m.wy) return m;
  } catch {}
  return null;
}

// Is the current head pose / distance inside what calibration covered?
function outOfRange(m, f) {
  let worst = 0, idx = -1;
  for (let i = 3; i <= 8; i++) {
    const z = Math.abs((f[i] - m.mu[i]) / m.sd[i]);
    if (z > worst) { worst = z; idx = i; }
  }
  return worst > COVERAGE_Z ? idx : -1;
}
function rangeMessage(i) {
  if (i === 8) return 'Your distance from the screen changed too much. Move back, or recalibrate.';
  if (i >= 6) return 'Your head moved too far off its calibrated position. Re-center, or recalibrate.';
  return 'Your head is turned beyond the calibrated range. Face the screen, or recalibrate.';
}

// ======================= One Euro filter (steady when still, quick when moving) =======================
const lowpass = (a, prev, x) => a * x + (1 - a) * prev;
const alphaFor = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);
class OneEuro {
  constructor(minCutoff = 0.8, beta = 0.01, dCutoff = 1.0) {
    Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: null });
  }
  filter(v, t) {
    if (this.t === null) { this.t = t; this.x = v; return v; }
    const dt = Math.max(t - this.t, 1e-3); this.t = t;
    this.dx = lowpass(alphaFor(this.dCutoff, dt), this.dx, (v - this.x) / dt);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x = lowpass(alphaFor(cutoff, dt), this.x, v);
    return this.x;
  }
}
let fx = new OneEuro(), fy = new OneEuro();

// ======================= Gaze display =======================
function show(f) {
  let x, y;
  if (model) {
    const [px, py] = predict(model, f);
    x = clamp01(px) * innerWidth; y = clamp01(py) * innerHeight;
  } else {                                   // uncorrected tracker output
    x = clamp01(f[1] + 0.5) * innerWidth; y = clamp01(f[2] + 0.5) * innerHeight;
  }
  const t = performance.now() / 1000;
  gazeEl.style.transform = `translate(${fx.filter(x, t)}px, ${fy.filter(y, t)}px)`;
  if (model) {
    const bad = outOfRange(model, f);
    gazeEl.style.opacity = bad >= 0 ? 0.15 : 0.55;
    setStatus(bad >= 0 ? rangeMessage(bad) : 'Tracking.');
  }
}

function onGaze(result) {
  if (!loggedFirst && result) {              // lets you check the real field values
    loggedFirst = true;
    console.log('First GazeResult:', result);
    console.log('headVector:', result.headVector, 'faceOrigin3D:', result.faceOrigin3D, 'normPog:', result.normPog);
  }
  const f = features(result);
  if (!f) {
    if (!sink && ++misses > 30) setStatus('No face detected, or head data missing. Face the camera in good light.');
    return;
  }
  misses = 0; lastF = f; lastFTime = performance.now();
  if (sink) sink(f); else show(f);
}

// ======================= Start =======================
async function start() {
  startBtn.disabled = true;
  try {                                      // ask for the camera explicitly so the prompt appears
    setStatus('Requesting camera…');
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach(t => t.stop());
  } catch (err) {
    setStatus(`Camera error: ${err.name} - ${err.message}`);
    startBtn.disabled = false; return;
  }
  try {
    setStatus('Starting WebEyeTrack…');
    client = new WebcamClient('video');
    proxy = new WebEyeTrackProxy(client);
    proxy.onGazeResults = onGaze;
  } catch (err) {
    console.error(err);
    setStatus('Could not start: ' + (err.message || err));
    startBtn.disabled = false; return;
  }
  model = loadModel();
  gazeEl.style.display = 'block';
  calibBtn.disabled = false; resetBtn.disabled = false;
  setStatus(model ? 'Tracking with saved calibration.' : 'Tracking (uncorrected). Click Calibrate.');
}

// ======================= Calibration =======================
function collect(n, timeout) {               // each call owns its own timer and sink
  return new Promise(res => {
    const rows = []; let timer = null;
    function finish() { clearTimeout(timer); if (sink === mySink) sink = null; res(rows); }
    function mySink(f) { rows.push(f); if (rows.length >= n) finish(); }
    sink = mySink; timer = setTimeout(finish, timeout);
  });
}

async function calibrate() {
  calibrating = true; calibBtn.disabled = true;
  gazeEl.style.display = 'none';
  calibEl.style.display = 'block';
  const samples = [];

  for (const pass of PASSES) {
    calibMsg.textContent = pass.text;
    targetEl.style.visibility = 'hidden';
    await sleep(INTRO_PAUSE_MS);
    targetEl.style.visibility = 'visible';
    for (const [px, py] of pass.points) {
      targetEl.style.left = px * 100 + '%';
      targetEl.style.top = py * 100 + '%';
      await sleep(SETTLE_MS);
      const rows = await collect(pass.samples, COLLECT_TIMEOUT_MS);
      for (const f of rows.slice(2)) samples.push({ f, px, py });   // drop the first frames
    }
  }

  calibEl.style.display = 'none';
  calibrating = false; calibBtn.disabled = false;
  gazeEl.style.display = 'block';

  const locations = new Set(samples.map(s => s.px + ',' + s.py)).size;
  if (samples.length < 60 || locations < 5) {
    setStatus('Too few usable samples. Check lighting, keep your face in view, and try again.');
    return;
  }
  model = buildModel(samples);
  saveModel();
  fx = new OneEuro(); fy = new OneEuro();
  setStatus(`Calibrated. Estimated error about ${Math.round(model.valErr)} px (held-out test, pessimistic).`);
  console.log('Calibration:', { samples: samples.length, lambda: model.lambda, valErrPx: model.valErr });
}

// ======================= Learn from clicks =======================
document.addEventListener('pointerdown', e => {
  if (!LEARN_FROM_CLICKS || !model || !lastF || sink || calibrating) return;
  if (performance.now() - lastFTime > 200) return;                  // need a fresh frame
  addSample(model, lastF, e.clientX / innerWidth, e.clientY / innerHeight, CLICK_WEIGHT);
  resolveModel(model);
  saveModel();
});

// ======================= Buttons / cleanup =======================
startBtn.onclick = start;
calibBtn.onclick = calibrate;
resetBtn.onclick = () => {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  model = null; fx = new OneEuro(); fy = new OneEuro();
  gazeEl.style.opacity = 0.55;
  setStatus('Calibration cleared. Showing uncorrected output.');
};
window.addEventListener('beforeunload', () => {
  try { proxy?.dispose?.(); } catch {}
  try { client?.dispose?.(); } catch {}
});
