# Metta Architecture

## Overview
Metta is a customer service AI agent built as an **AWS SQS Worker** using NestJS and OpenAI Agents SDK. It does NOT receive webhooks directly - instead, an AWS Lambda receives Chatwoot webhooks and sends them to SQS. Metta polls SQS, processes messages with AI, and sends responses back to Chatwoot.

## System Architecture

```
┌──────────────┐
│   Chatwoot   │  Messaging Platform
└──────┬───────┘
       │ webhook
       ▼
┌──────────────┐
│ AWS Lambda   │  Webhook Receiver (external)
│  (external)  │
└──────┬───────┘
       │ send to queue
       ▼
┌──────────────┐
│   AWS SQS    │  Message Queue
│    Queue     │
└──────┬───────┘
       │ long polling
       ▼
┌────────────────────────────────────────┐
│         METTA WORKER                   │
│  ┌────────────────────────────────┐   │
│  │      QueueModule               │   │
│  │  (Entry Point - Auto-starts)   │   │
│  └──────┬─────────────────────────┘   │
│         │                              │
│         ▼                              │
│  ┌────────────────────────────────┐   │
│  │    GuardrailsModule            │   │
│  │  (Validate Input)              │   │
│  └──────┬─────────────────────────┘   │
│         │                              │
│         ▼                              │
│  ┌────────────────────────────────┐   │
│  │       AIModule                 │   │
│  │  (OpenAI Agent + Odoo Tools)   │   │
│  └──────┬─────────────────────────┘   │
│         │                              │
│         ▼                              │
│  ┌────────────────────────────────┐   │
│  │    GuardrailsModule            │   │
│  │  (Validate Output)             │   │
│  └──────┬─────────────────────────┘   │
│         │                              │
│         ▼                              │
│  ┌────────────────────────────────┐   │
│  │   IntegrationsModule           │   │
│  │  (ChatwootService - Send Only) │   │
│  └──────┬─────────────────────────┘   │
│         │                              │
│         │ (all steps logged)           │
│         ▼                              │
│  ┌────────────────────────────────┐   │
│  │   PersistenceModule            │   │
│  │  (Audit Log - Global)          │   │
│  └────────────────────────────────┘   │
└────────────────────────────────────────┘
       │
       ▼ HTTP POST
┌──────────────┐
│ Chatwoot API │  Response sent
└──────────────┘
```

## Module Structure

```
src/
├── modules/
│   ├── queue/              # AWS SQS consumer (ENTRY POINT)
│   ├── integrations/       # External service integrations
│   │   ├── chatwoot/      # Messaging (send only, NO webhooks)
│   │   └── odoo/          # ERP system (tools for AI agent)
│   ├── guardrails/         # Input/output validation & safety
│   ├── persistence/        # Database layer (audit only)
│   └── ai/                 # OpenAI agent orchestration
└── common/
    └── interfaces/         # Shared type definitions
```

## Data Flow

### Complete Message Flow

```
1. User sends message to Chatwoot
2. Chatwoot webhook → AWS Lambda
3. Lambda parses webhook → SQS (as JSON)
4. QueueService polls SQS (long polling, 20s)
5. QueueProcessor receives message
6. Parse ChatwootWebhookPayload from SQS body
7. Filter: Only process message_created + incoming
8. Convert to IncomingMessage (fromChatwootWebhook helper)
9. GuardrailsService.validateInput() - Check PII, injection, toxicity
10. AIService.processMessage() - OpenAI agent processes
11. (AI may call Odoo tools for product/order data)
12. GuardrailsService.validateOutput() - Validate response
13. ChatwootService.sendMessage() - POST to Chatwoot API
14. PersistenceService.saveMessages() - Audit log
15. QueueService.deleteMessage() - Remove from SQS
```

### Worker Lifecycle

```
Application Start
  ↓
NestJS Bootstrap (main.ts)
  ↓
AppModule initialization
  ↓
QueueModule.onModuleInit()
  ↓
QueueProcessor.onModuleInit()
  ↓
Auto-start processing (if WORKER_ENABLED=true)
  ↓
Continuous polling loop
  ↓
Process messages until SIGTERM/SIGINT
  ↓
Graceful shutdown
```

## Module Dependencies

### AppModule
```typescript
ConfigModule (global)
  │
  ├─► PersistenceModule (@Global)
  ├─► GuardrailsModule
  ├─► IntegrationsModule
  ├─► QueueModule (Entry Point - starts on init)
  └─► AIModule
```

