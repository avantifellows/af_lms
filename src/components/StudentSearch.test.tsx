import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StudentSearch from "./StudentSearch";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const mockStudents = [
  {
    user_id: "u1",
    first_name: "Amit",
    last_name: "Kumar",
    student_id: "STU001",
    phone: "9876543210",
    school_name: "Delhi Public School",
    school_code: "SC001",
    grade: 10,
  },
  {
    user_id: "u2",
    first_name: "Priya",
    last_name: "Singh",
    student_id: "STU002",
    phone: null,
    school_name: "Kendriya Vidyalaya",
    school_code: "SC002",
    grade: null,
  },
];

function mockFetchSuccess(data: any) {
  return vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(data) })
  ) as any;
}

describe("StudentSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal(
      "fetch",
      mockFetchSuccess(mockStudents)
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders search input with placeholder", () => {
    render(<StudentSearch />);
    expect(
      screen.getByPlaceholderText("Search students by name, ID, or phone...")
    ).toBeInTheDocument();
  });

  it("does not fetch when query is less than 2 characters", async () => {
    render(<StudentSearch />);
    const input = screen.getByPlaceholderText(
      "Search students by name, ID, or phone..."
    );

    await act(async () => {
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).type(input, "A");
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches results after debounce when query >= 2 chars", async () => {
    render(<StudentSearch />);
    const input = screen.getByPlaceholderText(
      "Search students by name, ID, or phone..."
    );

    await act(async () => {
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).type(input, "Am");
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/students/search?q=Am");
    });
  });

  it("shows results in dropdown with student details", async () => {
    render(<StudentSearch />);
    const input = screen.getByPlaceholderText(
      "Search students by name, ID, or phone..."
    );

    await act(async () => {
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).type(input, "Am");
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText("Amit Kumar")).toBeInTheDocument();
    });

    expect(screen.getByText("Delhi Public School")).toBeInTheDocument();
    expect(screen.getByText(/ID: STU001/)).toBeInTheDocument();
    expect(screen.getByText(/Phone: 9876543210/)).toBeInTheDocument();
    expect(screen.getByText("Priya Singh")).toBeInTheDocument();
    expect(screen.getByText("Kendriya Vidyalaya")).toBeInTheDocument();
  });

  it("shows 'No students found' when results are empty", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess([]));

    render(<StudentSearch />);
    const input = screen.getByPlaceholderText(
      "Search students by name, ID, or phone..."
    );

    await act(async () => {
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).type(input, "zzz");
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText("No students found")).toBeInTheDocument();
    });
  });

  it("result links point to correct school path", async () => {
    render(<StudentSearch />);
    const input = screen.getByPlaceholderText(
      "Search students by name, ID, or phone..."
    );

    await act(async () => {
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).type(input, "Am");
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText("Amit Kumar")).toBeInTheDocument();
    });

    const link = screen.getByText("Amit Kumar").closest("a");
    expect(link).toHaveAttribute("href", "/school/SC001");
  });

  it("clicking a result link closes the dropdown", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<StudentSearch />);
    const input = screen.getByPlaceholderText(
      "Search students by name, ID, or phone..."
    );

    await act(async () => {
      await user.type(input, "Am");
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText("Amit Kumar")).toBeInTheDocument();
    });

    const link = screen.getByText("Amit Kumar").closest("a")!;
    await act(async () => {
      await user.click(link);
    });

    expect(screen.queryByText("Delhi Public School")).not.toBeInTheDocument();
  });

  it("clicking backdrop closes the dropdown", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<StudentSearch />);
    const input = screen.getByPlaceholderText(
      "Search students by name, ID, or phone..."
    );

    await act(async () => {
      await user.type(input, "Am");
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText("Amit Kumar")).toBeInTheDocument();
    });

    // The backdrop is the fixed inset-0 div
    const backdrop = document.querySelector(".fixed.inset-0")!;
    await act(async () => {
      await user.click(backdrop);
    });

    expect(screen.queryByText("Amit Kumar")).not.toBeInTheDocument();
  });
});
