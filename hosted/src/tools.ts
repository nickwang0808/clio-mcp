import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { registerAllTools, runWithSessionContext, TOOL_META, type SessionContext } from "../../build/lib.js";

/** The shared registry uses v1's raw schema shapes; the hosted transport is v2. */
export function registerHostedTools(server: McpServer, scopes: ReadonlySet<string>, session: () => SessionContext) {
  const facade = {
    registerTool(name: string, config: { inputSchema: z.ZodRawShape; description?: string; annotations?: Record<string, boolean> },
      callback: (args: Record<string, unknown>) => Promise<CallToolResult>) {
      const meta = TOOL_META[name];
      if (!meta || !scopes.has(meta.readOnly ? "clio:read" : "clio:write")) return undefined;
      return server.registerTool(name, { ...config, inputSchema: z.object(config.inputSchema).strict() },
        args => runWithSessionContext(session(), () => callback(args)));
    },
  };
  // This adapter implements the only method used when auth/resources are disabled.
  registerAllTools(facade as unknown as Parameters<typeof registerAllTools>[0], {
    auth: "none", resources: false,
    // Upload and audit export need hosted, owner-isolated implementations.
    exclude: ["upload_document", "export_audit_log"],
  });
}
