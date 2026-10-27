import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import z from "zod";
vi.mock("../../auth/oauth.js", () => ({ getValidAccessToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("../../utils/sessionContext.js", () => ({ requireSessionContext: vi.fn().mockReturnValue(null), getSessionContext: vi.fn().mockReturnValue(undefined) }));
vi.mock("../../utils/clioRegion.js", () => ({ getClioApiBaseUrl: vi.fn().mockReturnValue("https://eu.app.clio.com/api/v4") }));
const { audit } = vi.hoisted(() => ({ audit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../utils/auditLog.js", () => ({ appendAuditLog: audit }));
import { registerCrudTools } from "../crud.js";
import { registerNoteTools } from "../notes.js";
const handlers: Record<string, Function> = {}, schemas: Record<string, any> = {};
const server = { registerTool(name: string, config: any, handler: Function) { handlers[name] = handler; schemas[name] = z.object(config.inputSchema); } };
registerCrudTools(server as any); registerNoteTools(server as any);
function invoke(name: string, args: unknown) { return handlers[name](schemas[name].parse(args)); }
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status }); }
function payload() { return JSON.parse((fetch as any).mock.calls.at(-1)[1].body); }
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ data: { id: 7, etag: "version" } }))); });
afterEach(() => vi.unstubAllGlobals());

