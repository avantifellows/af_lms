"use client";

import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import Image from "next/image";
import { useRef, useState, type ReactNode } from "react";

type Audience = "teacher" | "admin";
type StepLayout = "notes" | "prepare" | "split";

type GuideStep = {
  number: string;
  nav: string;
  label: string;
  title: string;
  summary: string;
  instructions: ReactNode;
  media: {
    src: string;
    alt: string;
    label: string;
    width: number;
    height: number;
    highlights?: Array<{
      left: number;
      top: number;
      width: number;
      height: number;
    }>;
  };
  secondaryMedia?: GuideStep["media"];
  callout?: ReactNode;
  layout?: StepLayout;
};

const IMAGE_ROOT = "/holistic-mentorship-guide";

const teacherSteps: GuideStep[] = [
  {
    number: "01",
    nav: "Open mentorship",
    label: "Go to your workspace",
    title: "Open Holistic Mentorship",
    summary: "Start from your school page.",
    instructions: (
      <ol>
        <li>Sign in to the LMS with your Avanti email.</li>
        <li>Your school page opens directly.</li>
        <li>
          Select <strong>Holistic Mentorship</strong> from the school tabs.
        </li>
      </ol>
    ),
    media: {
      src: `${IMAGE_ROOT}/holistic-tab.png`,
      alt: "JNV Adilabad page with the Holistic Mentorship tab selected",
      label: "Holistic Mentorship tab",
      width: 1280,
      height: 800,
      highlights: [
        { left: 62.2, top: 11.5, width: 14.5, height: 7 },
      ],
    },
  },
  {
    number: "02",
    nav: "Assign students",
    label: "Choose your mentees",
    title: "Assign students to yourself",
    summary: "Choose the students you will mentor.",
    instructions: (
      <>
        <ol>
          <li>
            Open <strong>Assign Students</strong>.
          </li>
          <li>Search by name or Student ID, or filter by grade.</li>
          <li>Select one or more students.</li>
          <li>
            Choose <strong>Assign to me</strong> and confirm.
          </li>
        </ol>
        <GuideCallout tone="warning" title="Student already has a mentor?">
          Use <strong>Reassign</strong> only after checking with the current mentor.
          Reassigning removes their access to that student.
        </GuideCallout>
      </>
    ),
    media: {
      src: `${IMAGE_ROOT}/assign-students.png`,
      alt: "JNV Adilabad student list with unassigned students",
      label: "JNV Adilabad student list",
      width: 1280,
      height: 800,
      highlights: [
        { left: 3.1, top: 54.3, width: 4.3, height: 7 },
        { left: 83.3, top: 40.8, width: 13.1, height: 6.8 },
      ],
    },
  },
  {
    number: "03",
    nav: "Open student",
    label: "Choose a mentee",
    title: "Open the student detail view",
    summary: "Select a student card to begin.",
    instructions: (
      <ul>
        <li>
          Assigned students appear as cards under <strong>My Mentees</strong>.
        </li>
        <li>
          Search by name or Student ID, or filter by grade and active-phase status.
        </li>
        <li>Select a student card to open their detailed mentorship view.</li>
      </ul>
    ),
    media: {
      src: `${IMAGE_ROOT}/my-mentees.png`,
      alt: "My Mentees view showing assigned JNV Adilabad student cards",
      label: "My Mentees",
      width: 1280,
      height: 800,
      highlights: [
        { left: 2.3, top: 57.5, width: 31.5, height: 16.8 },
      ],
    },
  },
  {
    number: "04",
    nav: "Prepare",
    label: "Read before the meeting",
    title: "Review the student context and guidance",
    summary: "Use both panels to prepare for the conversation.",
    layout: "prepare",
    instructions: (
      <ul>
        <li>
          For a student who is new to mentorship, <strong>Student Context</strong>{" "}
          shows a summary of their survey responses.
        </li>
        <li>
          For other students, it shows notes from the previous mentorship session.
        </li>
        <li>
          Read this along with <strong>Phase Guidance</strong> before meeting the student.
        </li>
      </ul>
    ),
    media: {
      src: `${IMAGE_ROOT}/prepare-split-view.png`,
      alt: "Student Context and Phase Guidance shown side by side in the LMS",
      label: "Student Context and Phase Guidance",
      width: 1280,
      height: 800,
    },
    callout: (
      <GuideCallout title="No previous session notes available?">
        <p>You can still continue with the conversation. This may happen when:</p>
        <ul>
          <li>the student was assigned after an earlier phase;</li>
          <li>an earlier phase was skipped;</li>
          <li>the previous mentor saved a draft but did not submit it; or</li>
          <li>older notes were not available to import.</li>
        </ul>
      </GuideCallout>
    ),
  },
  {
    number: "05",
    nav: "Submit notes",
    label: "Record the conversation",
    title: "Complete the post-session notes",
    summary: "Answer the questions after meeting the student.",
    layout: "notes",
    instructions: (
      <ol>
        <li>
          Answer every question under <strong>Post-Session Notes</strong>.
        </li>
        <li>Your draft saves automatically while you type.</li>
        <li>
          Check the answers, then choose <strong>Submit Notes</strong>.
        </li>
        <li>Confirm the submission. The phase shows as completed.</li>
      </ol>
    ),
    media: {
      src: `${IMAGE_ROOT}/post-session-submit-focused.png`,
      alt: "Post-Session Notes with one actual Phase 1 question and the Submit Notes button",
      label: "Before submission",
      width: 1220,
      height: 350,
      highlights: [
        { left: 86, top: 76.6, width: 12.3, height: 14.2 },
      ],
    },
    secondaryMedia: {
      src: `${IMAGE_ROOT}/post-session-edit.png`,
      alt: "Three actual Phase 1 questions with submitted responses and the Edit Notes button",
      label: "After submission",
      width: 1220,
      height: 350,
      highlights: [
        { left: 87.7, top: 7.2, width: 10.7, height: 14.2 },
      ],
    },
    callout: (
      <GuideCallout>
        To correct submitted notes, choose <strong>Edit Notes</strong>, update the
        answers, and select <strong>Save Changes</strong>.
      </GuideCallout>
    ),
  },
];

