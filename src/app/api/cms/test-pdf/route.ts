import { NextRequest } from "next/server";
import { requireCmsServiceAccess } from "@/lib/cms-service";
import { serveCmsTestPdf } from "@/lib/cms-test-pdf";

// Question/answer PDFs for new-CMS tests in session details. The generation and
// S3 staging live in serveCmsTestPdf; see there for why the bytes are not returned.
export async function GET(request: NextRequest) {
  const access = await requireCmsServiceAccess();
  if (!access.ok) {
    return access.response;
  }
  return serveCmsTestPdf(request, access.cms);
}
