import assert from "node:assert/strict";
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
