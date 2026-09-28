import { useState } from "react";
import { post } from "../../api/client";

export interface SessionUser {
  email: string;
  role: "ADMIN" | "OWNER";
}

export default function LoginPage({ onSuccess }: { onSuccess: (u: SessionUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    try {
      const j = await post<{ user: SessionUser }>("/api/auth/login", { email, password });
      onSuccess(j.user);
    } catch {
      setErr("Invalid email or password");
    }
  };

  return (
    <form onSubmit={login}>
      <h2>Log in</h2>
      <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit">Log in</button>
      {err && <span style={{ color: "red" }}> {err}</span>}
    </form>
  );
}
