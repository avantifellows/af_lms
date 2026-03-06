import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PrincipalMeetingPage({ params }: PageProps) {
  const { id } = await params;
  redirect(`/visits/${id}`);
}
