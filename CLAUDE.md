# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Metta is a **customer service AI agent running as an AWS SQS Worker** built with NestJS and OpenAI Agents SDK (@openai/agents).

**Important:** This is NOT an API server that receives webhooks. An external AWS Lambda receives Chatwoot webhooks and sends them to SQS. This worker polls SQS, processes messages with AI using a workflow system with MCP (Model Context Protocol) servers for remote tool execution, and sends responses back to Chatwoot via API. All interactions are logged to Neon PostgreSQL for audit only.

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
AWS Lambda (external) → SQS → QueueModule → Guardrails → Workflow AI → MCP Servers → Guardrails → Chatwoot API
                                                              ↓
                                                         Persistence (audit)
```

Note: MCP Servers are Cloudflare Workers that provide tools for Nuvemshop (products, orders, authentication) and OpenAI Vector Store (FAQs). Odoo integration pending MCP refactor.

### Module Dependency Graph
```
AppModule
├── PersistenceModule (@Global) - Available to all modules
├── GuardrailsModule - Standalone validation
├── IntegrationsModule
│   ├── ChatwootService - API client (SEND only, no webhooks)
│   └── OdooService - ERP integration (pending MCP refactor)
├── QueueModule - ENTRY POINT (auto-starts on init)
│   └── Imports: AIModule, IntegrationsModule
└── AIModule
    ├── WorkflowAIService - Workflow system with MCP tools
    └── imports GuardrailsModule
