/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

const MOBILE_EXPERTISE_PATHS = new Set(["/expertise-mobile", "/developpement/expertise-mobile"]);

function rewriteRequest(request: Request, pathname: string) {
  const target = new URL(request.url);
  target.pathname = pathname;
  target.searchParams.set("mobile", "1");
  return new Request(target.toString(), request);
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

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

    if (MOBILE_EXPERTISE_PATHS.has(url.pathname)) {
      const response = await handler.fetch(request, env, ctx);
      if (response.status !== 404) return response;
      // Safety net for vinext route discovery: keep the distinct mobile URL usable
      // by serving the already proven expertise route instead of exposing a 404.
      return handler.fetch(rewriteRequest(request, "/developpement/expertise"), env, ctx);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
