"use client";

// The All year chart of the Test Attendance tab (#528): one bar per closed
// Monthly Test, oldest first, then a running one drawn dashed and labelled
// "so far". Each bar is the attended share of the Students counted for that
// Monthly Test, split into submitted and opened, not submitted. The bars come
// from the rules module; the values a user reads sit under the chart as text.
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from "recharts";

import { Card } from "@/components/ui";
import type { AttendanceChartBar } from "@/lib/test-attendance-rules";

const SUBMITTED = "var(--color-success)";
const OPENED = "var(--color-warning-border)";

function Swatch({ color, dashed = false }: { color?: string; dashed?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-3 w-3 rounded-sm border ${dashed ? "border-dashed border-text-muted" : "border-transparent"}`}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

export default function AttendanceChart({ bars }: { bars: AttendanceChartBar[] }) {
  if (bars.length === 0) return null;
  const columns = { gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` };
  return (
    <section aria-label="Attendance by Monthly Test">
      <Card elevation="sm" className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-text-primary">Attendance by Monthly Test</h3>
          <div className="flex flex-wrap items-center gap-3 text-xs text-text-secondary">
            <span className="inline-flex items-center gap-1">
              <Swatch color={SUBMITTED} /> Submitted
            </span>
            <span className="inline-flex items-center gap-1">
              <Swatch color={OPENED} /> Opened, not submitted
            </span>
            <span className="inline-flex items-center gap-1">
              <Swatch dashed /> So far (test still running)
            </span>
          </div>
        </div>

        {/* The same values are read below as text, so the drawing is hidden from screen readers. */}
        <div aria-hidden="true" className="h-40">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: 160 }}>
            <BarChart data={bars} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <XAxis dataKey="key" hide />
              <YAxis domain={[0, 100]} hide />
              <Bar dataKey="submittedShare" stackId="attended" maxBarSize={48} isAnimationActive={false}>
                {bars.map((bar) => (
                  <Cell
                    key={bar.key}
                    fill={SUBMITTED}
                    fillOpacity={bar.running ? 0.45 : 1}
                    stroke={bar.running ? SUBMITTED : undefined}
                    strokeDasharray={bar.running ? "4 3" : undefined}
                  />
                ))}
              </Bar>
              <Bar dataKey="openedShare" stackId="attended" maxBarSize={48} isAnimationActive={false}>
                {bars.map((bar) => (
                  <Cell
                    key={bar.key}
                    fill={OPENED}
                    fillOpacity={bar.running ? 0.3 : 0.6}
                    stroke={OPENED}
                    strokeDasharray={bar.running ? "4 3" : "2 2"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <ol className="grid gap-1 text-center" style={columns}>
          {bars.map((bar) => (
            <li key={bar.key} className="space-y-0.5">
              <p className="text-xs font-bold text-text-primary">
                {bar.shortName}
                {bar.running && <span className="font-medium text-text-muted"> so far</span>}
              </p>
              <p className="text-sm font-bold text-text-primary">{bar.percent}</p>
              <p className="text-xs text-text-secondary">
                {bar.attended} of {bar.counted}
              </p>
              <p className="text-xs text-warning-text">{bar.openedNotSubmitted} not submitted</p>
            </li>
          ))}
        </ol>
      </Card>
    </section>
  );
}
