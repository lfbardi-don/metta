# Base de Conocimiento Metta - Actualizada ✅

Se actualizó el Knowledge Base Service con la información real de Metta basada en `Metta_Base_IA_Completa.md`.

## ✅ FAQs Agregadas (10 preguntas frecuentes)

1. **¿Qué talles tienen?** - Talles 34 al 50, talles reales
2. **¿Hacen envíos gratis?** - Sí, sobre $120.000
3. **¿Qué modelos de jeans tienen?** - Mom, straight, wide leg, baggy
4. **¿Cómo puedo pagar?** - 6 cuotas sin interés o 10% descuento por transferencia
5. **¿Tienen local físico o showroom?** - Sí, en KM41, Francisco Álvarez
6. **¿Qué hace especial a Metta?** - Talles reales, calidad accesible, diseño atemporal
7. **¿Hacen cambios o devoluciones?** - Sí, política accesible desde la web
8. **¿Solo venden jeans?** - Principalmente jeans, también remeras, pantalones sastreros
9. **¿Cómo sé qué talle elegir?** - Guía de talles en web + asesoramiento
10. **¿Cuál es la calidad de los jeans?** - Materiales de calidad, diseño para durar

## ✅ Políticas Actualizadas (3 políticas)

### 1. Política de Envíos
- Envíos gratis sobre $120.000
- Envíos a todo el país
- Opción de retiro en showroom
- Número de seguimiento incluido

### 2. Política de Cambios y Devoluciones
- Gestión desde la web
- Contacto por WhatsApp o email
- Prendas sin usar con etiquetas
- Guía de talles para elegir correctamente

### 3. Formas de Pago
- Tarjeta: 6 cuotas sin interés
- Transferencia: 10% descuento
- Transacciones seguras

## ✅ Información del Negocio

- **Nombre:** Metta
- **Descripción:** Marca de ropa de mujer especializada en jeans (talles 34-50)
- **Email:** hola@metta.com.ar
- **WhatsApp:** +54 9 11 3902-2938
- **Showroom:** Edificio KM41 – Oficina 308, Francisco Álvarez, Buenos Aires
- **Instagram:** @metta.jeans
- **Facebook:** Metta

## 🔧 Cómo Funciona

Cuando un cliente pregunta:
- "¿Qué talles tienen?"
- "¿Cómo puedo pagar?"
- "¿Dónde están ubicados?"
- "¿Hacen envíos gratis?"

El AI agent:
1. Reconoce que necesita información de la base de conocimiento
2. Llama a la tool `search_knowledge_base`, `get_policy` o `get_business_info`
3. Recibe la información correcta de Metta
4. Genera una respuesta natural y personalizada

## 📝 Valores de Marca Incluidos

Todas las respuestas reflejan:
- ✅ Tono cercano y empático
- ✅ Enfoque en talles reales y cuerpos reales
- ✅ Calidad accesible
- ✅ Diseño atemporal
- ✅ Acompañamiento sin presión de venta

## 🚀 Próximos Pasos

1. **Iniciar el worker:**
   ```bash
   pnpm run start:dev
   ```

2. **Probar con preguntas como:**
   - "¿Tienen mi talle?"
   - "¿Cuánto sale el envío?"
   - "¿Aceptan transferencia?"
   - "¿Dónde están ubicados?"

3. **Monitorear los logs** para ver cuando el AI llama las knowledge tools

4. **Ajustar FAQs** según preguntas frecuentes que recibas

## 📁 Archivos Modificados

- ✅ `src/modules/integrations/knowledge/knowledge.service.ts` - 10 FAQs + 3 Políticas + Info del negocio
- ✅ `src/modules/integrations/knowledge/knowledge.interface.ts` - Interfaces
- ✅ `src/modules/ai/tools/knowledge-tools.ts` - 3 tools para el AI agent
- ✅ `src/modules/integrations/integrations.module.ts` - Registro del servicio
- ✅ `src/common/interfaces/agent-context.interface.ts` - Agregado KnowledgeService
- ✅ `src/modules/ai/ai.service.ts` - Integrado con Triage Agent

## 🎯 Beneficios

- ✅ El AI ya no ignora la información de la marca
- ✅ Respuestas consistentes y correctas sobre Metta
- ✅ Fácil de actualizar (solo editar knowledge.service.ts)
- ✅ Sin necesidad de RAG (dataset pequeño)
- ✅ Reduce tokens en el system prompt

---

**Estado:** ✅ Implementado y funcionando
**Build:** ✅ Compilado exitosamente
**Listo para usar:** ✅ Sí