const adminSteps: GuideStep[] = [
  {
    number: "01",
    nav: "Open workspace",
    label: "Choose what to manage",
    title: "Open the Mentorship Admin workspace",
    summary: "Start from the LMS landing page.",
    instructions: (
      <ol>
        <li>Sign in to the LMS with your Avanti email.</li>
        <li>
          Select <strong>Holistic Mentorship</strong> on the landing page.
        </li>
      </ol>
    ),
    media: {
      src: `${IMAGE_ROOT}/admin-landing.png`,
      alt: "LMS landing page with Holistic Mentorship highlighted in the top navigation",
      label: "LMS landing page",
      width: 1280,
      height: 800,
      highlights: [
        { left: 59.9, top: 1.1, width: 13.1, height: 5.7 },
      ],
    },
  },
  {
    number: "02",
    nav: "Set up phase",
    label: "Prepare the conversation",
    title: "Add or update a phase",
    summary: "Set the grade, guidance, and questions that teachers will use.",
    instructions: (
      <>
        <ol>
          <li>
            Select <strong>JNV CoE</strong> or <strong>EMRS CoE</strong>.
          </li>
          <li>Select the Academic Year you want to manage.</li>
          <li>
            Open <strong>Phase Setup</strong>.
          </li>
          <li>
            Select an existing phase, or choose <strong>Add Phase</strong>.
          </li>
          <li>Enter the phase title and choose Grade 11 or Grade 12.</li>
          <li>Add the Phase Guidance and Post-Session Questions.</li>
          <li>
            Select <strong>Save Phase</strong>.
          </li>
        </ol>
        <GuideCallout title="Add at least one question">
          A phase cannot be opened until it has at least one question.
        </GuideCallout>
      </>
    ),
    media: {
      src: `${IMAGE_ROOT}/admin-phase-setup.png`,
      alt: "Phase Setup editor showing a locked phase, its guidance, and questions",
      label: "Phase Setup",
      width: 1280,
      height: 800,
    },
  },
  {
    number: "03",
    nav: "Open phase",
    label: "Make the phase available",
    title: "Check and open the phase",
    summary: "Open a phase only after its guidance and questions are ready.",
    instructions: (
      <>
        <ol>
          <li>Select the locked phase you want to open.</li>
          <li>Check the title, grade, guidance, and questions.</li>
          <li>
            Choose <strong>Open Phase</strong>.
          </li>
          <li>Confirm that you want to open it.</li>
        </ol>
        <GuideCallout tone="warning" title="Opening makes it available to teachers">
          Open a phase only when teachers are ready to use it. Once a mentor saves notes,
          its setup becomes read-only.
        </GuideCallout>
      </>
    ),
    media: {
      src: `${IMAGE_ROOT}/admin-open-phase.png`,
      alt: "Locked phase selected with the Open Phase button highlighted",
      label: "Open Phase button",
      width: 1280,
      height: 800,
      highlights: [
        { left: 80.9, top: 43.5, width: 11.8, height: 7.8 },
      ],
    },
  },
  {
    number: "04",
    nav: "Track progress",
    label: "Monitor the program",
    title: "Review students and progress",
    summary: "Use the filters and counts to see what has been completed.",
    instructions: (
      <ul>
        <li>
          Open <strong>Students &amp; Progress</strong>.
        </li>
        <li>Filter by school, grade, phase, mentor, progress, or student.</li>
        <li>Use the summary counts to see pending, completed, and skipped work.</li>
        <li>
          Select <strong>Export CSV</strong> to download the filtered list for further
          analysis.
        </li>
      </ul>
    ),
    media: {
      src: `${IMAGE_ROOT}/admin-progress.png`,
      alt: "Students and Progress view with filters, counts, and student rows",
      label: "Students and Progress",
      width: 1280,
      height: 800,
    },
  },
  {
    number: "05",
    nav: "Review notes",
    label: "Read submitted work",
    title: "Open a student in read-only view",
    summary: "Review context, guidance, and notes without changing mentor responses.",
    instructions: (
      <>
        <ol>
          <li>
            Choose <strong>Open Student</strong> in the progress table.
          </li>
          <li>Use the Phase tabs to move between the student&apos;s phases.</li>
          <li>
            Read the Student Context and Phase Guidance. Open a completed phase to read
            its submitted Post-Session Notes.
          </li>
          <li>Use the back button to return to Students &amp; Progress.</li>
        </ol>
        <GuideCallout title="This is a read-only view">
          Admins can read submitted notes, but cannot change them. For a pending phase,
          draft answers are never shown here.
        </GuideCallout>
      </>
    ),
    media: {
      src: `${IMAGE_ROOT}/admin-student-detail.png`,
      alt: "Admin read-only student view with profile data, phase guidance, and submitted notes",
      label: "Admin read-only student view",
      width: 1280,
      height: 1510,
    },
  },
];

