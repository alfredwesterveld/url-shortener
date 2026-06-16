import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { Env, CredentialRow } from "./types";
import { createSession } from "./session";
import { parseCookies, b64urlEncode, b64urlDecode } from "./util";

const CHAL_COOKIE = "wauth";
const CHAL_TTL = 300;
const RP_NAME = "cq.fyi links";

interface Ctx {
  rpID: string;
  origin: string;
  host: string;
}

function ctxFrom(request: Request): Ctx {
  const url = new URL(request.url);
  return { rpID: url.hostname, origin: url.origin, host: url.host };
}

function challengeCookie(host: string, token: string): string {
  const secure = host.startsWith("localhost") || host.startsWith("127.") ? "" : " Secure;";
  return `${CHAL_COOKIE}=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${CHAL_TTL}`;
}

async function listCredentials(env: Env): Promise<CredentialRow[]> {
  const res = await env.DB.prepare("SELECT * FROM credentials").all<CredentialRow>();
  return res.results ?? [];
}

async function stashChallenge(env: Env, challenge: string): Promise<string> {
  const token = crypto.randomUUID();
  await env.AUTH.put(`chal:${token}`, challenge, { expirationTtl: CHAL_TTL });
  return token;
}

async function popChallenge(request: Request, env: Env): Promise<string | null> {
  const token = parseCookies(request)[CHAL_COOKIE];
  if (!token) return null;
  const challenge = await env.AUTH.get(`chal:${token}`);
  if (challenge) await env.AUTH.delete(`chal:${token}`);
  return challenge;
}

// ---------- Registration (enroll a passkey) ----------

export async function registrationOptions(request: Request, env: Env): Promise<Response> {
  const { rpID, host } = ctxFrom(request);
  const existing = await listCredentials(env);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: new TextEncoder().encode(env.OWNER_EMAIL) as Uint8Array<ArrayBuffer>,
    userName: env.OWNER_EMAIL,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });

  const token = await stashChallenge(env, options.challenge);
  return new Response(JSON.stringify(options), {
    headers: {
      "content-type": "application/json",
      "Set-Cookie": challengeCookie(host, token),
    },
  });
}

export async function verifyRegistration(request: Request, env: Env): Promise<Response> {
  const { rpID, origin } = ctxFrom(request);
  const expectedChallenge = await popChallenge(request, env);
  if (!expectedChallenge) return jsonErr("No pending challenge.");

  const body = (await request.json()) as { response: unknown; label?: string };
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response as never,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch (e) {
    return jsonErr(`Registration failed: ${(e as Error).message}`);
  }
  if (!verification.verified || !verification.registrationInfo) {
    return jsonErr("Registration not verified.");
  }

  const cred = verification.registrationInfo.credential;
  await env.DB.prepare(
    "INSERT OR REPLACE INTO credentials (id, public_key, counter, transports, label, created_at) VALUES (?,?,?,?,?,?)",
  )
    .bind(
      cred.id,
      b64urlEncode(cred.publicKey),
      cred.counter,
      cred.transports ? JSON.stringify(cred.transports) : null,
      typeof body.label === "string" ? body.label.slice(0, 80) : null,
      Date.now(),
    )
    .run();

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
}

// ---------- Authentication (login with a passkey) ----------

export async function authenticationOptions(request: Request, env: Env): Promise<Response> {
  const { rpID, host } = ctxFrom(request);
  const creds = await listCredentials(env);
  if (creds.length === 0) return jsonErr("No passkeys registered yet.", 404);

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map((c) => ({
      id: c.id,
      transports: c.transports ? (JSON.parse(c.transports) as AuthenticatorTransportLike[]) : undefined,
    })),
    userVerification: "preferred",
  });

  const token = await stashChallenge(env, options.challenge);
  return new Response(JSON.stringify(options), {
    headers: {
      "content-type": "application/json",
      "Set-Cookie": challengeCookie(host, token),
    },
  });
}

export async function verifyAuthentication(request: Request, env: Env): Promise<Response> {
  const { rpID, origin, host } = ctxFrom(request);
  const expectedChallenge = await popChallenge(request, env);
  if (!expectedChallenge) return jsonErr("No pending challenge.");

  const body = (await request.json()) as { id?: string; response?: unknown };
  const resp = (body.response ?? body) as { id: string };
  const row = await env.DB.prepare("SELECT * FROM credentials WHERE id = ?")
    .bind(resp.id)
    .first<CredentialRow>();
  if (!row) return jsonErr("Unknown passkey.", 404);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: resp as never,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: row.id,
        publicKey: b64urlDecode(row.public_key) as Uint8Array<ArrayBuffer>,
        counter: row.counter,
        transports: row.transports ? (JSON.parse(row.transports) as AuthenticatorTransportLike[]) : undefined,
      },
    });
  } catch (e) {
    return jsonErr(`Login failed: ${(e as Error).message}`);
  }
  if (!verification.verified) return jsonErr("Passkey not verified.");

  await env.DB.prepare("UPDATE credentials SET counter = ? WHERE id = ?")
    .bind(verification.authenticationInfo.newCounter, row.id)
    .run();

  const setCookie = await createSession(env, host);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json", "Set-Cookie": setCookie },
  });
}

type AuthenticatorTransportLike =
  | "ble"
  | "cable"
  | "hybrid"
  | "internal"
  | "nfc"
  | "smart-card"
  | "usb";

function jsonErr(error: string, status = 400): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
