import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { isAbsolute, dirname } from "node:path";
import { stat } from "node:fs/promises";
import { createHostedAuth } from "./auth.ts";
import { createHostedHttpHandler } from "./http.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const path = required("HOSTED_DATABASE_PATH");
if (!isAbsolute(path) || !(await stat(dirname(path))).isDirectory()) throw new Error("Persistent database directory must already exist");
const database = new DatabaseSync(path);
database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000");
const origin = required("HOSTED_ORIGIN");
const auth = await createHostedAuth(database, {
  origin, secret: required("BETTER_AUTH_SECRET"), clientId: required("CLIO_CLIENT_ID"), clientSecret: required("CLIO_CLIENT_SECRET"),
  invitations: new Set(required("CLIO_INVITED_IDENTITIES").split(",").map(value => value.trim()).filter(Boolean)),
});
const server = createServer(createHostedHttpHandler(auth, origin));
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.listen(Number(process.env.PORT ?? 8080), "0.0.0.0", () => console.info("Hosted Clio connector is ready"));
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => {
  server.close(() => { database.close(); });
  server.closeIdleConnections();
});