describe("Clio Manage CRUD over mocked HTTP", () => {
  it.each([
    ["list_contacts", {}],
    ["create_contact", { type: "Company", name: "Field projection test" }],
    ["update_contact", { contact_id: 7, name: "Field projection test" }],
  ])("%s uses a contact projection accepted by Clio's single-level field parser", async (tool, args) => {
    (fetch as any).mockImplementation(async (value: string) => {
      const fields = new URL(value).searchParams.get("fields")!;
      let depth = 0;
      for (const char of fields) {
        if (char === "{") depth++;
        if (char === "}") depth--;
        if (depth > 1) return response({ error: { type: "InvalidFields", message: "Nested field projection" } }, 400);
      }
      expect(depth).toBe(0);
      expect(fields).toContain("custom_field_values{id,value,custom_field}");
      return response({ data: tool === "list_contacts" ? [] : { id: 7 } });
    });
    const result = await invoke(tool as string, args);
    expect(result.isError).not.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("enumerates contacts and preserves cursor filters", async () => {
    (fetch as any).mockResolvedValue(response({ data: [{ id: 1 }], meta: { records: 2, paging: { next: "https://eu.app.clio.com/api/v4/contacts.json?page_token=next" } } }));
    const result = await invoke("list_contacts", { client_only: false, type: "Person", page_token: "previous", limit: 1 });
    const url = new URL((fetch as any).mock.calls[0][0]);
    expect(url.searchParams.get("query")).toBeNull(); expect(url.searchParams.get("client_only")).toBe("false"); expect(url.searchParams.get("page_token")).toBe("previous");
    expect(JSON.parse(result.content[0].text)).toEqual({ contacts: [{ id: 1 }], total_count: 2, has_more: true, next_page_token: "next" });
  });
  it("creates person, associations and company link using documented POST envelope and regional auth", async () => {
    const result = await invoke("create_contact", { type: "Person", first_name: "John", last_name: "Doe", company_id: 3, email_addresses: [{ name: "Work", address: "john@example.test" }] });
    expect(result.isError).toBeUndefined();
    const [url, request] = (fetch as any).mock.calls[0];
    expect(new URL(url).pathname).toBe("/api/v4/contacts.json"); expect(new URL(url).host).toBe("eu.app.clio.com");
    expect(new URL(url).searchParams.get("fields")).toContain("email_addresses{id");
    expect(request.method).toBe("POST"); expect(request.headers.Authorization).toBe("Bearer test-token");
    expect(payload()).toEqual({ data: { type: "Person", first_name: "John", last_name: "Doe", company: { id: 3 }, email_addresses: [{ name: "Work", address: "john@example.test" }] } });
    expect(JSON.parse(result.content[0].text).contact.id).toBe(7);
  });
  it("creates a company with name", async () => { await invoke("create_contact", { type: "Company", name: "Example LLC" }); expect(payload().data).toEqual({ type: "Company", name: "Example LLC" }); });
  it.each([{ type: "Person" }, { type: "Company", first_name: "Wrong" }, { type: "Person", first_name: "John", email_addresses: [{ id: 1, address: "a@b.test" }] }])("rejects incomplete creation or update-only association flags", async args => {
    expect((await invoke("create_contact", args)).isError).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });
  it("updates only supplied contact fields and preserves nested update/add/delete semantics", async () => {
    await invoke("update_contact", { contact_id: 7, etag: '"old"', email_addresses: [{ id: 2, address: "new@example.test" }, { id: 3, _destroy: true }, { address: "extra@example.test" }], custom_field_values: [{ id: "text_line-4", value: "new" }] });
    const request = (fetch as any).mock.calls[0][1]; expect(request.method).toBe("PATCH"); expect(request.headers["If-Match"]).toBe('"old"');
    expect(payload().data).toEqual({ email_addresses: [{ id: 2, address: "new@example.test" }, { id: 3, _destroy: true }, { address: "extra@example.test" }], custom_field_values: [{ id: "text_line-4", value: "new" }] });
  });
  it.each([{ contact_id: 7 }, { contact_id: 7, email_addresses: [{ _destroy: true }] }, { contact_id: 7, custom_field_values: [{ value: "missing field" }] }])("rejects invalid nested/no-op updates before HTTP", async args => { expect((await invoke("update_contact", args)).isError).toBe(true); expect(fetch).not.toHaveBeenCalled(); });
  it.each(["contact", "matter", "note"])("deletes %s using DELETE and accepts empty 204", async resource => {
    (fetch as any).mockResolvedValue(new Response(null, { status: 204 }));
    const result = await invoke("delete_" + resource, { [resource + "_id"]: 7 });
    const [url, request] = (fetch as any).mock.calls[0]; expect(new URL(url).pathname).toBe(`/api/v4/${resource}s/7.json`); expect(request.method).toBe("DELETE"); expect(request.body).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ success: true, deleted: true, [resource + "_id"]: 7 });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ tool: "delete_" + resource, outcome: "success" }));
  });
  it.each([403, 404, 422, 412])("propagates HTTP %s without retrying or reporting success", async status => {
    (fetch as any).mockResolvedValue(response({ error: { message: "Rejected" } }, status));
    const result = await invoke("update_contact", { contact_id: 7, name: "Changed" });
    expect(result.isError).toBe(true); expect(result.content[0].text).toContain(String(status)); expect(fetch).toHaveBeenCalledTimes(1); expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error" }));
  });
  it("does not treat failed deletion as already deleted", async () => { (fetch as any).mockResolvedValue(response({ error: "Missing" }, 404)); expect((await invoke("delete_contact", { contact_id: 7 })).isError).toBe(true); });
  it("does not retry an uncertain network mutation", async () => { (fetch as any).mockRejectedValue(new Error("socket lost")); expect((await invoke("create_contact", { type: "Company", name: "Test" })).isError).toBe(true); expect(fetch).toHaveBeenCalledTimes(1); });
  it("gets original note body, association and etag", async () => {
    const note = { id: 7, etag: "a", detail: "<p>Original</p>", detail_text_type: "rich_text", contact: { id: 2 } };
    (fetch as any).mockResolvedValue(response({ data: note })); const result = await invoke("get_note", { note_id: 7 });
    expect(JSON.parse(result.content[0].text)).toEqual({ note }); expect(new URL((fetch as any).mock.calls[0][0]).searchParams.get("fields")).toContain("etag");
  });
  it("updates note body as plain text by default and supports optimistic concurrency", async () => {
    await invoke("update_note", { note_id: 7, body: "New body", etag: "old", date: "2026-10-13" });
    expect(payload()).toEqual({ data: { date: "2026-10-13", detail: "New body", detail_text_type: "plain_text" } }); expect((fetch as any).mock.calls[0][1].headers["If-Match"]).toBe("old");
  });
  it("supports rich text and explicit clearing of body", async () => {
    await invoke("update_note", { note_id: 7, body: "", detail_text_type: "rich_text" }); expect(payload().data).toEqual({ detail: "", detail_text_type: "rich_text" });
  });
  it("rejects empty note update", async () => { expect((await invoke("update_note", { note_id: 7 })).isError).toBe(true); expect(fetch).not.toHaveBeenCalled(); });
  it.each(["matter", "contact"])("creates a %s note with exactly one documented association", async type => {
    await invoke("create_note", { [type + "_id"]: 7, subject: "Intake", body: "Body", date: "2026-10-13" });
    expect(payload().data).toEqual({ subject: "Intake", detail: "Body", detail_text_type: "plain_text", type: type === "matter" ? "Matter" : "Contact", [type]: { id: 7 }, date: "2026-10-13" });
  });
  it("rejects two note associations", async () => { expect((await invoke("create_note", { matter_id: 1, contact_id: 2, subject: "x", body: "x" })).isError).toBe(true); expect(fetch).not.toHaveBeenCalled(); });
  it("validates IDs, enums, nested unknown fields and dates", () => {
    expect(() => invoke("delete_contact", { contact_id: -1 })).toThrow(); expect(() => invoke("create_contact", { type: "Invalid", name: "x" })).toThrow();
    expect(() => invoke("update_contact", { contact_id: 1, email_addresses: [{ address: "a@b.test", unknown: true }] })).toThrow();
    expect(() => invoke("update_note", { note_id: 1, date: "2026-02-30" })).toThrow();
  });
});
