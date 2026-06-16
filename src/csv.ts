import type { Env } from "./types";
import { listLinks, createLink, type LinkView } from "./store";

function csvCell(v: string | number | null): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Export the caller's currently-visible links (private or active team) as CSV. */
export async function exportCsv(env: Env, view: LinkView): Promise<Response> {
  const links = await listLinks(env, view, 10000);
  const header = "slug,url,clicks,created_at,expires_at";
  const lines = links.map((l) =>
    [l.slug, l.url, l.clicks, l.created_at, l.expires_at ?? ""].map(csvCell).join(","),
  );
  const body = [header, ...lines].join("\n");
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="links.csv"',
    },
  });
}

/** Minimal CSV row parser (handles quotes, commas, escaped quotes). */
function parseRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export interface ImportResult {
  created: number;
  failed: { row: number; error: string }[];
}

/** Import links from CSV text. Expects a header with at least url (slug optional). */
export async function importCsv(env: Env, text: string, view: LinkView): Promise<ImportResult> {
  const rows = text.split(/\r?\n/).filter((r) => r.trim().length > 0);
  if (rows.length === 0) return { created: 0, failed: [] };

  const header = parseRow(rows[0]!).map((h) => h.trim().toLowerCase());
  const urlIdx = header.indexOf("url");
  const slugIdx = header.indexOf("slug");
  const expIdx = header.indexOf("expires_at");
  if (urlIdx === -1) return { created: 0, failed: [{ row: 1, error: "Missing 'url' column." }] };

  const result: ImportResult = { created: 0, failed: [] };
  for (let i = 1; i < rows.length; i++) {
    const cells = parseRow(rows[i]!);
    const url = (cells[urlIdx] ?? "").trim();
    const slug = slugIdx >= 0 ? (cells[slugIdx] ?? "").trim() || undefined : undefined;
    const expRaw = expIdx >= 0 ? (cells[expIdx] ?? "").trim() : "";
    const expiresAt = expRaw ? Number(expRaw) : null;
    const r = await createLink(
      env,
      url,
      slug,
      Number.isFinite(expiresAt!) ? expiresAt : null,
      view.ownerEmail,
      view.teamId,
    );
    if (r.ok) result.created++;
    else result.failed.push({ row: i + 1, error: r.error ?? "Failed." });
  }
  return result;
}
