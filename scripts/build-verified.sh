#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

command -v timeout || {
  echo "build-verified.sh requires GNU timeout." >&2
  exit 69
}

vinext="${SITES_PROJECT_ROOT}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

echo "Running bounded vinext build..."
timeout \
  --signal=TERM \
  --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
  "${SITES_BUILD_TIMEOUT:-3m}" \
  "${vinext}" build

"${script_dir}/validate-artifact.sh"

if [[ -n "${CLOUDFLARE_API_TOKEN:-}" && -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "Deploying the built App Router through vinext native Cloudflare deployment..."
  timeout \
    --signal=TERM \
    --kill-after="20s" \
    "5m" \
    "${vinext}" deploy --skip-build --name kpi-crvo

  echo "Verifying production HTML hydration and live API..."
  node <<'NODE'
const origin = "https://kpi-crvo.cyril-gay.workers.dev";
for (let attempt = 1; attempt <= 8; attempt += 1) {
  try {
    const [rootResponse, apiResponse] = await Promise.all([
      fetch(`${origin}/?_=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } }),
      fetch(`${origin}/api/dashboard?history=1&_=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } }),
    ]);
    const html = await rootResponse.text();
    const api = await apiResponse.json();
    const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)].map((match) => match[0]);
    const srcScripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((match) => match[1]);
    const hasClientMarkers = scriptTags.length > 0 || /__vite_rsc|modulepreload|\/assets\//i.test(html);
    console.log(`production check ${attempt}: root=${rootResponse.status} api=${apiResponse.status} scripts=${scriptTags.length} srcScripts=${srcScripts.length} markers=${hasClientMarkers} date=${api.snapshot?.date} mode=${api.sourceMode} backend=${api.backend}`);
    if (rootResponse.ok && apiResponse.ok && api.connected === true && api.sourceMode === "ftp" && String(api.snapshot?.date || "") >= "2026-08-13" && hasClientMarkers) {
      process.exit(0);
    }
  } catch (error) {
    console.log(`production check ${attempt}: ${error instanceof Error ? error.message : String(error)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 4000));
}
console.error("Production verification failed: live API or client hydration is still unavailable.");
process.exit(1);
NODE
fi
