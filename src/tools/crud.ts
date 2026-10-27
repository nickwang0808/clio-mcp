import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { clioGet, clioPost, clioPatch, clioDelete, extractNextPageToken } from "../utils/clioClient.js";
import { appendAuditLog } from "../utils/auditLog.js";

// Clio Manage v4, not Grow. Source and association semantics: docs/crud.md.
const id = z.number().int().positive();
const association = { id: id.optional(), _destroy: z.boolean().optional() };
const email = z.object({ ...association, name: z.enum(["Work", "Home", "Other"]).optional(), address: z.string().email().optional(), default_email: z.boolean().optional() }).strict();
const phone = z.object({ ...association, name: z.enum(["Work", "Home", "Mobile", "Fax", "Pager", "Skype", "Other"]).optional(), number: z.string().optional(), default_number: z.boolean().optional() }).strict();
const address = z.object({ ...association, name: z.enum(["Work", "Home", "Billing", "Other"]).optional(), street: z.string().optional(), city: z.string().optional(), province: z.string().optional(), postal_code: z.string().optional(), country: z.string().optional() }).strict();
const customField = z.object({ id: z.string().min(1).optional(), custom_field: z.object({ id }).strict().optional(), value: z.string().optional(), _destroy: z.boolean().optional() }).strict();
const contactFields = {
  type: z.enum(["Person", "Company"]).optional(), name: z.string().min(1).optional(),
  first_name: z.string().optional(), last_name: z.string().optional(), middle_name: z.string().optional(),
  prefix: z.string().optional(), title: z.string().optional(), date_of_birth: z.string().date().optional(),
  company_id: id.optional().describe("Existing company contact ID; null is not supported by Clio"),
  email_addresses: z.array(email).max(200).optional(), phone_numbers: z.array(phone).max(200).optional(),
  addresses: z.array(address).max(200).optional(), custom_field_values: z.array(customField).max(200).optional(),
};
// Include association IDs so callers can update/remove existing entries, rather than duplicate them.
const contactResultFields = "id,etag,name,type,first_name,last_name,middle_name,prefix,title,date_of_birth,company{id,name},email_addresses{id,name,address,default_email},phone_numbers{id,name,number,default_number},addresses{id,name,street,city,province,postal_code,country},custom_field_values{id,value,custom_field}";
const noteFields = "id,etag,subject,detail,detail_text_type,date,type,matter{id,display_number},contact{id,name},author{id,name},created_at,updated_at";
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const error = (message: string) => ({ content: [{ type: "text" as const, text: "Error: " + message }], isError: true });

function contactBody(args: Record<string, any>, creating: boolean): Record<string, any> {
  const { contact_id, etag, company_id, ...data } = args;
  if (company_id !== undefined) data.company = { id: company_id };
  if (creating) {
    if (data.type === "Company" && !data.name?.trim()) throw new Error("Company contacts require name");
    if (data.type === "Person" && !data.name?.trim() && !data.first_name?.trim() && !data.last_name?.trim()) throw new Error("Person contacts require first_name, last_name, or name");
  }
  if (!Object.keys(data).some(k => data[k] !== undefined)) throw new Error("Provide at least one contact field to update");
  for (const key of ["email_addresses", "phone_numbers", "addresses", "custom_field_values"]) {
    for (const entry of data[key] ?? []) {
      if (creating && (entry.id !== undefined || entry._destroy !== undefined)) throw new Error("Association id/_destroy are only supported when updating");
      if (entry._destroy && !entry.id) throw new Error("Association deletion requires its existing id");
      if (key === "custom_field_values" && !entry._destroy && (entry.value === undefined || (!entry.id && !entry.custom_field))) throw new Error("Custom field values require value and custom_field.id (or existing value id)");
      if (!entry.id && key === "email_addresses" && !entry.address) throw new Error("New email addresses require address");
      if (!entry.id && key === "phone_numbers" && !entry.number) throw new Error("New phone numbers require number");
    }
  }
  return data;
}

