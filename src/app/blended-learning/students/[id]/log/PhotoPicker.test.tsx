import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockDownscaleImage } = vi.hoisted(() => ({ mockDownscaleImage: vi.fn() }));
vi.mock("@/lib/image-resize", () => ({ downscaleImage: mockDownscaleImage }));

import { PhotoPicker, type PickedPhoto } from "./PhotoPicker";

// The photo upload route is the network boundary; canvas downscaling is
// replaced by a mock that resolves to a small JPEG blob.
const mockFetch = vi.fn();
const mockCreateObjectURL = vi.fn();
const mockRevokeObjectURL = vi.fn();

let latestPhotos: PickedPhoto[] = [];

// The form owns the photo list; this harness stands in for it.
function Harness({ initial = [], errors = {} }: { initial?: PickedPhoto[]; errors?: Record<string, string> }) {
  const [photos, setPhotos] = useState<PickedPhoto[]>(initial);
  useEffect(() => {
    latestPhotos = photos;
  }, [photos]);
  return <PhotoPicker studentId={501} photos={photos} setPhotos={setPhotos} errors={errors} />;
}

function jpeg(name = "photo.jpg", type = "image/jpeg") {
  return new File(["x"], name, { type });
}

function picker() {
  return screen.getByLabelText("Add photo") as HTMLInputElement;
}

function answer(body: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  latestPhotos = [];
  mockFetch.mockReset();
  mockDownscaleImage.mockReset();
  mockDownscaleImage.mockImplementation(async () => new Blob(["small"], { type: "image/jpeg" }));
  let n = 0;
  mockCreateObjectURL.mockReset();
  mockCreateObjectURL.mockImplementation(() => `blob:preview-${++n}`);
  mockRevokeObjectURL.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  Object.assign(URL, { createObjectURL: mockCreateObjectURL, revokeObjectURL: mockRevokeObjectURL });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PhotoPicker", () => {
  it("downscales and uploads a picked photo, then keeps its S3 key", async () => {
    const user = userEvent.setup();
    answer({ s3Key: "blended-learning/photos/501/a.jpg" });
    render(<Harness />);
    expect(screen.getByText("0 of 5 photos")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Attached photos" })).not.toBeInTheDocument();

    await user.upload(picker(), jpeg());

    expect(await screen.findByRole("img", { name: "Photo 1" })).toHaveAttribute("src", "blob:preview-1");
    await vi.waitFor(() => expect(latestPhotos[0]).toMatchObject({ status: "done", s3Key: "blended-learning/photos/501/a.jpg" }));
    expect(screen.queryByText("Uploading…")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 5 photos")).toBeInTheDocument();

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/blended-learning/students/501/photos");
    expect(init.method).toBe("POST");
    expect((init.body as FormData).get("photo")).toBeInstanceOf(Blob);
  });

  it("shows Uploading… with a placeholder until the photo is ready", async () => {
    const user = userEvent.setup();
    mockDownscaleImage.mockReturnValueOnce(new Promise(() => {}));
    render(<Harness />);

    await user.upload(picker(), jpeg());

    expect(screen.getByText("Uploading…")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 5 photos")).toBeInTheDocument();
  });

  it("explains a HEIC photo the browser can't open", async () => {
    const user = userEvent.setup();
    mockDownscaleImage.mockRejectedValueOnce(new Error("decode failed"));
    render(<Harness />);

    await user.upload(picker(), jpeg("IMG_1.heic", "image/heic"));

    expect(
      await screen.findByText("This phone can't open HEIC photos here. Share the photo as JPEG and add it again.")
    ).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("says any other unreadable image couldn't be opened", async () => {
    const user = userEvent.setup();
    mockDownscaleImage.mockRejectedValueOnce(new Error("decode failed"));
    render(<Harness />);

    await user.upload(picker(), jpeg("broken.png", "image/png"));

    expect(await screen.findByText("Couldn't open this image.")).toBeInTheDocument();
    expect(latestPhotos[0].status).toBe("failed");
  });

  it("shows the upload route's error, or a fallback when it sends none", async () => {
    const user = userEvent.setup();
    answer({ error: "Photos must be 10 MB or smaller." }, 422);
    mockFetch.mockResolvedValueOnce(new Response("Bad gateway", { status: 502 }));
    render(<Harness />);

    await user.upload(picker(), [jpeg("a.jpg"), jpeg("b.jpg")]);

    expect(await screen.findByText("Photos must be 10 MB or smaller.")).toBeInTheDocument();
    expect(await screen.findByText("Couldn't upload this photo.")).toBeInTheDocument();
    expect(latestPhotos.map((photo) => photo.status)).toEqual(["failed", "failed"]);
  });

  it("says to check the connection when the upload request fails", async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<Harness />);

    await user.upload(picker(), jpeg());

    expect(await screen.findByText("Couldn't upload this photo. Check your connection.")).toBeInTheDocument();
  });

  it("takes only as many photos as are left of the five, then stops offering more", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async () => new Response(JSON.stringify({ s3Key: "k" })));
    render(<Harness initial={[{ id: 900, previewUrl: "blob:earlier", status: "done", s3Key: "k0" }]} />);

    await user.upload(picker(), [1, 2, 3, 4, 5, 6].map((n) => jpeg(`${n}.jpg`)));

    expect(screen.getByText("5 of 5 photos")).toBeInTheDocument();
    expect(screen.getByText("Five photos is the most a Conversation can have.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add photo")).not.toBeInTheDocument();
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4));
  });

  it("removes a photo and releases its preview", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[
          { id: 1, previewUrl: "blob:one", status: "done", s3Key: "k1" },
          { id: 2, previewUrl: null, status: "failed", error: "Couldn't open this image." },
        ]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Remove photo 2" }));
    expect(mockRevokeObjectURL).not.toHaveBeenCalled();
    expect(screen.getByText("1 of 5 photos")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove photo 1" }));
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:one");
    expect(latestPhotos).toEqual([]);
  });

  it("puts each server photoKeys.N error on the Nth uploaded photo, and shows a list-wide error", () => {
    render(
      <Harness
        initial={[
          { id: 1, previewUrl: null, status: "failed", error: "Couldn't open this image." },
          { id: 2, previewUrl: "blob:two", status: "done", s3Key: "k2" },
          { id: 3, previewUrl: "blob:three", status: "done", s3Key: "k3" },
        ]}
        errors={{ "photoKeys.1": "This photo is no longer uploaded.", photoKeys: "Attach at most five photos." }}
      />
    );

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Couldn't open this image.");
    expect(items[1]).not.toHaveTextContent("This photo is no longer uploaded.");
    // Photo 3 is the second photo sent, so `photoKeys.1` is its error.
    expect(items[2]).toHaveTextContent("This photo is no longer uploaded.");
    expect(screen.getByText("Attach at most five photos.")).toBeInTheDocument();
  });
});
