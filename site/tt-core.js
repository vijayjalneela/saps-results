/* Timetable engine: clash-free scheduling and substitute suggestions.
   Pure functions (no database, no page), so they can be tested on their own. */

export const DEFAULT_TT = {
  days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  // 8 teaching periods: 3, break, 3, break, 2
  periods: [
    { n: 1, from: "08:00", to: "08:40" }, { n: 2, from: "08:40", to: "09:20" }, { n: 3, from: "09:20", to: "10:00" },
    { brk: "Short break", from: "10:00", to: "10:20" },
    { n: 4, from: "10:20", to: "11:00" }, { n: 5, from: "11:00", to: "11:40" }, { n: 6, from: "11:40", to: "12:20" },
    { brk: "Lunch break", from: "12:20", to: "12:50" },
    { n: 7, from: "12:50", to: "13:30" }, { n: 8, from: "13:30", to: "14:10" }
  ],
  perWeek: {
    prim: { English: 5, Hindi: 5, Mathematics: 5, EVS: 4 },
    mid: { English: 5, Hindi: 3, Mathematics: 5, Science: 5, "Social Science": 3 }
  }
};
export const PPD = 8; // teaching periods per day

/* Build the list of lessons and each teacher's load.
   classes: ["I-A",...]; subjectsOf(cls) -> [subjects]; group(cls) -> "prim"|"mid";
   staff: [{email,name,subjects,classes,classTeacher}] */
export function planLessons({ classes, subjectsOf, group, staff, perWeek, slots }) {
  const lessons = [], load = {}, missing = [], doubles = [];
  for (const c of classes) {
    for (const s of subjectsOf(c)) {
      const n = +((perWeek[group(c)] || {})[s] || 0); if (!n) continue;
      const ts = staff.filter(t => (t.subjects || []).includes(s) && (t.classes || []).includes(c));
      if (ts.length > 1) doubles.push({ c, s, teachers: ts.map(t => t.name) });
      const t = ts[0] || null; if (!t) missing.push({ c, s, n });
      for (let i = 0; i < n; i++) lessons.push({ c, s, t: t ? t.email : null });
      if (t) load[t.email] = (load[t.email] || 0) + n;
    }
  }
  const classLoad = {}; lessons.forEach(l => classLoad[l.c] = (classLoad[l.c] || 0) + 1);
  const over = staff.filter(t => (load[t.email] || 0) > slots).map(t => ({ name: t.name, email: t.email, need: load[t.email], cap: slots }));
  const classOver = Object.entries(classLoad).filter(([, n]) => n > slots).map(([c, n]) => ({ c, need: n, cap: slots }));
  return { lessons, load, missing, doubles, over, classOver };
}

/* Small seeded random generator so a run can be repeated */
function rng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

/* Clash-free scheduling as edge colouring of the teacher-class graph (Kempe chains),
   then local improvement so a class rarely has the same subject twice a day and the
   class teacher tends to take period 1. */
export function schedule({ lessons, classes, days, ctOf, seed = 7, iterations = 12000 }) {
  const R = rng(seed), S = days * PPD;
  const tKeys = [...new Set(lessons.map((l, i) => l.t || ("_none_" + l.c + "_" + l.s)))];
  const tIdx = Object.fromEntries(tKeys.map((k, i) => [k, i])), nT = tKeys.length;
  const cIdx = Object.fromEntries(classes.map((c, i) => [c, nT + i]));
  const N = nT + classes.length;
  const at = Array.from({ length: N }, () => new Int32Array(S).fill(-1));
  const E = lessons.map(l => ({ u: tIdx[l.t || ("_none_" + l.c + "_" + l.s)], v: cIdx[l.c], s: l.s, c: l.c, t: l.t, col: -1 }));
  const dayOf = k => Math.floor(k / PPD);
  // same subject already on that day for that class?
  const sameDay = (e, k) => { const row = at[e.v]; const d = dayOf(k); for (let j = d * PPD; j < d * PPD + PPD; j++) { const x = row[j]; if (x >= 0 && E[x].s === e.s) return true; } return false; };
  const ctFirst = (e, k) => (k % PPD === 0 && e.t && ctOf(e.c) === e.t);
  function kempe(start, a, b) { // swap colours a/b on the alternating component containing `start`
    const seen = new Set(), stack = [start], ed = [];
    while (stack.length) { const n = stack.pop(); if (seen.has(n)) continue; seen.add(n);
      for (const col of [a, b]) { const x = at[n][col]; if (x >= 0) { if (!ed.includes(x)) ed.push(x); const o = E[x].u === n ? E[x].v : E[x].u; if (!seen.has(o)) stack.push(o); } } }
    ed.forEach(x => { const e = E[x]; at[e.u][e.col] = -1; at[e.v][e.col] = -1; });
    ed.forEach(x => { const e = E[x]; e.col = e.col === a ? b : a; });
    ed.forEach(x => { const e = E[x]; at[e.u][e.col] = x; at[e.v][e.col] = x; });
    return ed;
  }
  // order: busiest teachers first, shuffled within
  const tLoad = new Array(nT).fill(0); E.forEach(e => tLoad[e.u]++);
  const order = E.map((_, i) => i).sort((a, b) => (tLoad[E[b].u] - tLoad[E[a].u]) || (R() - .5));
  const unplaced = [];
  for (const i of order) {
    const e = E[i], tu = at[e.u], cv = at[e.v];
    const freeT = [], freeC = [];
    for (let k = 0; k < S; k++) { if (tu[k] < 0) freeT.push(k); if (cv[k] < 0) freeC.push(k); }
    if (!freeT.length || !freeC.length) { unplaced.push(e); continue; }
    const both = freeT.filter(k => cv[k] < 0);
    let pick = -1;
    if (both.length) {
      let best = 1e9; for (const k of both) { const sc = (sameDay(e, k) ? 10 : 0) - (ctFirst(e, k) ? 3 : 0) + R(); if (sc < best) { best = sc; pick = k; } }
    } else {
      const a = freeT[Math.floor(R() * freeT.length)], b = freeC[Math.floor(R() * freeC.length)];
      kempe(e.v, a, b); // now `a` is free at the class (and still free at the teacher)
      pick = a;
    }
    e.col = pick; tu[pick] = i; cv[pick] = i;
  }
  // improvement: Kempe swaps that reduce penalty
  const pen = () => { let p = 0; for (const c of classes) { const row = at[cIdx[c]], ct = ctOf(c);
      for (let d = 0; d < days; d++) { const seen = {}; for (let j = d * PPD; j < d * PPD + PPD; j++) { const x = row[j]; if (x >= 0) { const s = E[x].s; if (seen[s]) p += 10; seen[s] = 1; } }
        const x0 = row[d * PPD]; if (ct && !(x0 >= 0 && E[x0].t === ct)) p += 1;
        for (let j = d * PPD; j < d * PPD + 6; j++) if (row[j] < 0) p += 2; } } return p; }; // free / activity periods go to the end of the day
  let cur = pen();
  for (let it = 0; it < iterations && cur > 0; it++) {
    const x = Math.floor(R() * E.length), e = E[x]; if (e.col < 0) continue;
    const a = e.col, b = Math.floor(R() * S); if (a === b) continue;
    kempe(e.v, a, b); const np = pen();
    if (np <= cur || R() < 0.002) cur = np; else kempe(e.v, a, b); // undo
  }
  // build grids
  const grid = {}; classes.forEach(c => { grid[c] = new Array(S).fill(null); });
  E.forEach(e => { if (e.col >= 0) grid[e.c][e.col] = { s: e.s, t: e.t || "" }; });
  const sameDayCount = (() => { let n = 0; for (const c of classes) for (let d = 0; d < days; d++) { const seen = {}; for (let j = d * PPD; j < d * PPD + PPD; j++) { const x = grid[c][j]; if (x) { if (seen[x.s]) n++; seen[x.s] = 1; } } } return n; })();
  return { grid, unplaced: unplaced.map(e => ({ c: e.c, s: e.s, t: e.t })), sameDayCount, slots: S };
}