```

### Key Architectural Patterns

**QueueModule is the Entry Point**: Auto-starts message processing on `onModuleInit()`. Not triggered by HTTP requests.

**PersistenceModule is @Global**: Available everywhere without explicit imports. Inject `PersistenceService` or `PrismaService` directly.

**Guardrails are bidirectional**: Input validation before AI processing, output validation before sending to Chatwoot.

**MCP Servers for Remote Tools**: Tools are hosted on Cloudflare Workers and accessed via the Model Context Protocol (MCP). The workflow uses `hostedMcpTool()` to connect to remote servers. Tools include:
  - **Nuvemshop Orders**: Customer orders, tracking, payment history, authentication (with Cloudflare KV sessions)
  - **Nuvemshop Products**: Product search, stock, categories, promotions
  - **Knowledge Base**: FAQ search using OpenAI Vector Store

**Workflow System**: Uses OpenAI Agents SDK with explicit classifier agent that routes to specialist agents (Orders, Products, FAQ, Greetings) based on customer intent.

**Database is audit-only**: Messages saved to Neon PostgreSQL are for compliance/debugging. Conversation history is loaded from database and passed to workflow.

**No webhook endpoint in production**: ChatwootController exists only for local testing (`/test/chatwoot/*`). Production webhooks go to Lambda → SQS.

**Graceful shutdown**: SIGTERM/SIGINT handlers stop polling, finish current message, close connections.

## Module Implementation Status

**Core System - Fully Implemented:**
- ✅ **WorkflowAIService** - Workflow system with MCP integration and guardrails
- ✅ **GuardrailsService** - Full validation with PII detection, prompt injection detection, OpenAI Moderation API integration
- ✅ **QueueService** - Complete SQS integration with polling, message handling, and graceful shutdown
- ✅ **QueueProcessor** - Full message processing pipeline with guardrails and workflow AI integration
- ✅ **PersistenceService** - Message persistence with conversation history management
- ✅ **ChatwootService** - Core sendMessage() method fully implemented
- ✅ **OdooService** - ERP integration (pending MCP refactor)

**MCP Servers (Cloudflare Workers) - Complete:**
- ✅ **Nuvemshop Orders MCP** - 3 tools (check_auth_status, verify_dni, get_last_order) with Cloudflare KV sessions
- ✅ **Nuvemshop Products MCP** - 7 product tools (search, stock, categories, SKU lookup)
- ✅ **Authentication** - DNI verification with 30-minute sessions in Cloudflare KV
- ✅ **OpenAI Vector Store** - FAQ search with file search tool

**Note on Orders MCP:** The API has been simplified - `get_last_order` returns the customer's most recent order with fulfillments (tracking) included. Order history/list functionality has been removed.

**Workflow System - Complete:**
- ✅ **Classifier Agent** - Routes by intent (ORDER_STATUS, PRODUCT_INFO, STORE_INFO, OTHERS)
- ✅ **Orders Agent** - Handles orders, tracking, payments, returns with authentication
- ✅ **Products Agent** - Product discovery, stock checking, size guidance
- ✅ **FAQ Agent** - Store policies, hours, contact info via vector search
- ✅ **Greetings Agent** - Handles casual conversation and greetings

**Production Ready:** All core functionality is complete. The worker processes messages end-to-end with full guardrails protection and MCP tool integration.

## Shared Interfaces

All type contracts in `src/common/interfaces/`:
- `chatwoot-webhook.interface.ts` - ChatwootWebhookPayload (from Lambda), SQSMessagePayload
- `message.interface.ts` - IncomingMessage, OutgoingMessage, MessageContext, `fromChatwootWebhook()` helper
- `odoo.interface.ts` - OdooProduct, OdooOrder, OdooCustomer (for future MCP refactor)
- `queue.interface.ts` - QueueConfig, ProcessingResult
- `guardrail.interface.ts` - GuardrailCheck, GuardrailResult

Note: Nuvemshop types are defined in MCP server code (`nuvemshop-orders/`, `nuvemshop-products/`)

## Workflow Architecture

Uses `@openai/agents` v0.2.1 with Zod v3 for structured outputs. The system uses a workflow pattern with MCP (Model Context Protocol) servers for remote tool execution.

### Workflow File
**Location**: `src/modules/ai/workflows/customer-service.workflow.ts`

The workflow defines:
- **Classifier Agent**: Uses `outputType` with Zod schema for structured intent detection
- **Specialist Agents**: Orders, Products, FAQ, Greetings (each with their own instructions and tools)
- **MCP Tool Integration**: Uses `hostedMcpTool()` to connect to Cloudflare Workers
- **Conversation History**: Accepts `AgentInputItem[]` for multi-turn conversations

Example MCP tool definition:
```typescript
const ordersTools = hostedMcpTool({
  serverLabel: "NuvemShop_Orders",
  serverUrl: "https://nuvemshop-orders.luisfbardi.workers.dev/sse",
  allowedTools: [
    "check_auth_status",
    "verify_dni",
    "get_last_order"  // Returns single order with fulfillments (tracking) included
  ],
  requireApproval: "never"
});
```

**Note:** The Orders MCP now uses a simplified API:
- `check_auth_status(conversationId)` - Check if customer is authenticated
- `verify_dni(conversationId, email, dniLastDigits)` - Authenticate customer with DNI
- `get_last_order(conversationId)` - Get customer's most recent order (includes tracking in fulfillments array)

### WorkflowAIService
**Location**: `src/modules/ai/workflow-ai.service.ts`

Responsibilities:
- Load conversation history from database
- Apply input guardrails (PII detection, toxicity, injection)
- Resolve PII placeholders before sending to MCP tools
- Execute workflow with conversation context
- Apply output guardrails (PII leaks, professionalism, relevance)
- Return sanitized response

### MCP Server Pattern
Tools are implemented in separate Cloudflare Workers projects:
- `nuvemshop-orders/` - Order management and authentication
- `nuvemshop-products/` - Product catalog and search

Each MCP server registers tools using the `@modelcontextprotocol/sdk` package.

## Environment Setup

Copy `.env.example` to `.env` and configure:

**Critical variables:**
- `WORKER_ENABLED=true` - Enable worker (set false to disable SQS processing)
- `SQS_QUEUE_URL` - AWS SQS queue URL
- `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` - AWS credentials
- `OPENAI_API_KEY` - Required for AI workflow
- `DATABASE_URL` - Neon PostgreSQL (required for Prisma)
- `CHATWOOT_API_URL` + `CHATWOOT_API_KEY` + `CHATWOOT_ACCOUNT_ID` - To send messages

**Workflow configuration:**
- `MCP_ORDERS_URL` - Nuvemshop Orders MCP server URL (Cloudflare Worker)
- `MCP_PRODUCTS_URL` - Nuvemshop Products MCP server URL (Cloudflare Worker)
- `OPENAI_VECTOR_STORE_ID` - Vector store ID for FAQ search

**Odoo configuration (pending MCP refactor):**
- `ODOO_URL` + `ODOO_DATABASE` + `ODOO_USERNAME` + `ODOO_PASSWORD`

**SQS configuration:**
- `SQS_MAX_MESSAGES=10` - Messages per poll (1-10)
- `SQS_WAIT_TIME_SECONDS=20` - Long polling duration
- `SQS_VISIBILITY_TIMEOUT=30` - Processing timeout before retry

**Guardrails configuration:**
- `GUARDRAILS_ENABLE_PII_CHECK=true`
- `GUARDRAILS_ENABLE_TOXICITY_CHECK=true`
- `GUARDRAILS_ENABLE_INJECTION_CHECK=true`
- `GUARDRAILS_ENABLE_BUSINESS_RULES=true`
- `GUARDRAILS_ENABLE_TONE_CHECK=true`
- `GUARDRAILS_ENABLE_RELEVANCE_CHECK=true`

## Important Implementation Notes

**QueueProcessor filters messages:** Only processes `event === 'message_created'` AND `message_type === 'incoming'`. Skips outgoing messages to prevent bot responding to itself.

**fromChatwootWebhook() helper:** Converts `ChatwootWebhookPayload` (from SQS) to `IncomingMessage` (internal format). Located in `message.interface.ts`.

**QueueService.parseMessageBody():** SQS sends message body as JSON string. This helper parses it safely.

**Auto-start behavior:** `QueueProcessor.onModuleInit()` checks `WORKER_ENABLED` env var. If true (default), automatically calls `startProcessing()`.

**Graceful shutdown:** `main.ts` handles SIGTERM/SIGINT → calls `app.close()` → triggers `QueueProcessor.stopProcessing()` → stops polling loop → waits for current message to finish.

**ChatwootController is optional:** Routes are `/test/chatwoot/health` and `/test/chatwoot/simulate`. NOT used in production (Lambda handles webhooks).

**Workflow execution:** WorkflowAIService loads conversation history from database, processes the latest message with the workflow, and returns the response. Conversation history is passed to the workflow as `AgentInputItem[]`.

**Guardrail validators:** Each returns `GuardrailCheck` with `type`, `passed`, optional `message`, and optional `score`.

**GuardrailsService implementation details:**
- **PII Detection with Metadata Extraction:** Automatically detects emails, phone numbers, credit cards (with Luhn validation), SSNs, and DNI (Argentina). Uses indexed placeholders (`[EMAIL_1]`, `[DNI_1]`, etc.) in conversation while storing real values in metadata. This allows:
  - AI sees sanitized conversation text
  - MCP tools automatically receive real values (resolved by `resolve-pii.helper` before sending to workflow)
  - Output checked for leaks and re-sanitized before sending to user
  - **Critical for customer service:** Enables tools like `get_customer_orders(email)` to work while keeping conversation secure
- **Prompt Injection Detection:** Pattern-based detection for jailbreak attempts, role confusion, system prompt manipulation, and instruction overrides. Blocks messages that match injection patterns.
- **Toxicity Check:** Uses OpenAI Moderation API (free) to detect harassment, hate speech, violence, sexual content, etc. Configurable timeout (default 5s) with graceful fallback behavior (warn or block on API failure).
- **Business Rules:** Enforces max input length (10,000 chars) and max output length (5,000 chars).
- **Professional Tone Check (LLM-based):** Uses gpt-4o-mini to validate AI responses are professional, courteous, and appropriate for customer service. Cost: ~$0.0002/check, Latency: ~200-500ms. Graceful degradation on errors.
- **Response Relevance Check (LLM-based):** Uses gpt-4o-mini to ensure AI responses directly address user's question. Requires user message context. Cost: ~$0.0002/check, Latency: ~200-500ms. Graceful degradation on errors.
- **Parallel Execution:** LLM-based guardrails run in parallel using `Promise.all()` to minimize latency impact.
- **PII Metadata Flow (Workflow System):**
  1. `GuardrailsService.validateInput()` extracts PII → returns `{ sanitizedContent, piiMetadata }`
  2. `WorkflowAIService` uses `resolve-pii.helper` to replace placeholders with real values before calling workflow
  3. Workflow receives content with real PII values (necessary for MCP tools to function)
  4. `GuardrailsService.validateOutput()` checks for PII leaks and re-sanitizes
- **WorkflowAIService Integration:** `processMessage()` uses `sanitizedContent` from input validation, resolves PII for MCP tools, passes conversation history to workflow, and uses `sanitizedContent` from output validation before returning response.
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
