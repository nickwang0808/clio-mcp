/**
 * The published tool count has been wrong three times (26, then 35, then 34),
 * on npm, in the MCP Registry and on the website, because it lives in prose and
 * prose does not fail CI. The README is what a firm reads before installing, so
 * the numbers in it are checked against the registry that decides them.
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
const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
const localGuide = fs.readFileSync(path.join(repoRoot, "docs/local-deployment.md"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

describe("README tool counts", () => {
  it("states the local tool total in the deployment comparison", () => {
    const totals = readme.match(/\| Tool total with writes enabled \| (\d+) tools \| (\d+) tools \|/);
    expect(totals, "README must distinguish hosted and local totals").not.toBeNull();
    expect(Number(totals![2])).toBe(Object.keys(TOOL_META).length);
  });

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
    const written = readme.match(/removes all \*\*(\d+) Clio write tools\*\*/);
    expect(written, "README no longer describes the read-only write-tool count").not.toBeNull();
    expect(Number(written![1])).toBe(WRITE_TOOLS.size);
  });
});
