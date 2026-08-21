"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

type Command = { id: string; target_key: string; action: string; request?: Record<string, unknown> };
type ClaimPayload = { command?: Command | null };

const TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

function targetFor(pathname: string) {
  if (pathname === "/atelier") return "screen.atelier";
  if (pathname === "/direction") return "screen.direction";
  return null;
}

async function postGuardian(action: "claim" | "result", token: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/maintenance/guardian?action=${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-kpi-guardian-token": token },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Guardian ${response.status}`);
  return payload;
}

export default function KioskMaintenanceGuardian() {
  const pathname = usePathname();

  useEffect(() => {
    const targetKey = targetFor(pathname);
    if (!targetKey) return;
    const storageKey = `crvo_guardian_token:${targetKey}`;
    const url = new URL(window.location.href);
    const provisioned = url.searchParams.get("guardian") ?? "";
    if (TOKEN_PATTERN.test(provisioned)) {
      localStorage.setItem(storageKey, provisioned.toLowerCase());
      url.searchParams.delete("guardian");
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    let token = localStorage.getItem(storageKey) ?? "";
    if (!TOKEN_PATTERN.test(token)) return;
    token = token.toLowerCase();
    let stopped = false;
    let running = false;

    async function report(command: Command, ok: boolean, result: Record<string, unknown>, error?: string) {
      await postGuardian("result", token, { targetKey, mode: "browser", commandId: command.id, ok, result, error: error ?? null, appVersion: "browser-guardian-v1" });
    }

    async function execute(command: Command) {
      if (command.action === "reload_page") {
        await report(command, true, { action: command.action, browser: true, reloading: true });
        window.setTimeout(() => location.reload(), 250);
        return;
      }
      if (command.action === "clear_cache") {
        const cacheNames = "caches" in window ? await caches.keys().catch(() => []) : [];
        await Promise.all(cacheNames.map(name => caches.delete(name).catch(() => false)));
        if ("serviceWorker" in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
          await Promise.all(registrations.map(registration => registration.unregister().catch(() => false)));
        }
        await report(command, true, { action: command.action, browser: true, cachesCleared: cacheNames.length, reloading: true });
        window.setTimeout(() => location.reload(), 300);
      }
    }

    async function poll() {
      if (stopped || running) return;
      running = true;
      try {
        const payload = await postGuardian("claim", token, {
          targetKey,
          mode: "browser",
          appVersion: "browser-guardian-v1",
          details: {
            pathname: location.pathname,
            online: navigator.onLine,
            visibility: document.visibilityState,
            userAgent: navigator.userAgent.slice(0, 220),
          },
        }) as ClaimPayload;
        if (payload.command) await execute(payload.command);
      } catch (error) {
        console.warn("kiosk_guardian_poll_failed", error instanceof Error ? error.message : "unknown");
      } finally {
        running = false;
      }
    }

    void poll();
    const timer = window.setInterval(() => void poll(), 20_000);
    const online = () => void poll();
    window.addEventListener("online", online);
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener("online", online); };
  }, [pathname]);

  return null;
}
