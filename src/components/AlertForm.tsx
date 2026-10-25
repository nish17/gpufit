import { useEffect, useRef, useState } from "react";
import { confirmHeadline } from "../lib/alerts/email";
import type { Profile } from "../lib/profile";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type TurnstileApi = {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  remove: (id: string) => void;
};

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export default function AlertForm({ profile, deviceName }: { profile: Profile; deviceName: string }) {
  const [email, setEmail] = useState("");
  const [weekly, setWeekly] = useState(true);
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [humanCheckKey, setHumanCheckKey] = useState(0);
  const [mailed, setMailed] = useState(false);
  const [alreadySubscribed, setAlreadySubscribed] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

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
    if (status === "idle") return;
    noticeRef.current?.focus();
  }, [status]);

  const formVisible = status !== "done";

  // A Turnstile token is spent on the first submit. Mount a new widget whenever the form is on screen.
  useEffect(() => {
    if (!formVisible || !siteKey) return;
    const host = widgetRef.current;
    if (!host) return;
    const win = window as Window & { turnstile?: TurnstileApi };
    let widgetId = "";
    let cancelled = false;

    const mount = () => {
      const turnstile = win.turnstile;
      if (cancelled || !turnstile || !host.isConnected) return;
      if (widgetId) turnstile.remove(widgetId);
      widgetId = turnstile.render(host, {
        sitekey: siteKey,
        callback: (token) => setTurnstileToken(token),
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => setTurnstileToken(""),
      });
    };

    const removeWidget = () => {
      cancelled = true;
      if (widgetId && win.turnstile) win.turnstile.remove(widgetId);
    };

    if (win.turnstile) {
      mount();
      return removeWidget;
    }

    let script = document.querySelector<HTMLScriptElement>("script[data-gpufit-turnstile]");
    if (!script) {
      script = document.createElement("script");
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.dataset.gpufitTurnstile = "true";
      document.head.appendChild(script);
    }
    script.addEventListener("load", mount);
    return () => {
      script?.removeEventListener("load", mount);
      removeWidget();
    };
  }, [formVisible, humanCheckKey, siteKey]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setMailed(false);
    setAlreadySubscribed(false);
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
      const body = (await response.json()) as {
        ok?: boolean;
        message?: string;
        devConfirmUrl?: string;
        provider?: string;
        alreadySubscribed?: boolean;
      };
      if (body.provider === "unconfigured" || body.provider === "browser" || body.provider === "memory" || body.provider === "file") {
        const local = JSON.parse(localStorage.getItem("gpufit.alert-mock") || "[]");
        local.push({ email, profile, weekly, provider: body.provider, at: new Date().toISOString() });
        localStorage.setItem("gpufit.alert-mock", JSON.stringify(local));
      }
      const keptLocal = body.provider === "unconfigured" || body.provider === "browser" || body.provider === "memory" || body.provider === "file";
      if (body.provider === "unconfigured") {
        setMailed(false);
        setStatus("done");
        setMessage("Saved in this browser. Email alerts are not switched on for this site yet, so nothing will be sent.");
        return;
      }
      if (!response.ok || body.ok === false) {
        setMailed(false);
        setTurnstileToken("");
        setHumanCheckKey((key) => key + 1);
        setStatus("error");
        setMessage(body.message || "Could not save that signup.");
        return;
      }
      setTurnstileToken("");
      if (body.alreadySubscribed) {
        setMailed(false);
        setAlreadySubscribed(true);
        setStatus("done");
        setMessage(body.message || "You're already subscribed. Fit alerts for that machine are on.");
        return;
      }
      setMailed(!keptLocal);
      setStatus("done");
      setMessage(body.message || "Signup received.");
      setDevUrl(body.devConfirmUrl || null);
    } catch {
      setMailed(false);
      setTurnstileToken("");
      setHumanCheckKey((key) => key + 1);
      setStatus("error");
      setMessage("The alerts endpoint did not respond.");
    }
  }

  function editAddress() {
    setStatus("idle");
    setMailed(false);
    setAlreadySubscribed(false);
    setTurnstileToken("");
    setHumanCheckKey((key) => key + 1);
    setMessage("");
    setDevUrl(null);
    requestAnimationFrame(() => emailRef.current?.focus());
  }

  if (status === "done" && alreadySubscribed) {
    return (
      <div ref={noticeRef} tabIndex={-1} role="status" className="grid gap-2 rounded-xl bg-[var(--great-bg)] px-4 py-4 outline-none">
        <p className="kicker m-0">Already on</p>
        <h2 className="serif m-0 text-[1.7rem] leading-tight text-[var(--ink)]">You're already subscribed for {deviceName}</h2>
        <p className="m-0 text-[0.98rem] leading-6 text-[var(--ink)]">
          Fit alerts for <strong>{email}</strong> are already on. No new confirmation was sent.
        </p>
        <div>
          <Button type="button" variant="outline" onClick={editAddress}>
            Use a different address
          </Button>
        </div>
      </div>
    );
  }

  if (status === "done" && mailed) {
    const headline = confirmHeadline(deviceName);
    return (
      <div ref={noticeRef} tabIndex={-1} role="status" className="grid gap-2 rounded-xl bg-[var(--great-bg)] px-4 py-4 outline-none">
        <p className="kicker m-0">Confirm to start</p>
        <h2 className="serif m-0 text-[1.7rem] leading-tight text-[var(--ink)]">Check your email</h2>
        <p className="m-0 text-[0.98rem] leading-6 text-[var(--ink)]">
          A confirmation was sent to <strong>{email}</strong>. Open it, and gpufit.tech will send alerts for your <strong>{deviceName}</strong>. Nothing else goes out until you do.
        </p>
        <p className="m-0 text-sm leading-5 text-[var(--muted)]">
          The message is from GPUfit, titled "{headline}". If it is not in your inbox in a minute, check spam.
        </p>
        {devUrl ? (
          <p className="m-0 text-sm">
            <a href={devUrl}>Open the local confirmation link</a>
          </p>
        ) : null}
        <div>
          <Button type="button" variant="outline" onClick={editAddress}>
            Use a different address
          </Button>
        </div>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div ref={noticeRef} tabIndex={-1} role="status" className="grid gap-2 rounded-xl bg-[var(--tight-bg)] px-4 py-4 outline-none">
        <p className="kicker m-0">Saved here</p>
        <h2 className="serif m-0 text-[1.7rem] leading-tight text-[var(--ink)]">Nothing was emailed</h2>
        <p className="m-0 text-[0.98rem] leading-6 text-[var(--ink)]">{message}</p>
        {devUrl ? (
          <p className="m-0 text-sm">
            <a href={devUrl}>Open the local confirmation link</a>
          </p>
        ) : null}
        <div>
          <Button type="button" variant="outline" onClick={editAddress}>
            Back to the form
          </Button>
        </div>
      </div>
    );
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
          ref={emailRef}
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
      {status === "error" ? (
        <p ref={noticeRef} tabIndex={-1} role="alert" className="m-0 rounded-xl bg-[var(--bad-bg)] px-3 py-2 text-sm leading-5 text-[var(--ink)] outline-none">
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
