import { Agent } from '@openai/agents';
import {
  ConversationState,
  CustomerAuthState,
  ExchangeState,
} from '../../../common/interfaces';
import { AIResponseSchema } from '../schemas/ai-response.schema';
import { ordersMcpTool, productsMcpTool, transferToHumanTool } from '../tools';

/**
 * Infer the next exchange step based on agent response and tool calls
 *
 * This function inspects the agent's tool calls and response to determine
 * what step the exchange flow should advance to.
 *
 * @param currentState - Current step in the exchange flow
 * @param toolCalls - List of tool calls made by the agent
 * @param agentResponse - The agent's text response
 * @returns Updated ExchangeState with next step and extracted data
 */
export const inferNextExchangeStep = (
  currentState: ExchangeState | null,
  toolCalls: Array<{ name: string; arguments?: any; output?: any }>,
  agentResponse: string,
): ExchangeState => {
  const now = new Date();
  const baseState: ExchangeState = currentState || {
    step: 'identify_customer',
    startedAt: now,
    lastUpdatedAt: now,
    validationAttempts: 0,
  };

  let nextStep = baseState.step;
  const updates: Partial<ExchangeState> = { lastUpdatedAt: now };

  // Check tool calls for data extraction
  for (const call of toolCalls) {
    // get_last_order was called - extract order data
    if (call.name === 'get_last_order' && call.output) {
      try {
        const orderData =
          typeof call.output === 'string'
            ? JSON.parse(call.output)
            : call.output;
        if (orderData && orderData.id) {
          updates.orderId = String(orderData.id);
          updates.orderNumber = orderData.number
            ? String(orderData.number)
            : undefined;
          updates.orderStatus = orderData.status;
          updates.orderDate = orderData.created_at;
          // Extract order items if available
          if (orderData.products && Array.isArray(orderData.products)) {
            updates.orderItems = orderData.products.map((p: any) => ({
              productId: p.product_id,
              name: p.name,
              sku: p.sku,
              size: p.variant_values?.[0],
              color: p.variant_values?.[1],
            }));
          }
          // Order validated successfully
          if (
            baseState.step === 'identify_customer' ||
            baseState.step === 'validate_order'
          ) {
            nextStep = 'select_product';
          }
        } else {
          // Order not found - increment validation attempts
          updates.validationAttempts = (baseState.validationAttempts || 0) + 1;
        }
      } catch (e) {
        // Failed to parse order - stay on current step
      }
    }

    // search_nuvemshop_products was called - stock check
    if (call.name === 'search_nuvemshop_products' && call.output) {
      try {
        const stockData =
          typeof call.output === 'string'
            ? JSON.parse(call.output)
            : call.output;
        if (stockData && Array.isArray(stockData) && stockData.length > 0) {
          const product = stockData[0];
          const hasStock = product.variants?.some((v: any) => v.stock > 0);
          updates.newProduct = {
            ...baseState.newProduct,
            productId: product.id,
            name: product.name?.es || product.name,
            hasStock,
          };
          if (baseState.step === 'check_stock') {
            nextStep = hasStock ? 'confirm_exchange' : 'get_new_product'; // Offer alternatives
          }
        }
      } catch (e) {
        // Failed to parse stock data
      }
    }

    // transfer_to_human was called - flow complete
    if (call.name === 'transfer_to_human') {
      nextStep = 'ready_for_handoff';
      updates.policyExplained = true;
    }
  }

  // Infer step from response content (if no tool calls advanced the step)
  if (nextStep === baseState.step) {
    const response = agentResponse.toLowerCase();

    // Detect step based on what agent asked/confirmed
    if (baseState.step === 'identify_customer') {
      // Agent asking for name/order number
      if (
        response.includes('número de pedido') ||
        response.includes('nombre')
      ) {
        nextStep = 'identify_customer'; // Stay
      }
    } else if (baseState.step === 'select_product') {
      // Agent asking which product to exchange
      if (
        response.includes('qué producto') ||
        response.includes('cuál querés cambiar')
      ) {
        nextStep = 'select_product'; // Stay
      } else if (
        response.includes('por qué') ||
        response.includes('qué talle')
      ) {
        nextStep = 'get_new_product';
      }
    } else if (baseState.step === 'get_new_product') {
      // Agent asked for new product details
      if (response.includes('verifico') || response.includes('stock')) {
        nextStep = 'check_stock';
      }
    } else if (baseState.step === 'confirm_exchange') {
      // Agent confirmed the exchange
      if (response.includes('dirección') || response.includes('sucursal')) {
        nextStep = 'get_address';
      }
    } else if (baseState.step === 'get_address') {
      // Agent asking for return branch - after getting it, go directly to handoff
      if (
        response.includes('equipo') ||
        response.includes('derivar') ||
        response.includes('humano') ||
        response.includes('te paso')
      ) {
        nextStep = 'ready_for_handoff';
      }
    }
  }

  return {
    ...baseState,
    ...updates,
    step: nextStep,
  };
};

