import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUserPermission, getFeatureAccess } from "@/lib/permissions";
import { query } from "@/lib/db";
import Link from "next/link";
import EndVisitButton from "@/components/visits/EndVisitButton";

interface Visit {
  id: number;
  school_code: string;
  pm_email: string;
  visit_date: string;
  status: string;
  data: {
    principalMeeting: unknown | null;
    leadershipMeetings: unknown | null;
    classroomObservations: unknown[];
    studentDiscussions: {
      groupDiscussions: unknown[];
      individualDiscussions: unknown[];
    };
    staffMeetings: {
      individualMeetings: unknown[];
      teamMeeting: unknown | null;
    };
    teacherFeedback: unknown[];
    issueLog: unknown[];
  };
  inserted_at: string;
  updated_at: string;
  ended_at: string | null;
  school_name?: string;
}

async function getVisit(id: string): Promise<Visit | null> {
  const visits = await query<Visit>(
    `SELECT v.id, v.school_code, v.pm_email, v.visit_date, v.status,
            v.data, v.inserted_at, v.updated_at, v.ended_at,
            s.name as school_name
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     WHERE v.id = $1`,
    [id]
  );
  return visits[0] || null;
}

interface Section {
  id: string;
  name: string;
  href: string;
  isComplete: boolean;
  description: string;
}

function getSectionStatus(visit: Visit): Section[] {
  const data = visit.data;

  return [
    {
      id: "principal",
      name: "Principal Meeting",
      href: `/visits/${visit.id}/principal`,
      isComplete: !!data.principalMeeting,
      description: "Core operations review, syllabus status, support required",
    },
    {
      id: "leadership",
      name: "Leadership Meetings",
      href: `/visits/${visit.id}/leadership`,
      isComplete: !!data.leadershipMeetings,
      description: "VP meeting and CBSE teacher discussions",
    },
    {
      id: "observations",
      name: "Classroom Observations",
      href: `/visits/${visit.id}/observations`,
      isComplete: data.classroomObservations?.length > 0,
      description: "Observe teaching quality across Grade 11 and 12",
    },
    {
      id: "students",
      name: "Student Discussions",
      href: `/visits/${visit.id}/students`,
      isComplete:
        (data.studentDiscussions?.groupDiscussions?.length > 0) ||
        (data.studentDiscussions?.individualDiscussions?.length > 0),
      description: "Group and individual student conversations",
    },
    {
      id: "staff",
      name: "Staff Meetings",
      href: `/visits/${visit.id}/staff`,
      isComplete: !!data.staffMeetings?.teamMeeting,
      description: "Individual staff check-ins and team planning",
    },
    {
      id: "feedback",
      name: "Feedback & Issues",
      href: `/visits/${visit.id}/feedback`,
      isComplete:
        data.teacherFeedback?.length > 0 || data.issueLog?.length > 0,
      description: "Collect feedback and log issues for follow-up",
    },
  ];
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function VisitDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/");
  }

  const permission = await getUserPermission(session.user.email);
  if (!getFeatureAccess(permission, "visits").canView) {
    redirect("/dashboard");
  }

  const visit = await getVisit(id);

  if (!visit) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">Visit not found.</p>
        </div>
      </main>
    );
  }

  // Only allow PM who created the visit or admins to view
  const isAdmin = permission?.level === 4;

  if (visit.pm_email !== session.user.email && !isAdmin) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800">You do not have access to this visit.</p>
        </div>
      </main>
    );
  }

  const sections = getSectionStatus(visit);
  const completedCount = sections.filter((s) => s.isComplete).length;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Back link */}
      <div className="mb-4">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">
          &larr; Back to Dashboard
        </Link>
      </div>

      {/* Visit Header */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {visit.school_name || visit.school_code}
            </h1>
            <p className="mt-1 text-gray-500">
              Visit on {new Date(visit.visit_date).toLocaleDateString("en-IN", {
                year: "numeric",
                month: "short",
                day: "numeric",
                timeZone: "Asia/Kolkata",
              })}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
              <span>
                Started: {new Date(visit.inserted_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
              </span>
              {visit.ended_at && (
                <span>
                  Ended: {new Date(visit.ended_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                </span>
              )}
            </div>
          </div>
          <span
            className={`inline-flex px-3 py-1 text-sm font-semibold rounded-full ${
              visit.status === "completed"
                ? "bg-green-100 text-green-800"
                : visit.ended_at
                  ? "bg-blue-100 text-blue-800"
                  : "bg-yellow-100 text-yellow-800"
            }`}
          >
            {visit.status === "completed"
              ? "Completed"
              : visit.ended_at
                ? "Ended"
                : "In Progress"}
          </span>
        </div>

        {/* Progress Bar */}
        <div className="mt-6">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>Progress</span>
            <span>
              {completedCount} of {sections.length} sections
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-green-600 h-2 rounded-full transition-all"
              style={{ width: `${(completedCount / sections.length) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="bg-white shadow rounded-lg overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Visit Sections</h2>
        </div>
        <div className="divide-y divide-gray-200">
          {sections.map((section, index) => (
            <Link
              key={section.id}
              href={section.href}
              className="flex items-center px-6 py-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
                {section.isComplete ? (
                  <span className="w-6 h-6 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
                    <svg
                      className="w-4 h-4"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </span>
                ) : (
                  <span className="w-6 h-6 bg-gray-200 text-gray-600 rounded-full flex items-center justify-center text-sm font-medium">
                    {index + 1}
                  </span>
                )}
              </div>
              <div className="ml-4 flex-1">
                <div className="text-sm font-medium text-gray-900">
                  {section.name}
                </div>
                <div className="text-sm text-gray-500">{section.description}</div>
              </div>
              <div className="ml-4">
                <svg
                  className="w-5 h-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* End Visit */}
      {visit.status !== "completed" && !visit.ended_at && (
        <div className="bg-white shadow rounded-lg p-6">
          <p className="text-sm text-gray-600 mb-4">
            When you&apos;re done at the school, end the visit to record your departure time and location.
          </p>
          <EndVisitButton visitId={visit.id} alreadyEnded={!!visit.ended_at} />
        </div>
      )}

      {/* Ended confirmation */}
      {visit.ended_at && visit.status !== "completed" && (
        <div className="bg-white shadow rounded-lg p-6 text-center">
          <p className="text-sm text-gray-500">
            Visit ended on{" "}
            {new Date(visit.ended_at).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
            })}
            . You can still update sections above.
          </p>
        </div>
      )}
    </main>
  );
}
