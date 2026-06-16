import type { Env } from "./types";

export function renderLogin(env: Env, googleEnabled: boolean): string {
  const google = googleEnabled
    ? `<a class="btn google" href="/auth/google">
         <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#fff" d="M12 11v2.8h4a3.4 3.4 0 0 1-1.5 2.2v1.8h2.4A7.3 7.3 0 0 0 19.6 12c0-.5 0-1-.1-1.4z"/><path fill="#fff" d="M12 20c2 0 3.6-.7 4.9-1.8l-2.4-1.8c-.7.5-1.5.8-2.5.8-1.9 0-3.6-1.3-4.1-3.1H5.4v1.9A7.4 7.4 0 0 0 12 20z"/><path fill="#fff" d="M7.9 13.1a4.4 4.4 0 0 1 0-2.8V8.4H5.4a7.4 7.4 0 0 0 0 6.6z"/><path fill="#fff" d="M12 6.6c1.1 0 2 .4 2.8 1.1l2.1-2.1A7.4 7.4 0 0 0 5.4 8.4l2.5 1.9C8.4 8.5 10.1 7.2 12 6.6z"/></svg>
         Sign in with Google
       </a>`
    : `<p class="muted small">Google sign-in not configured yet — use a passkey.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cq.fyi · sign in</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; margin: 0;
    min-height: 100vh; display: grid; place-items: center; background: #14151a; color: #e6e7ea; }
  .card { width: min(360px, 90vw); background: #1a1c23; border: 1px solid #262932;
    border-radius: 16px; padding: 2rem 1.75rem; box-shadow: 0 20px 60px rgba(0,0,0,.4); }
  h1 { font-size: 1.3rem; margin: 0 0 .25rem; }
  h1 span { color: #7aa2ff; }
  .muted { color: #8a8f9c; } .small { font-size: .85rem; }
  .stack { display: grid; gap: .65rem; margin-top: 1.5rem; }
  .btn { display: flex; align-items: center; justify-content: center; gap: .6rem;
    padding: .7rem 1rem; border-radius: 10px; border: 1px solid transparent;
    font: inherit; font-weight: 500; cursor: pointer; text-decoration: none; color: #fff; }
  .btn.google { background: #2c63ff; } .btn.google:hover { background: #4577ff; }
  .btn.passkey { background: #1f2230; border-color: #313542; color: #e6e7ea; }
  .btn.passkey:hover { background: #262a3a; }
  .sep { display: flex; align-items: center; gap: .75rem; color: #555b68; font-size: .8rem; margin: .25rem 0; }
  .sep::before, .sep::after { content: ""; flex: 1; height: 1px; background: #262932; }
  #toast { position: fixed; bottom: 1.25rem; left: 50%; transform: translateX(-50%) translateY(2rem);
    background: #2a1d22; color: #ff9b9b; border: 1px solid #4a2a32; padding: .6rem 1rem;
    border-radius: 10px; opacity: 0; transition: .25s; pointer-events: none; font-size: .9rem; }
  #toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
</style>
</head>
<body>
  <div class="card">
    <h1><span>cq.fyi</span> links</h1>
    <p class="muted small">Sign in to manage short links.</p>
    <div class="stack">
      ${google}
      <div class="sep">or</div>
      <button class="btn passkey" id="passkey">Use a passkey</button>
    </div>
  </div>
  <div id="toast" role="status" aria-live="polite"></div>
<script type="module">
  import { startAuthentication } from "/static/webauthn-browser-13.3.0.2661a8bb.js";
  const toast = (m) => { const t = document.getElementById("toast"); t.textContent = m;
    t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 3500); };

  const err = new URLSearchParams(location.search).get("error");
  if (err) toast(err);

  document.getElementById("passkey").addEventListener("click", async () => {
    try {
      const optRes = await fetch("/auth/passkey/options", { method: "POST" });
      if (!optRes.ok) { toast((await optRes.json()).error || "No passkey available."); return; }
      const options = await optRes.json();
      const asseResp = await startAuthentication({ optionsJSON: options });
      const verifyRes = await fetch("/auth/passkey/verify", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(asseResp),
      });
      if (verifyRes.ok) location.href = "/";
      else toast((await verifyRes.json()).error || "Passkey login failed.");
    } catch (e) { toast(e.message || "Passkey cancelled."); }
  });
</script>
</body>
</html>`;
}
