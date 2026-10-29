import { neon } from "@neondatabase/serverless";

export const maxDuration = 60;

export async function POST(req) {
  try {
    const db = neon(process.env.DATABASE_URL);
    const body = await req.json();

    if (body.action === "reset") {
      await db`drop table if exists stunden`;
      await db`drop table if exists tarife`;
      await db`drop table if exists referenz`;
      await db`create table stunden (
        i integer primary key, jahr smallint not null, monat smallint not null,
        tag smallint, std smallint, ht boolean,
        t double precision, waerme double precision, kg double precision, ku double precision,
        vent double precision, pv double precision, preis double precision, rueck double precision)`;
      await db`create index stunden_jahr on stunden (jahr)`;
      await db`create table tarife (jahr smallint primary key, leistung double precision, grund double precision)`;
      await db`create table referenz (jahr smallint primary key, strom double precision, pv double precision,
        kosten_mit double precision, kosten_ohne double precision)`;
      return Response.json({ ok: true });
    }

    if (body.action === "stunden") {
      const c = body.cols;
      await db.query(
        `insert into stunden (i, jahr, monat, tag, std, ht, t, waerme, kg, ku, vent, pv, preis, rueck)
         select * from unnest($1::int[], $2::smallint[], $3::smallint[], $4::smallint[], $5::smallint[],
           $6::boolean[], $7::float8[], $8::float8[], $9::float8[], $10::float8[], $11::float8[],
           $12::float8[], $13::float8[], $14::float8[])`,
        [c.i, c.jahr, c.monat, c.tag, c.std, c.ht, c.t, c.waerme, c.kg, c.ku, c.vent, c.pv, c.preis, c.rueck]
      );
      return Response.json({ ok: true, n: c.i.length });
    }

    if (body.action === "tarife") {
      for (const r of body.rows) {
        await db`insert into tarife values (${r.jahr}, ${r.leistung}, ${r.grund})`;
      }
      return Response.json({ ok: true });
    }

    if (body.action === "referenz") {
      for (const r of body.rows) {
        await db`insert into referenz values (${r.jahr}, ${r.strom}, ${r.pv}, ${r.kosten_mit}, ${r.kosten_ohne})`;
      }
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Unbekannte Aktion" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
