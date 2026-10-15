import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { mcpResource } from "@/lib/mcp/oauth";
import { getResolvedPermission } from "@/lib/permissions";
import CopyAddress from "./CopyAddress";

// Setup page for the LMS Claude connector, for LMS users only: any Google
// account can sign in, so the instructions also need an LMS permission.
// The address shown is the one this environment serves.

const CONTACT = "pritam@avantifellows.org";

export const metadata: Metadata = {
  title: "Avanti LMS in Claude",
  description: "Add the Avanti LMS connector to Claude",
};

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-text-on-accent">
        {n}
      </span>
      <div>
        <h4 className="font-semibold text-text-primary">{title}</h4>
        <div className="mt-1 text-text-secondary">{children}</div>
      </div>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-2xl font-bold text-text-primary">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export default async function McpSetupPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/?callbackUrl=/mcp");

  if (!(await getResolvedPermission(email))) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-4">
        <div className="max-w-md rounded-xl border border-border bg-bg-card p-6 text-text-secondary">
          <h1 className="text-xl font-bold text-text-primary">No LMS access</h1>
          <p className="mt-2">
            {email} doesn&apos;t have access to the LMS, so the Claude connector won&apos;t show it anything. If you
            should have access, write to <a className="text-accent hover:underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
          </p>
        </div>
      </main>
    );
  }

  const address = mcpResource(new URL(process.env.NEXTAUTH_URL || "http://localhost:3000").origin);

  return (
    <main className="min-h-screen bg-bg px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-2xl text-[16px] leading-relaxed text-text-secondary">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://cdn.avantifellows.org/af_logos/avanti_logo_black_text.webp"
          alt="Avanti Fellows"
          className="mb-8 h-10"
        />
        <h1 className="text-4xl font-bold text-text-primary">Avanti LMS in Claude</h1>
        <p className="mt-3 text-lg">
          Ask Claude about your schools in plain English: curriculum progress, test results, mentorship coverage.
          It sees exactly what you see in the LMS, and nothing more. For LMS users.
        </p>

        <div className="mt-8 rounded-xl border border-border bg-bg-card p-5">
          <p className="mb-2 text-sm font-semibold text-text-primary">Connector address</p>
          <CopyAddress address={address} />
          <p className="mt-3 text-sm">
            Do this on a computer, in <b>claude.ai</b> or the Claude desktop app. Connectors are set up there, not in
            the phone app. Sign in with the <b>same Google account you use for the LMS</b>.
          </p>
        </div>

        <Section title="Add it to Claude">
          <div className="rounded-xl border border-border bg-bg-card p-5">
            <h3 className="text-lg font-semibold text-text-primary">If your Claude account is in the Avanti workspace</h3>
            <p className="mt-1">Most people. An admin adds it once for the whole organisation.</p>
            <ol className="mt-4 space-y-4">
              <Step n={1} title="Connect">
                Go to <b>Settings → Connectors</b>, find <b>Avanti LMS</b> and click <b>Connect</b>. Not in the list?
                It hasn&apos;t been added for the organisation yet. Ask a workspace admin (see below).
              </Step>
              <Step n={2} title="Sign in and allow">
                Sign in with your LMS Google account. The LMS then asks you to allow access and shows where it will be
                sent. It should say <b>claude.ai</b>.
              </Step>
              <Step n={3} title="Ask it what it can see">
                Start a new chat and ask <i>&ldquo;what can you see in the LMS?&rdquo;</i>, then a real question.
              </Step>
            </ol>
          </div>

          <div className="rounded-xl border border-border bg-bg-card p-5">
            <h3 className="text-lg font-semibold text-text-primary">If you pay for Claude yourself (Pro or Max)</h3>
            <p className="mt-1">
              The connector won&apos;t appear in your list, so add it once yourself. Custom connectors aren&apos;t
              available on the Free plan.
            </p>
            <ol className="mt-4 space-y-4">
              <Step n={1} title="Add it as a custom connector">
                <b>Settings → Connectors</b>, then <b>Add custom connector</b>. Paste the address above and click{" "}
                <b>Add</b>. Leave <b>Advanced settings</b> empty. There is no client ID or secret.
              </Step>
              <Step n={2} title="Connect, sign in and allow">
                Click <b>Connect</b> and sign in with your LMS Google account. The LMS shows where access will be sent.
                Allow only if it says <b>claude.ai</b> or <b>claude.com</b>.
              </Step>
              <Step n={3} title="Ask it what it can see">
                New chat, <i>&ldquo;what can you see in the LMS?&rdquo;</i>
              </Step>
            </ol>
          </div>

          <div className="rounded-xl border border-border bg-bg-card p-5">
            <h3 className="text-lg font-semibold text-text-primary">Claude Code</h3>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-bg-card-alt p-3 text-sm text-text-primary">
              <code>claude mcp add --transport http avanti-lms {address}</code>
            </pre>
            <p className="mt-2">
              Then run <code className="font-mono">/mcp</code> in Claude Code and sign in. The LMS will warn that access
              goes to an app on this computer. That&apos;s Claude Code.
            </p>
          </div>

          <div className="rounded-xl border border-warning-border bg-warning-bg p-5">
            <h3 className="text-lg font-semibold text-text-primary">For workspace admins</h3>
            <p className="mt-1">
              Members can&apos;t add custom connectors on the Avanti workspace, so an Owner adds it once for everyone:{" "}
              <b>Organization settings → Connectors → Add → Custom → Web</b>. Name it <b>Avanti LMS</b>, paste the
              address above, leave the advanced settings empty.
            </p>
          </div>
        </Section>

        <Section title="What it can see">
          <ul className="list-disc space-y-2 pl-5">
            <li><b>Your schools</b>: the ones your LMS role gives you.</li>
            <li><b>Curriculum progress</b>: chapters taught and completion, per grade and subject.</li>
            <li><b>Test results</b>: test-by-test summaries, students&apos; academic levels, one test in depth.</li>
            <li><b>Holistic mentorship</b>: sessions completed and coverage, per program.</li>
          </ul>
          <p>Each only if your LMS role can see it. If something is missing in the LMS, it is missing here too.</p>
        </Section>

        <Section title="What it won't do">
          <ul className="list-disc space-y-2 pl-5">
            <li>Change anything. It only reads.</li>
            <li>Show students&apos; phone numbers, emails, dates of birth or addresses.</li>
            <li>Read out mentors&apos; note text unless you ask for the notes.</li>
          </ul>
          <p>
            Every request is logged against your account. If your LMS access is removed, the connector stops working
            too. If the tools look out of date, disconnect and reconnect in <b>Settings → Connectors</b>.
          </p>
        </Section>

        <p className="mt-10">
          Something wrong, or a view you wish it had? Write to{" "}
          <a className="text-accent hover:underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>

        <p className="mt-12 border-t border-border pt-6 text-sm">
          Avanti Fellows · <a className="text-accent hover:underline" href="https://avantifellows.org">avantifellows.org</a>
        </p>
      </div>
    </main>
  );
}
