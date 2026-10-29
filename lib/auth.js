export const COOKIE = "kipfer_auth";

// Cookie-Wert = Hash des Passworts. Ändert sich das Passwort, sind alte Cookies ungültig.
export async function tokenFor(password) {
  const data = new TextEncoder().encode("kipfer:" + password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
