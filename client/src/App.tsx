import { useEffect, useState } from "react";

export default function App() {
  const [health, setHealth] = useState<any>(null);
  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch((e) => setHealth({ status: "error: " + e }));
  }, []);
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Employee Tracker</h1>
      <p>API status: {health ? JSON.stringify(health.status) : "loading…"}</p>
      {health && <pre>{JSON.stringify(health, null, 2)}</pre>}
    </main>
  );
}
