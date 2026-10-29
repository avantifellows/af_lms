import { Card } from "@/components/ui";

export default function VisitSummaryLoading() {
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-bg-card shadow-sm">
        <div className="px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="text-xl font-bold uppercase tracking-tight text-text-primary sm:text-2xl">Visit Summary</h1>
          <p className="text-xs text-text-muted">Loading visits...</p>
        </div>
      </header>

      <main className="px-4 py-6 sm:px-6 lg:px-8">
        <Card className="p-6" role="status" aria-live="polite">
          <div className="flex items-center gap-3 text-sm font-semibold text-text-primary">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Loading visit summary...
          </div>
          <div className="mt-5 space-y-3">
            <div className="h-11 rounded-lg bg-hover-bg" />
            <div className="h-11 rounded-lg bg-hover-bg" />
            <div className="h-11 rounded-lg bg-hover-bg" />
          </div>
        </Card>
      </main>
    </div>
  );
}
