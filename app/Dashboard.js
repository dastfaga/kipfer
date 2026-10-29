"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";
import { FAGA_LOGO, HERO, LOGO, TRAILER } from "../lib/brand";

Chart.defaults.font.family = "Inter, system-ui, sans-serif";
Chart.defaults.color = "#5b6780";
Chart.defaults.borderColor = "rgba(38,57,96,0.08)";

const C = {
  navy: "#263960",
  blue: "#4f86c6",
  orange: "#e0803a",
  grey: "#a3aec0",
  sun: "#f2b531",
  green: "#2e9e6b",
  red: "#d0453b",
};
const MONATE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const LETZTES_JAHR = 2025; // 2026 ist unvollständig und wird nicht gezeigt
const LW_BASIS = 5; // Luftwechsel der Planung (127'173 m³/h)
// Lager aus der Excel (Blatt «Lager»): Luftmenge bei 5-fach und el. Leistung Zuluft + Fortluft
const LAGER = [
  { id: "53", m3h: 14579, kw: 8.71, raum: "5 °C" },
  { id: "55a", m3h: 10680, kw: 5.97, raum: "5 °C" },
  { id: "55b", m3h: 7120, kw: 4.08, raum: "15–25 °C" },
  { id: "18", m3h: 21188, kw: 13.21, raum: "5 °C" },
  { id: "13", m3h: 27658, kw: 18.93, raum: "5 °C" },
  { id: "56", m3h: 20485, kw: 12.67, raum: "5 °C" },
  { id: "54", m3h: 25463, kw: 17.22, raum: "5 °C" },
];
const M3H_TOTAL = LAGER.reduce((s, l) => s + l.m3h, 0);
const KW_TOTAL = LAGER.reduce((s, l) => s + l.kw, 0);
const BASIS = { lw: 5, eer: 3, cop: 3, pumpe: 3, pv: true, aus: [] };
const PRESETS = [
  { name: "Planung", sub: "5-fach · EER 3 · COP 3", p: BASIS },
  { name: "Weniger Luft", sub: "3-fach Luftwechsel", p: { ...BASIS, lw: 3 } },
  { name: "Effizient", sub: "EER 4.5 · COP 4", p: { ...BASIS, eer: 4.5, cop: 4 } },
  { name: "Konservativ", sub: "EER 2.5 · COP 2.5", p: { ...BASIS, eer: 2.5, cop: 2.5 } },
];