/**
 * Generate Exchange Agent for handling product exchange flows (REGLA 4)
 *
 * This agent manages the complete exchange process step-by-step:
 * 1. Confirm exchange intent
 * 2. Verify order exists and is eligible
 * 3. Get original product details
 * 4. Get desired new product
 * 5. Check stock availability
 * 6. Confirm exchange details
 * 7. Get shipping address
 * 8. ONLY THEN transfer to human
 *
 * @param conversationState - Current conversation state with exchange progress
 * @param authState - Customer authentication state
 * @param conversationId - Chatwoot conversation ID
 * @param exchangeState - Current state of the exchange flow
 * @returns Agent configured with exchange-specific instructions
 */
export const createExchangeAgent = (
  conversationState: ConversationState | null,
  authState: CustomerAuthState | null,
  conversationId: string,
  exchangeState: ExchangeState | null,
) => {
  // Generate exchange context based on current step
  let exchangeContext = '';
  let currentStepInstructions = '';

  if (exchangeState) {
    exchangeContext = `
## Current Exchange State

**Step:** ${exchangeState.step}
${exchangeState.isAuthenticated ? `**Autenticado:** Sí` : ''}
${exchangeState.orderNumber ? `**Pedido:** #${exchangeState.orderNumber}` : ''}
${exchangeState.orderStatus ? `**Estado del pedido:** ${exchangeState.orderStatus}` : ''}
${exchangeState.originalProduct?.name ? `**Producto a cambiar:** ${exchangeState.originalProduct.name} (Talle: ${exchangeState.originalProduct.size || 'unknown'}, Color: ${exchangeState.originalProduct.color || 'unknown'})` : ''}
${exchangeState.newProduct?.name ? `**Producto nuevo:** ${exchangeState.newProduct.name} (Talle: ${exchangeState.newProduct.size || 'unknown'})` : ''}
${exchangeState.newProduct?.hasStock !== undefined ? `**Stock disponible:** ${exchangeState.newProduct.hasStock ? 'Sí' : 'No'}` : ''}
${exchangeState.returnShippingAddress || exchangeState.correoArgentinoReturnBranch ? `**Sucursal devolución:** ${exchangeState.correoArgentinoReturnBranch || exchangeState.returnShippingAddress}` : ''}
${exchangeState.policyExplained ? `**Política explicada:** Sí` : ''}
${exchangeState.validationAttempts ? `**Intentos de validación:** ${exchangeState.validationAttempts}/2` : ''}

`;

    // Generate step-specific instructions based on current step
    currentStepInstructions = getStepInstructions(
      exchangeState,
      conversationId,
    );
  } else {
    // No exchange state yet - this is the first message
    exchangeContext = `
## Iniciando Nuevo Cambio

Esta es la primera interacción para un cambio. Comenzá con PASO 0.
`;
    currentStepInstructions = `
**PASO 0 — IDENTIFICACIÓN DEL CLIENTE**
Tu trabajo: Dar la bienvenida y verificar la identidad del cliente.

**PRIMERO:** Llamá a check_auth_status("${conversationId}") para ver si ya está autenticado.

- **SI YA ESTÁ AUTENTICADO:** Decí "¡Hola! Veo que ya estás registrado/a. Dejame buscar tu último pedido..." y llamá get_last_order("${conversationId}")
- **SI NO ESTÁ AUTENTICADO:** Pedí los datos:
  "¡Hola! Entiendo que querés hacer un cambio de producto. Para verificar tu compra necesito:
  1. Tu email de la compra
  2. Los últimos 3 dígitos de tu DNI"

**NOTA:** El email se usa para buscar el pedido, el DNI para verificar la identidad.
`;
  }

  const EXCHANGE_AGENT_PROMPT = `# Luna – Exchange Agent (REGLA 4 v2.0)
${exchangeContext}${currentStepInstructions}
## Rol y Propósito
Sos **Luna** de Metta, manejando cambios de producto siguiendo REGLA 4.
Tu trabajo es recolectar TODA la información necesaria paso a paso ANTES de derivar a un humano.

**REGLA CRÍTICA:** NO llames transfer_to_human() hasta llegar al paso "ready_for_handoff" con TODO:
- ✓ Cliente autenticado (email + DNI verificados)
- ✓ Pedido validado con get_last_order
- ✓ Producto a cambiar identificado
- ✓ Producto nuevo confirmado con stock
- ✓ Sucursal o dirección obtenida
- ✓ Política de costos explicada

**PROHIBIDO:**
- Derivar apenas el cliente dice "quiero hacer un cambio"
- Saltarse pasos (especialmente identificación del pedido)
- Procesar sin validar número de pedido real
- Pedir datos duplicados

## Hora Actual y Contexto
- **Hora actual (Argentina):** ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}
- **Horario de atención humana:** Lunes a Viernes, 09:00 a 17:00 (GMT-3)
- **Conversation ID:** ${conversationId}

## Estilo de Comunicación
- Español argentino, usar "vos"
- Cálido, paciente y servicial
- Mensajes cortos, enfocados en UNA cosa a la vez
- Guiar al cliente paso a paso

## Herramientas Disponibles

### Herramienta de Pedidos
- get_last_order(conversationId): Obtener el último pedido del cliente

### Herramientas de Productos (para verificar stock)
- search_nuvemshop_products(query?, size?): Buscar productos y verificar stock
- get_nuvemshop_product(product_id, include_variants?): Obtener detalles de un producto

### Herramienta de Derivación
- transfer_to_human(reason, summary): Derivar a agente humano
  **SOLO USAR cuando TODA la info del cambio está completa (paso = ready_for_handoff)**

## Resumen del Flujo (REGLA 4)
PASO 0: Identificación (nombre + pedido) → PASO 1: Seleccionar producto → PASO 2: Nuevo talle/color →
PASO 3: Verificar stock → PASO 4: Confirmar cambio → PASO 5: Obtener dirección →
PASO 6: Explicar política → PASO 7: **DERIVAR**

## Recordatorios Importantes
- Mantené el foco en el paso actual
- Si el cliente pregunta otra cosa, respondé brevemente pero volvé al flujo de cambio
- Máximo 2 intentos de validación de pedido antes de derivar
- Confiá en los datos de las herramientas - no inventes información
`;

  return new Agent({
    name: 'Exchange Agent',
    instructions: EXCHANGE_AGENT_PROMPT,
    model: 'gpt-4.1',
    tools: [ordersMcpTool, productsMcpTool, transferToHumanTool],
    outputType: AIResponseSchema,
    modelSettings: {
      temperature: 0.6,
      topP: 1,
      maxTokens: 2048,
      store: true,
    },
  });
};

/**
 * Helper function to generate step-specific instructions
 */
function getStepInstructions(
  exchangeState: ExchangeState,
  conversationId: string,
): string {
  switch (exchangeState.step) {
    case 'identify_customer':
      return `
**PASO 0 — IDENTIFICACIÓN DEL CLIENTE**
Tu trabajo: Verificar si el cliente ya está autenticado o pedir los datos necesarios.

**PRIMERO:** Llamá a check_auth_status("${conversationId}") para ver si ya está autenticado.

- **SI YA ESTÁ AUTENTICADO:** Saltá directo a obtener el pedido con get_last_order("${conversationId}").
- **SI NO ESTÁ AUTENTICADO:** Pedí email y los últimos 3 dígitos del DNI.

Next: Si la verificación es exitosa, pasá a validate_order.
`;
    case 'validate_order':
      return `
**PASO 0b — VALIDAR PEDIDO EN TIENDA NUBE**
Tu trabajo: Buscar el último pedido usando get_last_order("${conversationId}") y verificar que:
- El pedido existe
- El pedido fue entregado o está en condiciones de cambio
- No pasaron más de 30 días desde la entrega

Después de mostrar el pedido, explicá la política de cambio y preguntá cuál producto quiere cambiar.
`;
    case 'select_product':
      return `
**PASO 1 — IDENTIFICAR QUÉ PRODUCTO QUIERE CAMBIAR**
Tu trabajo: Determinar cuál producto del pedido quiere cambiar.

- Si el pedido tiene 1 solo producto: confirmalo directamente.
- Si tiene varios productos: listá todos y preguntá cuál quiere cambiar.

Next: Una vez identificado el producto, preguntá por qué talle/color lo quiere (get_new_product).
`;
    case 'get_new_product':
      return `
**PASO 2 — PREGUNTAR POR QUÉ TALLE/COLOR QUIERE CAMBIARLO**
Tu trabajo: Saber qué talle o color nuevo quiere el cliente.

Preguntá: "Perfecto. ¿Por qué talle o color querés cambiarlo?"

Next: Con esa información, verificá el stock (check_stock).
`;
    case 'check_stock':
      return `
**PASO 3 — VERIFICAR STOCK**
Tu trabajo: Consultar stock del SKU solicitado usando search_nuvemshop_products.

- **SI HAY STOCK:** Informá y avanzá a confirmar el cambio.
- **SI NO HAY STOCK:** Ofrecé alternativas.

Next: Cuando tenga un producto disponible confirmado, pasá a confirm_exchange.
`;
    case 'confirm_exchange':
      return `
**PASO 4 — CONFIRMAR PRODUCTO FINAL DEL CAMBIO**
Tu trabajo: Resumir el cambio y pedir confirmación.

Decí: "Listo 💛 Lo cambiamos por: {producto}, {talle}, {color}. ¿Está bien?"

Next: Una vez confirmado, pedí la sucursal o dirección (get_address).
`;
    case 'get_address':
      return `
**PASO 5 — PEDIR SUCURSAL DE CORREO ARGENTINO PARA DEVOLUCIÓN**
Tu trabajo: Saber desde qué sucursal de Correo Argentino el cliente va a ENVIAR el producto.

Preguntá: "¿Desde qué sucursal de Correo Argentino vas a enviar el producto?"

Next: Con la sucursal confirmada, pasá DIRECTAMENTE a ready_for_handoff.
`;
    case 'ready_for_handoff':
      return `
**PASO 6 — DERIVAR A HUMANO (ÚNICO MOMENTO DE DERIVACIÓN)**
¡TODA LA INFORMACIÓN ESTÁ COMPLETA! Ahora sí podés derivar.

Verificá la hora actual:
- **Si es Lunes a Viernes, 9:00-17:00 (Argentina):**
  Decí: "Perfecto 💛 Con estos datos ya puedo avanzar. Te paso con las chicas para que generen la etiqueta..."
  Llamá: transfer_to_human(reason="Cambio completo", summary="[incluí todos los datos]")

- **Si es fuera de horario:**
  Decí: "Perfecto 💛 Tengo todos los datos. La atención humana es de Lunes a Viernes de 9 a 17hs..."
  Llamá: transfer_to_human() de todas formas.

**RESUMEN PARA EL HUMANO:**
- Número de pedido: ${exchangeState.orderNumber || '[pendiente]'}
- Autenticado: ${exchangeState.isAuthenticated ? 'Sí' : 'No'}
- Producto a cambiar: ${exchangeState.originalProduct?.name || '[pendiente]'}
- Producto nuevo: ${exchangeState.newProduct?.name || '[pendiente]'}
- Stock confirmado: ${exchangeState.newProduct?.hasStock ? 'Sí' : 'Pendiente'}
- Sucursal devolución: ${exchangeState.correoArgentinoReturnBranch || exchangeState.returnShippingAddress || '[pendiente]'}
`;
    default:
      return '';
  }
}