### Module Import Graph
```
QueueModule (Entry Point)
  ├─► (will import AIModule when implementing)
  └─► (will import IntegrationsModule when implementing)

AIModule
  ├─► GuardrailsModule
  └─► IntegrationsModule (for OdooService)

IntegrationsModule
  ├─► ChatwootService (send messages only)
  └─► OdooService (tools)

GuardrailsModule
  └─► (standalone)

PersistenceModule (@Global)
  └─► Available everywhere without imports
```

## Module Responsibilities

### 1. Queue Module ⭐ **ENTRY POINT**
**Purpose:** Consume messages from AWS SQS and orchestrate processing

**Components:**
- `QueueService` - SQS client, polling, delete messages
- `QueueProcessor` - Main processing loop, auto-starts on init

**Key Methods:**
```typescript
// QueueService
receiveMessages(): Promise<Message[]>  // Long polling SQS
deleteMessage(receiptHandle: string): Promise<void>
parseMessageBody<T>(message): T | null

// QueueProcessor
startProcessing(): void  // Auto-called on module init
processMessage(sqsMessage): Promise<void>  // Main processing logic
```

**Important:**
- Auto-starts when `WORKER_ENABLED=true` (default)
- Uses long polling (20s) for efficiency
- Filters: Only processes `message_created` + `incoming`
- Deletes message after successful processing
- SQS handles retries via visibility timeout

**TODO:**
- Inject AIService, ChatwootService, PersistenceService
- Uncomment processing steps in QueueProcessor

---

### 2. Integrations Module
**Purpose:** Connect with external services (Chatwoot + Odoo)

#### Chatwoot Service
**Purpose:** SEND messages to Chatwoot (NOT receive webhooks)

**Key Methods:**
```typescript
sendMessage(message: OutgoingMessage): Promise<void>
getConversation(conversationId: string): Promise<any>
markAsRead(conversationId: string): Promise<void>
```

**Important:**
- Does NOT receive webhooks (Lambda does that)
- Only sends responses via Chatwoot API
- Uses `api_access_token` header for auth

**TODO:** Implement Chatwoot API client with axios

#### Odoo Service
**Purpose:** Product/order data (exposed as AI tools)

**Key Methods (Tools for AI):**
```typescript
getProduct(productId: number): Promise<OdooProduct>
searchProducts(query: string): Promise<OdooProduct[]>
getOrder(orderNumber: string): Promise<OdooOrder>
getOrdersByCustomer(email: string): Promise<OdooOrder[]>
```

**TODO:**
1. Implement Odoo XML-RPC client
2. Convert methods to @openai/agents tool format

#### ChatwootController (Optional)
**Purpose:** Test endpoint only (NOT production)

**Endpoints:**
- `GET /test/chatwoot/health` - Health check
- `POST /test/chatwoot/simulate` - Simulate message (dev only)

**Important:** Production uses Lambda → SQS, NOT this controller

---

### 3. Guardrails Module
**Purpose:** Validate input/output for safety and compliance

**Key Methods:**
```typescript
validateInput(message: string, context: MessageContext): Promise<GuardrailResult>
validateOutput(response: string, context: MessageContext): Promise<GuardrailResult>
sanitize(content: string): Promise<string>
```

**Checks:**
- PII detection (emails, phone numbers, SSN, credit cards)
- Toxicity detection
- Prompt injection attempts
- Business rule compliance

**TODO:** Implement validators (use libraries like `validator`, custom regex, or external APIs)

---

### 4. Persistence Module
**Purpose:** Audit logging to Neon PostgreSQL

**Key Methods:**
```typescript
saveIncomingMessage(message: IncomingMessage): Promise<void>
saveOutgoingMessage(message: OutgoingMessage): Promise<void>
saveConversationMetadata(conversationId: string, metadata: any): Promise<void>
```

**Important:**
- Database is for **audit only**, NOT for AI context
- Module is `@Global` - available everywhere
- Uses Prisma ORM

**TODO:**
1. Run `prisma generate` to create client
2. Run `prisma migrate dev` to create tables
3. Implement save methods using Prisma

---

### 5. AI Module
**Purpose:** Orchestrate OpenAI agent with tools and guardrails

**Key Methods:**
```typescript
processMessage(message: IncomingMessage): Promise<string>
```

**Process Flow:**
1. Validate input via `GuardrailsService`
2. Process message with OpenAI agent
3. Agent can call Odoo tools if needed
4. Validate output via `GuardrailsService`
5. Return response

**TODO:**
1. Implement `createOdooTools()` to convert OdooService methods to tool format
2. Register tools with the agent
3. Handle tool call errors

