import type { Env, LinkRow, AllowedUserRow, TeamRow, TeamMemberRow } from "./types";

export interface TeamContext {
  teams: TeamRow[];
  activeTeam: string | null;
  teamMembers: Record<string, TeamMemberRow[]>; // populated for owner only
}

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

interface PasskeyView {
  id: string;
  label: string | null;
  created_at: number;
}

export function renderDashboard(
  env: Env,
  links: LinkRow[],
  currentEmail: string,
  owner: boolean,
  allowed: AllowedUserRow[],
  passkeys: PasskeyView[],
  teamCtx: TeamContext,
): string {
  const base = env.BASE_URL.replace(/\/$/, "");
  const now = Date.now();
  const activeName = teamCtx.activeTeam
    ? teamCtx.teams.find((t) => t.id === teamCtx.activeTeam)?.name ?? "team"
    : null;
  const rows = links
    .map((l) => {
      const short = `${base}/${esc(l.slug)}`;
      const when = new Date(l.created_at).toISOString().slice(0, 16).replace("T", " ");
      const expired = l.expires_at != null && l.expires_at <= now;
      const expLabel = l.expires_at == null
        ? ""
        : expired
          ? `<span class="badge dead">expired</span>`
          : `<span class="badge live" title="Expires ${new Date(l.expires_at).toISOString().slice(0, 16).replace("T", " ")}">expires</span>`;
      return `<tr data-slug="${esc(l.slug)}" data-url="${esc(l.url)}" data-expires="${l.expires_at ?? ""}" data-team="${esc(l.team_id ?? "")}">
        <td data-label="Slug"><a href="${short}" target="_blank" rel="noopener">${esc(l.slug)}</a> ${expLabel}</td>
        <td class="url" data-label="Destination"><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.url)}</a></td>
        <td class="num" data-label="Clicks">${l.clicks}</td>
        <td class="when" data-label="Created">${when}</td>
        <td class="actions-cell">
          <button class="icon stats" data-slug="${esc(l.slug)}" title="Analytics">📊</button>
          <button class="icon qr" data-slug="${esc(l.slug)}" title="QR code">▦</button>
          <button class="icon move" data-slug="${esc(l.slug)}" title="Move to team / private">↪</button>
          <button class="icon edit" data-slug="${esc(l.slug)}" title="Edit">✎</button>
          <button class="del" data-slug="${esc(l.slug)}" title="Delete">✕</button>
        </td>
      </tr>`;
    })
    .join("\n");

  const empty = links.length === 0 ? `<p class="muted" id="emptyState">No links yet. Add one above.</p>` : "";

  const userRows = allowed
    .map((u) => {
      const when = new Date(u.added_at).toISOString().slice(0, 10);
      return `<tr data-email="${esc(u.email)}">
        <td>${esc(u.email)}</td>
        <td class="when">${when}</td>
        <td><button class="del rmuser" data-email="${esc(u.email)}" title="Revoke">✕</button></td>
      </tr>`;
    })
    .join("\n");

  const usersSection = owner
    ? `<section id="users">
        <h2>Allowed users</h2>
        <p class="muted small">People who may sign in with Google. You (owner) always have access.</p>
        <form id="addUser">
          <input id="email" type="email" placeholder="name@example.com" required>
          <button type="submit">Grant access</button>
        </form>
        <table>
          <thead><tr><th>Email</th><th>Added</th><th></th></tr></thead>
          <tbody id="userRows">${userRows}</tbody>
        </table>
        ${allowed.length === 0 ? `<p class="muted small">No extra users yet — only you can sign in.</p>` : ""}
      </section>`
    : "";

  // Context selector: Private + every team the user belongs to.
  const teamOptions = [
    `<option value=""${teamCtx.activeTeam ? "" : " selected"}>🔒 Private (only you)</option>`,
    ...teamCtx.teams.map(
      (t) =>
        `<option value="${esc(t.id)}"${t.id === teamCtx.activeTeam ? " selected" : ""}>👥 ${esc(t.name)}</option>`,
    ),
  ].join("");
  const teamSelector = `<select id="ctxSelect" title="Which links you're viewing and creating in">${teamOptions}</select>`;

  // Owner-only team administration.
  const teamAdminRows = teamCtx.teams
    .map((t) => {
      const members = teamCtx.teamMembers[t.id] ?? [];
      const memberChips = members
        .map(
          (m) =>
            `<span class="chip" data-team="${esc(t.id)}" data-email="${esc(m.email)}">${esc(m.email)}<button class="chipx rmMember" data-team="${esc(t.id)}" data-email="${esc(m.email)}" title="Remove">✕</button></span>`,
        )
        .join(" ");
      return `<tr data-team="${esc(t.id)}">
        <td><strong>${esc(t.name)}</strong></td>
        <td class="members">${memberChips || '<span class="muted small">no members</span>'}
          <form class="addMember" data-team="${esc(t.id)}">
            <input type="email" placeholder="add member email" required>
            <button type="submit">Add</button>
          </form>
        </td>
        <td><button class="del delTeam" data-team="${esc(t.id)}" title="Delete team">✕</button></td>
      </tr>`;
    })
    .join("\n");

  const teamsSection = owner
    ? `<section id="teams">
        <h2>Teams</h2>
        <p class="muted small">A team shares links among its members. Pick a team in the top bar to create/view links there; “Private” keeps links visible to only you.</p>
        <form id="addTeam">
          <input id="teamName" type="text" placeholder="Team name (e.g. Marketing)" required maxlength="80">
          <button type="submit">Create team</button>
        </form>
        <table>
          <thead><tr><th>Team</th><th>Members</th><th></th></tr></thead>
          <tbody id="teamRows">${teamAdminRows}</tbody>
        </table>
        ${teamCtx.teams.length === 0 ? `<p class="muted small">No teams yet — create one above.</p>` : ""}
      </section>`
    : "";

  const passkeyRows = passkeys
    .map((p) => {
      const when = new Date(p.created_at).toISOString().slice(0, 10);
      return `<tr data-id="${esc(p.id)}">
        <td class="pk-label">${esc(p.label || "Unnamed passkey")}</td>
        <td class="when">${when}</td>
        <td>
          <button class="icon pk-rename" data-id="${esc(p.id)}" title="Rename">✎</button>
          <button class="del pk-del" data-id="${esc(p.id)}" title="Delete">✕</button>
        </td>
      </tr>`;
    })
    .join("\n");

  const passkeysSection = `<section id="passkeys">
      <h2>Your passkeys</h2>
      <p class="muted small">Devices that can sign you in without a password.</p>
      <table>
        <thead><tr><th>Label</th><th>Added</th><th></th></tr></thead>
        <tbody id="pkRows">${passkeyRows}</tbody>
      </table>
      ${passkeys.length === 0 ? `<p class="muted small">No passkeys yet — click “+ Passkey” above to add one.</p>` : ""}
    </section>`;

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
  input, select { background: #1d1f27; border: 1px solid #2c2f3a; color: #e6e7ea;
    padding: .55rem .7rem; border-radius: 8px; font: inherit; }
  input#url { flex: 1 1 320px; } input#slug { flex: 0 1 180px; }
  button { background: #2c63ff; border: 0; color: #fff; padding: .55rem 1rem;
    border-radius: 8px; font: inherit; cursor: pointer; }
  button:hover { background: #4577ff; }
  button.ghost { background: #1f2230; border: 1px solid #313542; color: #cfd2da; }
  button.ghost:hover { background: #262a3a; }
  button.del, button.icon { background: transparent; padding: .15rem .45rem;
    border: 1px solid #313542; font-size: .8rem; line-height: 1; color: #cfd2da; }
  button.del { color: #ff8a8a; border-color: #3a2c33; }
  button.del:hover { background: #2a1d22; }
  button.icon:hover { background: #262a3a; }
  .actions-cell { display: flex; gap: .25rem; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid #23252e; }
  th { font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; color: #8a8f9c; }
  td.url { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.when { color: #8a8f9c; font-size: .85rem; white-space: nowrap; }
  a { color: #7aa2ff; text-decoration: none; } a:hover { text-decoration: underline; }
  .muted { color: #8a8f9c; } .small { font-size: .85rem; }
  .who { color: #8a8f9c; font-size: .85rem; align-self: center; }
  .badge { font-size: .65rem; padding: .1rem .35rem; border-radius: 5px; vertical-align: middle; }
  .badge.live { background: #1d2a3a; color: #7ab8ff; }
  .badge.dead { background: #2a1d22; color: #ff9b9b; }
  section { margin-top: 2.5rem; padding-top: 1.5rem; border-top: 1px solid #23252e; }
  section h2 { font-size: 1.05rem; margin: 0 0 .25rem; }
  section form { margin: 1rem 0 .75rem; }
  section#users input#email { flex: 1 1 260px; }
  .toolbar { display: flex; gap: .5rem; flex-wrap: wrap; margin: .25rem 0 1rem; }
  details.adv { margin: 0 0 1rem; }
  details.adv summary { cursor: pointer; color: #8a8f9c; font-size: .85rem; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; margin-top: .6rem; }
  .grid2 input { width: 100%; }

  /* toast */
  #toast { position: fixed; bottom: 1.25rem; left: 50%;
    transform: translateX(-50%) translateY(2rem); padding: .6rem 1rem; border-radius: 10px;
    opacity: 0; transition: .25s; pointer-events: none; font-size: .9rem; border: 1px solid; z-index: 20; }
  #toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  #toast.ok { background: #14271d; color: #7ee0a6; border-color: #234a34; }
  #toast.err { background: #2a1d22; color: #ff9b9b; border-color: #4a2a32; }

  /* modal */
  #overlay, #dlgOverlay { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: none;
    place-items: center; z-index: 10; }
  #overlay.show, #dlgOverlay.show { display: grid; }
  .modal { width: min(440px, 92vw); background: #1a1c23; border: 1px solid #262932;
    border-radius: 14px; padding: 1.5rem; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
  .modal h2 { margin: 0 0 .5rem; font-size: 1.05rem; }
  .modal p { margin: 0 0 1.25rem; color: #b9bdc7; }
  .modal .row { display: flex; justify-content: flex-end; gap: .5rem; margin-top: 1rem; }
  .modal .danger { background: #c2364b; } .modal .danger:hover { background: #d8425a; }
  .modal label { display: block; font-size: .8rem; color: #8a8f9c; margin: .6rem 0 .2rem; }
  .modal input, .modal select { width: 100%; }
  /* sparkline */
  .spark { width: 100%; height: 60px; display: block; margin: .5rem 0 1rem; }
  .spark rect { fill: #2c63ff; }
  .statlists { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  .statlists h3 { font-size: .8rem; color: #8a8f9c; margin: 0 0 .3rem; text-transform: uppercase; letter-spacing: .04em; }
  .statlists ul { list-style: none; margin: 0; padding: 0; font-size: .85rem; }
  .statlists li { display: flex; justify-content: space-between; padding: .15rem 0; border-bottom: 1px solid #23252e; }
  .statlists .c { color: #8a8f9c; font-variant-numeric: tabular-nums; }
  /* team context selector + member chips */
  select#ctxSelect { background: #1d1f27; border: 1px solid #2c2f3a; color: #e6e7ea;
    padding: .4rem .6rem; border-radius: 8px; font: inherit; cursor: pointer; }
  .ctxnote { margin: 0 0 1rem; }
  td.members { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; }
  .chip { display: inline-flex; align-items: center; gap: .3rem; background: #1f2230;
    border: 1px solid #313542; border-radius: 999px; padding: .15rem .25rem .15rem .6rem;
    font-size: .8rem; color: #cfd2da; }
  .chip .chipx { background: transparent; border: 0; color: #ff8a8a; cursor: pointer;
    padding: 0 .25rem; font-size: .8rem; line-height: 1; }
  form.addMember { display: inline-flex; gap: .3rem; margin: 0; }
  form.addMember input { padding: .3rem .5rem; flex: 0 1 200px; }
  form.addMember button { padding: .3rem .7rem; }

  /* responsive: phones */
  @media (max-width: 640px) {
    main { padding: 1.25rem .9rem 3rem; }
    header { flex-direction: column; align-items: flex-start; }
    .actions { flex-wrap: wrap; }
    .grid2, .statlists { grid-template-columns: 1fr; }

    table thead { display: none; }
    table, tbody, tr, td { display: block; width: 100%; }
    tr { border: 1px solid #23252e; border-radius: 10px; margin-bottom: .75rem; padding: .25rem .5rem; }
    td { border-bottom: 0; padding: .35rem .4rem; display: flex; justify-content: space-between; gap: 1rem; align-items: center; }
    td[data-label]::before { content: attr(data-label); color: #8a8f9c; font-size: .72rem;
      text-transform: uppercase; letter-spacing: .04em; }
    td.url { max-width: none; white-space: normal; overflow-wrap: anywhere; text-align: right; }
    td.num, td.when { text-align: right; }
    .actions-cell { justify-content: flex-end; }
    td.members { justify-content: flex-start; }
  }
</style>
</head>
<body>
<main>
  <header>
    <h1><span>cq.fyi</span> link dashboard</h1>
    <div class="actions">
      <span class="who" title="Signed in">${esc(currentEmail)}${owner ? " · owner" : ""}</span>
      ${teamSelector}
      <button class="ghost" id="addPasskey">+ Passkey</button>
      <button class="ghost" id="signout">Sign out</button>
    </div>
  </header>

  <p class="ctxnote muted small">${
    activeName
      ? `Viewing <strong>👥 ${esc(activeName)}</strong> — new links are shared with this team.`
      : `Viewing <strong>🔒 your private links</strong> — only you can see these.`
  }</p>

  <form id="add">
    <input id="url" name="url" type="url" placeholder="https://example.com/long/url" required>
    <input id="slug" name="slug" type="text" placeholder="custom-slug (optional)"
      pattern="[A-Za-z0-9_-]{1,128}">
    <input id="expires" name="expires" type="datetime-local" title="Expiry (optional)">
    <button type="submit">Shorten</button>
  </form>
  <details class="adv">
    <summary>UTM builder</summary>
    <div class="grid2">
      <input id="utm_source" placeholder="utm_source (e.g. newsletter)">
      <input id="utm_medium" placeholder="utm_medium (e.g. email)">
      <input id="utm_campaign" placeholder="utm_campaign">
      <input id="utm_term" placeholder="utm_term">
      <input id="utm_content" placeholder="utm_content">
    </div>
    <p class="muted small" style="margin:.5rem 0 0">UTM params are appended to the destination URL on shorten.</p>
  </details>

  <div class="toolbar">
    <button class="ghost" id="exportCsv">⭳ Export CSV</button>
    <button class="ghost" id="importCsv">⭱ Import CSV</button>
    <input id="csvFile" type="file" accept=".csv,text/csv" hidden>
  </div>

  <table>
    <thead><tr><th>Slug</th><th>Destination</th><th>Clicks</th><th>Created</th><th></th></tr></thead>
    <tbody id="rows">${rows}</tbody>
  </table>
  ${empty}
  ${passkeysSection}
  ${teamsSection}
  ${usersSection}
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

<div id="dlgOverlay">
  <div class="modal" role="dialog" aria-modal="true">
    <h2 id="dTitle">Edit</h2>
    <div id="dBody"></div>
    <div class="row">
      <button class="ghost" id="dCancel">Cancel</button>
      <button id="dOk">Save</button>
    </div>
  </div>
</div>

<div id="toast" role="status" aria-live="polite"></div>

<script type="module">
  import { startRegistration } from "/static/webauthn-browser-13.3.0.2661a8bb.js";

  const BASE = ${JSON.stringify(base)};
  const TEAMS = ${JSON.stringify(teamCtx.teams.map((t) => ({ id: t.id, name: t.name })))};
  const $ = (id) => document.getElementById(id);
  const toast = (m, kind = "ok") => { const t = $("toast");
    t.textContent = m; t.className = "show " + kind;
    setTimeout(() => t.className = t.className.replace("show", "").trim(), 3500); };

  // Promise-based confirm modal.
  const overlay = $("overlay");
  let resolver = null;
  const confirmModal = (body, okLabel = "Delete") => new Promise((res) => {
    $("mBody").textContent = body; $("mOk").textContent = okLabel;
    overlay.classList.add("show"); resolver = res;
  });
  const close = (v) => { overlay.classList.remove("show"); if (resolver) { resolver(v); resolver = null; } };
  $("mCancel").addEventListener("click", () => close(false));
  $("mOk").addEventListener("click", () => close(true));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });

  // Generic dialog (custom body + save handler).
  const dlg = $("dlgOverlay");
  let onSave = null;
  const openDialog = (title, bodyHtml, saveFn, okLabel = "Save") => {
    $("dTitle").textContent = title; $("dBody").innerHTML = bodyHtml;
    $("dOk").textContent = okLabel; onSave = saveFn; dlg.classList.add("show");
  };
  const closeDialog = () => { dlg.classList.remove("show"); onSave = null; };
  $("dCancel").addEventListener("click", closeDialog);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closeDialog(); });
  $("dOk").addEventListener("click", async () => { if (onSave) { const keep = await onSave(); if (keep !== false) closeDialog(); } });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (overlay.classList.contains("show")) close(false);
    if (dlg.classList.contains("show")) closeDialog();
  });

  const toEpoch = (localValue) => localValue ? new Date(localValue).getTime() : null;
  const toLocalInput = (epoch) => {
    if (!epoch) return "";
    const d = new Date(Number(epoch) - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  };

  // Append UTM params to a URL string.
  const applyUtm = (raw) => {
    const fields = ["utm_source","utm_medium","utm_campaign","utm_term","utm_content"];
    const present = fields.filter((f) => $(f) && $(f).value.trim());
    if (!present.length) return raw;
    try {
      const u = new URL(raw);
      for (const f of present) u.searchParams.set(f, $(f).value.trim());
      return u.toString();
    } catch { return raw; }
  };

  $("add").addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = applyUtm($("url").value.trim());
    const slug = $("slug").value.trim();
    const expires_at = toEpoch($("expires").value);
    const res = await fetch("/api/links", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, slug: slug || undefined, expires_at }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error || "Failed.", "err"); return; }
    toast("Created " + data.short); setTimeout(() => location.reload(), 600);
  });

  $("rows").addEventListener("click", async (e) => {
    const row = e.target.closest("tr"); if (!row) return;
    const slug = row.dataset.slug;

    if (e.target.closest("button.del")) {
      if (!(await confirmModal("Delete “" + slug + "” permanently?"))) return;
      const res = await fetch("/api/links/" + encodeURIComponent(slug), { method: "DELETE" });
      if (res.ok) { row.remove(); toast("Deleted " + slug); } else toast("Delete failed.", "err");
      return;
    }
    if (e.target.closest("button.qr")) {
      window.open("/" + encodeURIComponent(slug) + "/qr.svg", "_blank", "noopener");
      return;
    }
    if (e.target.closest("button.move")) {
      const cur = row.dataset.team || "";
      const opts = ['<option value=""' + (cur ? "" : " selected") + '>🔒 Private (only you)</option>']
        .concat(TEAMS.map((t) => '<option value="' + t.id + '"' + (t.id === cur ? " selected" : "") +
          '>👥 ' + t.name.replace(/</g, "&lt;") + '</option>'));
      const body = '<label>Move “' + slug + '” to</label><select id="moveDest">' + opts.join("") + '</select>';
      openDialog("Move link", body, async () => {
        const team_id = $("moveDest").value || null;
        const res = await fetch("/api/links/" + encodeURIComponent(slug) + "/move", { method: "POST",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ team_id }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { toast(d.error || "Move failed.", "err"); return false; }
        toast("Moved " + slug); setTimeout(() => location.reload(), 500);
      }, "Move");
      return;
    }
    if (e.target.closest("button.edit")) {
      const body = '<label>Destination URL</label><input id="editUrl" type="url" value="' +
        row.dataset.url.replace(/"/g, "&quot;") + '">' +
        '<label>Expiry (optional)</label><input id="editExp" type="datetime-local" value="' +
        toLocalInput(row.dataset.expires) + '">';
      openDialog("Edit “" + slug + "”", body, async () => {
        const url = $("editUrl").value.trim();
        const expires_at = toEpoch($("editExp").value);
        const res = await fetch("/api/links/" + encodeURIComponent(slug), { method: "PATCH",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ url, expires_at }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { toast(d.error || "Failed.", "err"); return false; }
        toast("Updated " + slug); setTimeout(() => location.reload(), 500);
      });
      return;
    }
    if (e.target.closest("button.stats")) {
      const res = await fetch("/api/links/" + encodeURIComponent(slug) + "/stats");
      if (!res.ok) { toast("Could not load stats.", "err"); return; }
      const s = await res.json();
      openDialog("Analytics · " + slug, renderStats(s), null, "Close");
      $("dOk").onclick = closeDialog;
    }
  });

  const renderStats = (s) => {
    const days = s.daily || [];
    const max = Math.max(1, ...days.map((d) => d.count));
    const w = 100 / Math.max(days.length, 1);
    const bars = days.map((d, i) => {
      const h = (d.count / max) * 100;
      return '<rect x="' + (i * w) + '%" y="' + (100 - h) + '%" width="' + (w * 0.8) +
        '%" height="' + h + '%"><title>' + d.day + ': ' + d.count + '</title></rect>';
    }).join("");
    const list = (arr, label, keyfn) => '<div><h3>' + label + '</h3><ul>' +
      (arr.length ? arr.map((x) => '<li><span>' + keyfn(x) + '</span><span class="c">' + x.count + '</span></li>').join("")
        : '<li class="c">none</li>') + '</ul></div>';
    return '<p class="muted small">' + s.total + ' total clicks · last 30 days</p>' +
      '<svg class="spark" viewBox="0 0 100 100" preserveAspectRatio="none">' + bars + '</svg>' +
      '<div class="statlists">' +
        list(s.countries || [], "Countries", (x) => x.country) +
        list(s.referrers || [], "Referrers", (x) => x.referrer) +
      '</div>';
  };

  // CSV export / import.
  $("exportCsv").addEventListener("click", () => { window.location.href = "/api/links/export"; });
  $("importCsv").addEventListener("click", () => $("csvFile").click());
  $("csvFile").addEventListener("change", async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const text = await file.text();
    const res = await fetch("/api/links/import", { method: "POST",
      headers: { "content-type": "text/csv" }, body: text });
    const d = await res.json().catch(() => ({}));
    e.target.value = "";
    if (!res.ok) { toast(d.error || "Import failed.", "err"); return; }
    toast("Imported " + d.created + (d.failed && d.failed.length ? (", " + d.failed.length + " failed") : ""));
    setTimeout(() => location.reload(), 800);
  });

  $("addPasskey").addEventListener("click", async () => {
    try {
      const optRes = await fetch("/auth/passkey/register/options", { method: "POST" });
      if (!optRes.ok) { toast((await optRes.json()).error || "Cannot enroll.", "err"); return; }
      const options = await optRes.json();
      const attResp = await startRegistration({ optionsJSON: options });
      const label = navigator.userAgent.slice(0, 60);
      const verifyRes = await fetch("/auth/passkey/register/verify", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: attResp, label }) });
      if (verifyRes.ok) { toast("Passkey added ✓"); setTimeout(() => location.reload(), 600); }
      else toast((await verifyRes.json()).error || "Enroll failed.", "err");
    } catch (e) { toast(e.message || "Cancelled.", "err"); }
  });

  // Passkey management.
  const pkRows = $("pkRows");
  if (pkRows) {
    pkRows.addEventListener("click", async (e) => {
      const row = e.target.closest("tr"); if (!row) return;
      const id = row.dataset.id;
      if (e.target.closest("button.pk-del")) {
        if (!(await confirmModal("Delete this passkey? You can no longer sign in with it."))) return;
        const res = await fetch("/api/passkeys/" + encodeURIComponent(id), { method: "DELETE" });
        if (res.ok) { row.remove(); toast("Passkey deleted"); } else toast("Delete failed.", "err");
      } else if (e.target.closest("button.pk-rename")) {
        const cur = row.querySelector(".pk-label").textContent;
        const body = '<label>Label</label><input id="pkLabel" type="text" value="' +
          cur.replace(/"/g, "&quot;") + '">';
        openDialog("Rename passkey", body, async () => {
          const label = $("pkLabel").value.trim();
          if (!label) { toast("Label required.", "err"); return false; }
          const res = await fetch("/api/passkeys/" + encodeURIComponent(id), { method: "PATCH",
            headers: { "content-type": "application/json" }, body: JSON.stringify({ label }) });
          if (!res.ok) { toast("Rename failed.", "err"); return false; }
          row.querySelector(".pk-label").textContent = label; toast("Renamed");
        });
      }
    });
  }

  $("signout").addEventListener("click", async () => {
    await fetch("/auth/logout", { method: "POST" }); location.href = "/login";
  });

  const addUser = $("addUser");
  if (addUser) {
    addUser.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("email").value.trim();
      const res = await fetch("/api/users", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || "Failed.", "err"); return; }
      toast("Granted " + data.email); setTimeout(() => location.reload(), 600);
    });
    $("userRows").addEventListener("click", async (e) => {
      const btn = e.target.closest("button.rmuser"); if (!btn) return;
      const email = btn.dataset.email;
      if (!(await confirmModal("Revoke access for " + email + "? Their passkeys are deleted too."))) return;
      const res = await fetch("/api/users/" + encodeURIComponent(email), { method: "DELETE" });
      if (res.ok) { btn.closest("tr").remove(); toast("Revoked " + email); }
      else toast("Revoke failed.", "err");
    });
  }

  // Switch viewing/creating context (private vs a team).
  const ctxSelect = $("ctxSelect");
  if (ctxSelect) {
    ctxSelect.addEventListener("change", async () => {
      const team_id = ctxSelect.value || null;
      const res = await fetch("/api/team/active", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ team_id }) });
      if (!res.ok) { toast((await res.json().catch(() => ({}))).error || "Switch failed.", "err"); return; }
      location.reload();
    });
  }

  // Owner: team administration.
  const addTeam = $("addTeam");
  if (addTeam) {
    addTeam.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = $("teamName").value.trim();
      const res = await fetch("/api/teams", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || "Failed.", "err"); return; }
      toast("Created team"); setTimeout(() => location.reload(), 600);
    });

    const teamRows = $("teamRows");
    teamRows.addEventListener("submit", async (e) => {
      const form = e.target.closest("form.addMember"); if (!form) return;
      e.preventDefault();
      const teamId = form.dataset.team;
      const input = form.querySelector("input");
      const email = input.value.trim();
      const res = await fetch("/api/teams/" + encodeURIComponent(teamId) + "/members", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || "Failed.", "err"); return; }
      toast("Added " + data.email); setTimeout(() => location.reload(), 500);
    });

    teamRows.addEventListener("click", async (e) => {
      const rm = e.target.closest("button.rmMember");
      if (rm) {
        const teamId = rm.dataset.team, email = rm.dataset.email;
        if (!(await confirmModal("Remove " + email + " from this team?"))) return;
        const res = await fetch("/api/teams/" + encodeURIComponent(teamId) + "/members/" + encodeURIComponent(email), { method: "DELETE" });
        if (res.ok) { rm.closest(".chip").remove(); toast("Removed " + email); }
        else toast("Remove failed.", "err");
        return;
      }
      const del = e.target.closest("button.delTeam");
      if (del) {
        const teamId = del.dataset.team;
        if (!(await confirmModal("Delete this team? Its links become private to their creators."))) return;
        const res = await fetch("/api/teams/" + encodeURIComponent(teamId), { method: "DELETE" });
        if (res.ok) { toast("Team deleted"); setTimeout(() => location.reload(), 500); }
        else toast("Delete failed.", "err");
      }
    });
  }
</script>
</body>
</html>`;
}
