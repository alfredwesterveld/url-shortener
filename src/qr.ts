import QRCode from "qrcode";
import type { Env } from "./types";
import { resolve } from "./store";

/** Render an SVG QR code for a short link at /:slug/qr.svg. */
export async function qrSvg(env: Env, slug: string): Promise<Response> {
  const r = await resolve(env, slug);
  if (!r || "expired" in r) {
    return new Response("Not found.", { status: 404 });
  }
  const base = env.BASE_URL.replace(/\/$/, "");
  const shortUrl = `${base}/${slug}`;
  const svg = await QRCode.toString(shortUrl, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
