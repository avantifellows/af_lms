import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "./page";

const mockPush = vi.fn();
const mockSignIn = vi.fn();

vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Initial state ---

  it("renders Google sign-in button", () => {
    render(<LoginPage />);
    expect(screen.getByText("Sign in with Google")).toBeInTheDocument();
    expect(screen.getByText("Avanti Fellows")).toBeInTheDocument();
    expect(screen.getByText("Student Enrollment Management")).toBeInTheDocument();
  });

  it("offers no passcode login", () => {
    render(<LoginPage />);
    expect(screen.queryByText("Enter School Passcode")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("School Passcode")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Enter 8-digit code")).not.toBeInTheDocument();
  });

  // --- Google OAuth ---

  it("calls signIn('google') on Google button click", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByText("Sign in with Google"));
    expect(mockSignIn).toHaveBeenCalledWith("google", {
      callbackUrl: "/dashboard",
    });
  });

  // --- Dev login ---

  it("renders dev login buttons in non-production", () => {
    render(<LoginPage />);
    expect(screen.getByText("dev login")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Program Manager")).toBeInTheDocument();
    expect(screen.getByText("Program Admin")).toBeInTheDocument();
    expect(screen.getByText("Teacher")).toBeInTheDocument();
    expect(screen.getByText("Former Mentor")).toBeInTheDocument();
    expect(screen.getByText("Holistic Admin")).toBeInTheDocument();
    expect(screen.getByText("Read-Only")).toBeInTheDocument();
    expect(screen.getByText("PMU Manager")).toBeInTheDocument();
    expect(screen.getByText("PMU Govt School User")).toBeInTheDocument();
  });

  it("signs in as a PMU Govt School User persona via dev-login", async () => {
    mockSignIn.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByText("PMU Govt School User"));
    expect(mockSignIn).toHaveBeenCalledWith("dev-login", {
      persona: "pmu_govt_school_user",
      redirect: false,
    });
  });

  it("describes the Holistic Admin persona for all supported programs", () => {
    render(<LoginPage />);
    expect(screen.getByText("All supported programs, mentorship only")).toBeInTheDocument();
    expect(screen.queryByText("JNV + EMRS, mentorship only")).not.toBeInTheDocument();
  });

  it("calls signIn('dev-login') with persona on dev button click", async () => {
    mockSignIn.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByText("Admin"));
    expect(mockSignIn).toHaveBeenCalledWith("dev-login", {
      persona: "admin",
      redirect: false,
    });
  });

  it("redirects to /dashboard on successful dev login", async () => {
    mockSignIn.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByText("Teacher"));
    await vi.waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("does not redirect on failed dev login", async () => {
    mockSignIn.mockResolvedValue({ error: "CredentialsSignin" });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByText("Admin"));
    await vi.waitFor(() => {
      expect(screen.getByText("Admin")).toBeInTheDocument();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
