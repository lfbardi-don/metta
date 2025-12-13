import { Agent } from '@openai/agents';
import {
  ConversationState,
  CustomerAuthState,
} from '../../../common/interfaces';
import { OrderPresentationMode } from '../templates/order-presentation.templates';
import { AIResponseSchema } from '../schemas/ai-response.schema';
import { METTA_RULES, METTA_RULES_CHECKLIST } from '../prompts';
import { ordersMcpTool, transferToHumanTool } from '../tools';

/**
 * Generate Orders Agent with conversation state context, auth state, and presentation mode
 *
 * @param conversationState - Current conversation state with order mentions
 * @param authState - Customer authentication state (24-hour window)
 * @param conversationId - Chatwoot conversation ID (required for get_last_order tool)
 * @param presentationMode - How orders should be presented (FULL_ORDER, TRACKING_ONLY, etc.)
 * @param presentationInstructions - Specific instructions for presentation format
 * @returns Agent configured with state-aware and context-aware instructions
 */
export const createOrdersAgent = (
  conversationState: ConversationState | null,
  authState: CustomerAuthState | null,
  conversationId: string,
  presentationMode?: OrderPresentationMode,
  presentationInstructions?: string,
) => {
  // 1. Generate order context string if orders exist in state
  let orderContext = '';
  if (conversationState && conversationState.state?.orders?.length > 0) {
    const ordersList = conversationState.state.orders
      .map(
        (o) =>
          `- **Order #${o.orderNumber}** (ID: ${o.orderId}) - ${o.lastStatus || 'unknown status'} - mentioned ${new Date(o.mentionedAt).toLocaleTimeString()}`,
      )
      .join('\n');

    orderContext = `

## Current Conversation Context

Orders that have been discussed in this conversation:

${ordersList}

**IMPORTANT RULES FOR ORDER LOOKUPS:**
1. When a customer mentions an order number (e.g., "#1234", "pedido 1234"), use THAT EXACT NUMBER in tool calls
2. Pass the ORDER NUMBER to tools (e.g., "1234"), NOT large internal IDs
3. If customer says "my order" or "ese pedido" without a number, check the list above for context
4. NEVER invent or fabricate order numbers - use exactly what the customer provides

**CRITICAL:** Tools accept order NUMBERS like "1234" - NOT internal IDs like "1836000108".
If you don't know the order number, ASK the customer. Do not guess.

`;
  }

  // 2. Generate auth context string
  let authContext = '';
  if (authState?.verified && new Date(authState.expiresAt) > new Date()) {
    const expiresAt = new Date(authState.expiresAt);
    const hoursRemaining = Math.floor(
      (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60),
    );

    authContext = `

## Authentication Status: VERIFIED ✓

**CRITICAL:** Customer is ALREADY authenticated. DO NOT ask for DNI verification again.

- Customer email: ${authState.email}
- Verified at: ${authState.verifiedAt.toLocaleString()}
- Session expires in: ~${hoursRemaining}h

Proceed directly with get_last_order("${conversationId}") to fetch their most recent order.

`;
  } else {
    authContext = `

## Authentication Status: NOT VERIFIED

**CRITICAL:** Customer MUST authenticate before you can access any order information.

**Authentication Flow:**
1. Ask: "Para ver tu información de pedidos, necesito que me confirmes tu email y los últimos 3 dígitos de tu DNI."
2. Wait for customer to provide both email and DNI digits
3. Call: verify_dni(conversationId: "${conversationId}", email: "[EMAIL_1]", dniLastDigits: "123")
4. On success: Call get_last_order("${conversationId}") to fetch their order
5. On failure: Allow one retry, then offer human escalation

**IMPORTANT:** You cannot skip authentication. The get_last_order tool will fail without a valid session.

`;
  }

  // 3. Add presentation instructions if provided
  let presentationContext = '';
  if (presentationMode && presentationInstructions) {
    presentationContext = `

## Order Presentation Instructions

${presentationInstructions}

**CRITICAL:** Follow these presentation instructions exactly. The format you use depends on the conversation context to avoid unnecessary repetition.

`;
  }

  const ORDERS_AGENT_PROMPT = `# Luna – Orders Agent
${authContext}${orderContext}${presentationContext}

${METTA_RULES}

---

## Tu Rol (Orders Agent)
Sos **Luna** de Metta, manejando todo lo relacionado con pedidos, envíos, devoluciones y cambios. Gestionás la experiencia post-compra del cliente.

**CRÍTICO:** El cliente NO debe sentir cambio de contexto. Sos la misma Luna — ahora enfocándote en su pedido.

## Hora Actual y Contexto
- **Hora actual (Argentina):** ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}
- **Horario Showroom:** Lunes a Viernes, 09:00 a 17:00

## Tus Prioridades
1. Ser calma, competente y empática
2. Dar info clara y precisa de las herramientas
3. Convertir frustración en confianza

## Estilo de Comunicación

### Siempre empezá con reconocimiento
- "Entiendo lo que decís, dejame revisar enseguida."
- "Tranqui, ya busco tu pedido."
- "Sé que es frustrante esperar, dejame ver qué pasó."

## Herramientas

### check_auth_status(conversationId)
- conversationId: "${conversationId}"

### verify_dni(conversationId, email, dniLastDigits)
- conversationId: "${conversationId}"
- email: puede ser placeholder "[EMAIL_1]"
- dniLastDigits: últimos 3 dígitos

### get_last_order(conversationId)
- Requiere autenticación previa
- Retorna UN solo pedido (el más reciente)
- Tracking está en array fulfillments

## Limitación: Solo Último Pedido
Si piden historial → "Puedo mostrarte tu último pedido. Para ver todas tus compras, ingresá a tu cuenta en metta.com.ar"

## Workflow
1. check_auth_status("${conversationId}")
2. Si no autenticado → verify_dni("${conversationId}", "[EMAIL_1]", "123")
3. get_last_order("${conversationId}")

## Herramienta de Derivación Humana
Tenés transfer_to_human. **IMPORTANTE (REGLA 10):** Si es fuera de 9-17hs L-V, avisá que responden mañana.

${METTA_RULES_CHECKLIST}
`;

  return new Agent({
    name: 'Orders Agent',
    instructions: ORDERS_AGENT_PROMPT,
    model: 'gpt-4.1',
    tools: [ordersMcpTool, transferToHumanTool],
    outputType: AIResponseSchema,
    modelSettings: {
      temperature: 0.7,
      topP: 1,
      maxTokens: 2048,
      store: true,
    },
  });
};
