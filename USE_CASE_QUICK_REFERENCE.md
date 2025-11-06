# Use Case System - Quick Reference Guide

## Overview
The Use Case System tracks customer journey goals and guides the AI through structured workflows.

## Use Case Types

### Order-Related
- `CHECK_ORDER_STATUS` - Customer wants order status
- `TRACK_SHIPMENT` - Customer wants tracking info
- `REQUEST_RETURN` - Customer wants to return item
- `VERIFY_PAYMENT` - Customer has payment questions

### Product-Related
- `FIND_PRODUCT` - Customer searching for products
- `CHECK_SIZE_AVAILABILITY` - Customer needs specific size
- `GET_PRODUCT_DETAILS` - Customer wants product details

### Information
- `LEARN_RETURN_POLICY` - Customer wants policy info
- `GET_STORE_HOURS` - Customer wants hours
- `CONTACT_SUPPORT` - Customer wants contact info

### General
- `GREETING` - Simple greeting/hello
- `OTHER` - Doesn't fit other categories

## Use Case Status
- `PENDING` - Detected but not started
- `IN_PROGRESS` - Currently being worked on
- `COMPLETED` - Successfully finished
- `BLOCKED` - Waiting for user input
- `ABANDONED` - User moved to different topic

## Message Flow

```
User Message
    ↓
Input Guardrails
    ↓
Load Conversation State
    ↓
Get Classifier Intent (ORDER_STATUS, PRODUCT_INFO, STORE_INFO, OTHERS)
    ↓
Detect/Continue Use Case
    ↓
Get Use Case Instructions
    ↓
Run Workflow (with use case context)
    ↓
Update Use Case Progress
    ↓
Check Completion
    ↓
Save Use Case State
    ↓
Output Guardrails
    ↓
Response
```

## Key Components

### UseCaseDetectionService
- `detectUseCase()` - Detect new or continue existing
- `markStepCompleted()` - Mark step as done
- `isUseCaseCompleted()` - Check if all steps done
- `getNextStep()` - Get next incomplete step
- `getCompletionPrompt()` - Get closing question

### WorkflowAIService Integration
1. Detects classifier intent
2. Calls `useCaseDetectionService.detectUseCase()`
3. Passes use case context to workflow
4. Updates progress based on response
5. Saves state to database

### Workflow Integration
- Accepts `useCase` and `useCaseInstructions`
- Injects system message with:
  - Active use case type
  - Current status
  - Next step description
  - Instructions

## Example Use Case Flow

### Scenario: Customer Asks About Order

```
1. Message: "Hola, quiero saber dónde está mi pedido #1234"

2. Detection:
   - Classifier: ORDER_STATUS
   - Use Case: CHECK_ORDER_STATUS
   - Steps: [authenticate, identify_order, fetch_status, present_status]
   - Status: IN_PROGRESS

3. Workflow:
   - System message injected:
     "ACTIVE USE CASE: check_order_status
      Status: in_progress
      Next Step: Verify customer identity
      
      Instructions:
      1. Authenticate customer (verify DNI)
      2. Identify which order
      3. Fetch order status
      4. Present status clearly
      5. Ask: ¿Hay algo más que pueda hacer por vos con este pedido?"

4. Agent Response:
   "Para ver tu información de pedidos, necesito que confirmes los 
    últimos 3 dígitos de tu DNI."

5. Progress Update:
   - Step "authenticate" marked as PENDING (waiting for DNI)

6. Next Message: "123"

7. Progress Update:
   - Step "authenticate" → COMPLETED
   - Step "identify_order" → COMPLETED (order # from context)
   - Step "fetch_status" → COMPLETED (tool call made)
   - Step "present_status" → COMPLETED (status shown)

8. Use Case Status: COMPLETED

9. State Saved:
   {
     "activeCases": [],
     "completedCases": [{
       "useCaseId": "uuid-123",
       "type": "check_order_status",
       "status": "completed",
       "completedAt": "2025-11-06T10:30:00Z"
     }]
   }
```

## Step Completion Indicators

### Authentication
- Keywords: "confirmé tu identidad", "confirmed", "verificado"

### Product Presentation
- Keywords: "![" (markdown image), "precio:", "disponible"

