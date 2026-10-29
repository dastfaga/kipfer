"use client";
import { useState } from "react";
import { HERO, LOGO } from "../../lib/brand";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      location.href = "/";
    } else {
      setError(json.error || "Anmeldung fehlgeschlagen");
      setBusy(false);
    }
  }

  return (
    <main
      className="login"
      style={{
        backgroundImage: `linear-gradient(120deg, rgba(14,24,46,.93), rgba(38,57,96,.55)), url(${HERO})`,
      }}
    >
      <form className="login-card" onSubmit={submit}>
        <img src={LOGO} alt="Kipfer-Logistik" className="login-logo" />
        <h1>Energie-Simulator</h1>
        <p>Lüftung Kühllager mit PV · Logistikgebäude Pratteln</p>
        <label>
          Passwort
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
        </label>
        <div className="login-hint">Hinweis: PLZ Lausen</div>
        {error && <div className="login-error">{error}</div>}
        <button disabled={busy}>{busy ? "Prüfe …" : "Öffnen"}</button>
      </form>
    </main>
  );
}
