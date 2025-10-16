# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Metta is a **customer service AI agent running as an AWS SQS Worker** built with NestJS and OpenAI Agents SDK (@openai/agents).

**Important:** This is NOT an API server that receives webhooks. An external AWS Lambda receives Chatwoot webhooks and sends them to SQS. This worker polls SQS, processes messages with AI (with Odoo tools for product/order data), and sends responses back to Chatwoot via API. All interactions are logged to Neon PostgreSQL for audit only.

## Commands

### Development
```bash
pnpm install              # Install dependencies
pnpm run start:dev        # Run worker in watch mode
pnpm run start:debug      # Run with debugger
pnpm run build            # Build the project
```

### Database (Prisma)
```bash
npx prisma generate                    # Generate Prisma client
npx prisma migrate dev --name <name>   # Create and apply migration
npx prisma studio                      # Open database GUI
```

### Testing
```bash
pnpm run test             # Run unit tests
pnpm run test:watch       # Run tests in watch mode
pnpm run test:cov         # Run tests with coverage
pnpm run test:e2e         # Run end-to-end tests
```

### Code Quality
```bash
pnpm run lint             # Lint and auto-fix
pnpm run format           # Format code with Prettier
```

## Architecture

### Worker Pattern - NOT API Server

This is a **long-running worker process**, not a traditional API server:
- Application starts → QueueModule auto-starts on init → Continuous SQS polling begins
- Processes messages until SIGTERM/SIGINT (graceful shutdown)
- HTTP server runs only for health checks and test endpoints (port 3000)

### Message Flow
```
AWS Lambda (external) → SQS → QueueModule → Guardrails → AI Agent (+Odoo tools) → Guardrails → Chatwoot API
                                                ↓
                                           Persistence (audit)
```

### Module Dependency Graph
```
AppModule
├── PersistenceModule (@Global) - Available to all modules
├── GuardrailsModule - Standalone validation
├── IntegrationsModule
│   ├── ChatwootService - API client (SEND only, no webhooks)
│   └── OdooService - Tools for AI agent
├── QueueModule - ENTRY POINT (auto-starts on init)
│   └── Imports: AIModule, IntegrationsModule (when implemented)
└── AIModule
    ├── imports GuardrailsModule
    └── imports IntegrationsModule (for OdooService)
```

### Key Architectural Patterns

**QueueModule is the Entry Point**: Auto-starts message processing on `onModuleInit()`. Not triggered by HTTP requests.

**PersistenceModule is @Global**: Available everywhere without explicit imports. Inject `PersistenceService` or `PrismaService` directly.

**Guardrails are bidirectional**: Input validation before AI processing, output validation before sending to Chatwoot.

**OdooService methods become AI tools**: Methods like `getProduct()`, `searchProducts()` are converted to tool definitions that the OpenAI agent can call. See `AIService.createOdooTools()` (TODO).

**Database is audit-only**: Messages saved to Neon PostgreSQL are for compliance/debugging, never retrieved as context for the AI agent.

**No webhook endpoint in production**: ChatwootController exists only for local testing (`/test/chatwoot/*`). Production webhooks go to Lambda → SQS.

**Graceful shutdown**: SIGTERM/SIGINT handlers stop polling, finish current message, close connections.

## Module Implementation Status

All modules have boilerplate with method signatures. Services throw "Not implemented" errors.

**Implementation priority:**
1. **QueueModule** ⭐ - Test SQS connection, verify auto-start, log received messages
2. ChatwootService - Implement sendMessage() with axios
3. AIModule - Test agent without tools first
4. GuardrailsModule - PII detection, toxicity, prompt injection
5. OdooService - XML-RPC client + convert to tools
6. PersistenceModule - Prisma migrations + save methods

## Shared Interfaces

All type contracts in `src/common/interfaces/`:
- `chatwoot-webhook.interface.ts` - ChatwootWebhookPayload (from Lambda), SQSMessagePayload
- `message.interface.ts` - IncomingMessage, OutgoingMessage, MessageContext, `fromChatwootWebhook()` helper
- `odoo.interface.ts` - OdooProduct, OdooOrder, OdooCustomer
- `queue.interface.ts` - QueueConfig, ProcessingResult
- `guardrail.interface.ts` - GuardrailCheck, GuardrailResult

