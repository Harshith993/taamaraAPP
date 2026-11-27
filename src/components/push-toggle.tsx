"use client";

/** "Notifications on this phone": turns web push on or off for this device (Phase 10). */
import { BellRing } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";

function keyBytes(base64url: string) {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type State = "checking" | "unsupported" | "blocked" | "off" | "on" | "working";

export function PushToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
      if (Notification.permission === "denied") return setState("blocked");
      const reg = await navigator.serviceWorker.register("/sw.js");
      setState((await reg.pushManager.getSubscription()) ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function turnOn() {
    setState("working");
    setError(null);
    try {
      if ((await Notification.requestPermission()) !== "granted") return setState("blocked");
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const r = await fetch("/api/v1/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Couldn't turn it on.");
      setState("on");
    } catch (e) {
      setError((e as Error).message);
      setState("off");
    }
  }

  async function turnOff() {
    setState("working");
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/v1/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    setState("off");
  }

  if (state === "checking" || state === "unsupported") return null;
  return (
    <section aria-label="Notifications on this device" className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white p-3.5 shadow-[var(--shadow-card)]">
      <BellRing aria-hidden className="size-5 text-[#7c3aed]" />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="font-semibold">Notifications on this device</span>
        <span className="text-[13px] text-ink-quiet">
          {state === "on" ? "On: new notifications pop up here even when the app is closed." : state === "blocked" ? "Blocked in this browser's settings. Allow notifications for this site to turn them on." : "Off: you only see them in the app."}
        </span>
        {error && <span className="text-[13px] font-semibold text-now">{error}</span>}
      </span>
      {state !== "blocked" && (
        <Button type="button" variant={state === "on" ? "secondary" : "primary"} disabled={state === "working"} onClick={state === "on" ? turnOff : turnOn}>
          {state === "working" ? "One moment…" : state === "on" ? "Turn off" : "Turn on"}
        </Button>
      )}
    </section>
  );
}
