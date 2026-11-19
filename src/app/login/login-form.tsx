"use client";

import { useState } from "react";
import { Button, Field, Notice } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { normalizePhone } from "@/lib/phone";

/** One box for phone or email, then the password. Phone numbers can be typed any way. */
export function LoginForm({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const id = String(form.get("login") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!id || !password) {
      setError("Enter your phone number or email, and your password.");
      return;
    }
    setBusy(true);
    try {
      const result = id.includes("@")
        ? await authClient.signIn.email({ email: id.toLowerCase(), password })
        : await (async () => {
            const phoneNumber = normalizePhone(id);
            if (!phoneNumber) return { error: { message: "That phone number doesn't look right." } };
            return authClient.signIn.phoneNumber({ phoneNumber, password });
          })();
      if (result.error) {
        const msg = result.error.message ?? "";
        setError(
          /switched off/i.test(msg)
            ? msg
            : /too many/i.test(msg) || (result.error as { status?: number }).status === 429
              ? "Too many tries. Wait a few minutes and try again."
              : "That phone/email and password don't match. Check them and try again.",
        );
        setBusy(false);
        return;
      }
      window.location.assign(next);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Phone number or email" name="login" autoComplete="username" inputMode="email" placeholder="98100 00005" required />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <Button type="submit" disabled={busy} className="min-h-12 text-[15px]">
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
