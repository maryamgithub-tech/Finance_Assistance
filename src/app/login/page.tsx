"use client";

// TEMPORARY minimal auth page so you can log in and test. Real UI in step 6.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function Login() {
  const supabase = createClient();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  async function signIn() {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return setMsg(error.message);
    router.push("/");
    router.refresh();
  }

  async function signUp() {
    const { error } = await supabase.auth.signUp({ email, password });
    setMsg(
      error
        ? error.message
        : "Account created. If email confirmation is on, confirm via email — or disable it in Supabase > Authentication > Providers for dev."
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-3 p-6">
      <h1 className="text-lg font-semibold">Sign in</h1>
      <input
        className="rounded border p-2"
        placeholder="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="rounded border p-2"
        type="password"
        placeholder="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <div className="flex gap-2">
        <button className="flex-1 rounded bg-black px-4 py-2 text-white" onClick={signIn}>
          Sign in
        </button>
        <button className="flex-1 rounded border px-4 py-2" onClick={signUp}>
          Sign up
        </button>
      </div>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </div>
  );
}
