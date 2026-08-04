import { randomUUID } from "node:crypto";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export async function writePrivateFileAtomically(
  outputPath: string,
  contents: string
): Promise<void> {
  const target = resolve(outputPath);
  await requireMissingTarget(target);
  const temporary = join(
    dirname(target),
    `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`
  );
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let published = false;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await requireMissingTarget(target);
    await rename(temporary, target);
    published = true;
  } catch {
    await handle?.close().catch(() => undefined);
    if (!published) await unlink(temporary).catch(() => undefined);
    throw new Error("Historical private output could not be written safely");
  }
}

async function requireMissingTarget(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("Historical private output already exists");
}
