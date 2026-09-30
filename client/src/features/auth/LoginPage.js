import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { post } from "../../api/client";
import { Logo } from "../../components/polish";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
export default function LoginPage({ onSuccess }) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [err, setErr] = useState("");
    const login = async (e) => {
        e.preventDefault();
        setErr("");
        try {
            const j = await post("/api/auth/login", { email, password });
            onSuccess(j.user);
        }
        catch {
            setErr("Invalid email or password");
        }
    };
    return (_jsx("div", { className: "-m-6 flex min-h-screen items-center justify-center bg-muted/40 p-6", children: _jsxs(Card, { className: "w-full max-w-sm", children: [_jsxs(CardHeader, { className: "items-center text-center", children: [_jsx(Logo, { size: 56 }), _jsx(CardTitle, { className: "mt-3 text-xl", children: "Employee Tracker" }), _jsx(CardDescription, { children: "Sign in to continue" })] }), _jsx(CardContent, { children: _jsxs("form", { onSubmit: login, className: "space-y-4", children: [_jsxs("div", { className: "space-y-2", children: [_jsx("label", { htmlFor: "login-email", className: "text-sm font-medium leading-none", children: "Email" }), _jsx(Input, { id: "login-email", placeholder: "you@example.com", value: email, onChange: (e) => setEmail(e.target.value), autoComplete: "email" })] }), _jsxs("div", { className: "space-y-2", children: [_jsx("label", { htmlFor: "login-password", className: "text-sm font-medium leading-none", children: "Password" }), _jsx(Input, { id: "login-password", placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", type: "password", value: password, onChange: (e) => setPassword(e.target.value), autoComplete: "current-password" })] }), _jsx(Button, { type: "submit", className: "w-full", children: "Log in" }), err && (_jsxs("div", { role: "alert", className: "rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3", children: [_jsx("p", { className: "text-sm font-semibold text-destructive", children: "Couldn't sign you in" }), _jsx("p", { className: "text-sm text-destructive", children: "Check your email and password, then try again." })] }))] }) })] }) }));
}
