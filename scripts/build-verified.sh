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

  echo "Verifying production health and authentication boundary..."
  node <<'NODE'
const origin = "https://kpi-crvo.cyril-gay.workers.dev";
for (let attempt = 1; attempt <= 8; attempt += 1) {
  try {
    const stamp = Date.now();
    const [healthResponse, loginResponse, protectedResponse] = await Promise.all([
      fetch(`${origin}/api/health?_=${stamp}`, { headers: { "Cache-Control": "no-cache" } }),
      fetch(`${origin}/login?_=${stamp}`, { headers: { "Cache-Control": "no-cache" } }),
      fetch(`${origin}/api/dashboard?history=1&_=${stamp}`, { headers: { "Cache-Control": "no-cache" } }),
    ]);
    const health = await healthResponse.json().catch(() => ({}));
    const loginHtml = await loginResponse.text();
    console.log(`production check ${attempt}: health=${healthResponse.status} login=${loginResponse.status} protected=${protectedResponse.status} data=${health.dataReady} bottlenecks=${health.bottlenecksReady} clients=${health.clientDashboardReady}`);
    if (
      healthResponse.ok && health.ok === true && health.dataReady === true && health.bottlenecksReady === true && health.clientDashboardReady === true &&
      loginResponse.ok && /Accès sécurisé|Accès s.curis./i.test(loginHtml) &&
      protectedResponse.status === 401
    ) process.exit(0);
  } catch (error) {
    console.log(`production check ${attempt}: ${error instanceof Error ? error.message : String(error)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 4000));
}
console.error("Production verification failed: health or authentication boundary unavailable.");
process.exit(1);
NODE
fi
