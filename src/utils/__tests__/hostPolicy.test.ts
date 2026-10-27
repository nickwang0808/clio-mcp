import { describe, expect, it, vi } from "vitest";
import { runWithSessionContext, type SessionContext } from "../sessionContext.js";
import { clioGet, clioPatch } from "../clioClient.js";
import { appendAuditLog } from "../auditLog.js";

describe("request-local host policies", () => {
  it("isolates concurrent HTTP and audit overrides without retrying a host failure", async () => {
    const contexts = ["alice", "carol"].map(userId => {
      const fetchClio = vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === "PATCH") throw new Error("host denied write");
        await Promise.resolve();
        return Response.json({ userId });
      });
      const appendAudit = vi.fn(async () => {});
      return { sessionId: userId, userId, clioUserId: userId, region: "ca", fetchClio, appendAudit,
        getAccessToken: async () => userId, getTokens: async () => null,
        storeTokens: async () => {}, clearTokens: async () => {},
      } satisfies SessionContext;
    });
    await Promise.all(contexts.map(context => runWithSessionContext(context, async () => {
      expect(await clioGet("/matters/1.json")).toEqual({ userId: context.userId });
      await expect(clioPatch("/matters/1.json", { data: {} })).rejects.toThrow("host denied write");
      await appendAuditLog({ tool: "get_matter", args: {}, outcome: "success" });
      expect(context.fetchClio).toHaveBeenCalledTimes(2);
      expect(context.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ user_id: context.userId }));
    })));
  });
});