const teacherHelp = [
  ["No Holistic Mentorship tab", "Ask your Program Manager to check your teacher access and school assignment."],
  ["Student is missing", "Ask your Program Manager to check the student's school, grade, and Academic Year."],
  ["No active phase", "Ask the Mentorship Admin (Rahul or Nitin) to open the phase for that grade."],
] as const;

const adminHelp = [
  [
    "Student is missing",
    "Check the Program and Academic Year first. Then ask the Program Manager to check the student's school, grade, and Academic Year.",
  ],
  [
    "Phase cannot be edited",
    "The phase may already have notes. Once a mentor saves notes, its title, grade, guidance, and questions become read-only.",
  ],
  [
    "Submitted notes are missing",
    "Admins cannot see drafts. Ask the mentor to check and submit their notes.",
  ],
] as const;

function GuideCallout({
  children,
  title,
  tone = "info",
}: {
  children: ReactNode;
  title?: string;
  tone?: "info" | "warning";
}) {
  const classes = tone === "warning"
    ? "border-accent bg-danger-bg text-accent"
    : "border-success bg-success-bg text-success";
  return (
    <aside className={`mt-5 border-l-4 p-4 text-sm leading-6 ${classes}`}>
      {title && <strong className="mb-1 block text-base">{title}</strong>}
      <div className="[&_p]:m-0 [&_ul]:mt-2">{children}</div>
    </aside>
  );
}

