import { useEffect, useRef, useState } from "react";
import type { Profile } from "../lib/profile";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type TurnstileApi = {
  render: (el: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void }) => string;
  remove: (id: string) => void;
};

export default function AlertForm({ profile, deviceName }: { profile: Profile; deviceName: string }) {
  const [email, setEmail] = useState("");
  const [weekly, setWeekly] = useState(true);
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancel = false;
    fetch("/api/alerts/")
      .then((response) => response.json())
      .then((body: { turnstileSiteKey?: string | null }) => {
        if (!cancel) setSiteKey(body.turnstileSiteKey || null);
      })
      .catch(() => {
        if (!cancel) setSiteKey(null);
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!siteKey || !widgetRef.current) return;
    const host = widgetRef.current;
    let widgetId = "";
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => {
      const turnstile = (window as Window & { turnstile?: TurnstileApi }).turnstile;
      if (!turnstile || !host.isConnected) return;
      widgetId = turnstile.render(host, {
        sitekey: siteKey,
        callback: (token) => setTurnstileToken(token),
        "expired-callback": () => setTurnstileToken(""),
      });
    };
    document.head.appendChild(script);
    return () => {
      script.remove();
      const turnstile = (window as Window & { turnstile?: TurnstileApi }).turnstile;
      if (widgetId && turnstile) turnstile.remove(widgetId);
    };
  }, [siteKey]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setDevUrl(null);
    try {
      const response = await fetch("/api/alerts/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          weeklyDigest: weekly,
          company_website: companyWebsite,
          turnstileToken,
          ...profile,
        }),
      });
      const body = (await response.json()) as { ok?: boolean; message?: string; devConfirmUrl?: string; provider?: string };
      if (body.provider === "unconfigured" || body.provider === "browser" || body.provider === "memory" || body.provider === "file") {
        const local = JSON.parse(localStorage.getItem("gpufit.alert-mock") || "[]");
        local.push({ email, profile, weekly, provider: body.provider, at: new Date().toISOString() });
        localStorage.setItem("gpufit.alert-mock", JSON.stringify(local));
      }
      if (body.provider === "unconfigured") {
        setStatus("done");
        setMessage("Saved in this browser. Email alerts are not switched on for this site yet, so nothing will be sent.");
        return;
      }
      if (!response.ok || body.ok === false) {
        setStatus("error");
        setMessage(body.message || "Could not save that signup.");
        return;
      }
      setStatus("done");
      setMessage(body.message || "Signup received.");
      setDevUrl(body.devConfirmUrl || null);
    } catch {
      setStatus("error");
      setMessage("The alerts endpoint did not respond.");
    }
  }

  return (
    <form onSubmit={submit} className="relative grid gap-3">
      <p className="m-0 text-sm text-[var(--muted)]">
        Email me when a newly tracked model fits <strong className="text-[var(--ink)]">{deviceName}</strong>. No account. Double opt-in before anything is sent.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-label="Email"
        />
        <Button type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Get alerts"}
        </Button>
      </div>
      <div className="absolute -left-[9999px] h-0 overflow-hidden" aria-hidden="true">
        <label>
          Company website
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={companyWebsite}
            onChange={(event) => setCompanyWebsite(event.target.value)}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
        <input type="checkbox" checked={weekly} onChange={(event) => setWeekly(event.target.checked)} />
        Also send a weekly digest
      </label>
      {siteKey ? <div ref={widgetRef} className="min-h-16" /> : null}
      {message ? (
        <p className={`m-0 text-sm ${status === "error" ? "text-[var(--bad)]" : "text-[var(--muted)]"}`} role="status">
          {message}
        </p>
      ) : null}
      {devUrl ? (
        <p className="m-0 text-sm">
          <a href={devUrl}>Open the local confirmation link</a>
        </p>
      ) : null}
    </form>
  );
}