const nf0 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("de-CH", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const chf = (v) => "CHF " + nf0.format(Math.round(v));
const mwh = (kwh) => nf0.format(kwh / 1000) + " MWh";
const signed = (v, f) => (v > 0.5 ? "+" : v < -0.5 ? "−" : "±") + f(Math.abs(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- Simulation: jede Stunde neu rechnen ----------
// Luftwechsel und Lager: Kälte und Wärme proportional zur Luftmenge, Ventilatoren nach Geräteleistung.
function faktoren(p) {
  const an = LAGER.filter((l) => !p.aus.includes(l.id));
  const lw = p.lw / LW_BASIS;
  return {
    fa: (lw * an.reduce((s, l) => s + l.m3h, 0)) / M3H_TOTAL,
    fv: (lw * an.reduce((s, l) => s + l.kw, 0)) / KW_TOTAL,
  };
}

function stunde(d, i, p, f) {
  const kth = (d.kg[i] + d.ku[i]) * f.fa;
  const wth = d.waerme[i] * f.fa;
  const sk = kth / p.eer;
  const sw = wth / p.cop;
  const sp = (p.pumpe / 100) * (kth + wth);
  const sv = d.vent[i] * f.fv;
  const pv = p.pv ? d.pv[i] : 0;
  return { sk, sw, sp, sv, tot: sk + sw + sp + sv, pv };
}

function simulate(data, p) {
  const f = faktoren(p);
  const months = [];
  for (const y of data.jahre) {
    const d = data.stunden[y];
    const tar = data.tarife[y] || { leistung: 0, grund: 0 };
    const acc = {};
    for (let i = 0; i < d.monat.length; i++) {
      const m = d.monat[i];
      const a = (acc[m] ||= {
        jahr: y, monat: m, vent: 0, kaelte: 0, waerme: 0, pumpen: 0, tot: 0, pv: 0, ev: 0, ein: 0, netz: 0,
        eMit: 0, eOhne: 0, erl: 0, pkMit: 0, pkOhne: 0, h: 0, tSum: 0,
      });
      const s = stunde(d, i, p, f);
      const ev = s.pv < s.tot ? s.pv : s.tot;
      const netz = s.tot - ev;
      a.vent += s.sv; a.kaelte += s.sk; a.waerme += s.sw; a.pumpen += s.sp;
      a.tot += s.tot; a.pv += s.pv; a.ev += ev; a.ein += s.pv - ev; a.netz += netz;
      a.eMit += netz * d.preis[i];
      a.eOhne += s.tot * d.preis[i];
      a.erl += (s.pv - ev) * d.rueck[i];
      if (d.ht[i]) {
        if (netz > a.pkMit) a.pkMit = netz;
        if (s.tot > a.pkOhne) a.pkOhne = s.tot;
      }
      a.h++;
      a.tSum += d.t[i];
    }
    for (const m of Object.keys(acc).map(Number).sort((x, z) => x - z)) {
      const a = acc[m];
      a.kostenMit = a.eMit / 100 + a.pkMit * tar.leistung + tar.grund - a.erl / 100;
      a.kostenOhne = a.eOhne / 100 + a.pkOhne * tar.leistung + tar.grund;
      a.einsparung = a.kostenOhne - a.kostenMit;
      months.push(a);
    }
  }
  return months;
}

const FIELDS = ["vent", "kaelte", "waerme", "pumpen", "tot", "pv", "ev", "ein", "netz", "kostenMit", "kostenOhne", "einsparung", "h", "tSum"];
function sum(list) {
  const s = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  for (const a of list) for (const f of FIELDS) s[f] += a[f];
  return s;
}
function scale(s, k) {
  return Object.fromEntries(Object.entries(s).map(([f, v]) => [f, v * k]));
}
function groupBy(months, key) {
  const map = new Map();
  for (const a of months) {
    if (!map.has(a[key])) map.set(a[key], []);
    map.get(a[key]).push(a);
  }
  return map;
}

// ---------- kleine Bausteine ----------
function useAnimated(value, ms = 700) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    let raf;
    const start = performance.now();
    const a = from.current;
    const step = (t) => {
      const k = Math.min(1, (t - start) / ms);
      const cur = a + (value - a) * (1 - Math.pow(1 - k, 3));
      from.current = cur;
      setShown(cur);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

function Num({ value, format, ms }) {
  return <>{format(useAnimated(value, ms))}</>;
}

function ChartBox({ config, height = 320 }) {
  const canvas = useRef(null);
  const chart = useRef(null);
  useEffect(() => {
    chart.current = new Chart(canvas.current, config);
    return () => chart.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const ch = chart.current;
    if (!ch) return;
    ch.data.labels = config.data.labels;
    config.data.datasets.forEach((ds, i) => {
      if (ch.data.datasets[i]) Object.assign(ch.data.datasets[i], ds);
      else ch.data.datasets.push(ds);
    });
    ch.data.datasets.length = config.data.datasets.length;
    ch.options = config.options;
    ch.update();
  }, [config]);
  return (
    <div className="chart" style={{ height }}>
      <canvas ref={canvas} />
    </div>
  );
}

function chartOptions({ fmt, scales, animation = 500 }) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: animation },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8, padding: 16 } },
      tooltip: {
        filter: (item) => item.parsed.y != null,
        callbacks: { label: (ctx) => `${ctx.dataset.label}: ${(ctx.dataset.fmt || fmt)(ctx.parsed.y)}` },
      },
    },
    scales,
  };
}

function Regler({ label, info, value, min, max, step, unit, onChange, basis, digits = 1 }) {
  const pct = ((basis - min) / (max - min)) * 100;
  return (
    <div className="regler">
      <div className="regler-head">
        <span>{label}</span>
        <strong>
          {value.toFixed(digits)}
          {unit}
        </strong>
      </div>
      <div className="regler-track">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="regler-basis" style={{ left: `${pct}%` }} title={`Planung: ${basis}${unit}`} />
      </div>
      <p className="regler-info">{info}</p>
    </div>
  );
}

