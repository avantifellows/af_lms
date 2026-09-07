import * as CFB from "cfb";
import officeCrypto from "officecrypto-tool";

const COMPOUND_FILE_SIGNATURE = Buffer.from("d0cf11e0a1b11ae1", "hex");
// Excel opens workbooks using this built-in password without prompting users.
const EXCEL_DEFAULT_PASSWORD = "VelvetSweatshop";

export class UnsupportedWorkbookEncryptionError extends Error {
  constructor() {
    super("This workbook requires a password or uses unsupported encryption. Password-protected uploads are not supported. Save an unencrypted .xlsx copy and upload again.");
  }
}

function supportedEncryption(info: Buffer) {
  if (info.length < 8) return false;
  const major = info.readUInt16LE(0);
  const minor = info.readUInt16LE(2);
  if ((major === 3 || major === 4) && minor === 2) return true;
  if (major !== 4 || minor !== 4) return false;

  // Agile files choose their own work factor. Bound it before entering the
  // decryptor's synchronous key-derivation loop; Excel normally uses 100,000.
  const counts = [...info.subarray(8).toString("utf8").matchAll(/\bspinCount\s*=\s*["'](\d+)["']/g)];
  return counts.length === 1 && Number(counts[0][1]) <= 100_000;
}

export async function readableStudentWorkbook(data: Buffer): Promise<Buffer> {
  if (!data.subarray(0, 8).equals(COMPOUND_FILE_SIGNATURE)) return data;
  const archive = CFB.read(data, { type: "buffer" });
  const info = CFB.find(archive, "/EncryptionInfo");
  if (!info) return data; // Not an encrypted XLSX; the normal parser handles it.

  try {
    if (!supportedEncryption(Buffer.from(info.content))) {
      throw new UnsupportedWorkbookEncryptionError();
    }
    return await officeCrypto.decrypt(data, { password: EXCEL_DEFAULT_PASSWORD });
  } catch {
    // Never try user passwords or expose cryptographic/parser details.
    throw new UnsupportedWorkbookEncryptionError();
  }
}
