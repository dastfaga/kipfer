import { NextResponse } from "next/server";
import { COOKIE, tokenFor } from "./lib/auth";

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();

  const password = process.env.APP_PASSWORD;
  const cookie = req.cookies.get(COOKIE)?.value;
  if (password && cookie && cookie === (await tokenFor(password))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}
