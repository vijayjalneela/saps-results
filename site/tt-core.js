/* Timetable engine: clash-free scheduling and substitute suggestions.
   Pure functions (no database, no page), so they can be tested on their own. */

export const DEFAULT_TT = {
  v: 3,
  days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  stds: ["I", "II", "III", "IV", "V"],
  sections: { I: ["A", "B", "C"], II: ["A", "B", "C"], III: ["A", "B"], IV: ["A", "B"], V: ["A", "B"] },
  // 8 teaching periods: 2, short break, 2, long break, 4
  periods: [
    { n: 1, from: "08:00", to: "08:40" }, { n: 2, from: "08:40", to: "09:20" },
    { brk: "Short break", from: "09:20", to: "09:30" },
    { n: 3, from: "09:30", to: "10:10" }, { n: 4, from: "10:10", to: "10:50" },
    { brk: "Long break", from: "10:50", to: "11:20" },
    { n: 5, from: "11:20", to: "12:00" }, { n: 6, from: "12:00", to: "12:40" }, { n: 7, from: "12:40", to: "13:20" }, { n: 8, from: "13:20", to: "14:00" }
  ],
  // the same for every class; nothing else is scheduled in these periods
  fixed: [
    { day: "Wed", p: 1, label: "Mass PT", who: "PT" },
    { day: "Fri", p: 7, label: "CCA (Arts) / buffer", who: "Art" },
    { day: "Fri", p: 8, label: "CCA (Arts) / buffer", who: "Art" }
  ],
  perWeek: {
    prim: { English: 7, Mathematics: 7, Hindi: 6, EVS: 6, PT: 2, Art: 2 },
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
      const ts = staff.filter(t => teachesIn(t, c).includes(s));
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

/* Which subjects a teacher takes in a class: the per-class list if set, otherwise all her subjects in all her classes */
export function teachesIn(t, c) {
  if (t && t.teaches && typeof t.teaches === "object" && Object.keys(t.teaches).length) return t.teaches[c] || [];
  return (t && (t.classes || []).includes(c)) ? (t.subjects || []) : [];
}
/* Fixed periods as slot numbers */
export function fixedSlots(set) {
  const m = {}; (set.fixed || []).forEach(f => { const d = set.days.indexOf(f.day); if (d >= 0 && f.p >= 1 && f.p <= PPD) m[d * PPD + f.p - 1] = f; }); return m;
}

/* Small seeded random generator so a run can be repeated */
function rng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

/* Clash-free scheduling as edge colouring of the teacher-class graph (Kempe chains),
   then local improvement so a class rarely has the same subject twice a day and the
   class teacher tends to take period 1. */
export function schedule({ lessons, classes, days, ctOf, seed = 7, iterations = 12000, fixed = {} }) {
  const R = rng(seed), S = days * PPD;
  const cols = []; for (let k = 0; k < S; k++) if (!fixed[k]) cols.push(k);   // usable periods
  const K = cols.length, dayCols = Array.from({ length: days }, () => []);
  cols.forEach((k, i) => dayCols[Math.floor(k / PPD)].push(i));
  const tKeys = [...new Set(lessons.map(l => l.t || ("_none_" + l.c + "_" + l.s)))];
  const tIdx = Object.fromEntries(tKeys.map((k, i) => [k, i])), nT = tKeys.length;
  const cIdx = Object.fromEntries(classes.map((c, i) => [c, nT + i]));
  const N = nT + classes.length;
  const at = Array.from({ length: N }, () => new Int32Array(K).fill(-1));
  const E = lessons.map(l => ({ u: tIdx[l.t || ("_none_" + l.c + "_" + l.s)], v: cIdx[l.c], s: l.s, c: l.c, t: l.t, col: -1 }));
  const dayOfCol = i => Math.floor(cols[i] / PPD), perOfCol = i => cols[i] % PPD;
  const sameDay = (e, i) => { const row = at[e.v]; for (const j of dayCols[dayOfCol(i)]) { const x = row[j]; if (x >= 0 && E[x].s === e.s) return true; } return false; };
  const ctFirst = (e, i) => (perOfCol(i) === 0 && e.t && ctOf(e.c) === e.t);
  function kempe(start, a, b) {
    const seen = new Set(), stack = [start], ed = [];
    while (stack.length) { const n = stack.pop(); if (seen.has(n)) continue; seen.add(n);
      for (const col of [a, b]) { const x = at[n][col]; if (x >= 0) { if (!ed.includes(x)) ed.push(x); const o = E[x].u === n ? E[x].v : E[x].u; if (!seen.has(o)) stack.push(o); } } }
    ed.forEach(x => { const e = E[x]; at[e.u][e.col] = -1; at[e.v][e.col] = -1; });
    ed.forEach(x => { const e = E[x]; e.col = e.col === a ? b : a; });
    ed.forEach(x => { const e = E[x]; at[e.u][e.col] = x; at[e.v][e.col] = x; });
  }
  const tLoad = new Array(nT).fill(0); E.forEach(e => tLoad[e.u]++);
  const order = E.map((_, i) => i).sort((a, b) => (tLoad[E[b].u] - tLoad[E[a].u]) || (R() - .5));
  const unplaced = [];
  for (const i of order) {
    const e = E[i], tu = at[e.u], cv = at[e.v];
    const freeT = [], freeC = [];
    for (let k = 0; k < K; k++) { if (tu[k] < 0) freeT.push(k); if (cv[k] < 0) freeC.push(k); }
    if (!freeT.length || !freeC.length) { unplaced.push(e); continue; }
    const both = freeT.filter(k => cv[k] < 0);
    let pick = -1;
    if (both.length) { let best = 1e9; for (const k of both) { const sc = (sameDay(e, k) ? 10 : 0) - (ctFirst(e, k) ? 3 : 0) + perOfCol(k) * 0.2 + R(); if (sc < best) { best = sc; pick = k; } } }
    else { const a = freeT[Math.floor(R() * freeT.length)], b = freeC[Math.floor(R() * freeC.length)]; kempe(e.v, a, b); pick = a; }
    e.col = pick; tu[pick] = i; cv[pick] = i;
  }
  const pen = () => { let p = 0; for (const c of classes) { const row = at[cIdx[c]], ct = ctOf(c);
      for (let d = 0; d < days; d++) { const seen = {}; for (const j of dayCols[d]) { const x = row[j]; if (x >= 0) { const s = E[x].s; if (seen[s]) p += 10; seen[s] = 1; } else if (perOfCol(j) < 4) p += 2; }
        const first = dayCols[d].find(j => perOfCol(j) === 0); if (ct && first != null) { const x0 = row[first]; if (!(x0 >= 0 && E[x0].t === ct)) p += 1; } } } return p; };
  let cur = pen();
  for (let it = 0; it < iterations && cur > 0; it++) {
    const x = Math.floor(R() * E.length), e = E[x]; if (e.col < 0) continue;
    const a = e.col, b = Math.floor(R() * K); if (a === b) continue;
    kempe(e.v, a, b); const np = pen();
    if (np <= cur || R() < 0.002) cur = np; else kempe(e.v, a, b);
  }
  const grid = {}; classes.forEach(c => { grid[c] = new Array(S).fill(null); });
  Object.entries(fixed).forEach(([k, f]) => classes.forEach(c => { grid[c][+k] = { s: f.label, t: "", fixed: true, who: f.who || "" }; }));
  E.forEach(e => { if (e.col >= 0) grid[e.c][cols[e.col]] = { s: e.s, t: e.t || "" }; });
  const sameDayCount = (() => { let n = 0; for (const c of classes) for (let d = 0; d < days; d++) { const seen = {}; for (let j = d * PPD; j < d * PPD + PPD; j++) { const x = grid[c][j]; if (x && !x.fixed) { if (seen[x.s]) n++; seen[x.s] = 1; } } } return n; })();
  return { grid, unplaced: unplaced.map(e => ({ c: e.c, s: e.s, t: e.t })), sameDayCount, slots: S };
}

/* Check a grid for teacher clashes */
export function clashes(grid) {
  const out = []; const by = {};
  for (const [c, row] of Object.entries(grid)) row.forEach((x, k) => { if (x && x.t && !x.fixed) { const key = x.t + "|" + k; if (by[key]) out.push({ t: x.t, k, a: by[key], b: c }); else by[key] = c; } });
  return out;
}

/* Teacher's busy slots from the grid */
export function teacherSlots(grid) {
  const m = {}; for (const [c, row] of Object.entries(grid)) row.forEach((x, k) => { if (x && x.t && !x.fixed) (m[x.t] = m[x.t] || {})[k] = { c, s: x.s }; }); return m;
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
      const x = row[k]; if (!x || !x.t || x.fixed || !absent.has(x.t)) continue;
      const cands = teachers.filter(t => !(busy[t.email] || {})[k] && !plan.some(q => q.k === k && q.sub === t.email))
        .map(t => { const n = periodsToday(t.email) + (extra[t.email] || 0);
          const score = (t.coordinator ? 40 : 0) + (teachesIn(t, c).includes(x.s) || (t.subjects || []).includes(x.s) ? 30 : 0) + (teachesIn(t, c).length ? 20 : 0) + ((t.classTeacher || []).includes(c) ? 5 : 0)
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
    const opts = teachers.filter(t => teachesIn(t, c).length || t.coordinator).sort((a, b) => (periodsToday(a.email) + (extra[a.email] || 0)) - (periodsToday(b.email) + (extra[b.email] || 0)));
    acting.push({ c, absent: ct, sub: opts[0] ? opts[0].email : "" }); }
  return { plan, acting };
}
function whyText(t, s, c) {
  const r = []; if (t.coordinator) r.push("coordinator"); if ((t.subjects || []).includes(s)) r.push("teaches " + s); if ((t.classes || []).includes(c)) r.push("teaches this class");
  return r.length ? r.join(", ") : "free in this period";
}

/* ---------- School calendar ---------- */
// The school's own 2026-27 calendar (school diary pages 40-42): holidays (G = gazetted, R = restricted),
// breaks, non-instructional days, Friday CCA events and important days.
// Note from the diary: two more holidays are at the Principal's discretion.
export const SUGGESTED_HOLIDAYS = [
  {"from": "2026-05-11", "to": "2026-06-30", "name": "Summer vacation", "kind": "Vacation"},
  {"from": "2026-10-17", "to": "2026-10-26", "name": "Autumn break", "kind": "Vacation"},
  {"from": "2026-11-09", "to": "2026-11-13", "name": "Diwali break", "kind": "Vacation"},
  {"from": "2026-12-26", "to": "2027-01-04", "name": "Winter break", "kind": "Vacation"},
  {"from": "2026-04-03", "to": "2026-04-03", "name": "Good Friday", "kind": "Holiday"},
  {"from": "2026-05-01", "to": "2026-05-01", "name": "Budh Purnima", "kind": "Holiday"},
  {"from": "2026-05-27", "to": "2026-05-27", "name": "Id-ul-Zuha (Bakrid)", "kind": "Holiday"},
  {"from": "2026-06-26", "to": "2026-06-26", "name": "Muharram", "kind": "Holiday"},
  {"from": "2026-08-26", "to": "2026-08-26", "name": "Milad-un-Nabi / Id-e-Milad", "kind": "Holiday"},
  {"from": "2026-08-28", "to": "2026-08-28", "name": "Raksha Bandhan", "kind": "Holiday (R)"},
  {"from": "2026-09-04", "to": "2026-09-04", "name": "Janmashtami", "kind": "Holiday"},
  {"from": "2026-09-14", "to": "2026-09-14", "name": "Ganesh Chaturthi", "kind": "Holiday (R)"},
  {"from": "2026-10-02", "to": "2026-10-02", "name": "Mahatma Gandhi's Birthday", "kind": "Holiday"},
  {"from": "2026-10-20", "to": "2026-10-20", "name": "Dussehra", "kind": "Holiday"},
  {"from": "2026-11-08", "to": "2026-11-08", "name": "Diwali (Deepavali)", "kind": "Holiday"},
  {"from": "2026-11-24", "to": "2026-11-24", "name": "Guru Nanak's Birthday", "kind": "Holiday"},
  {"from": "2026-12-25", "to": "2026-12-25", "name": "Christmas Day", "kind": "Holiday"},
  {"from": "2026-08-15", "to": "2026-08-15", "name": "Independence Day (non-instructional working day)", "kind": "Non-instructional day"},
  {"from": "2027-01-26", "to": "2027-01-26", "name": "Republic Day (non-instructional working day)", "kind": "Non-instructional day"},
  {"from": "2026-04-10", "to": "2026-04-10", "name": "Calligraphy competition", "kind": "CCA"},
  {"from": "2026-04-17", "to": "2026-04-17", "name": "Earth Day celebration", "kind": "CCA"},
  {"from": "2026-05-08", "to": "2026-05-08", "name": "Shloka chanting competition", "kind": "CCA"},
  {"from": "2026-07-03", "to": "2026-07-03", "name": "Best out of waste", "kind": "CCA"},
  {"from": "2026-07-10", "to": "2026-07-10", "name": "Monsoon drawing", "kind": "CCA"},
  {"from": "2026-07-17", "to": "2026-07-17", "name": "Fireless cooking", "kind": "CCA"},
  {"from": "2026-07-24", "to": "2026-07-24", "name": "Kargil Divas drawing competition", "kind": "CCA"},
  {"from": "2026-07-31", "to": "2026-07-31", "name": "Life skills & moral values", "kind": "CCA"},
  {"from": "2026-08-07", "to": "2026-08-07", "name": "Craft work", "kind": "CCA"},
  {"from": "2026-08-14", "to": "2026-08-14", "name": "Patriotic song competition", "kind": "CCA"},
  {"from": "2026-08-21", "to": "2026-08-21", "name": "Rakhi making competition", "kind": "CCA"},
  {"from": "2026-08-28", "to": "2026-08-28", "name": "Story telling competition (moral)", "kind": "CCA"},
  {"from": "2026-09-04", "to": "2026-09-04", "name": "Teacher's Day celebration (card making)", "kind": "CCA"},
  {"from": "2026-09-11", "to": "2026-09-11", "name": "Ganesh Chaturthi activity", "kind": "CCA"},
  {"from": "2026-09-18", "to": "2026-09-18", "name": "Hindi poem recitation / Hindi writing competition", "kind": "CCA"},
  {"from": "2026-10-09", "to": "2026-10-09", "name": "Dussehra celebration", "kind": "CCA"},
  {"from": "2026-10-30", "to": "2026-10-30", "name": "Joy of Giving", "kind": "CCA"},
  {"from": "2026-11-06", "to": "2026-11-06", "name": "Diwali celebration", "kind": "CCA"},
  {"from": "2026-11-20", "to": "2026-11-20", "name": "English speech competition", "kind": "CCA"},
  {"from": "2026-11-27", "to": "2026-11-27", "name": "Spell bee competition", "kind": "CCA"},
  {"from": "2026-12-04", "to": "2026-12-04", "name": "Maths Week competition", "kind": "CCA"},
  {"from": "2026-12-11", "to": "2026-12-11", "name": "Annual Day week", "kind": "CCA"},
  {"from": "2026-12-18", "to": "2026-12-18", "name": "Christmas celebration", "kind": "CCA"},
  {"from": "2027-01-08", "to": "2027-01-08", "name": "Art exhibition", "kind": "CCA"},
  {"from": "2027-01-15", "to": "2027-01-15", "name": "Harvest festival celebration", "kind": "CCA"},
  {"from": "2027-01-22", "to": "2027-01-22", "name": "Republic Day celebration", "kind": "CCA"},
  {"from": "2027-01-28", "to": "2027-01-28", "name": "Community lunch", "kind": "CCA"},
  {"from": "2027-02-05", "to": "2027-02-05", "name": "Basant Panchami celebration", "kind": "CCA"},
  {"from": "2027-02-12", "to": "2027-02-12", "name": "Science projects exhibition", "kind": "CCA"},
  {"from": "2027-02-19", "to": "2027-02-19", "name": "Shiv Jayanti celebration", "kind": "CCA"},
  {"from": "2026-04-07", "to": "2026-04-07", "name": "World Health Day", "kind": "Important day"},
  {"from": "2026-04-14", "to": "2026-04-14", "name": "Dr. B.R. Ambedkar Jayanti", "kind": "Important day"},
  {"from": "2026-04-16", "to": "2026-04-16", "name": "World Heritage Day", "kind": "Important day"},
  {"from": "2026-04-22", "to": "2026-04-22", "name": "Earth Day", "kind": "Important day"},
  {"from": "2026-05-01", "to": "2026-05-01", "name": "Labour Day / Maharashtra Day / Buddha Purnima", "kind": "Important day"},
  {"from": "2026-05-08", "to": "2026-05-08", "name": "World Red Cross Day", "kind": "Important day"},
  {"from": "2026-05-10", "to": "2026-05-10", "name": "Mother's Day", "kind": "Important day"},
  {"from": "2026-05-11", "to": "2026-05-11", "name": "National Technology Day", "kind": "Important day"},
  {"from": "2026-06-05", "to": "2026-06-05", "name": "World Environment Day", "kind": "Important day"},
  {"from": "2026-06-21", "to": "2026-06-21", "name": "International Yoga Day / Father's Day", "kind": "Important day"},
  {"from": "2026-07-01", "to": "2026-07-01", "name": "Doctor's Day", "kind": "Important day"},
  {"from": "2026-07-16", "to": "2026-07-16", "name": "Jagannath Rath Yatra", "kind": "Important day"},
  {"from": "2026-07-26", "to": "2026-07-26", "name": "Kargil Vijay Diwas", "kind": "Important day"},
  {"from": "2026-07-29", "to": "2026-07-29", "name": "Guru Purnima", "kind": "Important day"},
  {"from": "2026-08-15", "to": "2026-08-15", "name": "Independence Day", "kind": "Important day"},
  {"from": "2026-08-28", "to": "2026-08-28", "name": "Raksha Bandhan", "kind": "Important day"},
  {"from": "2026-09-04", "to": "2026-09-04", "name": "Janmashtami", "kind": "Important day"},
  {"from": "2026-09-05", "to": "2026-09-05", "name": "Teachers' Day", "kind": "Important day"},
  {"from": "2026-09-08", "to": "2026-09-08", "name": "International Literacy Day", "kind": "Important day"},
  {"from": "2026-09-14", "to": "2026-09-14", "name": "Ganesh Chaturthi / Hindi Diwas", "kind": "Important day"},
  {"from": "2026-09-16", "to": "2026-09-16", "name": "World Ozone Day", "kind": "Important day"},
  {"from": "2026-10-02", "to": "2026-10-02", "name": "Gandhi Jayanti", "kind": "Important day"},
  {"from": "2026-10-20", "to": "2026-10-20", "name": "Dussehra / Vijayadashami", "kind": "Important day"},
  {"from": "2026-10-24", "to": "2026-10-24", "name": "United Nations Day", "kind": "Important day"},
  {"from": "2026-10-29", "to": "2026-10-29", "name": "Karwa Chauth", "kind": "Important day"},
  {"from": "2026-10-31", "to": "2026-10-31", "name": "National Unity Day", "kind": "Important day"},
  {"from": "2026-11-08", "to": "2026-11-08", "name": "Diwali", "kind": "Important day"},
  {"from": "2026-11-11", "to": "2026-11-11", "name": "Bhai Dooj", "kind": "Important day"},
  {"from": "2026-11-14", "to": "2026-11-14", "name": "Children's Day", "kind": "Important day"},
  {"from": "2026-11-19", "to": "2026-11-19", "name": "Rani Lakshmibai Jayanti", "kind": "Important day"},
  {"from": "2026-11-26", "to": "2026-11-26", "name": "Constitution Day", "kind": "Important day"},
  {"from": "2026-12-25", "to": "2026-12-25", "name": "Christmas", "kind": "Important day"},
  {"from": "2027-01-01", "to": "2027-01-01", "name": "New Year", "kind": "Important day"},
  {"from": "2027-01-12", "to": "2027-01-12", "name": "National Youth Day", "kind": "Important day"},
  {"from": "2027-01-14", "to": "2027-01-14", "name": "Lohri", "kind": "Important day"},
  {"from": "2027-01-15", "to": "2027-01-15", "name": "Makar Sankranti / Pongal / Army Day", "kind": "Important day"},
  {"from": "2027-01-23", "to": "2027-01-23", "name": "Netaji Subhas Chandra Bose Jayanti", "kind": "Important day"},
  {"from": "2027-01-26", "to": "2027-01-26", "name": "Republic Day", "kind": "Important day"},
  {"from": "2027-01-30", "to": "2027-01-30", "name": "Martyrs' Day", "kind": "Important day"},
  {"from": "2027-02-11", "to": "2027-02-11", "name": "Basant Panchami", "kind": "Important day"},
  {"from": "2027-02-28", "to": "2027-02-28", "name": "National Science Day", "kind": "Important day"},
  {"from": "2027-03-08", "to": "2027-03-08", "name": "International Women's Day", "kind": "Important day"},
  {"from": "2027-03-22", "to": "2027-03-22", "name": "Holi / World Water Day", "kind": "Important day"}
];
// kinds on which there are no classes
export const CLOSED_KINDS = ["Vacation", "Holiday", "Holiday (R)", "Non-instructional day"];
const iso = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const DN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function holidayOn(date, holidays) { return (holidays || []).find(h => CLOSED_KINDS.includes(h.kind || "Holiday") && h.from <= date && date <= (h.to || h.from)) || null; }
export function workingDays(start, end, days, holidays) {
  const out = []; const d = new Date(start + "T00:00:00"), e = new Date(end + "T00:00:00");
  while (d <= e) { const s = iso(d); if (days.includes(DN[d.getDay()]) && !holidayOn(s, holidays)) out.push(s); d.setDate(d.getDate() + 1); }
  return out;
}
/* Space the four exams across the teaching days of the year, avoiding weekends and holidays.
   subjects: { groupLabel: [subjects in paper order] }; gap: leave a study day between papers in term exams */
export function planExams({ start, end, days, holidays, subjects, gap = true }) {
  const W = workingDays(start, end, days, holidays), N = W.length;
  const nSub = Math.max(1, ...Object.values(subjects).map(a => a.length));
  const spec = [
    { key: "UT-1", label: "Unit Test I", at: 0.22, perDay: 2, gap: false },
    { key: "Term I", label: "Term I exam", at: 0.47, perDay: 1, gap },
    { key: "UT-2", label: "Unit Test II", at: 0.72, perDay: 2, gap: false },
    { key: "Term II", label: "Term II (final) exam", at: 0.93, perDay: 1, gap }
  ];
  return spec.map(x => {
    const papers = Math.ceil(nSub / x.perDay), span = x.gap ? papers * 2 - 1 : papers;
    let i0 = Math.round(x.at * N) - Math.floor(span / 2); i0 = Math.max(0, Math.min(N - span, i0));
    // never split an exam across a vacation: look for the nearest window without a long break inside
    const calDays = i => (new Date(W[i + span - 1] + "T00:00:00") - new Date(W[i] + "T00:00:00")) / 864e5;
    const ok = i => i >= 3 && i + span - 1 < N && calDays(i) <= span * 1.5 + 3 && (new Date(W[i] + "T00:00:00") - new Date(W[i - 3] + "T00:00:00")) / 864e5 <= 7; // and not straight after a vacation
    if (!ok(i0)) for (let k = 1; k < 40; k++) { if (ok(i0 + k)) { i0 += k; break; } if (ok(i0 - k)) { i0 -= k; break; } }
    const dates = []; for (let j = 0; j < papers; j++) dates.push(W[i0 + (x.gap ? 2 * j : j)]);
    const sheet = dates.map((date, j) => { const row = { date }; for (const [g, list] of Object.entries(subjects)) row[g] = list.slice(j * x.perDay, j * x.perDay + x.perDay).join(" + "); return row; });
    return { key: x.key, label: x.label, from: dates[0], to: dates[dates.length - 1], sheet };
  });
}

/* Fill every period a class would otherwise have with no teacher.
   Each class gets "Library / Activity" with a teacher who is free then: its class teacher first,
   then whoever has the lightest week. The coordinator is kept free for substitutions. */
export function fillGaps({ grid, staff, ctOf, keepFree = [], maxLoad = 34, label = "Library / Activity" }) {
  const busy = {}, load = {};
  for (const row of Object.values(grid)) row.forEach((x, k) => { if (x && x.t && !x.fixed) { (busy[x.t] = busy[x.t] || new Set()).add(k); load[x.t] = (load[x.t] || 0) + 1; } });
  const pool = staff.filter(t => t.role === "teacher" && !keepFree.includes(t.email));
  let filled = 0, open = 0;
  for (const [c, row] of Object.entries(grid)) {
    row.forEach((x, k) => {
      if (x) return;
      const free = t => !(busy[t.email] && busy[t.email].has(k)) && (load[t.email] || 0) < maxLoad;
      const ct = pool.find(t => t.email === ctOf(c) && free(t));
      const pick = ct || pool.filter(free).sort((a, b) => (load[a.email] || 0) - (load[b.email] || 0))[0];
      if (!pick) { open++; return; }
      row[k] = { s: label, t: pick.email, filler: true };
      (busy[pick.email] = busy[pick.email] || new Set()).add(k); load[pick.email] = (load[pick.email] || 0) + 1; filled++;
    });
  }
  return { grid, filled, open };
}
