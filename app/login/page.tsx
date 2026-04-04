"use client";

import { FormEvent, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("Sign in to use Add Paper.");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next") ?? "/";
      const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

      const { error: signInError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo
        }
      });

      if (signInError) {
        throw signInError;
      }

      setMessage("Check your email for the sign-in link.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="single-column">
        <aside className="panel controls">
          <div className="section">
            <h1>Sign In</h1>
            <p>Use your authorised email to access the Add Paper converter.</p>
          </div>

          <form className="section" onSubmit={handleSubmit}>
            <label className="section">
              <span>Email</span>
              <input
                className="text-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>
            <div className="actions">
              <button className="button button-primary" type="submit" disabled={busy}>
                {busy ? "Sending..." : "Send Magic Link"}
              </button>
            </div>
          </form>

          <div className="section">
            <div className="status-box">
              <div>{message}</div>
              {error ? (
                <div className="status-error" style={{ marginTop: 8 }}>
                  {error}
                </div>
              ) : null}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
