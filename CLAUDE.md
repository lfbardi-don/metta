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
AWS Lambda (external) → SQS → QueueModule → Guardrails → AI Agent (+Integration tools) → Guardrails → Chatwoot API
                                                ↓
                                           Persistence (audit)
```

Note: Integration tools = Odoo or Nuvemshop (controlled by `PRODUCT_INTEGRATION` env var)

### Module Dependency Graph
```
AppModule
├── PersistenceModule (@Global) - Available to all modules
├── GuardrailsModule - Standalone validation
├── IntegrationsModule
│   ├── ChatwootService - API client (SEND only, no webhooks)
│   ├── OdooService - ERP integration tools for AI agent
│   └── NuvemshopService - E-commerce integration tools for AI agent
├── QueueModule - ENTRY POINT (auto-starts on init)
│   └── Imports: AIModule, IntegrationsModule
└── AIModule
    ├── imports GuardrailsModule
    └── imports IntegrationsModule (for OdooService + NuvemshopService)
```

### Key Architectural Patterns

**QueueModule is the Entry Point**: Auto-starts message processing on `onModuleInit()`. Not triggered by HTTP requests.

**PersistenceModule is @Global**: Available everywhere without explicit imports. Inject `PersistenceService` or `PrismaService` directly.

**Guardrails are bidirectional**: Input validation before AI processing, output validation before sending to Chatwoot.

**Integration service methods become AI tools**: Methods like `getProduct()`, `searchProducts()`, `getStoreInfo()`, `getOrderTracking()` are converted to tool definitions that the OpenAI agent can call. Tools are created using the `createAgentTool` helper in `src/common/helpers/create-agent-tool.helper.ts`.

**Database is audit-only**: Messages saved to Neon PostgreSQL are for compliance/debugging, never retrieved as context for the AI agent.

**No webhook endpoint in production**: ChatwootController exists only for local testing (`/test/chatwoot/*`). Production webhooks go to Lambda → SQS.

**Graceful shutdown**: SIGTERM/SIGINT handlers stop polling, finish current message, close connections.

## Module Implementation Status

**Fully Implemented:**
- ✅ **OdooService** - Complete JSON-RPC client with all methods exposed as AI tools
- ✅ **NuvemshopService** - Complete REST API client with comprehensive e-commerce tools
- ✅ **AIService** - Multi-agent system with real integration tools (Odoo/Nuvemshop)
- ✅ **GuardrailsService** - Full validation with PII detection, prompt injection detection, OpenAI Moderation API integration
- ✅ **QueueService** - Complete SQS integration with polling, message handling, and graceful shutdown
- ✅ **QueueProcessor** - Full message processing pipeline with guardrails and AI integration
- ✅ **PersistenceService** - Core message persistence (save/get messages) fully implemented
- ✅ **ChatwootService** - Core sendMessage() method fully implemented

**Nuvemshop Integration - Complete E-commerce Coverage:**
- ✅ **Products** - Search, details, stock, categories
- ✅ **Orders** - Search by customer, order details, customer info
- ✅ **Promotions** - Active promotions, coupon validation
- ✅ **Store Information** - Contact details, business hours, social media
- ✅ **Shipping Options** - Available carriers and methods
- ✅ **Payment Methods** - Enabled payment providers
- ✅ **Order Tracking** - Tracking numbers, shipment status
- ✅ **Payment History** - Transaction details, refund status

**Optional Enhancements (Non-blocking):**
- ⚠️ **ChatwootService** - Additional methods (getConversation, markAsRead, updateStatus) are stubbed
- ⚠️ **PersistenceService** - Metadata methods (saveConversationMetadata, getConversationMetadata) are stubbed
- ⚠️ **QueueProcessor** - Explicit retry counter/DLQ integration (currently relies on SQS visibility timeout)

**Production Ready:** All core functionality is complete. The worker can process messages end-to-end with full guardrails protection.

## Shared Interfaces

All type contracts in `src/common/interfaces/`:
- `chatwoot-webhook.interface.ts` - ChatwootWebhookPayload (from Lambda), SQSMessagePayload
- `message.interface.ts` - IncomingMessage, OutgoingMessage, MessageContext, `fromChatwootWebhook()` helper
- `odoo.interface.ts` - OdooProduct, OdooOrder, OdooCustomer
- `nuvemshop.interface.ts` - NuvemshopProduct, NuvemshopOrder, NuvemshopStore, NuvemshopShippingCarrier, NuvemshopPaymentProvider, NuvemshopFulfillment, NuvemshopTransaction (+ simplified variants)
- `queue.interface.ts` - QueueConfig, ProcessingResult
- `guardrail.interface.ts` - GuardrailCheck, GuardrailResult

## OpenAI Agents SDK Usage

Uses `@openai/agents` v0.1.10 (NOT the OpenAI API directly). Tools are created using the `createAgentTool` helper with Zod v4 schemas:

```typescript
import { createAgentTool } from '../common/helpers/create-agent-tool.helper';
import { z } from 'zod';

const getProductTool = createAgentTool({
  name: 'get_product',
  description: 'Get product details from Odoo by product ID',
  parameters: z.object({
    productId: z.number().int().positive().describe('The Odoo product ID')
  }),
  execute: async (params, context) => {
    const { odooService } = context.services;
    const product = await odooService.getProduct(params.productId);
    return product;
  }
});
```

**Tool Format Requirements:**
- Use `createAgentTool()` helper from `src/common/helpers/create-agent-tool.helper.ts`
- Use Zod v4 schemas for parameter validation (NOT JSON Schema directly)
- Zod v4 has native JSON Schema conversion via `z.toJSONSchema()` - no third-party library needed
- `execute` function receives validated params and AgentContext (with access to services)
- Return data directly (not JSON stringified) - helper handles response formatting
- Tool names use snake_case convention (e.g., `get_product`, `search_products`)

**Current Implementation:**
- Real Odoo tools implemented in `src/modules/ai/tools/odoo/`
- Tools are exported via `src/modules/ai/tools/index.ts`
- Tools automatically assigned to specialist agents in `AIService.onModuleInit()`
- See individual tool files for complete implementations

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

**Creating Odoo tools:** Use the `createAgentTool` helper with (1) tool name (snake_case), (2) description for AI, (3) Zod schema for parameters, (4) execute function that receives params and context. See `src/modules/ai/tools/odoo/` for examples.

**Guardrail validators:** Each returns `GuardrailCheck` with `type`, `passed`, optional `message`, and optional `score`.

**GuardrailsService implementation details:**
- **PII Detection with Metadata Extraction:** Automatically detects emails, phone numbers, credit cards (with Luhn validation), SSNs, and DNI (Argentina). Uses indexed placeholders (`[EMAIL_1]`, `[DNI_1]`, etc.) in conversation while storing real values in metadata. This allows:
  - AI sees sanitized conversation text
  - Tools automatically receive real values (resolved before execution via `create-agent-tool` helper)
  - Output checked for leaks and re-sanitized before sending to user
  - **Critical for customer service:** Enables tools like `get_customer_orders(email)` to work while keeping conversation secure
- **Prompt Injection Detection:** Pattern-based detection for jailbreak attempts, role confusion, system prompt manipulation, and instruction overrides. Blocks messages that match injection patterns.
- **Toxicity Check:** Uses OpenAI Moderation API (free) to detect harassment, hate speech, violence, sexual content, etc. Configurable timeout (default 5s) with graceful fallback behavior (warn or block on API failure).
- **Business Rules:** Enforces max input length (10,000 chars) and max output length (5,000 chars).
- **Professional Tone Check (LLM-based):** Uses gpt-4o-mini to validate AI responses are professional, courteous, and appropriate for customer service. Cost: ~$0.0002/check, Latency: ~200-500ms. Graceful degradation on errors.
- **Response Relevance Check (LLM-based):** Uses gpt-4o-mini to ensure AI responses directly address user's question. Requires user message context. Cost: ~$0.0002/check, Latency: ~200-500ms. Graceful degradation on errors.
- **Parallel Execution:** LLM-based guardrails run in parallel using `Promise.all()` to minimize latency impact.
- **PII Metadata Flow:**
  1. `GuardrailsService.validateInput()` extracts PII → returns `{ sanitizedContent, piiMetadata }`
  2. `AIService` passes metadata to agent context
  3. `create-agent-tool` helper automatically resolves placeholders before tool execution
  4. `GuardrailsService.validateOutput()` checks for PII leaks and re-sanitizes
- **AIService Integration:** `processMessage()` uses `sanitizedContent` from input validation before sending to AI, stores PII metadata in context for tool resolution, passes original user message to output validation for relevance checking, and uses `sanitizedContent` from output validation before returning response.
- **Configuration:** All checks can be individually enabled/disabled via environment variables (`GUARDRAILS_ENABLE_PII_CHECK`, `GUARDRAILS_ENABLE_TOXICITY_CHECK`, `GUARDRAILS_ENABLE_INJECTION_CHECK`, `GUARDRAILS_ENABLE_BUSINESS_RULES`, `GUARDRAILS_ENABLE_TONE_CHECK`, `GUARDRAILS_ENABLE_RELEVANCE_CHECK`).
- **Testing:** Comprehensive unit tests in `guardrails.service.spec.ts` covering PII detection, DNI detection, metadata extraction, indexed placeholders, prompt injection, moderation API integration, business rules, and sanitization. Additional tests for LLM-based guardrails in `professional-tone.guardrail.spec.ts` and `response-relevance.guardrail.spec.ts`.

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
