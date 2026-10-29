"use client";
import { useState } from "react";
import { LOGO } from "../../lib/brand";

const SHEETJS = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
const CHUNK = 4000;

function loadXlsx() {
  return new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    const s = document.createElement("script");
    s.src = SHEETJS;
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error("Excel-Leser konnte nicht geladen werden"));
    document.head.appendChild(s);
  });
}

async function post(body) {
  const res = await fetch("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

function sheetRows(XLSX, wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Blatt «${name}» fehlt in der Excel-Datei`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const head = rows[0].map((h) => String(h ?? "").trim());
  const ix = (col) => {
    const k = head.indexOf(col);
    if (k < 0) throw new Error(`Spalte «${col}» fehlt im Blatt «${name}»`);
    return k;
  };
  return { rows: rows.slice(1).filter((r) => r && r[0] != null && r[0] !== ""), ix };
}

// "2021-01-01 01:00+0100" = Ende der Stunde, Lokalzeit -> Tag im Jahr und Stunde (Beginn)
function lokal(s, jahr) {
  const str = String(s);
  const t = new Date(Date.UTC(+str.slice(0, 4), +str.slice(5, 7) - 1, +str.slice(8, 10), +str.slice(11, 13)) - 3600000);
  if (t.getUTCFullYear() !== jahr) return { tag: -1, std: t.getUTCHours() };
  return { tag: Math.floor((t - Date.UTC(jahr, 0, 1)) / 86400000), std: t.getUTCHours() };
}

const num = (v) => (v == null || v === "" ? null : Number(v));

export default function Import() {
  const [log, setLog] = useState([]);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const say = (m) => setLog((l) => [...l, m]);

  async function run(file) {
    setBusy(true);
    setLog([]);
    setProgress(0);
    try {
      say(`Lese ${file.name} …`);
      const XLSX = await loadXlsx();
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", dense: true });

      const st = sheetRows(XLSX, wb, "Stunden");
      const c = {
        jahr: st.ix("jahr"), monat: st.ix("monat"), lokal: st.ix("zeit_lokal_ende"), tarif: st.ix("tarifzeit"),
        t: st.ix("t_aussen_c"), waerme: st.ix("waerme_erhitzer_kw"), kg: st.ix("kaelte_geraet_kw"),
        ku: st.ix("kaelte_ulk_lueftungsanteil_kw"), vent: st.ix("strom_ventilatoren_kw"), pv: st.ix("pv_kw"),
        preis: st.ix("preis_rp_kwh"), rueck: st.ix("rueck_rp_kwh"),
      };
      const ta = sheetRows(XLSX, wb, "Tarife");
      const ja = sheetRows(XLSX, wb, "Jahr");
      say(`${st.rows.length.toLocaleString("de-CH")} Stunden gefunden.`);

      await post({ action: "reset" });
      await post({
        action: "tarife",
        rows: ta.rows.map((r) => ({
          jahr: num(r[ta.ix("jahr")]),
          leistung: num(r[ta.ix("leistungspreis_chf_kw_monat")]),
          grund: num(r[ta.ix("grundpreis_chf_monat")]),
        })),
      });
      await post({
        action: "referenz",
        rows: ja.rows.map((r) => ({
          jahr: num(r[ja.ix("jahr")]),
          strom: num(r[ja.ix("strom_total_kwh")]),
          pv: num(r[ja.ix("pv_produktion_kwh")]),
          kosten_mit: num(r[ja.ix("kosten_netto_mit_pv_chf")]),
          kosten_ohne: num(r[ja.ix("kosten_ohne_pv_chf")]),
        })),
      });
      say("Tarife und Excel-Referenzwerte gespeichert.");

      for (let start = 0; start < st.rows.length; start += CHUNK) {
        const part = st.rows.slice(start, start + CHUNK);
        const cols = { i: [], jahr: [], monat: [], tag: [], std: [], ht: [], t: [], waerme: [], kg: [], ku: [], vent: [], pv: [], preis: [], rueck: [] };
        part.forEach((r, k) => {
          const jahr = num(r[c.jahr]);
          const { tag, std } = lokal(r[c.lokal], jahr);
          cols.i.push(start + k);
          cols.jahr.push(jahr);
          cols.monat.push(num(r[c.monat]));
          cols.tag.push(tag);
          cols.std.push(std);
          cols.ht.push(String(r[c.tarif]).toUpperCase() === "HT");
          for (const key of ["t", "waerme", "kg", "ku", "vent", "pv", "preis", "rueck"]) cols[key].push(num(r[c[key]]));
        });
        await post({ action: "stunden", cols });
        setProgress(Math.min(1, (start + CHUNK) / st.rows.length));
      }
      say("Fertig! Alle Daten sind in der Datenbank.");
    } catch (e) {
      say("Fehler: " + e.message);
    }
    setBusy(false);
  }

  return (
    <main className="import">
      <div className="import-card">
        <img src={LOGO} alt="Kipfer-Logistik" className="login-logo" />
        <h1>Daten importieren</h1>
        <p>
          Excel-Datei «Energie_Kosten_Lueftung_PV_Pratteln.xlsx» auswählen. Die Datei wird im Browser gelesen und
          direkt in die Datenbank geschrieben. Bestehende Daten werden ersetzt.
        </p>
        <input type="file" accept=".xlsx" disabled={busy} onChange={(e) => e.target.files[0] && run(e.target.files[0])} />
        {progress > 0 && (
          <div className="bar">
            <div style={{ width: `${progress * 100}%` }} />
          </div>
        )}
        <ul className="import-log">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        {!busy && progress >= 1 && (
          <a className="btn" href="/">
            Zum Simulator →
          </a>
        )}
      </div>
    </main>
  );
}