function Schalter({ label, info, on, onChange }) {
  return (
    <div className="regler">
      <button className={`schalter ${on ? "on" : ""}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
        <span>{label}</span>
        <i />
      </button>
      <p className="regler-info">{info}</p>
    </div>
  );
}

function Ventilator({ an, lw }) {
  return (
    <svg viewBox="0 0 40 40" className={`fan ${an ? "spin" : ""}`} style={{ animationDuration: `${(1.4 * LW_BASIS) / lw}s` }}>
      <circle cx="20" cy="20" r="18" className="fan-ring" />
      {[0, 120, 240].map((r) => (
        <path key={r} d="M20 20 C 16 12, 18 5, 24 4 C 27 9, 25 15, 20 20 Z" transform={`rotate(${r} 20 20)`} />
      ))}
      <circle cx="20" cy="20" r="3" className="fan-hub" />
    </svg>
  );
}

function Anlagen({ params, setParams }) {
  const toggle = (id) =>
    setParams((p) => ({ ...p, aus: p.aus.includes(id) ? p.aus.filter((x) => x !== id) : [...p.aus, id] }));
  return (
    <div className="regler">
      <div className="regler-head">
        <span>Anlagen (Lager)</span>
        <strong>
          {LAGER.length - params.aus.length} / {LAGER.length} an
        </strong>
      </div>
      <div className="anlagen">
        {LAGER.map((l) => {
          const an = !params.aus.includes(l.id);
          return (
            <button key={l.id} className={`anlage ${an ? "on" : ""}`} onClick={() => toggle(l.id)} title={`Lager ${l.id} ein/aus`}>
              <Ventilator an={an} lw={params.lw} />
              <strong>Lager {l.id}</strong>
              <span>{nf0.format((l.m3h * params.lw) / LW_BASIS)} m³/h</span>
              <span>{l.raum}</span>
            </button>
          );
        })}
      </div>
      <p className="regler-info">Klick auf ein Lager schaltet dessen Lüftungsgeräte ein oder aus.</p>
    </div>
  );
}

// Karten beim Scrollen sanft einblenden
function useReveal(active, key) {
  useEffect(() => {
    if (!active) return;
    const els = document.querySelectorAll(".reveal");
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("visible")),
      { threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [active, key]);
}

// ---------- Kalender: jeder Tag ein Kästchen ----------
const SKALEN = {
  netz: { label: "Netzbezug", unit: "kWh", stops: ["#eef2f6", "#a6bdc0", "#4f86c6", "#263960"] },
  tot: { label: "Strombedarf", unit: "kWh", stops: ["#eef2f6", "#a6bdc0", "#4f86c6", "#263960"] },
  pv: { label: "PV-Produktion", unit: "kWh", stops: ["#eef2f6", "#f8e08e", "#f2b531", "#c2710c"] },
  t: { label: "Aussentemperatur", unit: "°C", stops: ["#3b6fb6", "#9cc3e6", "#f4f4f4", "#f1a46b", "#d0453b"], min: -8, max: 28 },
};
const WOCHENTAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function colorAt(stops, k) {
  const x = Math.max(0, Math.min(1, k)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const a = hex(stops[i]);
  const b = hex(stops[i + 1]);
  const f = x - i;
  return a.map((v, j) => Math.round(v + (b[j] - v) * f));
}
const Z = 12; // Kästchen
const G = 3; // Abstand
const wochentag = (y, k) => (new Date(Date.UTC(y, 0, 1 + k)).getUTCDay() + 6) % 7; // Mo = 0

function Kalender({ data, params }) {
  const [metrik, setMetrik] = useState("netz");
  const [hover, setHover] = useState(null);

  // Tageswerte pro Jahr
  const tage = useMemo(() => {
    const f = faktoren(params);
    const out = {};
    for (const y of data.jahre) {
      const d = data.stunden[y];
      const n = y % 4 === 0 ? 366 : 365;
      const w = { tot: new Float64Array(n), pv: new Float64Array(n), netz: new Float64Array(n), t: new Float64Array(n), h: new Uint16Array(n) };
      for (let i = 0; i < d.monat.length; i++) {
        const k = d.tag[i];
        if (k < 0 || k >= n) continue;
        const s = stunde(d, i, params, f);
        w.tot[k] += s.tot;
        w.pv[k] += s.pv;
        w.netz[k] += Math.max(0, s.tot - s.pv);
        w.t[k] += d.t[i];
        w.h[k]++;
      }
      for (let k = 0; k < n; k++) w.t[k] = w.h[k] ? w.t[k] / w.h[k] : 0;
      out[y] = w;
    }
    return out;
  }, [data, params]);

  const sk = SKALEN[metrik];
  const min = sk.min ?? 0;
  const max = useMemo(() => {
    if (sk.max != null) return sk.max;
    let m = 0;
    for (const y of data.jahre) for (const v of tage[y][metrik]) if (v > m) m = v;
    return m;
  }, [tage, metrik, data, sk]);
  const fmt = (v) => (metrik === "t" ? nf1.format(v) : nf0.format(v)) + " " + sk.unit;
  const breite = 54 * (Z + G);
  const refJahr = data.jahre[data.jahre.length - 1];
  const start0 = wochentag(refJahr, 0);

  function onOver(e) {
    const k = e.target.dataset?.k;
    if (k == null) return;
    const y = Number(e.target.dataset.y);
    const date = new Date(Date.UTC(y, 0, 1 + Number(k)));
    setHover(`${WOCHENTAGE[wochentag(y, Number(k))]}, ${date.getUTCDate()}. ${MONATE[date.getUTCMonth()]} ${y}: ${fmt(tage[y][metrik][k])}`);
  }

  return (
    <div className="kalender">
      <div className="seg">
        {Object.entries(SKALEN).map(([k, s]) => (
          <button key={k} className={k === metrik ? "on" : ""} onClick={() => setMetrik(k)}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="kalender-monate" style={{ marginLeft: 48 }}>
        {MONATE.map((m, i) => {
          const k = Math.round((Date.UTC(refJahr, i, 1) - Date.UTC(refJahr, 0, 1)) / 86400000);
          return (
            <span key={m} style={{ left: `${(Math.floor((k + start0) / 7) * (Z + G) * 100) / breite}%` }}>
              {m}
            </span>
          );
        })}
      </div>
      <div className="kalender-jahre" onMouseOver={onOver} onMouseLeave={() => setHover(null)}>
        {data.jahre.map((y) => {
          const w = tage[y];
          const start = wochentag(y, 0);
          return (
            <div key={y} className="kalender-jahr">
              <strong>{y}</strong>
              <svg viewBox={`0 0 ${breite} ${7 * (Z + G)}`}>
                {Array.from(w.h, (h, k) => {
                  if (!h) return null;
                  const pos = k + start;
                  const [r, g, b] = colorAt(sk.stops, (w[metrik][k] - min) / (max - min || 1));
                  return (
                    <rect
                      key={k} data-k={k} data-y={y} x={Math.floor(pos / 7) * (Z + G)} y={(pos % 7) * (Z + G)}
                      width={Z} height={Z} rx={3} fill={`rgb(${r},${g},${b})`}
                    />
                  );
                })}
              </svg>
            </div>
          );
        })}
      </div>
      <div className="kalender-fuss">
        <span className="kalender-info">{hover || "Fahren Sie mit der Maus über einen Tag."}</span>
        <span className="heatmap-legend">
          <span>{fmt(min)}</span>
          <i style={{ background: `linear-gradient(90deg, ${sk.stops.join(",")})` }} />
          <span>{fmt(max)}</span>
        </span>
      </div>
    </div>
  );
}

// ---------- Hauptseite ----------
async function getJson(url) {
  const res = await fetch(url);
  if (res.status === 401) {
    location.href = "/login";
    throw new Error("Nicht angemeldet");
  }
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState({ phase: "laden", progress: 0 });
  const [params, setParams] = useState(BASIS);
  const [monatsAnsicht, setMonatsAnsicht] = useState("schnitt");
  const [cursor, setCursor] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const meta = await getJson("/api/data");
        const jahre = meta.jahre.map((r) => r.jahr).filter((y) => y <= LETZTES_JAHR);
        if (!jahre.length) return setStatus({ phase: "leer" });
        const stunden = {};
        let done = 0;
        await Promise.all(
          jahre.map(async (y) => {
            stunden[y] = await getJson(`/api/data?jahr=${y}`);
            done++;
            setStatus({ phase: "laden", progress: done / jahre.length });
          })
        );
        setData({
          jahre,
          stunden,
          tarife: Object.fromEntries(meta.tarife.map((t) => [t.jahr, t])),
          referenz: meta.referenz.filter((r) => r.jahr <= LETZTES_JAHR),
        });
        setStatus({ phase: "fertig" });
      } catch (e) {
        setStatus({ phase: "fehler", error: e.message });
      }
    })();
    return () => clearInterval(timer.current);
  }, []);

  const months = useMemo(() => (data ? simulate(data, params) : []), [data, params]);
  const bMonths = useMemo(() => (data ? simulate(data, BASIS) : []), [data]);
  const istBasis = same(params, BASIS);
  const nJahre = data ? data.jahre.length : 1;

  const years = useMemo(() => [...groupBy(months, "jahr")].map(([jahr, l]) => ({ jahr, ...sum(l) })), [months]);
  const bYears = useMemo(() => [...groupBy(bMonths, "jahr")].map(([jahr, l]) => ({ jahr, ...sum(l) })), [bMonths]);
  const total = useMemo(() => sum(months), [months]);
  const bTotal = useMemo(() => sum(bMonths), [bMonths]);
  const schnitt = useMemo(() => scale(total, 1 / nJahre), [total, nJahre]);
  // Durchschnitt pro Kalendermonat über alle Jahre
  const monatsSchnitt = useMemo(
    () => [...groupBy(months, "monat")].sort((a, b) => a[0] - b[0]).map(([monat, l]) => ({ monat, ...scale(sum(l), 1 / l.length) })),
    [months]
  );
  const playing = cursor !== null;

  const cum = useMemo(() => {
    let s = 0;
    return months.map((a) => (s += a.einsparung));
  }, [months]);

  function play() {
    clearInterval(timer.current);
    let k = 0;
    setCursor(0);
    timer.current = setInterval(() => {
      k++;
      if (k >= months.length) {
        clearInterval(timer.current);
        setCursor(null);
        return;
      }
      setCursor(k);
    }, Math.max(60, 7000 / months.length));
  }

  const verbraucher = (list) => [
    { label: "Ventilatoren", data: list.map((a) => a.vent / 1000), backgroundColor: C.navy, stack: "s" },
    { label: "Kälte", data: list.map((a) => a.kaelte / 1000), backgroundColor: C.blue, stack: "s" },
    { label: "Wärme", data: list.map((a) => a.waerme / 1000), backgroundColor: C.orange, stack: "s" },
    { label: "Pumpen", data: list.map((a) => a.pumpen / 1000), backgroundColor: C.grey, stack: "s" },
  ];
  const mwhAxis = (text) => ({ stacked: true, title: { display: true, text } });

  const cfgStromJahr = useMemo(
    () => ({
      type: "bar",
      data: {
        labels: years.map((y) => String(y.jahr)),
        datasets: [
          ...verbraucher(years).map((ds) => ({ ...ds, borderRadius: 4 })),
          {
            type: "line", label: `Ø 2021–${LETZTES_JAHR}`, data: years.map(() => schnitt.tot / 1000), borderColor: C.red,
            borderDash: [6, 4], pointRadius: 0, borderWidth: 2, stack: "avg",
          },
          {
            type: "line", label: "PV-Produktion", data: years.map((y) => y.pv / 1000), borderColor: C.sun,
            backgroundColor: C.sun, pointRadius: 4, borderWidth: 3, stack: "pv", hidden: !params.pv,
          },
        ],
      },
      options: chartOptions({ fmt: (v) => nf0.format(v) + " MWh", scales: { x: { stacked: true }, y: mwhAxis("MWh pro Jahr") } }),
    }),
    [years, schnitt, params.pv] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const monatsDaten = useMemo(
    () => (monatsAnsicht === "schnitt" ? monatsSchnitt : months.filter((a) => a.jahr === monatsAnsicht)),
    [monatsAnsicht, monatsSchnitt, months]
  );
  const cfgStromMonat = useMemo(
    () => ({
      type: "bar",
      data: {
        labels: monatsDaten.map((a) => MONATE[a.monat - 1]),
        datasets: [
          ...verbraucher(monatsDaten),
          {
            type: "line", label: "PV-Produktion", data: monatsDaten.map((a) => a.pv / 1000), borderColor: C.sun,
            backgroundColor: C.sun, pointRadius: 3, borderWidth: 3, tension: 0.3, stack: "pv", hidden: !params.pv,
          },
          {
            type: "line", label: "Aussentemperatur", data: monatsDaten.map((a) => a.tSum / a.h), borderColor: C.red,
            backgroundColor: C.red, pointRadius: 0, borderWidth: 1.5, borderDash: [3, 3], tension: 0.3, yAxisID: "y2",
            stack: "t", fmt: (v) => nf1.format(v) + " °C",
          },
        ],
      },
      options: chartOptions({
        fmt: (v) => nf0.format(v) + " MWh",
        scales: {
          x: { stacked: true },
          y: mwhAxis("MWh pro Monat"),
          y2: { position: "right", grid: { display: false }, title: { display: true, text: "°C" } },
        },
      }),
    }),
    [monatsDaten, params.pv] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const cfgKosten = useMemo(
    () => ({
      type: "bar",
      data: {
        labels: years.map((y) => String(y.jahr)),
        datasets: [
          { label: "Ohne PV", data: years.map((y) => y.kostenOhne), backgroundColor: C.grey, borderRadius: 6 },
          { label: "Mit PV", data: years.map((y) => y.kostenMit), backgroundColor: C.navy, borderRadius: 6, hidden: !params.pv },
          {
            type: "line", label: "Planung mit PV", data: bYears.map((y) => y.kostenMit), borderColor: C.orange,
            backgroundColor: C.orange, borderDash: [6, 4], pointRadius: 4, hidden: istBasis,
          },
        ],
      },
      options: chartOptions({ fmt: chf, scales: { y: { ticks: { callback: (v) => nf0.format(v / 1000) + "k" } } } }),
    }),
    [years, bYears, istBasis, params.pv]
  );

  const cfgKumuliert = useMemo(
    () => ({
      type: "line",
      data: {
        labels: months.map((a) => `${MONATE[a.monat - 1]} ${String(a.jahr).slice(2)}`),
        datasets: [
          {
            label: "Einsparung durch PV (kumuliert)", data: cum.map((v, i) => (cursor === null || i <= cursor ? v : null)),
            borderColor: C.green, backgroundColor: "rgba(46,158,107,0.15)", fill: true, pointRadius: 0, tension: 0.25, borderWidth: 3,
          },
        ],
      },
      options: chartOptions({
        fmt: chf,
        animation: playing ? 0 : 500,
        scales: { y: { ticks: { callback: (v) => nf0.format(v / 1000) + "k" } }, x: { ticks: { maxTicksLimit: 10 } } },
      }),
    }),
    [months, cum, cursor, playing]
  );

  useReveal(status.phase === "fertig", params.pv);

  if (status.phase !== "fertig") return <Splash status={status} />;

  const set = (k) => (v) => setParams((p) => ({ ...p, [k]: v }));
  const dJahr = (total.kostenMit - bTotal.kostenMit) / nJahre;
  const dMwh = (total.tot - bTotal.tot) / nJahre;
  const zeitraum = `2021–${LETZTES_JAHR}`;
  const tick = playing ? months[cursor] : null;
  const best = years.reduce((a, y) => (y.einsparung > a.einsparung ? y : a), years[0]);
  const refMit = data.referenz.reduce((s, r) => s + r.kosten_mit, 0);
  const luftmenge = (faktoren(params).fa * M3H_TOTAL);
  const tabelle = [...years.map((y) => ({ label: String(y.jahr), ...y })), { label: `Ø ${zeitraum}`, schnitt: true, ...schnitt }];

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-autor">
          <img src={FAGA_LOGO} alt="fagà Klima" className="faga-logo" />
          <div>
            <strong>Damir Stojadinovic</strong>
            <span>fagà Klima GmbH</span>
          </div>
        </div>
        <div className="topbar-title">Energie-Simulator · Lüftung Kühllager mit PV</div>
        <img src={LOGO} alt="Kipfer-Logistik" className="topbar-logo" />
        <button
          className="link"
          onClick={async () => {
            await fetch("/api/login", { method: "DELETE" });
            location.href = "/login";
          }}
        >
          Abmelden
        </button>
      </header>

      <section className="hero" style={{ backgroundImage: `linear-gradient(100deg, rgba(14,24,46,.94) 30%, rgba(38,57,96,.35)), url(${HERO})` }}>
        <div className="hero-text">
          <span className="eyebrow">Logistikgebäude Pratteln · Obergeschoss</span>
          <h1>Was wäre, wenn die Anlage schon seit 2021 laufen würde?</h1>
          <p>
            Simulation Stunde für Stunde mit echten Wetterdaten von MeteoSchweiz ({nf0.format(total.h)} Stunden, {zeitraum}) und
            den EBL-Stromtarifen des jeweiligen Jahres. Ändern Sie links die Einstellungen und sehen Sie sofort die Wirkung.
          </p>
        </div>
        {params.pv ? (
          <div className="hero-kpi">
            <span>{tick ? `Einsparung durch PV bis ${MONATE[tick.monat - 1]} ${tick.jahr}` : `Einsparung durch PV ${zeitraum}`}</span>
            <strong>
              <Num value={tick ? cum[cursor] : total.einsparung} format={chf} ms={playing ? 100 : 1400} />
            </strong>
            <button className="btn btn-play" onClick={play} disabled={playing}>
              {playing ? "Zeitraffer läuft …" : "▶ Zeitraffer starten"}
            </button>
          </div>
        ) : (
          <div className="hero-kpi">
            <span>Stromkosten ohne PV {zeitraum}</span>
            <strong className="neutral">
              <Num value={total.kostenOhne} format={chf} />
            </strong>
            <button className="btn btn-play" onClick={() => setParams((p) => ({ ...p, pv: true }))}>
              ☀ PV einschalten
            </button>
          </div>
        )}
      </section>

      <div className="layout">
        <aside className="panel">
          <h2>Einstellungen</h2>
          <div className="presets">
            {PRESETS.map((s) => (
              <button key={s.name} className={same(params, s.p) ? "preset on" : "preset"} onClick={() => setParams(s.p)}>
                <strong>{s.name}</strong>
                <span>{s.sub}</span>
              </button>
            ))}
          </div>
          <Schalter
            label="Photovoltaik-Anlage" on={params.pv} onChange={set("pv")}
            info="617.5 kWp auf dem Dach, Ost/West. Ausschalten zeigt die Kosten ohne PV."
          />
          <Regler
            label="Luftwechsel" unit="-fach" value={params.lw} basis={BASIS.lw} min={2} max={6} step={0.5} onChange={set("lw")}
            info={`Wie oft pro Stunde die Luft in den Kühllagern ausgetauscht wird. Aktuell ${nf0.format(luftmenge)} m³/h.`}
          />
          <Anlagen params={params} setParams={setParams} />
          <Regler
            label="EER Kältemaschine" unit="" value={params.eer} basis={BASIS.eer} min={2} max={6} step={0.5} onChange={set("eer")}
            info={`Wie viel Kälte aus 1 kWh Strom entsteht. Kälte macht hier ${nf0.format((total.kaelte / total.tot) * 100)} % des Stroms aus.`}
          />
          <Regler
            label="COP Wärmeerzeugung" unit="" value={params.cop} basis={BASIS.cop} min={2} max={6} step={0.5} onChange={set("cop")}
            info="Effizienz der Wärmepumpe für die Erhitzer. Wärmebedarf ist dank Wärmerückgewinnung klein."
          />
          <div className={`impact ${istBasis ? "" : dJahr > 0 ? "worse" : "better"}`}>
            <span>Gegenüber Planung</span>
            {istBasis ? (
              <strong>= Planung</strong>
            ) : (
              <>
                <strong>
                  <Num value={dJahr} format={(v) => signed(v, chf)} /> / Jahr
                </strong>
                <small>
                  {signed(dMwh, mwh)} Strom pro Jahr · {signed(total.kostenMit - bTotal.kostenMit, chf)} über {zeitraum}
                </small>
              </>
            )}
          </div>
        </aside>

        <main className="content">
          <div className="kpis">
            <div className="kpi reveal">
              <span>Stromverbrauch</span>
              <strong><Num value={schnitt.tot} format={mwh} /></strong>
              <small>Ø pro Jahr {zeitraum}</small>
            </div>
            <div className="kpi reveal">
              <span>Stromkosten {params.pv ? "mit PV" : "ohne PV"}</span>
              <strong><Num value={schnitt.kostenMit} format={chf} /></strong>
              <small>Ø pro Jahr, exkl. MWST</small>
            </div>
            <div className="kpi reveal">
              <span>PV-Produktion</span>
              <strong>{params.pv ? <Num value={schnitt.pv} format={mwh} /> : "aus"}</strong>
              <small>Ø pro Jahr</small>
            </div>
            <div className="kpi reveal">
              <span>Strom vom eigenen Dach</span>
              <strong>{params.pv ? <Num value={(total.ev / total.tot) * 100} format={(v) => nf1.format(v) + " %"} /> : "–"}</strong>
              <small>{params.pv ? `${nf0.format((total.ev / total.pv) * 100)} % der PV selbst genutzt` : "PV ausgeschaltet"}</small>
            </div>
          </div>

          <section className="card reveal">
            <h2>Stromverbrauch pro Jahr</h2>
            <p className="card-sub">Aufgeteilt nach Verbraucher, mit Durchschnitt {zeitraum}.</p>
            <ChartBox config={cfgStromJahr} height={320} />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Total</th>
                    <th>Ventilatoren</th>
                    <th>Kälte</th>
                    <th>Wärme</th>
                    <th>Pumpen</th>
                    <th>PV genutzt</th>
                    <th>Netzbezug</th>
                    <th>Stromkosten</th>
                  </tr>
                </thead>
                <tbody>
                  {tabelle.map((r) => (
                    <tr key={r.label} className={r.schnitt ? "avg" : ""}>
                      <th>{r.label}</th>
                      <td>{mwh(r.tot)}</td>
                      <td>{mwh(r.vent)}</td>
                      <td>{mwh(r.kaelte)}</td>
                      <td>{mwh(r.waerme)}</td>
                      <td>{mwh(r.pumpen)}</td>
                      <td>{params.pv ? mwh(r.ev) : "–"}</td>
                      <td>{mwh(r.netz)}</td>
                      <td>{chf(r.kostenMit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card reveal">
            <div className="card-head">
              <h2>Stromverbrauch pro Monat</h2>
              <div className="seg">
                <button className={monatsAnsicht === "schnitt" ? "on" : ""} onClick={() => setMonatsAnsicht("schnitt")}>
                  Ø {zeitraum}
                </button>
                {data.jahre.map((y) => (
                  <button key={y} className={monatsAnsicht === y ? "on" : ""} onClick={() => setMonatsAnsicht(y)}>
                    {y}
                  </button>
                ))}
              </div>
            </div>
            <p className="card-sub">Im Sommer steigt der Kältebedarf. Genau dann liefert auch die PV-Anlage am meisten.</p>
            <ChartBox config={cfgStromMonat} height={340} />
          </section>

          {params.pv && (
            <section className="card reveal">
              <div className="card-head">
                <h2>Kumulierte Einsparung durch PV</h2>
                <button className="btn btn-small" onClick={play} disabled={playing}>▶ Zeitraffer</button>
              </div>
              <p className="card-sub">So wäre die Einsparung seit Januar 2021 Monat für Monat gewachsen.</p>
              <ChartBox config={cfgKumuliert} height={280} />
            </section>
          )}

          <div className="grid2">
            <section className="card reveal">
              <h2>Stromkosten pro Jahr</h2>
              <p className="card-sub">Energie, Leistung, Grundpreis, abzüglich Rückliefervergütung. Exkl. MWST.</p>
              <ChartBox config={cfgKosten} height={300} />
            </section>
            <section className="card image-card reveal" style={{ backgroundImage: `linear-gradient(180deg, rgba(14,24,46,.1), rgba(14,24,46,.85)), url(${TRAILER})` }}>
              <div>
                <span className="eyebrow">Die Strompreise spielen mit</span>
                {params.pv ? (
                  <>
                    <h2>{best.jahr} hätte die PV am meisten gebracht</h2>
                    <p>Bei hohen Strompreisen zählt jede selbst erzeugte Kilowattstunde doppelt: {chf(best.einsparung)} Einsparung in einem Jahr.</p>
                  </>
                ) : (
                  <>
                    <h2>Ohne PV voll den Strompreisen ausgesetzt</h2>
                    <p>Schalten Sie die PV ein und sehen Sie, wie viel davon das eigene Dach abfedert.</p>
                  </>
                )}
              </div>
            </section>
          </div>

          <section className="card reveal">
            <h2>Jeder Tag von 2021 bis 2025</h2>
            <p className="card-sub">Jedes Kästchen ist ein Tag. Ändern Sie links die Einstellungen und sehen Sie, wie sich die Farben verschieben.</p>
            <Kalender data={data} params={params} />
          </section>

          <section className="card notes reveal">
            <h2>Annahmen und Grenzen</h2>
            <ul>
              <li>Wetter: Stundenwerte MeteoSchweiz Basel-Binningen, ca. 10 km vom Standort, {zeitraum}.</li>
              <li>Luftwechsel: Ventilator-, Kälte- und Wärmeenergie proportional zur Luftmenge. Planung 5-fach = 127&apos;173 m³/h, 24/7.</li>
              <li>PV: 617.5 kWp, Ost/West 10°, Wechselrichter 500 kVA, simuliert mit pvlib. Keine Verschattung durch Dachaufbauten gerechnet.</li>
              <li>Nur Lüftung: Ventilatoren, Erhitzer, Gerätekühler, Pumpen und Lüftungsanteil der Umluftkühler. Pumpenstrom fix 3 % der Kälte- und Wärmeenergie. Keine Raumlasten.</li>
              <li>Tarif: EBL Grundversorgung M-DLB des jeweiligen Jahres, Leistungsspitze als Stundenmittel im Hochtarif. Exkl. MWST.</li>
              <li>Eigenverbrauch als Stundenbilanz ohne Speicher. Grobschätzung für den Variantenvergleich, keine Garantie.</li>
            </ul>
            {refMit > 0 && (
              <p className="check">
                Abgleich mit der Excel-Berechnung (Planung, {zeitraum}): Excel {chf(refMit)} · Simulator {chf(bTotal.kostenMit)}
                {Math.abs(bTotal.kostenMit / refMit - 1) < 0.001 ? " ✓ identisch" : ` · Abweichung ${nf1.format((bTotal.kostenMit / refMit - 1) * 100)} %`}
              </p>
            )}
          </section>
        </main>
      </div>
      <footer className="footer">Energie-Simulator Lüftung Kühllager Pratteln · Grobschätzung, alle Beträge exkl. MWST</footer>
    </div>
  );
}

function Splash({ status }) {
  return (
    <div className="splash" style={{ backgroundImage: `linear-gradient(120deg, rgba(14,24,46,.94), rgba(38,57,96,.6)), url(${HERO})` }}>
      <div className="splash-card">
        <img src={LOGO} alt="Kipfer-Logistik" className="login-logo" />
        {status.phase === "laden" && (
          <>
            <p>Lade 5 Jahre Stundenwerte …</p>
            <div className="bar">
              <div style={{ width: `${(status.progress || 0.05) * 100}%` }} />
            </div>
          </>
        )}
        {status.phase === "leer" && (
          <>
            <p>Noch keine Daten in der Datenbank.</p>
            <a className="btn" href="/import">Excel importieren →</a>
          </>
        )}
        {status.phase === "fehler" && <p className="login-error">Fehler: {status.error}</p>}
      </div>
    </div>
  );
}
