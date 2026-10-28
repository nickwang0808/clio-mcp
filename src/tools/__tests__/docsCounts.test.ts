/**
 * The published tool count has been wrong three times (26, then 35, then 34),
 * on npm, in the MCP Registry and on the website, because it lives in prose and
 * prose does not fail CI. Counts in the local guide and package description
 * are checked against the registry that decides them.
 */
import { vi, describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

vi.mock("@napi-rs/keyring", () => ({
  Entry: class {
    getPassword() { return null; }
    setPassword() {}
    deletePassword() {}
  },
}));

import { TOOL_META, WRITE_TOOLS } from "../index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const localGuide = fs.readFileSync(path.join(repoRoot, "docs/local-deployment.md"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

describe("Published tool counts", () => {
  it("states the same total in the local setup guide", () => {
    const total = localGuide.match(/local server has (\d+) tools/);
    expect(total).not.toBeNull();
    expect(Number(total![1])).toBe(Object.keys(TOOL_META).length);
  });

  it("states the same total in the npm package description", () => {
    const claimed = pkg.description.match(/(\d+) tools/);
    expect(claimed, "package.json description no longer states a tool count").not.toBeNull();
    expect(Number(claimed![1])).toBe(Object.keys(TOOL_META).length);
  });

  it("describes the read-only mode with the real number of write tools", () => {
    const written = localGuide.match(/read-only mode omits the (\d+) Clio write tools/);
    expect(written, "Local guide no longer describes the read-only write-tool count").not.toBeNull();
    expect(Number(written![1])).toBe(WRITE_TOOLS.size);
  });
});