---

## Implementation Order

### Phase 1: Foundation ✅
- [x] Create interfaces in `common/interfaces/`
- [x] Set up all module structures
- [x] Connect modules in AppModule
- [x] Update .env.example
- [x] **Update architecture for Worker pattern**

### Phase 2: Queue Module (NEXT - Priority #1)
1. **Install Dependencies**
   ```bash
   pnpm add @aws-sdk/client-sqs
   ```

2. **Test Queue Connection**
   - Configure AWS credentials
   - Test SQS polling
   - Log received messages

3. **Verify Worker Behavior**
   - Check auto-start on init
   - Test graceful shutdown
   - Verify message filtering

### Phase 3: Chatwoot Integration
4. **ChatwootService**
   - Implement API client (axios)
   - Test sending messages
   - Handle rate limiting/errors

### Phase 4: AI Integration
5. **AI Module**
   - Test agent without tools
   - Add Odoo tool integration
   - Integrate with guardrails

### Phase 5: Complete Flow
6. **Guardrails Module**
   - Implement PII detection
   - Implement toxicity check
   - Implement prompt injection detection

7. **Odoo Module**
   - Implement XML-RPC client
   - Implement data fetching methods
   - Convert to tools

8. **Persistence Module**
   - Run Prisma migrations
   - Implement save methods

### Phase 6: Integration & Testing
9. End-to-end flow testing
10. Error handling & retries
11. Monitoring & logging

## Environment Variables

See `.env.example` for all required configuration.

### Critical Variables:
```bash
WORKER_ENABLED=true              # Enable/disable worker
AWS_SQS_QUEUE_URL=...           # SQS queue URL
OPENAI_API_KEY=...              # OpenAI API key
CHATWOOT_API_KEY=...            # Chatwoot API token
DATABASE_URL=...                # Neon PostgreSQL URL
```

## Worker Configuration

### SQS Polling Settings
```bash
SQS_MAX_MESSAGES=10            # Max messages per poll (1-10)
SQS_WAIT_TIME_SECONDS=20       # Long polling duration (0-20)
SQS_VISIBILITY_TIMEOUT=30      # Processing timeout before retry
```

### Graceful Shutdown
- Handles SIGTERM and SIGINT signals
- Stops polling loop gracefully
- Waits for current message to finish
- Closes database connections
- Timeout: 30s (configurable)

## External Components

### AWS Lambda (External)
**Purpose:** Receive Chatwoot webhooks, send to SQS

**Not part of this repository** - managed separately

**Expected behavior:**
1. Receives POST from Chatwoot webhook
2. Parses payload
3. Sends ChatwootWebhookPayload as JSON to SQS
4. Returns 200 OK to Chatwoot

### Chatwoot Webhook Payload Structure
```typescript
interface ChatwootWebhookPayload {
  event: string;  // "message_created"
  id: number;
  content: string;
  message_type: 'incoming' | 'outgoing';
  sender: { type, id, name, email };
  conversation: { id, display_id, inbox_id };
  account: { id, name };
  // ... more fields
}
```

## Tools Format (@openai/agents)

Tools will be created in this format:

```typescript
{
  type: 'function',
  function: {
    name: 'getProduct',
    description: 'Get product details from Odoo by product ID',
    parameters: {
      type: 'object',
      properties: {
        productId: {
          type: 'number',
          description: 'The Odoo product ID'
        }
      },
      required: ['productId']
    },
    function: async (args: { productId: number }) => {
      return await odooService.getProduct(args.productId);
    }
  }
}
```

## Next Steps

1. **Install missing dependencies:**
   ```bash
   pnpm add @nestjs/config @aws-sdk/client-sqs @prisma/client axios
   pnpm add -D prisma
   ```

2. **Initialize Prisma:**
   ```bash
   npx prisma generate
   npx prisma migrate dev --name init
   ```

3. **Test Queue Module** (recommended first step)
   - Configure AWS credentials in `.env`
   - Start worker: `pnpm run start:dev`
   - Check logs for SQS polling
   - Send test message to SQS
   - Verify worker receives and logs it

4. **Implement modules incrementally**
   - Recommended order: Queue → Chatwoot → AI → Guardrails → Odoo → Persistence

## Notes

- This is a **worker application**, not an API server
- QueueModule is the entry point (auto-starts on init)
- HTTP server runs only for health checks and test endpoints
- All modules use NestJS dependency injection
- Services have TODO comments for implementation
- Focus on queue processing first, then add features incrementally
