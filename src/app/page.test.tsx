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

  it("renders Google sign-in button and passcode toggle", () => {
    render(<LoginPage />);
    expect(screen.getByText("Sign in with Google")).toBeInTheDocument();
    expect(screen.getByText("Enter School Passcode")).toBeInTheDocument();
    expect(screen.getByText("Avanti Fellows")).toBeInTheDocument();
    expect(screen.getByText("Student Enrollment Management")).toBeInTheDocument();
  });

  it("does not show passcode form initially", () => {
    render(<LoginPage />);
    expect(screen.queryByLabelText("School Passcode")).not.toBeInTheDocument();
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

  // --- Passcode form toggle ---

  it("shows passcode form when 'Enter School Passcode' is clicked", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByText("Enter School Passcode"));
    expect(screen.getByLabelText("School Passcode")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter 8-digit code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.getByText("Back to login options")).toBeInTheDocument();
  });

  it("hides Google button when passcode form is shown", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByText("Enter School Passcode"));
    expect(screen.queryByText("Sign in with Google")).not.toBeInTheDocument();
  });

  // --- Passcode input validation ---

  it("strips non-numeric characters from passcode input", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByText("Enter School Passcode"));
    const input = screen.getByLabelText("School Passcode");
    await user.type(input, "12ab34cd");
    expect(input).toHaveValue("1234");
  });

  it("limits passcode to 8 digits", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByText("Enter School Passcode"));
    const input = screen.getByLabelText("School Passcode");
    await user.type(input, "1234567890");
    expect(input).toHaveValue("12345678");
  });

  it("disables Continue button when passcode is less than 8 digits", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByText("Enter School Passcode"));
    const input = screen.getByLabelText("School Passcode");
    await user.type(input, "1234567");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("enables Continue button when passcode is exactly 8 digits", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByText("Enter School Passcode"));
    const input = screen.getByLabelText("School Passcode");
    await user.type(input, "12345678");
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  // --- Passcode submission ---

  it("calls signIn('passcode') on form submit", async () => {
    mockSignIn.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByText("Enter School Passcode"));
    await user.type(screen.getByLabelText("School Passcode"), "12345678");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(mockSignIn).toHaveBeenCalledWith("passcode", {
      passcode: "12345678",
      redirect: false,
    });
  });

  it("shows 'Verifying...' loading state during submission", async () => {
    let resolveSignIn: (value: unknown) => void;
    mockSignIn.mockImplementation(
      () => new Promise((resolve) => { resolveSignIn = resolve; })
    );
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByText("Enter School Passcode"));
    await user.type(screen.getByLabelText("School Passcode"), "12345678");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Verifying...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verifying..." })).toBeDisabled();
    resolveSignIn!({ ok: true });
  });

  it("redirects to /school/{schoolCode} on successful passcode sign-in", async () => {
    mockSignIn.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByText("Enter School Passcode"));
    await user.type(screen.getByLabelText("School Passcode"), "12345678");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await vi.waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/school/12345");
    });
  });

  it("shows error message on failed passcode sign-in", async () => {
    mockSignIn.mockResolvedValue({ error: "CredentialsSignin" });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByText("Enter School Passcode"));
    await user.type(screen.getByLabelText("School Passcode"), "12345678");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await vi.waitFor(() => {
      expect(screen.getByText("Invalid passcode")).toBeInTheDocument();
    });
  });

  it("clears previous error on new submission", async () => {
    mockSignIn.mockResolvedValueOnce({ error: "CredentialsSignin" });
    mockSignIn.mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByText("Enter School Passcode"));
    await user.type(screen.getByLabelText("School Passcode"), "12345678");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await vi.waitFor(() => {
      expect(screen.getByText("Invalid passcode")).toBeInTheDocument();
    });
    // Submit again — error should clear
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await vi.waitFor(() => {
      expect(screen.queryByText("Invalid passcode")).not.toBeInTheDocument();
    });
  });

  it("does not redirect when result has no ok and no error", async () => {
    mockSignIn.mockResolvedValue({});
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByText("Enter School Passcode"));
    await user.type(screen.getByLabelText("School Passcode"), "12345678");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByText("Invalid passcode")).not.toBeInTheDocument();
  });

  // --- Back button ---

  it("goes back to login options and clears passcode/error", async () => {
    mockSignIn.mockResolvedValue({ error: "CredentialsSignin" });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByText("Enter School Passcode"));
    await user.type(screen.getByLabelText("School Passcode"), "12345678");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await vi.waitFor(() => {
      expect(screen.getByText("Invalid passcode")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Back to login options"));
    // Should be back to initial state
    expect(screen.getByText("Sign in with Google")).toBeInTheDocument();
    expect(screen.getByText("Enter School Passcode")).toBeInTheDocument();
    expect(screen.queryByLabelText("School Passcode")).not.toBeInTheDocument();
    expect(screen.queryByText("Invalid passcode")).not.toBeInTheDocument();
  });
});