async function audited(tool: string, args: Record<string, any>, operation: () => Promise<unknown>) {
  // Summarize only routing IDs/filter enums; omit names, bodies and association values.
  const auditArgs = Object.fromEntries(Object.entries(args).filter(([key]) => ["contact_id", "matter_id", "note_id", "company_id", "type", "date", "detail_text_type", "limit", "page_token", "client_only"].includes(key)));
  try {
    const result = await operation();
    await appendAuditLog({ tool, args: auditArgs, outcome: "success", ...(args.matter_id && { matter_id: args.matter_id }) });
    return text(result);
  } catch (err: any) {
    await appendAuditLog({ tool, args: auditArgs, outcome: "error", error_message: err.message, ...(args.matter_id && { matter_id: args.matter_id }) });
    return error(err.message);
  }
}

export function registerCrudTools(server: McpServer): void {
  server.registerTool("list_contacts", {
    description: "List Clio contacts without requiring a search query; use pagination to enumerate records. Optional filters restrict contact type or clients.",
    inputSchema: { type: z.enum(["Person", "Company"]).optional(), client_only: z.boolean().optional(), limit: z.number().int().min(1).max(200).default(25), page_token: z.string().optional() },
  }, args => audited("list_contacts", args, async () => {
    const params: Record<string, string> = { fields: contactResultFields, limit: String(args.limit) };
    if (args.type !== undefined) params.type = args.type;
    if (args.client_only !== undefined) params.client_only = String(args.client_only);
    if (args.page_token !== undefined) params.page_token = args.page_token;
    const result = await clioGet("/contacts.json", params);
    const next = extractNextPageToken(result.meta);
    return { contacts: result.data ?? [], total_count: result.meta?.records ?? result.data?.length ?? 0, has_more: next !== null, next_page_token: next };
  }));
  server.registerTool("create_contact", {
    description: "Create a Clio Person or Company contact. Prefer first_name/last_name for people; companies require name. Nested associations are created in this request.",
    inputSchema: { ...contactFields, type: z.enum(["Person", "Company"]) },
  }, args => audited("create_contact", args, async () => {
    const result = await clioPost("/contacts.json", { data: contactBody(args, true) }, { fields: contactResultFields });
    return { success: true, contact: result.data };
  }));
  server.registerTool("update_contact", {
    description: "Update supplied fields only. Association arrays are nested changes, NOT replacements: use existing association id to update, id + _destroy to remove, omit id to add. Optional etag prevents overwriting concurrent edits.",
    inputSchema: { contact_id: id, ...contactFields, etag: z.string().min(1).optional() },
  }, args => audited("update_contact", args, async () => {
    const result = await clioPatch(`/contacts/${args.contact_id}.json`, { data: contactBody(args, false) }, { fields: contactResultFields }, args.etag);
    return { success: true, contact: result.data };
  }));
  for (const [resource, key] of [["contact", "contact_id"], ["matter", "matter_id"], ["note", "note_id"]] as const) {
    server.registerTool(`delete_${resource}`, {
      description: `Delete one Clio ${resource} by ID. This changes Clio records. API permissions and dependency restrictions apply; an error is not a successful deletion.`,
      inputSchema: { [key]: id },
    }, args => audited(`delete_${resource}`, args, async () => {
      await clioDelete(`/${resource}s/${args[key]}.json`);
      return { success: true, deleted: true, [key]: args[key] };
    }));
  }
  server.registerTool("get_note", {
    description: "Get a single Clio note, its association, original body and etag by ID.",
    inputSchema: { note_id: id },
  }, args => audited("get_note", args, async () => {
    const result = await clioGet(`/notes/${args.note_id}.json`, { fields: noteFields });
    return { note: result.data };
  }));
  server.registerTool("update_note", {
    description: "Update a note's subject, body or date. Existing matter/contact association cannot be changed through Clio's note update API. Optional etag prevents overwriting concurrent edits.",
    inputSchema: { note_id: id, subject: z.string().min(1).optional(), body: z.string().optional(), date: z.string().date().optional(), detail_text_type: z.enum(["plain_text", "rich_text"]).optional(), etag: z.string().min(1).optional() },
  }, args => audited("update_note", args, async () => {
    const { note_id, etag, body, ...data } = args;
    if (!Object.keys(data).some(k => data[k as keyof typeof data] !== undefined) && body === undefined) throw new Error("Provide at least one note field to update");
    const result = await clioPatch(`/notes/${note_id}.json`, { data: { ...data, ...(body !== undefined && { detail: body, detail_text_type: args.detail_text_type ?? "plain_text" }) } }, { fields: noteFields }, etag);
    return { success: true, note: result.data };
  }));
}
