import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { getRequest, setResponse } from "better-call/node";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import type { createHostedAuth } from "./auth.ts";

type Auth = Awaited<ReturnType<typeof createHostedAuth>>;
function escape(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function createHostedHttpHandler(auth: Auth, origin: string) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", origin);
      if (url.pathname === "/health") { res.writeHead(200); res.end("ok"); return; }
      if (req.headers.host !== new URL(origin).host) { res.writeHead(400); res.end("Invalid host"); return; }
      if (url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/.well-known/")) {
        if (Number(req.headers["content-length"] ?? 0) > 64 * 1024) {
          res.writeHead(413); res.end("Request is too large"); req.resume(); return;
        }
        await setResponse(res, await auth.handler(getRequest({ request: req, base: origin, bodySizeLimit: 64 * 1024 }))); return;
      }
      if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
      const nonce = randomBytes(18).toString("base64");
      let content: string;
      let script = "";
      const query = url.search.slice(1);
      const headers = new Headers();
      if (req.headers.cookie) headers.set("cookie", req.headers.cookie);
      const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
      const send = `async function send(path, body) { const response = await fetch(path, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) { document.getElementById('status').textContent = 'Unable to continue. Please reconnect from your AI client.'; return; } if (result.url) location.assign(result.url); else location.assign('/'); }`;
      if (url.pathname === "/login") {
        if (query && !(await verifyOAuthQueryParams(query, (await auth.$context).secret))) {
          res.writeHead(400); res.end("Invalid or expired authorization request"); return;
        }
        content = "<h1>Connect Clio Canada</h1><p>Sign in with your own Clio account. Access is currently limited to invited users.</p><button id='login'>Continue with Clio</button>";
        script = `${send} document.getElementById('login').onclick = () => send('/api/auth/sign-in/social', {provider:'clio-ca', callbackURL:'/connected', oauth_query:${safeJson(query)}});`;
      } else if (url.pathname === "/consent") {
        if (!(await verifyOAuthQueryParams(query, (await auth.$context).secret))) {
          res.writeHead(400); res.end("Invalid or expired authorization request"); return;
        }
        const session = await auth.api.getSession({ headers });
        if (!session) { res.writeHead(401); res.end("Restart the connection from your AI client"); return; }
        const client = await auth.api.getOAuthClientPublic({ headers, query: { client_id: url.searchParams.get("client_id") ?? "" } });
        const requested = (url.searchParams.get("scope") ?? "").split(" ");
        const labels: Record<string, string> = { "clio:read": "Read Clio records", "clio:write": "Create and update Clio records", offline_access: "Keep access until you disconnect or authorization expires" };
        if (requested.some(scope => !labels[scope])) { res.writeHead(400); res.end("Unsupported access request"); return; }
        content = `<h1>Allow this connection?</h1><p>${escape(client.client_name ?? "AI client")} requests access as ${escape(session.user.name)}.</p><ul>${requested.map(scope => `<li>${labels[scope]}</li>`).join("")}</ul><p>Your Clio permissions still apply. Updates can change important records.</p><button id='allow'>Allow access</button> <button id='deny'>Cancel</button>`;
        script = `${send} for (const [id, accept] of [['allow',true],['deny',false]]) document.getElementById(id).onclick = () => send('/api/auth/oauth2/consent', {accept, oauth_query:${safeJson(query)}});`;
      } else if (url.pathname === "/" || url.pathname === "/connected") {
        const session = await auth.api.getSession({ headers });
        content = session
          ? `<h1>Clio connected</h1><p>Signed in as ${escape(session.user.name)}. Return to your AI client to finish connecting.</p><p>Disconnecting removes this service's saved connection and invalidates its access. It does not revoke authorization at Clio.</p><button id='disconnect'>Disconnect Clio</button>`
          : "<h1>Clio Canada connector</h1><p>Connect from your AI client using the address below.</p>";
        content += `<p><code>${escape(origin)}/api/auth/mcp</code></p>`;
        if (session) script = `${send} document.getElementById('disconnect').onclick = () => { if (confirm('Disconnect Clio and invalidate your AI connections?')) send('/api/auth/delete-user', {}); };`;
      } else { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff", "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
      });
      res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Clio Canada connector</title><main>${content}<p id="status" role="status"></p></main><script nonce="${nonce}">${script}</script></html>`);
    } catch {
      if (!res.headersSent) res.writeHead(400, { "content-type": "text/plain", "cache-control": "no-store" });
      res.end("Unable to continue. Restart the connection from your AI client.");
    }
  };
}
