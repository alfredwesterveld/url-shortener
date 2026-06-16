import type { Env } from "./types";

/** Branded 404 / expired landing page for unknown or dead slugs. */
export function renderNotFound(env: Env, expired = false): string {
  const base = env.BASE_URL.replace(/\/$/, "");
  const host = base.replace(/^https?:\/\//, "");
  const title = expired ? "Link expired" : "Link not found";
  const msg = expired
    ? "This short link has expired and no longer points anywhere."
    : "That short link doesn’t exist — it may have been deleted or mistyped.";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · ${host}</title>
<style>
  :root { color-scheme: dark; }
  html, body { height: 100%; }
  body { margin: 0; font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif;
    background: #14151a; color: #e6e7ea; display: grid; place-items: center; text-align: center; }
  .card { max-width: 420px; padding: 2.5rem 1.5rem; }
  .code { font-size: 4rem; font-weight: 700; color: #2c63ff; margin: 0; line-height: 1; }
  h1 { font-size: 1.3rem; margin: 1rem 0 .5rem; }
  p { color: #8a8f9c; margin: 0 0 1.75rem; }
  a.brand { color: #7aa2ff; font-weight: 600; text-decoration: none; }
  a.brand:hover { text-decoration: underline; }
</style>
</head>
<body>
  <div class="card">
    <p class="code">${expired ? "410" : "404"}</p>
    <h1>${title}</h1>
    <p>${msg}</p>
    <a class="brand" href="${base}/">${host}</a>
  </div>
</body>
</html>`;
}
