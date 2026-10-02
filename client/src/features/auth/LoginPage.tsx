import { useState } from "react";
import { post } from "../../api/client";
import { Logo } from "../../components/polish";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";

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
    <div className="-m-6 flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Logo size={56} />
          <CardTitle className="mt-3 text-xl">HourBook</CardTitle>
          <CardDescription>Sign in to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={login} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="login-email" className="text-sm font-medium leading-none">
                Email
              </label>
              <Input
                id="login-email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="login-password" className="text-sm font-medium leading-none">
                Password
              </label>
              <Input
                id="login-password"
                placeholder="••••••••"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" className="w-full">
              Log in
            </Button>
            {err && (
              <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3">
                <p className="text-sm font-semibold text-destructive">Couldn&apos;t sign you in</p>
                <p className="text-sm text-destructive">Check your email and password, then try again.</p>
              </div>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