### Order Status
- Keywords: "pedido", "estado", "en camino", "entregado"

### Auto-Complete Steps
These complete automatically in single turn:
- `understand_need`
- `search_products`
- `identify_product`

## Database Storage

Use cases stored in `ConversationState.state.useCases`:

```json
{
  "products": [...],
  "useCases": {
    "activeCases": [
      {
        "useCaseId": "uuid-1",
        "type": "find_product",
        "status": "in_progress",
        "startedAt": "2025-11-06T10:00:00Z",
        "steps": [...],
        "context": {},
        "metadata": {}
      }
    ],
    "completedCases": [
      {
        "useCaseId": "uuid-2",
        "type": "check_order_status",
        "status": "completed",
        "completedAt": "2025-11-06T10:05:00Z",
        ...
      }
    ]
  }
}
```

## Logging

### Key Log Messages

```typescript
// Detection
"New use case detected: find_product"
"Continuing existing use case: check_order_status"

// Processing
"Processing use case: find_product"
"Next step: search_products"

// Progress
"Step completed: authenticate"

// Completion
"Use case completed: check_order_status"
"Duration: 45000ms"

// Persistence
"Use case state saved"
"Active cases: 1"
"Completed cases: 3"
```

## Configuration

### Adding New Use Case Type

1. Add to `UseCaseType` enum in `use-case.interface.ts`
2. Add workflow config in `use-case-workflows.config.ts`:
   ```typescript
   [UseCaseType.NEW_USE_CASE]: {
     type: UseCaseType.NEW_USE_CASE,
     requiredSteps: ['step1', 'step2', 'step3'],
     allowedAgents: ['Agent Name'],
     completionCriteria: 'Description',
     instructions: 'Step-by-step instructions...'
   }
   ```
3. Add step descriptions to `STEP_DESCRIPTIONS`
4. Update `mapIntentToUseCaseType()` in detection service
5. Add completion prompt to `getCompletionPrompt()`

### Customizing Step Detection

Update `updateUseCaseProgress()` in `workflow-ai.service.ts`:

```typescript
if (
  !useCase.steps.find(s => s.stepId === 'custom_step')?.completed &&
  (responseLower.includes('keyword1') || 
   responseLower.includes('keyword2'))
) {
  this.useCaseDetectionService.markStepCompleted(useCase, 'custom_step');
}
```

## Troubleshooting

### Use Case Not Detected
- Check classifier intent detection
- Verify keyword mapping in `mapIntentToUseCaseType()`
- Check logs for "Classifier intent detected"

### Steps Not Completing
- Check keyword matching in `updateUseCaseProgress()`
- Verify agent response contains expected keywords
- Add debug logging for response analysis

### State Not Persisting
- Check database connection
- Verify ConversationState.state is JSONB
- Check logs for "Use case state saved"

### Multiple Active Cases
- System supports it by design
- Each use case tracked independently
- Check `activeCases` array in state

## Performance Considerations

### Database Queries
- 1 read: Load conversation state
- 1 write: Save use case state
- Upsert operation is efficient

### Workflow Overhead
- Minimal: Single system message injection
- Use case context is lightweight
- No additional API calls

### Memory
- State stored in database (not memory)
- Only recent 5 completed cases kept
- Active cases cleaned up on completion

## Best Practices

1. **Clear Instructions**: Write detailed step-by-step instructions in Spanish
2. **Explicit Steps**: Define clear, measurable steps
3. **Completion Criteria**: Specify when use case is truly done
4. **Error Handling**: Handle cases where steps can't complete
5. **User Communication**: Always confirm actions taken
6. **Logging**: Log key events for debugging
7. **Testing**: Test each use case type thoroughly

## Quick Commands

### Check Use Case State
```typescript
const state = await persistenceService.getConversationState(conversationId);
console.log(state.state.useCases);
```

### Manually Complete Use Case
```typescript
useCase.status = UseCaseStatus.COMPLETED;
useCase.completedAt = new Date();
await saveUseCaseState(conversationId, useCase, currentState);
```

### Reset Use Case
```typescript
// Set all steps to incomplete
useCase.steps.forEach(step => {
  step.completed = false;
  step.completedAt = undefined;
});
useCase.status = UseCaseStatus.PENDING;
```