/* Check a grid for teacher clashes */
export function clashes(grid) {
  const out = []; const by = {};
  for (const [c, row] of Object.entries(grid)) row.forEach((x, k) => { if (x && x.t) { const key = x.t + "|" + k; if (by[key]) out.push({ t: x.t, k, a: by[key], b: c }); else by[key] = c; } });
  return out;
}

/* Teacher's busy slots from the grid */
export function teacherSlots(grid) {
  const m = {}; for (const [c, row] of Object.entries(grid)) row.forEach((x, k) => { if (x && x.t) (m[x.t] = m[x.t] || {})[k] = { c, s: x.s }; }); return m;
}

/* Substitute plan for one day.
   absent: Set of emails on leave; dayIdx: 0..days-1; staff: list; ctOf(cls)->email */
export function substitutePlan({ grid, dayIdx, absent, staff, ctOf, maxPerTeacher = 2 }) {
  const busy = teacherSlots(grid), plan = [], extra = {}, acting = [];
  const teachers = staff.filter(t => t.role !== "principal" && t.role !== "admin" && !absent.has(t.email));
  const periodsToday = em => Object.keys(busy[em] || {}).filter(k => Math.floor(k / PPD) === dayIdx).length;
  for (let p = 0; p < PPD; p++) {
    const k = dayIdx * PPD + p;
    for (const [c, row] of Object.entries(grid)) {
      const x = row[k]; if (!x || !x.t || !absent.has(x.t)) continue;
      const cands = teachers.filter(t => !(busy[t.email] || {})[k] && !plan.some(q => q.k === k && q.sub === t.email))
        .map(t => { const n = periodsToday(t.email) + (extra[t.email] || 0);
          const score = ((t.subjects || []).includes(x.s) ? 30 : 0) + ((t.classes || []).includes(c) ? 20 : 0) + ((t.classTeacher || []).includes(c) ? 5 : 0)
            - n * 4 - ((extra[t.email] || 0) >= maxPerTeacher ? 100 : 0);
          return { t, score, n }; })
        .sort((a, b) => b.score - a.score);
      const best = cands[0];
      plan.push({ k, p: p + 1, c, s: x.s, absent: x.t, sub: best ? best.t.email : "", why: best ? whyText(best.t, x.s, c) : "No teacher is free in this period", options: cands.slice(0, 6).map(o => o.t.email) });
      if (best) extra[best.t.email] = (extra[best.t.email] || 0) + 1;
    }
  }
  // acting class teachers
  for (const c of Object.keys(grid)) { const ct = ctOf(c); if (!ct || !absent.has(ct)) continue;
    const opts = teachers.filter(t => (t.classes || []).includes(c)).sort((a, b) => (periodsToday(a.email) + (extra[a.email] || 0)) - (periodsToday(b.email) + (extra[b.email] || 0)));
    acting.push({ c, absent: ct, sub: opts[0] ? opts[0].email : "" }); }
  return { plan, acting };
}
function whyText(t, s, c) {
  const r = []; if ((t.subjects || []).includes(s)) r.push("teaches " + s); if ((t.classes || []).includes(c)) r.push("teaches this class");
  return r.length ? r.join(", ") : "free in this period";
}