## OpenAI Agents SDK Usage

Uses `@openai/agents` v0.1.9 (NOT the OpenAI API directly). Tools defined as:

```typescript
{
  type: 'function',
  function: {
    name: 'getProduct',
    description: 'Get product details from Odoo by product ID',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'number', description: 'The Odoo product ID' }
      },
      required: ['productId']
    },
    function: async (args) => await odooService.getProduct(args.productId)
  }
}
```

Register tools during agent initialization in `AIService.onModuleInit()`.

## Environment Setup

Copy `.env.example` to `.env` and configure:

**Critical variables:**
- `WORKER_ENABLED=true` - Enable worker (set false to disable SQS processing)
- `SQS_QUEUE_URL` - AWS SQS queue URL
- `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` - AWS credentials
- `OPENAI_API_KEY` - Required for AI agent
- `DATABASE_URL` - Neon PostgreSQL (required for Prisma)
- `CHATWOOT_API_URL` + `CHATWOOT_API_KEY` + `CHATWOOT_ACCOUNT_ID` - To send messages
- `ODOO_*` - ERP credentials for tools

**SQS configuration:**
- `SQS_MAX_MESSAGES=10` - Messages per poll (1-10)
- `SQS_WAIT_TIME_SECONDS=20` - Long polling duration
- `SQS_VISIBILITY_TIMEOUT=30` - Processing timeout before retry

## Important Implementation Notes

**QueueProcessor filters messages:** Only processes `event === 'message_created'` AND `message_type === 'incoming'`. Skips outgoing messages to prevent bot responding to itself.

**fromChatwootWebhook() helper:** Converts `ChatwootWebhookPayload` (from SQS) to `IncomingMessage` (internal format). Located in `message.interface.ts`.

**QueueService.parseMessageBody():** SQS sends message body as JSON string. This helper parses it safely.

**Auto-start behavior:** `QueueProcessor.onModuleInit()` checks `WORKER_ENABLED` env var. If true (default), automatically calls `startProcessing()`.

**Graceful shutdown:** `main.ts` handles SIGTERM/SIGINT → calls `app.close()` → triggers `QueueProcessor.stopProcessing()` → stops polling loop → waits for current message to finish.

**ChatwootController is optional:** Routes are `/test/chatwoot/health` and `/test/chatwoot/simulate`. NOT used in production (Lambda handles webhooks).

**Creating Odoo tools:** Each OdooService method needs (1) tool name, (2) description for AI, (3) JSON schema for parameters, (4) function wrapper calling the service method.

**Guardrail validators:** Each returns `GuardrailCheck` with `type`, `passed`, optional `message`, and optional `score`.

See `ARCHITECTURE.md` for detailed module responsibilities and `PROJECT_STRUCTURE.md` for complete file structure.

## Worker Debugging

**Check if worker is running:**
```bash
# Start worker
pnpm run start:dev

# Look for these log messages:
# - "Queue service initialized"
# - "Queue processor initialized"
# - "Started processing messages from queue"
# - "Metta Worker is running on port 3000"
```

**Verify SQS polling:**
- Worker uses long polling (20s wait time)
- If no messages, logs will be quiet
- When message arrives, logs: "Received X message(s)"

**Test without SQS:**
```bash
# Disable worker to test other components
WORKER_ENABLED=false pnpm run start:dev
```

**Simulate message (dev only):**
```bash
curl -X POST http://localhost:3000/test/chatwoot/simulate \
  -H "Content-Type: application/json" \
  -d '{"event":"message_created","content":"test"}'
```

## External Components

**AWS Lambda (not in this repo):** Receives Chatwoot webhooks, sends to SQS. Expected to send `ChatwootWebhookPayload` as JSON in SQS message body.

**Chatwoot:** Messaging platform. We only SEND messages via API (`POST /api/v1/accounts/{accountId}/conversations/{conversationId}/messages`). Authentication: `api_access_token` header.

**Odoo:** ERP system. Methods will be exposed as tools for the AI agent (TODO).

**Neon PostgreSQL:** Audit log database. Uses Prisma ORM. Data stored here is never used as AI context.
