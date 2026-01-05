import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ code: string }>;
}

// Redirect to unified school page
export default async function PMSchoolPage({ params }: PageProps) {
  const { code } = await params;
  redirect(`/school/${code}`);
}
