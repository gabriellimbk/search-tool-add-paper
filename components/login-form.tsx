"use client";

import { FormEvent, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export default function LoginForm({
  initialError,
  nextPath
}: {
  initialError: string | null;
  nextPath: string;
}) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [message, setMessage] = useState("Sign in to use Add Paper.");
  const [pinSent, setPinSent] = useState(false);

  function validateEmailDomain(input: string) {
    return input.trim().toLowerCase().endsWith("@ri.edu.sg");
  }

  async function handleSendPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (!validateEmailDomain(normalizedEmail)) {
        throw new Error("Use an email address ending with @ri.edu.sg.");
      }

      const { error: signInError } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          shouldCreateUser: true
        }
      });

      if (signInError) {
        throw signInError;
      }

      setPinSent(true);
      setMessage("A 6-digit PIN has been sent to your email.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to send PIN.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (!validateEmailDomain(normalizedEmail)) {
        throw new Error("Use an email address ending with @ri.edu.sg.");
      }

      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: token.trim(),
        type: "email"
      });

      if (verifyError) {
        throw verifyError;
      }

      window.location.href = nextPath || "/";
    } catch (verifySubmissionError) {
      setError(verifySubmissionError instanceof Error ? verifySubmissionError.message : "Unable to verify PIN.");
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
            <p>Use your authorised <code>@ri.edu.sg</code> email to access the Add Paper converter.</p>
          </div>

          <form className="section" onSubmit={handleSendPin}>
            <label className="section">
              <span>Email</span>
              <input
                className="text-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@ri.edu.sg"
                required
              />
            </label>
            <div className="actions">
              <button className="button button-primary" type="submit" disabled={busy}>
                {busy ? "Sending..." : "Send 6-Digit PIN"}
              </button>
            </div>
          </form>

          {pinSent ? (
            <form className="section" onSubmit={handleVerifyPin}>
              <label className="section">
                <span>6-Digit PIN</span>
                <input
                  className="text-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  value={token}
                  onChange={(event) => setToken(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  required
                />
              </label>
              <div className="actions">
                <button className="button button-primary" type="submit" disabled={busy || token.length !== 6}>
                  {busy ? "Verifying..." : "Verify PIN"}
                </button>
              </div>
            </form>
          ) : null}

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
