import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

const KEYS = ["monat", "tag", "std", "ht", "t", "waerme", "kg", "ku", "vent", "pv", "preis", "rueck"];

// Ohne ?jahr: Übersicht (Jahre, Tarife, Excel-Referenz). Mit ?jahr: Stundenwerte als Spalten.
export async function GET(req) {
  try {
    const db = neon(process.env.DATABASE_URL);
    const jahr = new URL(req.url).searchParams.get("jahr");

    if (!jahr) {
      const [{ t }] = await db`select to_regclass('public.stunden')::text as t`;
      if (!t) return Response.json({ jahre: [], tarife: [], referenz: [], count: 0 });
      const [jahre, tarife, referenz] = await Promise.all([
        db`select jahr, count(*)::int as n from stunden group by jahr order by jahr`,
        db`select * from tarife order by jahr`,
        db`select * from referenz order by jahr`,
      ]);
      return Response.json({ jahre, tarife, referenz, count: jahre.reduce((s, r) => s + r.n, 0) });
    }

    const rows = await db`select monat, tag, std, ht, t, waerme, kg, ku, vent, pv, preis, rueck
      from stunden where jahr = ${Number(jahr)} order by i`;
    const cols = {};
    for (const k of KEYS) cols[k] = new Array(rows.length);
    rows.forEach((r, i) => {
      for (const k of KEYS) cols[k][i] = k === "ht" ? (r.ht ? 1 : 0) : r[k];
    });
    return Response.json(cols, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
