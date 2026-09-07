// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import officeCrypto from "officecrypto-tool";
import * as CFB from "cfb";
import { readableStudentWorkbook, UnsupportedWorkbookEncryptionError } from "./student-addition-workbook";

async function workbook() {
  const book = new ExcelJS.Workbook();
  book.addWorksheet("Template").addRow(["Grade", "Student Name"]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe("readableStudentWorkbook", () => {
  it("leaves ordinary XLSX bytes untouched", async () => {
    const data = await workbook();
    expect(await readableStudentWorkbook(data)).toBe(data);
  });

  it.each(["standard", "agile"] as const)("opens automatic %s encryption without changing the workbook", async (type) => {
    const data = await workbook();
    const encrypted = await officeCrypto.encrypt(data, {
      password: "VelvetSweatshop", ...(type === "standard" ? { type } : {}),
    });
    expect(await readableStudentWorkbook(encrypted)).toEqual(data);
  });

  it.each(["standard", "agile"] as const)("rejects a user password with %s encryption", async (type) => {
    const encrypted = await officeCrypto.encrypt(await workbook(), {
      password: "synthetic-user-password", ...(type === "standard" ? { type } : {}),
    });
    await expect(readableStudentWorkbook(encrypted)).rejects.toThrow(UnsupportedWorkbookEncryptionError);
  });

  it("rejects excessive Agile work factors before decrypting", async () => {
    const encrypted = await officeCrypto.encrypt(await workbook(), { password: "VelvetSweatshop" });
    const archive = CFB.read(encrypted, { type: "buffer" });
    const entry = CFB.find(archive, "/EncryptionInfo")!;
    const info = Buffer.from(entry.content);
    const xml = info.subarray(8).toString("utf8").replace('spinCount="100000"', 'spinCount="999999999"');
    expect(xml).toContain('spinCount="999999999"');
    CFB.utils.cfb_add(archive, "/EncryptionInfo", Buffer.concat([info.subarray(0, 8), Buffer.from(xml)]));
    const modified = CFB.write(archive, { type: "buffer" });
    await expect(readableStudentWorkbook(modified)).rejects.toThrow(UnsupportedWorkbookEncryptionError);
  });
});
