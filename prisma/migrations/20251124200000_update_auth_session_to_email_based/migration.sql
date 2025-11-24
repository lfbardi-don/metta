-- Update AuthSession from conversation-based to email-based auth with 24h window

-- Step 1: Drop foreign key constraint
ALTER TABLE "AuthSession" DROP CONSTRAINT IF EXISTS "AuthSession_conversationId_fkey";

-- Step 2: Drop unique index on conversationId
DROP INDEX IF EXISTS "AuthSession_conversationId_key";

-- Step 3: Drop index on conversationId
DROP INDEX IF EXISTS "AuthSession_conversationId_idx";

-- Step 4: Add verifiedAt column
ALTER TABLE "AuthSession" ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);

-- Step 5: Rename conversationId to lastConversationId and make nullable
ALTER TABLE "AuthSession" RENAME COLUMN "conversationId" TO "lastConversationId";
ALTER TABLE "AuthSession" ALTER COLUMN "lastConversationId" DROP NOT NULL;

-- Step 6: Create unique index on email
CREATE UNIQUE INDEX IF NOT EXISTS "AuthSession_email_key" ON "AuthSession"("email");

-- Step 7: Create index on email for lookups
CREATE INDEX IF NOT EXISTS "AuthSession_email_idx" ON "AuthSession"("email");

-- Step 8: Clear existing sessions (they used conversation-based auth)
-- Uncomment if you want to clear old sessions:
-- DELETE FROM "AuthSession";
