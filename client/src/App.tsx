import { useEffect, useState } from "react";

export default function App() {
  const [health, setHealth] = useState<any>(null);
  const [me, setMe] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  const refreshMe = () =>
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((j) => setMe(j?.user ?? null));

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch((e) => setHealth({ status: "error: " + e }));
    refreshMe().catch(() => setMe(null));
  }, []);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) { setErr("Invalid email or password"); return; }
    setPassword("");
    refreshMe();
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setMe(null);
  };

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 640 }}>
      <h1>Employee Tracker</h1>
      <p>API status: {health ? JSON.stringify(health.status) : "loading…"}</p>
      {me ? (
        <p>Signed in as {me.email} ({me.role}) <button onClick={logout}>Log out</button></p>
      ) : (
        <form onSubmit={login}>
          <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit">Log in</button>
          {err && <span style={{ color: "red" }}> {err}</span>}
        </form>
      )}
      {health && <pre>{JSON.stringify(health, null, 2)}</pre>}
    </main>
  );
}
