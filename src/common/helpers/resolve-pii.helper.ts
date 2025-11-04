/**
 * PII Resolution Helper for MCP Tools
 *
 * Resolves PII placeholders back to real values before sending to MCP servers.
 * This is necessary because MCP servers (Cloudflare Workers) don't have access
 * to the PII metadata that's stored in the NestJS application context.
 *
 * Strategy:
 * 1. Guardrails detect PII → Create placeholders ([EMAIL_1], [DNI_1], etc.)
 * 2. Before calling workflow → Resolve placeholders back to real values
 * 3. MCP tools receive real data and can execute properly
 *
 * Security Note:
 * - Real PII is sent to MCP servers (external Cloudflare Workers)
 * - Conversation history in DB still contains placeholders (sanitized)
 * - Only the current message sent to workflow has real PII
 * - Output is still checked for PII leaks before sending to user
 */

/**
 * Resolve PII placeholders in content using metadata
 *
 * @param content - Content with placeholders (e.g., "My email is [EMAIL_1]")
 * @param piiMetadata - Map of placeholder to real value (e.g., { "[EMAIL_1]": "real@email.com" })
 * @returns Content with real PII values restored
 *
 * @example
 * const sanitized = "Contact me at [EMAIL_1] or call [PHONE_1]";
 * const metadata = {
 *   "[EMAIL_1]": "user@example.com",
 *   "[PHONE_1]": "+5491123456789"
 * };
 * const resolved = resolvePIIPlaceholders(sanitized, metadata);
 * // Returns: "Contact me at user@example.com or call +5491123456789"
 */
export function resolvePIIPlaceholders(
  content: string,
  piiMetadata?: Record<string, string>,
): string {
  if (!piiMetadata || Object.keys(piiMetadata).length === 0) {
    return content;
  }

  let resolvedContent = content;

  // Replace each placeholder with its real value
  for (const [placeholder, realValue] of Object.entries(piiMetadata)) {
    // Use global regex to replace all occurrences
    const regex = new RegExp(escapeRegExp(placeholder), 'g');
    resolvedContent = resolvedContent.replace(regex, realValue);
  }

  return resolvedContent;
}

/**
 * Escape special regex characters in string
 * Necessary to safely use placeholder strings in RegExp
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
