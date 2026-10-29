import { NextResponse } from "next/server";
import { COOKIE, tokenFor } from "../../../lib/auth";

export async function POST(req) {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    return NextResponse.json(
      { error: "Das Passwort ist noch nicht eingerichtet (APP_PASSWORD fehlt in Vercel)." },
      { status: 503 }
    );
  }
  const body = await req.json().catch(() => ({}));
  if (body.password !== password) {
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ error: "Falsches Passwort" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await tokenFor(password), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
