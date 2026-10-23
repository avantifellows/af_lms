import { query } from "./db";

// Staging + prod have duplicate chapter rows for the same chapter code (e.g. 12P17
// "Electric Charges and Fields" = ids 22 AND 27), and a CMS test's type_params.chapter_id
// points at just one of them. Chapter rows sharing (code, subject, grade) are the same
// Chapter. See task lms-cms-tests.

// SQL predicate: chapter row `sibling` shares chapter row `chapter`'s code, subject and grade.
export function chapterSharesCodeSql(chapter: string, sibling: string): string {
  return `${sibling}.code = ${chapter}.code
    AND ${sibling}.subject_id IS NOT DISTINCT FROM ${chapter}.subject_id
    AND ${sibling}.grade_id IS NOT DISTINCT FROM ${chapter}.grade_id`;
}

export async function chapterIdsSharingCode(chapterId: number): Promise<number[]> {
  const rows = await query<{ id: number }>(
    `SELECT sib.id
       FROM chapter sel
       JOIN chapter sib ON ${chapterSharesCodeSql("sel", "sib")}
      WHERE sel.id = $1`,
    [chapterId]
  );
  return rows.map((r) => Number(r.id));
}
