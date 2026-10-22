// Client-side file download through a temporary object URL. A failed response
// throws its JSON `error`, else `${failureMessage} (${status})`.
export async function downloadFile(
  url: string,
  failureMessage: string,
  filenameFor: (response: Response) => string,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `${failureMessage} (${response.status})`);
  }
  const filename = filenameFor(response);
  const downloadUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(downloadUrl);
}
