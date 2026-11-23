/**
 * Request-body previews for logs.
 *
 * Devices can't be inspected remotely, so the payload they actually sent is
 * the only way to diagnose a rejected uplink. These helpers turn a body into a
 * bounded, log-safe string.
 */

/**
 * Serialize `body` (parsed JSON or raw text) and cap it at `maxChars`.
 * Returns null when previews are disabled (`maxChars <= 0`) or there is no body.
 *
 * @param {unknown} body
 * @param {number} maxChars
 * @returns {string | null}
 */
export function previewBody(body, maxChars) {
  if (!(maxChars > 0) || body === undefined || body === null) return null;
  let text;
  if (typeof body === "string") {
    text = body;
  } else {
    try {
      text = JSON.stringify(body);
    } catch {
      text = String(body);
    }
  }
  if (text === undefined || text === "") return null;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…[truncated ${text.length - maxChars} chars]`;
}
