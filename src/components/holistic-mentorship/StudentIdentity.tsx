type StudentIdentityProps = {
  student: {
    name: string;
    externalStudentId: string | null;
  };
};

export function studentInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export default function StudentIdentity({ student }: StudentIdentityProps) {
  return <span className="flex min-w-0 items-center gap-2.5">
    <span aria-hidden="true"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-info-bg text-xs font-extrabold text-info">
      {studentInitials(student.name)}
    </span>
    <span className="min-w-0">
      <span className="block font-semibold text-text-primary">{student.name}</span>
      {student.externalStudentId &&
        <span className="block font-mono text-xs text-text-muted">{student.externalStudentId}</span>}
    </span>
  </span>;
}