function GuideMedia({ media }: { media: GuideStep["media"] }) {
  return (
    <figure className="min-w-0 overflow-hidden rounded-md border border-border bg-bg-card shadow-sm">
      <figcaption className="flex min-h-11 items-center justify-between gap-3 border-b border-border bg-bg-card-alt px-4 text-xs font-bold text-text-secondary">
        <span>{media.label}</span>
        <a
          className="inline-flex items-center gap-1 text-accent hover:text-accent-hover"
          href={media.src}
          target="_blank"
          rel="noreferrer"
        >
          Open full size
          <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
        </a>
      </figcaption>
      <a
        href={media.src}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${media.label} full size`}
        className="block overflow-x-auto bg-white"
      >
        <span className="relative block min-w-[640px] sm:min-w-0">
          <Image
            src={media.src}
            alt={media.alt}
            width={media.width}
            height={media.height}
            loading="eager"
            sizes="(max-width: 1024px) 100vw, 70vw"
            className="h-auto w-full"
          />
          {media.highlights?.map((highlight, index) => (
            <span
              key={`${highlight.left}-${highlight.top}-${index}`}
              aria-hidden="true"
              data-testid="screenshot-highlight"
              className="pointer-events-none absolute rounded-sm border-[3px] border-success shadow-[0_0_0_2px_rgba(255,255,255,0.95),0_0_0_5px_rgba(22,101,74,0.22)]"
              style={{
                left: `${highlight.left}%`,
                top: `${highlight.top}%`,
                width: `${highlight.width}%`,
                height: `${highlight.height}%`,
              }}
            />
          ))}
        </span>
      </a>
    </figure>
  );
}

function StepBody({ step }: { step: GuideStep }) {
  const instructions = (
    <div className="text-[15px] leading-7 text-text-secondary [&_li+li]:mt-3 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_ol]:marker:font-mono [&_ol]:marker:font-bold [&_ol]:marker:text-accent [&_strong]:font-extrabold [&_strong]:text-text-primary [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6 [&_ul]:marker:text-accent">
      {step.instructions}
    </div>
  );

  if (step.layout === "prepare") {
    return (
      <div className="space-y-6">
        {instructions}
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(17rem,0.8fr)]">
          <GuideMedia media={step.media} />
          <div className="[&_aside]:mt-0">{step.callout}</div>
        </div>
      </div>
    );
  }

  if (step.layout === "notes") {
    return (
      <div className="space-y-6">
        {instructions}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(16rem,0.72fr)_minmax(0,1.55fr)]">
          <div className="[&_aside]:mt-0">{step.callout}</div>
          <div className="space-y-4">
            <GuideMedia media={step.media} />
            {step.secondaryMedia && <GuideMedia media={step.secondaryMedia} />}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(16rem,0.72fr)_minmax(0,1.55fr)]">
      {instructions}
      <GuideMedia media={step.media} />
    </div>
  );
}

function GuideFooter({ audience }: { audience: Audience }) {
  const help = audience === "teacher" ? teacherHelp : adminHelp;
  const privacy = audience === "teacher"
    ? [
        "Write factual, useful notes in clear language.",
        "Do not invent responses or submit before the conversation.",
        "Do not share student context or notes outside the approved team.",
      ]
    : [
        "Use student context and notes only for approved mentorship work.",
        "Do not share notes or exported files outside the approved team.",
        "Delete exported files when you no longer need them.",
      ];

  return (
    <>
      <section className="border-t border-border bg-bg-card">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <p className="text-xs font-extrabold uppercase text-accent">Quick help</p>
          <h2 className="mt-1 text-2xl font-bold text-text-primary">
            When something does not look right
          </h2>
          <div className="mt-6 grid gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-3">
            {help.map(([title, description], index) => (
              <article key={title} className="bg-bg-card p-5">
                <span className="font-mono text-xs font-bold text-accent">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-2 font-bold text-text-primary">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-text-muted">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="border-t border-success/20 bg-success">
        <div className="mx-auto grid max-w-7xl gap-5 px-4 py-9 text-white md:grid-cols-[0.8fr_1.2fr] md:items-start sm:px-6 lg:px-8">
          <div>
            <p className="text-xs font-extrabold uppercase text-white/70">Please remember</p>
            <h2 className="mt-1 text-2xl font-bold">
              {audience === "teacher"
                ? "Keep mentorship notes respectful and private"
                : "Handle student information carefully"}
            </h2>
          </div>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-white/90">
            {privacy.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </section>
    </>
  );
}

export default function HolisticMentorshipTutorial({ audience }: { audience: Audience }) {
  const steps = audience === "teacher" ? teacherSteps : adminSteps;
  const [activeStep, setActiveStep] = useState(0);
  const stepButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const step = steps[activeStep];

  function goToStep(index: number) {
    if (index < 0 || index >= steps.length) return;
    setActiveStep(index);
    requestAnimationFrame(() => {
      stepButtons.current[index]?.scrollIntoView?.({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
      document.getElementById("tutorial-step")?.scrollIntoView?.({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  return (
    <>
      <div className="sticky top-0 z-20 border-b border-border bg-bg/95 shadow-sm backdrop-blur">
        <nav
          aria-label="Tutorial steps"
          className="mx-auto max-w-7xl overflow-x-auto px-4 py-3 sm:px-6 lg:px-8"
        >
          <strong className="block text-xs font-extrabold uppercase text-text-muted">
            Follow these 5 steps
          </strong>
          <div className="mt-2 flex min-w-[760px] items-center gap-2">
            {steps.map((item, index) => (
              <button
                key={item.number}
                ref={(element) => { stepButtons.current[index] = element; }}
                type="button"
                aria-current={index === activeStep ? "step" : undefined}
                onClick={() => goToStep(index)}
                className={`flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-md border px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                  index === activeStep
                    ? "border-success bg-success text-white"
                    : index < activeStep
                      ? "border-success/25 bg-success-bg text-success"
                      : "border-border bg-bg-card text-text-secondary hover:border-accent/40 hover:bg-danger-bg hover:text-accent"
                }`}
              >
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[11px] ${
                    index === activeStep ? "bg-white text-success" : "bg-danger-bg text-accent"
                  }`}
                >
                  {item.number}
                </span>
                <span className="whitespace-nowrap">{item.nav}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>

      <main
        id="tutorial-step"
        className="mx-auto max-w-7xl scroll-mt-28 px-4 py-8 sm:px-6 sm:py-10 lg:px-8"
      >
        <article>
          <header className="mb-7 border-b border-border pb-5">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-accent font-mono text-sm font-bold text-white">
                {step.number}
              </span>
              <p className="text-xs font-extrabold uppercase text-accent">{step.label}</p>
            </div>
            <h2 className="mt-4 text-2xl font-bold text-text-primary sm:text-3xl">
              {step.title}
            </h2>
            <p className="mt-1 text-sm text-text-muted">{step.summary}</p>
          </header>

          <StepBody step={step} />

          <footer className="mt-8 flex items-center justify-between border-t border-border pt-5">
            <button
              type="button"
              disabled={activeStep === 0}
              onClick={() => goToStep(activeStep - 1)}
              className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-bold text-text-secondary hover:bg-bg-card-alt disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Back
            </button>
            <span className="font-mono text-xs font-bold text-text-muted">
              Step {activeStep + 1} of {steps.length}
            </span>
            <button
              type="button"
              disabled={activeStep === steps.length - 1}
              onClick={() => goToStep(activeStep + 1)}
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-4 text-sm font-bold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-35"
            >
              Next
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </footer>
        </article>
      </main>

      <GuideFooter audience={audience} />
    </>
  );
}
