import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFetchWithRetry } from "./use-fetch-with-retry";

type State = { status: "loaded"; value: number } | { status: "failed" };

const read = async (response: Response): Promise<State> =>
  response.ok ? { status: "loaded", value: Number(await response.text()) } : { status: "failed" };
const NO_STORE: RequestInit = { cache: "no-store" };

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useFetchWithRetry", () => {
  it("reads the url once with the given init, and shows what read made of the answer", async () => {
    fetchMock.mockResolvedValue(new Response("7"));

    const { result } = renderHook(() => useFetchWithRetry("/a", read, NO_STORE));

    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.state).toEqual({ status: "loaded", value: 7 }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/a");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("reads failed when fetch throws, and Retry shows loading then reads again", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network")).mockResolvedValueOnce(new Response("3"));

    const { result } = renderHook(() => useFetchWithRetry("/a", read));
    await waitFor(() => expect(result.current.state).toEqual({ status: "failed" }));

    act(() => result.current.retry());
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.state).toEqual({ status: "loaded", value: 3 }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reads nothing for a null url", () => {
    const { result } = renderHook(() => useFetchWithRetry(null, read));

    expect(result.current.state).toEqual({ status: "loading" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts the fetch on unmount and drops its answer", async () => {
    let answer: (response: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));

    const { result, unmount } = renderHook(() => useFetchWithRetry("/a", read));
    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal!;
    unmount();
    answer(new Response("9"));
    await Promise.resolve();

    expect(signal.aborted).toBe(true);
    expect(result.current.state).toEqual({ status: "loading" });
  });
});
