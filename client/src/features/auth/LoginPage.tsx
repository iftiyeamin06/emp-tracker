import { useState } from "react";
import { post } from "../../api/client";
import { Card, Logo, Notice } from "../../components/polish";

export interface SessionUser {
  email: string;
  role: "ADMIN" | "OWNER";
}

const input: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  margin: "8px 0",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  fontSize: 15,
};

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
    <Card>
      <Logo />
      <h2 style={{ margin: "12px 0 4px" }}>Employee Tracker</h2>
      <p style={{ margin: "0 0 16px", color: "#6b7280", fontSize: 14 }}>Sign in to continue</p>
      <form onSubmit={login} style={{ textAlign: "left" }}>
        <input style={input} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <input style={input} placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <button
          type="submit"
          style={{
            width: "100%",
            padding: "10px 12px",
            marginTop: 8,
            border: 0,
            borderRadius: 8,
            background: "#1d4ed8",
            color: "#fff",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          Log in
        </button>
        {err && <Notice title="Couldn't sign you in" message="Check your email and password, then try again." />}
      </form>
    </Card>
  );
}
