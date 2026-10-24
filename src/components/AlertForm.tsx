import { useState } from "react";
import type { Profile } from "../lib/profile";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export default function AlertForm({ profile, deviceName }: { profile: Profile; deviceName: string }) {
  const [email, setEmail] = useState("");
  const [weekly, setWeekly] = useState(true);
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [devUrl, setDevUrl] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setDevUrl(null);
    try {
      const response = await fetch("/api/alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, weeklyDigest: weekly, ...profile }),
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
    <form onSubmit={submit} className="grid gap-3">
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
      <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
        <input type="checkbox" checked={weekly} onChange={(event) => setWeekly(event.target.checked)} />
        Also send a weekly digest
      </label>
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
