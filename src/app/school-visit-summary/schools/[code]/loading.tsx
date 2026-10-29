import { Card } from "@/components/ui";

export default function SchoolVisitSummaryLoading() {
  return (
    <div className="min-h-screen bg-bg">
      <main className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="border-b-4 border-border-accent pb-4">
          <div className="h-7 w-64 max-w-full rounded bg-hover-bg" />
          <div className="mt-2 h-4 w-48 max-w-full rounded bg-hover-bg" />
        </div>
        <Card className="p-6" role="status" aria-live="polite">
          <div className="flex items-center gap-3 text-sm font-semibold text-text-primary">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Loading School concerns...
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="h-24 rounded-lg bg-hover-bg" />
            <div className="h-24 rounded-lg bg-hover-bg" />
          </div>
        </Card>
      </main>
    </div>
  );
}
