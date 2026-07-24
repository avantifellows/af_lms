import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { writePrivateFileAtomically } from "./private-file";

describe("private operator output", () => {
  it("publishes a new owner-only file without leaving a temporary file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "holistic-private-"));
    try {
      const output = join(directory, "grouped.json");
      await writePrivateFileAtomically(output, "private-content");

      expect(await readFile(output, "utf8")).toBe("private-content");
      expect((await stat(output)).mode & 0o777).toBe(0o600);
      expect(await readdir(directory)).toEqual(["grouped.json"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects existing files and symlinks without changing their targets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "holistic-private-"));
    try {
      const existing = join(directory, "existing.json");
      await writeFile(existing, "existing", { mode: 0o644 });
      await expect(writePrivateFileAtomically(existing, "replacement"))
        .rejects.toThrow("Historical private output already exists");
      expect(await readFile(existing, "utf8")).toBe("existing");

      const target = join(directory, "target.json");
      const linked = join(directory, "linked.json");
      await writeFile(target, "target");
      await symlink(target, linked);
      await expect(writePrivateFileAtomically(linked, "replacement"))
        .rejects.toThrow("Historical private output already exists");
      expect(await readFile(target, "utf8")).toBe("target");
      expect((await readdir(directory)).every((name) => !name.endsWith(".tmp"))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
