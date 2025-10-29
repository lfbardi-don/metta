/**
 * Authentication Tools
 *
 * These tools handle customer identity verification using DNI digits.
 * Protected tools (order access, tracking, payment history) require authentication.
 */

export { verifyDNITool } from './verify-dni.tool';
export { checkAuthStatusTool } from './check-auth-status.tool';
