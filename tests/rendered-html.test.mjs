import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

const env = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};
const ctx = { waitUntil() {}, passThroughOnException() {} };

test("renders the CRVO operational reporting navigation and daily snapshot", async () => {
  const worker = await loadWorker();

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    env,
    ctx,
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, developmentPreviewMeta);
  assert.match(html, /Performance du jour/);
  assert.match(html, /Dashboard de la veille/);
  assert.match(html, /Goulots &amp; encours/);
  assert.match(html, /Plus vieux dossiers/);
  assert.match(html, /Sources &amp; connexion/);
  assert.match(html, /07 août 2026/);
  assert.match(html, /Priorité du jour : Carrosserie et DSP/);
});

test("serves a truthful verified snapshot when Supabase is not configured", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/api/dashboard"), env, ctx);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.backend, "verified-seed");
  assert.equal(body.connected, false);
  assert.equal(body.snapshot.date, "2026-08-07");
  assert.equal(body.snapshot.stock, 1097);
  assert.equal(body.snapshot.over20, 399);
});

test("keeps imports locked until a valid access code creates a secure session", async () => {
  const worker = await loadWorker();
  const anonymous = await worker.fetch(new Request("http://localhost/api/import-book/auth"), env, ctx);
  assert.equal(anonymous.status, 200);
  assert.deepEqual(await anonymous.json(), { authenticated: false, method: null });

  const rejected = await worker.fetch(
    new Request("http://localhost/api/import-book/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessCode: "incorrect" }),
    }),
    env,
    ctx,
  );
  assert.equal(rejected.status, 401);

  const accessCode = "CRVOlens62!";
  const normalizedAccessCode = accessCode.trim().toLowerCase();
  process.env.IMPORT_ACCESS_TOKEN_SHA256 = createHash("sha256").update(normalizedAccessCode).digest("hex");
  const unlocked = await worker.fetch(
    new Request("http://localhost/api/import-book/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessCode }),
    }),
    env,
    ctx,
  );
  assert.equal(unlocked.status, 200);
  const setCookie = unlocked.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /crvo_import_access=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.doesNotMatch(setCookie, /CRVOlens62!/);

  const cookie = setCookie.split(";", 1)[0];
  assert.match(cookie, /^crvo_import_access=[a-f0-9]{64}$/);
  const authenticated = await worker.fetch(
    new Request("http://localhost/api/import-book/auth", { headers: { cookie } }),
    env,
    ctx,
  );
  assert.equal(authenticated.status, 200);
  assert.deepEqual(await authenticated.json(), { authenticated: true, method: "access-code" });
});
