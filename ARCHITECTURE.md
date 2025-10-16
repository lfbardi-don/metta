# Metta Architecture

## Overview
Metta is a customer service AI agent built with NestJS and OpenAI Agents SDK. It integrates with Chatwoot for messaging and Odoo for product/order data.

## Module Structure

```
src/
├── modules/
│   ├── queue/              # AWS SQS message queue processing
│   ├── integrations/       # External service integrations
│   │   ├── chatwoot/      # Messaging platform (webhooks + API)
│   │   └── odoo/          # ERP system (tools for AI agent)
│   ├── guardrails/         # Input/output validation & safety
│   ├── persistence/        # Database layer (audit only)
│   └── ai/                 # OpenAI agent orchestration
└── common/
    └── interfaces/         # Shared type definitions
```

## Data Flow

```
┌──────────────┐
│   Chatwoot   │
│   Webhook    │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Queue       │◄──── SQS receives webhook
│  Module      │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Integrations │
│   Module     │◄──── Parse webhook payload
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Guardrails   │◄──── Validate input (PII, injection, toxicity)
│   Module     │
└──────┬───────┘
       │ (if valid)
       ▼
┌──────────────┐
│   AI         │
│   Module     │◄──── Process with OpenAI agent
└──────┬───────┘
       │       │
       │       └──────► OdooService (tools for product/order data)
       │
       ▼
┌──────────────┐
│ Guardrails   │◄──── Validate output
│   Module     │
└──────┬───────┘
       │ (if valid)
       ▼
┌──────────────┐
│ Integrations │◄──── Send response via Chatwoot API
│   Module     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Chatwoot API │
│   Response   │
└──────────────┘

       │ (all steps)
       ▼
┌──────────────┐
│ Persistence  │◄──── Audit log (not used for context)
│   Module     │
└──────────────┘
```

## Module Dependencies

### AppModule
Entry point that connects all modules:
```typescript
ConfigModule (global)
  │
  ├─► PersistenceModule (@Global)
  ├─► GuardrailsModule
  ├─► IntegrationsModule
  ├─► QueueModule
  └─► AIModule
```

### Module Import Graph
```
AIModule
  ├─► GuardrailsModule
  └─► IntegrationsModule
        └─► OdooService (tools)

QueueModule
  └─► (will import IntegrationsModule for processing)

IntegrationsModule
  ├─► ChatwootService (webhooks + API)
  └─► OdooService (tools)

GuardrailsModule
  └─► (standalone)

PersistenceModule (@Global)
  └─► Available everywhere
```

## Module Responsibilities

### 1. Queue Module
**Purpose:** Handle async message processing via AWS SQS

**Exports:**
- `QueueService` - Send/receive messages from SQS

**Key Methods:**
```typescript
sendMessage(message: QueueMessage): Promise<void>
receiveMessages(): Promise<QueueMessage[]>
deleteMessage(receiptHandle: string): Promise<void>
```

**TODO:** Implement SQS client and message processing loop

---

### 2. Integrations Module
**Purpose:** Connect with external services (Chatwoot + Odoo)

#### Chatwoot Service
**Exports:**
- `ChatwootService` - Send messages, manage conversations
- `ChatwootController` - Webhook endpoint

**Key Methods:**
```typescript
sendMessage(message: OutgoingMessage): Promise<void>
getConversation(conversationId: string): Promise<any>
markAsRead(conversationId: string): Promise<void>
```

**Webhook Endpoint:** `POST /webhooks/chatwoot`

**TODO:** Implement Chatwoot API client

#### Odoo Service
**Exports:**
- `OdooService` - Product/order data (exposed as AI tools)

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

---

### 3. Guardrails Module
**Purpose:** Validate input/output for safety and compliance

**Exports:**
- `GuardrailsService` - Validation methods

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

**Exports:**
- `PersistenceService` - Save messages/metadata
- `PrismaService` - Database client

**Key Methods:**
```typescript
saveIncomingMessage(message: IncomingMessage): Promise<void>
saveOutgoingMessage(message: OutgoingMessage): Promise<void>
saveConversationMetadata(conversationId: string, metadata: any): Promise<void>
```

**Important:**
- Database is for **audit only**, not for AI context
- Module is `@Global` so it's available everywhere

**TODO:**
1. Run `prisma generate` to create client
2. Run `prisma migrate dev` to create tables
3. Implement save methods using Prisma

---

### 5. AI Module
**Purpose:** Orchestrate OpenAI agent with tools and guardrails

**Exports:**
- `AIService` - Main entry point for AI processing

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

### Phase 2: Core Services (Next)
1. **Persistence Module**
   - Run Prisma migrations
   - Implement save methods

2. **Guardrails Module**
   - Implement PII detection
   - Implement toxicity check
   - Implement prompt injection detection

3. **Integrations - Chatwoot**
   - Implement API client (axios)
   - Implement webhook handler
   - Test sending/receiving messages

### Phase 3: AI Integration
4. **Integrations - Odoo**
   - Implement XML-RPC client
   - Implement data fetching methods

5. **AI Module**
   - Convert Odoo methods to tools
   - Test agent with tools
   - Integrate with guardrails

### Phase 4: Queue Processing
6. **Queue Module**
   - Implement SQS client
   - Implement message processor
   - Set up cron/worker for polling

### Phase 5: Integration & Testing
7. End-to-end flow testing
8. Error handling & retries
9. Monitoring & logging

## Environment Variables

See `.env.example` for all required configuration.

Key services:
- **OpenAI**: API key for agents
- **AWS SQS**: Queue URL, credentials, region
- **Chatwoot**: API URL, key, account ID, webhook secret
- **Odoo**: URL, database, username, password
- **Neon DB**: PostgreSQL connection string

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

1. **Install dependencies:**
   ```bash
   pnpm add @nestjs/config @aws-sdk/client-sqs @prisma/client axios
   pnpm add -D prisma
   ```

2. **Initialize Prisma:**
   ```bash
   npx prisma generate
   npx prisma migrate dev --name init
   ```

3. **Start implementing modules one by one** (recommended order: Persistence → Guardrails → Integrations → AI → Queue)

4. **Test each module independently** before integrating

## Notes

- All modules use NestJS dependency injection
- No implementation details yet - just structure and contracts
- Services have method signatures but throw "Not implemented"
- Focus on clarity of how modules connect, not implementation
