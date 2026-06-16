import type { Env, LinkRow } from "./types";

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });

export function renderDashboard(env: Env, links: LinkRow[]): string {
  const base = env.BASE_URL.replace(/\/$/, "");
  const rows = links
    .map((l) => {
      const short = `${base}/${esc(l.slug)}`;
      const when = new Date(l.created_at).toISOString().slice(0, 16).replace("T", " ");
      return `<tr data-slug="${esc(l.slug)}">
        <td><a href="${short}" target="_blank" rel="noopener">${esc(l.slug)}</a></td>
        <td class="url"><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.url)}</a></td>
        <td class="num">${l.clicks}</td>
        <td class="when">${when}</td>
        <td><button class="del" data-slug="${esc(l.slug)}" title="Delete">✕</button></td>
      </tr>`;
    })
    .join("\n");

  const empty = links.length === 0 ? `<p class="muted" id="emptyState">No links yet. Add one above.</p>` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cq.fyi · links</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
    margin: 0; background: #14151a; color: #e6e7ea; }
  main { max-width: 920px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 1rem;
    flex-wrap: wrap; margin-bottom: 1.5rem; }
  h1 { font-size: 1.35rem; margin: 0; } h1 span { color: #7aa2ff; }
  .actions { display: flex; gap: .5rem; }
  form { display: flex; gap: .5rem; flex-wrap: wrap; margin-bottom: .5rem; }
  input { background: #1d1f27; border: 1px solid #2c2f3a; color: #e6e7ea;
    padding: .55rem .7rem; border-radius: 8px; font: inherit; }
  input#url { flex: 1 1 320px; } input#slug { flex: 0 1 180px; }
  button { background: #2c63ff; border: 0; color: #fff; padding: .55rem 1rem;
    border-radius: 8px; font: inherit; cursor: pointer; }
  button:hover { background: #4577ff; }
  button.ghost { background: #1f2230; border: 1px solid #313542; color: #cfd2da; }
  button.ghost:hover { background: #262a3a; }
  button.del { background: transparent; color: #ff8a8a; padding: .15rem .5rem;
    border: 1px solid #3a2c33; font-size: .8rem; line-height: 1; }
  button.del:hover { background: #2a1d22; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid #23252e; }
  th { font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; color: #8a8f9c; }
  td.url { max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.when { color: #8a8f9c; font-size: .85rem; white-space: nowrap; }
  a { color: #7aa2ff; text-decoration: none; } a:hover { text-decoration: underline; }
  .muted { color: #8a8f9c; }

  /* toast */
  #toast { position: fixed; bottom: 1.25rem; left: 50%;
    transform: translateX(-50%) translateY(2rem); padding: .6rem 1rem; border-radius: 10px;
    opacity: 0; transition: .25s; pointer-events: none; font-size: .9rem; border: 1px solid; }
  #toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  #toast.ok { background: #14271d; color: #7ee0a6; border-color: #234a34; }
  #toast.err { background: #2a1d22; color: #ff9b9b; border-color: #4a2a32; }

  /* modal */
  #overlay { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: none;
    place-items: center; z-index: 10; }
  #overlay.show { display: grid; }
  .modal { width: min(360px, 90vw); background: #1a1c23; border: 1px solid #262932;
    border-radius: 14px; padding: 1.5rem; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
  .modal h2 { margin: 0 0 .5rem; font-size: 1.05rem; }
  .modal p { margin: 0 0 1.25rem; color: #b9bdc7; }
  .modal .row { display: flex; justify-content: flex-end; gap: .5rem; }
  .modal .danger { background: #c2364b; } .modal .danger:hover { background: #d8425a; }
</style>
</head>
<body>
<main>
  <header>
    <h1><span>cq.fyi</span> link dashboard</h1>
    <div class="actions">
      <button class="ghost" id="addPasskey">+ Passkey</button>
      <button class="ghost" id="signout">Sign out</button>
    </div>
  </header>

  <form id="add">
    <input id="url" name="url" type="url" placeholder="https://example.com/long/url" required>
    <input id="slug" name="slug" type="text" placeholder="custom-slug (optional)"
      pattern="[A-Za-z0-9_-]{1,128}">
    <button type="submit">Shorten</button>
  </form>

  <table>
    <thead><tr><th>Slug</th><th>Destination</th><th>Clicks</th><th>Created</th><th></th></tr></thead>
    <tbody id="rows">${rows}</tbody>
  </table>
  ${empty}
</main>

<div id="overlay">
  <div class="modal" role="dialog" aria-modal="true">
    <h2 id="mTitle">Confirm</h2>
    <p id="mBody"></p>
    <div class="row">
      <button class="ghost" id="mCancel">Cancel</button>
      <button class="danger" id="mOk">Delete</button>
    </div>
  </div>
</div>
<div id="toast" role="status" aria-live="polite"></div>

<script type="module">
  import { startRegistration } from "https://esm.sh/@simplewebauthn/browser@13";

  const toast = (m, kind = "ok") => { const t = document.getElementById("toast");
    t.textContent = m; t.className = "show " + kind;
    setTimeout(() => t.className = t.className.replace("show", "").trim(), 3500); };

  // Promise-based confirm modal (replaces window.confirm).
  const overlay = document.getElementById("overlay");
  let resolver = null;
  const confirmModal = (body) => new Promise((res) => {
    document.getElementById("mBody").textContent = body;
    overlay.classList.add("show"); resolver = res;
  });
  const close = (v) => { overlay.classList.remove("show"); if (resolver) { resolver(v); resolver = null; } };
  document.getElementById("mCancel").addEventListener("click", () => close(false));
  document.getElementById("mOk").addEventListener("click", () => close(true));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && overlay.classList.contains("show")) close(false); });

  document.getElementById("add").addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = document.getElementById("url").value.trim();
    const slug = document.getElementById("slug").value.trim();
    const res = await fetch("/api/links", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, slug: slug || undefined }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error || "Failed.", "err"); return; }
    toast("Created " + data.short); setTimeout(() => location.reload(), 600);
  });

  document.getElementById("rows").addEventListener("click", async (e) => {
    const btn = e.target.closest("button.del"); if (!btn) return;
    const slug = btn.dataset.slug;
    if (!(await confirmModal("Delete “" + slug + "” permanently?"))) return;
    const res = await fetch("/api/links/" + encodeURIComponent(slug), { method: "DELETE" });
    if (res.ok) { btn.closest("tr").remove(); toast("Deleted " + slug); }
    else toast("Delete failed.", "err");
  });

  document.getElementById("addPasskey").addEventListener("click", async () => {
    try {
      const optRes = await fetch("/auth/passkey/register/options", { method: "POST" });
      if (!optRes.ok) { toast((await optRes.json()).error || "Cannot enroll.", "err"); return; }
      const options = await optRes.json();
      const attResp = await startRegistration({ optionsJSON: options });
      const label = navigator.userAgent.slice(0, 60);
      const verifyRes = await fetch("/auth/passkey/register/verify", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: attResp, label }) });
      if (verifyRes.ok) toast("Passkey added ✓");
      else toast((await verifyRes.json()).error || "Enroll failed.", "err");
    } catch (e) { toast(e.message || "Cancelled.", "err"); }
  });

  document.getElementById("signout").addEventListener("click", async () => {
    await fetch("/auth/logout", { method: "POST" }); location.href = "/login";
  });
</script>
</body>
</html>`;
}
