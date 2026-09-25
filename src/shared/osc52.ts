// OSC 52 clipboard writes (`ESC ] 52 ; <selections> ; <base64> BEL`), as emitted by Claude Code's /copy over SSH.
// Writes only: queries (`?`) and clears (empty/invalid data) are ignored so programs can never read the clipboard.
export const clipboardLimit = 128000;
export function osc52Text(data: string): { text?: string; error?: string } {
  const split = data.indexOf(';');
  if (split === -1 || !/^[cpqs0-7]*$/.test(data.slice(0, split))) return {};
  const payload = data.slice(split + 1).replace(/[\r\n]/g, '');
  if (!payload || payload === '?' || payload.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return {};
  if (payload.length > Math.ceil(clipboardLimit * 4 / 3) + 4) return { error: 'Copied text is too large for the clipboard (limit 128 KB).' };
  const text = new TextDecoder().decode(Uint8Array.from(atob(payload), char => char.charCodeAt(0)));
  return text.length > clipboardLimit ? { error: 'Copied text is too large for the clipboard (limit 128 KB).' } : { text };
}
