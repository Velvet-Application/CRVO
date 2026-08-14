/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const EMAIL_IMPORT_GATEWAY = "https://tvmkhvfmdstkunwwuzuz.supabase.co/functions/v1/kpi-email-import-gateway";

function normalizeEmailImportAuth(request: Request) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/email-import") return request;
  if (request.headers.get("x-crvo-ingest-token")) return request;

  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization) return request;
  const token = authorization.replace(/^(Bearer|ApiKey|Token)\s+/i, "").trim();
  if (!token) return request;

  const headers = new Headers(request.headers);
  headers.set("x-crvo-ingest-token", token);
  return new Request(request, { headers });
}

async function proxyEmailImport(request: Request) {
  const normalized = normalizeEmailImportAuth(request);
  const headers = new Headers(normalized.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.set("x-crvo-gateway-proxy", "cloudflare");
  return fetch(EMAIL_IMPORT_GATEWAY, {
    method: "POST",
    headers,
    body: normalized.body,
    redirect: "manual",
  });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/email-import" && request.method === "POST") {
      return proxyEmailImport(request);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const outputFormat = format as "image/jpeg" | "image/avif" | "image/webp" | "image/png" | "image/gif" | "rgb" | "rgba";
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format: outputFormat, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
