// A Conversation Draft's notes, as etl-next writes them (`[{heading, points[]}]`),
// turned into notes-editor HTML: an <h3> per section and a <ul> of its points.
// Drafted text is model output, so it is escaped and enters the editor as
// text; the server still sanitises whatever the Mentor saves.

export type DraftNote = { heading: string; points: string[] };

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

export function draftNotesToHtml(notes: DraftNote[] | null): string {
  return (notes ?? [])
    .map(({ heading, points }) => {
      const list = points.length > 0 ? `<ul>${points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>` : "";
      return `<h3>${escapeHtml(heading)}</h3>${list}`;
    })
    .join("");
}
