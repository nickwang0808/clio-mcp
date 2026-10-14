# Contact, matter and note CRUD

This local development fork adds `list_contacts`, `create_contact`, `update_contact`, `delete_contact`, `delete_matter`, `get_note`, `update_note` and `delete_note`. Existing `create_note` now supports contact notes as well as matter notes. The server has 45 tools, including 18 Clio write tools. `READ_ONLY=true` excludes all 18 writes. Existing regional/session OAuth routing and audit sinks remain in use.

## Official Clio Manage sources

Implementation checked against the official [Manage API reference](https://docs.developers.clio.com/clio-manage/api-reference/) and its [OpenAPI JSON](https://docs.developers.clio.com/openapi.json), retrieved 2026-10-13. Operations: `Contact#create`, `Contact#update`, `Contact#destroy`, `Matter#destroy`, `Note#show`, `Note#update`, `Note#destroy`, `Note#create`.

- POST `/contacts.json` returns 201; PATCH `/contacts/{id}.json` returns 200. Both use a `{data: ...}` envelope and explicitly request result fields. Person creation accepts full name, or preferred first/last components; Company requires name. Although the OpenAPI required list includes `name`, its Contacts/Contact Name section explicitly allows individual person name components instead.
- Contact update arrays describe individual nested additions, updates and removals; they do not replace whole arrays. Existing association `id` updates an entry; `id` with `_destroy: true` removes it; omission of `id` adds one. Reads and write results return association IDs. Custom field value IDs are composite strings (for example `text_line-123`), not numeric field IDs. Creating a custom value uses `custom_field: {id}` and `value`; updating/removing uses its existing composite `id`.
- GET `/notes/{id}.json` returns the original body and association. PATCH updates subject, detail, text type and date; the documented update body does not support changing contact/matter association. `body` maps to `detail`; a supplied body defaults to `plain_text` unless rich text is explicit. Note creation sends exactly one association matching `type: Matter` or `Contact`, according to the field descriptions (the OpenAPI required list misleadingly lists both).
- DELETE `/contacts/{id}.json`, `/matters/{id}.json`, `/notes/{id}.json` return 204 with no JSON. A 403, 404, validation failure, or uncertain network result remains an error; no failed request is reported as successful deletion. Dependency/cascade restrictions must be established against the actual account; no bulk wipe is performed by these tools.
- Optional `etag` on new PATCH tools becomes `If-Match`; a stale value produces 412 and requires reading/reconciling the latest record before retrying. See [ETags](https://docs.developers.clio.com/api-docs/clio-manage/etags/). No undocumented ETag requirement is imposed on DELETE.
- Configure application read/write access for Contacts, Matters and Notes, plus account user permissions. Changing app permissions requires OAuth reauthorization; refreshing an old token does not grant new access. See [permissions](https://docs.developers.clio.com/api-docs/clio-manage/permissions/).

The new contact tools intentionally expose the common identity/address/company/custom-field subset, not every billing, KYC, avatar or notification option in Clio. CRUD means all four operations are available; this is not exhaustive field coverage.

## Validation

Mocked HTTP tests exercise request methods, envelopes, regional URL/authentication, nested association semantics, schema/conditional validation, ETag conflicts, empty DELETE responses and API/network errors. Registry and audit tests cover read-only exclusion, annotations and redaction. No live Clio credentials or external records were used. Test the seed/delete cycle with disposable records after authorizing the trial/developer account, before relying on a reset workflow.
