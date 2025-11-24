/**
 * Customer Authentication State
 *
 * Tracks customer authentication across all conversations.
 * Uses email as the unique identifier (not conversationId).
 *
 * Authentication Flow:
 * 1. Customer provides email + 3 DNI digits
 * 2. MCP server validates against Nuvemshop customer data
 * 3. On success: Create/update AuthSession in DB with 24-hour expiry
 * 4. Future conversations: Check DB before asking for re-verification
 *
 * Dual Storage:
 * - DB AuthSession (24h): Determines if customer needs to verify at all
 * - MCP Cloudflare KV (30min): Real-time session validation for MCP tools
 */
export interface CustomerAuthState {
  /** Customer email (unique identifier) */
  email: string;

  /** Whether customer is verified */
  verified: boolean;

  /** When verification happened */
  verifiedAt: Date;

  /** When auth expires (24 hours from verification) */
  expiresAt: Date;

  /** Conversation where auth was last established/used */
  verifiedInConversationId: string;
}

/**
 * Check if auth state is still valid
 */
export function isAuthValid(authState: CustomerAuthState | null): boolean {
  if (!authState) return false;
  if (!authState.verified) return false;

  const now = new Date();
  const expiresAt = new Date(authState.expiresAt);

  return expiresAt > now;
}

/**
 * Get time remaining until auth expires (in minutes)
 */
export function getAuthTimeRemaining(
  authState: CustomerAuthState | null,
): number {
  if (!authState || !isAuthValid(authState)) return 0;

  const now = new Date();
  const expiresAt = new Date(authState.expiresAt);
  const diffMs = expiresAt.getTime() - now.getTime();

  return Math.max(0, Math.floor(diffMs / 1000 / 60));
}

/**
 * Format auth expiry for display
 */
export function formatAuthExpiry(authState: CustomerAuthState | null): string {
  if (!authState || !isAuthValid(authState)) return 'Not authenticated';

  const minutesRemaining = getAuthTimeRemaining(authState);

  if (minutesRemaining >= 60) {
    const hours = Math.floor(minutesRemaining / 60);
    return `${hours}h remaining`;
  }

  return `${minutesRemaining}min remaining`;
}
