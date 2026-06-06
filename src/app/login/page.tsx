"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function Login() {
  const supabase = createClient();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return setMsg(error.message);
      router.push("/"); router.refresh();
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      setMsg(error ? error.message : "Account created — signing you in…");
      if (!error) { router.push("/"); router.refresh(); }
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="mark">L</div>
        <h1>{mode === "in" ? "Welcome back" : "Create your ledger"}</h1>
        <p className="sub">Your finances, in plain language.</p>
        <input className="field" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="field" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn-solid" style={{ width: "100%", marginTop: 4 }} type="submit">
          {mode === "in" ? "Sign in" : "Sign up"}
        </button>
        {msg && <p className="err">{msg}</p>}
        <p className="sub" style={{ marginTop: 16, marginBottom: 0 }}>
          {mode === "in" ? "New here? " : "Have an account? "}
          <a style={{ color: "var(--emerald)", cursor: "pointer" }} onClick={() => { setMode(mode === "in" ? "up" : "in"); setMsg(""); }}>
            {mode === "in" ? "Create an account" : "Sign in"}
          </a>
        </p>
      </form>
    </div>
  );
}
