import { Card } from "@/components/ui";

export default function AcademicMentorshipLoading() {
  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-bg-card border-b border-border shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <h1 className="text-xl font-bold uppercase tracking-tight text-text-primary sm:text-2xl">
              Academic Mentorship
            </h1>
            <p className="text-xs text-text-muted">Loading mappings...</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Card className="p-6" role="status" aria-live="polite">
          <div className="flex items-center gap-3 text-sm font-semibold text-text-primary">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Loading mentorship mappings...
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_220px_auto]">
            <div className="h-11 rounded-lg bg-hover-bg" />
            <div className="h-11 rounded-lg bg-hover-bg" />
            <div className="h-11 rounded-lg bg-hover-bg" />
            <div className="h-11 rounded-lg bg-hover-bg" />
          </div>
        </Card>
      </main>
    </div>
  );
}
