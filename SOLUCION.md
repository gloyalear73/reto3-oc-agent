# SOLUCIÓN — Reto 3: Agente de órdenes de compra (SAP simulado)

> **Estado:** borrador construido *antes* de recibir el PRD y los fixtures oficiales. Todo lo marcado con
> **[SUPUESTO]** debe contrastarse con el PRD real. Los datos en `fixtures/reto-03/` son de ejemplo y se
> reemplazan copiando los oficiales encima (mismas rutas); el único código que depende de su forma es
> `src/types.ts`, `src/data/loader.ts`, `src/data/parsing.ts` y `src/controls.ts`.

## 1. Problema y objetivo

Compras recibe por correo una solicitud con cotización y evidencia de aprobación del líder. Hoy un analista
valida a mano proveedor, aprobador, topes, IVA y condiciones de pago, y crea la OC en SAP. El agente
automatiza la lectura y la validación, y **deja la decisión de escribir en SAP en manos de una persona**.

Objetivos de negocio: menos tiempo por solicitud, controles aplicados siempre igual, trazabilidad de quién
aprobó qué, y visibilidad de las compras que se saltan el proceso (retroactivas).

## 2. Arquitectura

```
public/index.html ──HTTP──► src/server.ts ──► src/agent/loop.ts ──► API de Anthropic (Messages)
   chat + panel                  │                  │ tool_use
   confirmación humana           │                  ▼
                                 │          src/tools/oc.ts  (herramientas tipadas con zod)
                                 │                  │
                                 │         ┌────────┴─────────┐
                                 │         ▼                  ▼
                                 │   src/controls.ts     src/confirmations.ts
                                 │   (matriz C01–C13)    (token de confirmación humana)
                                 │         │                  │ resolver() — solo humano
                                 │         ▼                  ▼
                                 │   src/data/*          src/sap/adapter.ts ◄── mock.ts | (SAP real)
                                 ▼
                          demo.ts  (mismas herramientas, sin LLM)
```

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Prompt | `agent/prompt.md` | Rol, reglas inviolables, flujo y estilo. Versionable sin tocar código. |
| Herramientas | `src/tools/oc.ts` | 7 herramientas con esquema zod; punto único `ejecutarHerramienta`. |
| Reglas | `src/controls.ts` | Función pura `evaluarCaso`: misma entrada, misma salida. |
| Humano en el bucle | `src/confirmations.ts` | `crear_oc` solo registra una confirmación; escribir en SAP exige `resolver()`. |
| SAP | `src/sap/adapter.ts`, `mock.ts` | Interfaz + implementación en memoria, idempotente por solicitud. |
| Agente | `src/agent/loop.ts` | Ciclo modelo ↔ herramientas con tope de iteraciones. |
| UI | `public/index.html` | Chat, tarjetas de llamadas a herramientas, confirmaciones resaltadas. |
| Verificación | `demo.ts` | Recorre los casos sin modelo y falla (exit 1) si algo no coincide. |

**Decisión clave de diseño:** el LLM **orquesta y explica; no decide**. La decisión (`CREAR`, `ESCALAR`,
`RECHAZAR`) sale de código determinista. Por eso `demo.ts` puede probar el 100 % de la lógica sin modelo.

## 3. Ciclo del agente

1. El usuario escribe («Revisa sol-003»). Se agrega al historial de la sesión.
2. Se llama al modelo con `system` (= `agent/prompt.md`), `tools` (zod → JSON Schema) y el historial.
3. Si `stop_reason = tool_use`: por cada llamada se valida la entrada con zod, se ejecuta la herramienta y se devuelve un `tool_result`.
4. Se repite hasta que el modelo responde solo con texto o se llegan a 8 iteraciones.
5. Si `crear_oc` devolvió `REQUIERE_CONFIRMACION`, la UI muestra una tarjeta ámbar con los datos de la OC.
   La persona aprueba o rechaza llamando a `/api/confirmar`, **endpoint que el modelo no puede invocar**.
6. El resultado se inyecta al historial como mensaje `[SISTEMA]` para que el agente continúe con información real.

Cada turno devuelve eventos (`texto`, `herramienta`, `confirmacion`, `uso`, `error`); así la UI pinta las llamadas a herramientas y los tokens consumidos.

## 4. Matriz de controles **[SUPUESTO: reglas inferidas del instructivo]**

| ID | Control | Fuente | Si falla |
|---|---|---|---|
| C01 | Proveedor existe | `proveedores.json` (por NIT normalizado) | RECHAZAR |
| C02 | Proveedor activo | `estado` | RECHAZAR |
| C03 | NIT de la cotización = NIT de la solicitud | cotización | RECHAZAR |
| C04 | Centro de costo y subárea válidos | `centros-costo.json` | RECHAZAR |
| C05 | Aprobación presente y «aprobado» | `aprobacion.json` | RECHAZAR |
| C06 | Aprobador es el líder del centro | `lider.id` | RECHAZAR |
| C07 | Total ≤ tope del líder | `topeAprobacion` | ESCALAR |
| C08 | Monto aprobado ≥ total cotizado | aprobación vs cotización | ESCALAR |
| C09 | Ítems = subtotal; subtotal + IVA = total | solicitud + cotización | ESCALAR |
| C10 | Tasa efectiva de IVA existe como indicador | `indicadores-iva.json` | ESCALAR |
| C11 | Condición de pago existe en maestro | `condiciones-pago.json` | ESCALAR |
| C12 | No es compra retroactiva | `factura.txt` vs fecha de proceso | ESCALAR |
| C13 | No hay OC previa de la misma solicitud | SAP | RECHAZAR |

**Regla de decisión:** cualquier bloqueante fallido → `RECHAZAR` (no se puede crear ni con confirmación);
si solo fallan controles de escalamiento → `ESCALAR` (una persona puede autorizar con justificación ≥ 10 caracteres);
si todo pasa → `CREAR` (igual requiere confirmación humana antes de escribir).

Resultados con los fixtures de ejemplo (verificados con `demo.ts`):

| Caso | Escenario | Decisión | Control(es) |
|---|---|---|---|
| sol-001 | Camino feliz | CREAR | — |
| sol-002 | Proveedor bloqueado | RECHAZAR | C02 |
| sol-003 | Excede tope del líder | ESCALAR | C07 |
| sol-004 | Aprobador no es líder | RECHAZAR | C06 |
| sol-005 | Compra retroactiva | ESCALAR | C12 |
| sol-006 | NIT distinto y pago a 90 días | RECHAZAR | C03, C11 |

**Preguntas a resolver con el PRD:** si el tope aplica al total con IVA o al subtotal; si exceder el tope
debe escalar al siguiente nivel o rechazar; qué hacer con los defaults del proveedor cuando la cotización
no trae condición de pago o IVA; si hay tolerancias de redondeo; si C08 admite un margen.

## 5. Adaptador SAP real para producción

`SapAdapter` aísla el resto del sistema de SAP. Implementación productiva propuesta:

- **Interfaz:** OData `API_PURCHASEORDER_PROCESS_SRV` (S/4HANA) o `BAPI_PO_CREATE1` vía RFC/SAP Cloud Connector (ECC). Elegir según versión de SAP del cliente.
- **Autenticación:** OAuth 2.0 / usuario técnico dedicado con rol mínimo (solo crear OC); secretos en un gestor (nunca en el repo).
- **Idempotencia:** guardar `solicitudId` como referencia externa en la cabecera y consultar antes de crear; es el equivalente productivo del control C13 y de la idempotencia del mock.
- **Mapeo:** `proveedorId` → `Supplier`; `centroCosto` → `CostCenter` en la posición; `indicadorIva` → `TaxCode`; `condicionPago` → `PaymentTerms`; `moneda` → `DocumentCurrency`.
- **Errores:** distinguir transitorios (timeout, 5xx → reintento con backoff) de funcionales (mensajes de negocio de SAP → se muestran a la persona, sin reintento). `BAPI` exige `BAPI_TRANSACTION_COMMIT` y revisar la tabla `RETURN`.
- **Concurrencia y consistencia:** una única función de escritura detrás del adaptador; si falla a mitad, la confirmación sigue «pendiente» y se puede reintentar sin duplicar.
- **Pruebas:** el mismo `demo.ts` debe correr contra un sandbox de SAP cambiando solo la implementación inyectada en `crearContexto()`.

## 6. Análisis crítico: el desvío de las órdenes retroactivas

Una OC retroactiva ocurre cuando **ya existe la factura (el bien o servicio ya se recibió) antes de que exista la OC**.
No es un error de captura: es un **proceso que se ejecutó al revés**. Consecuencias:

- **Control financiero vacío:** el tope y la aprobación del líder se validaron *después* del compromiso, así que dejaron de ser preventivos y pasaron a ser un trámite de legalización.
- **Riesgo de fraude y de proveedor no calificado:** nadie verificó estado, precio ni condiciones antes de comprar.
- **Impacto contable y fiscal:** gasto sin provisión, facturas que esperan OC (bloqueo de pago, intereses o relación dañada con el proveedor), y dificultad para conciliar en cierre de mes.
- **Normalización del desvío:** si el agente aprueba esto con la misma fluidez que una compra normal, el sistema premia saltarse el proceso.

**Postura implementada:** el agente **nunca** la trata como caso normal. C12 la clasifica como `ESCALAR`,
la marca `retroactiva = true` en la OC, exige justificación humana y la deja visible en la UI y en SAP.

**Causas probables** (hipótesis a validar con datos, no conclusiones): urgencia operativa; percepción de que el proceso de OC es lento;
falta de visibilidad del estado de la solicitud; compras recurrentes de bajo monto sin contrato marco; y ausencia de consecuencias.

**Recomendaciones de producto:**
1. Medir: porcentaje de OC retroactivas por centro de costo, por líder y por proveedor, y días de desfase. Sin esa línea base no hay mejora demostrable.
2. Acortar el camino legítimo: SLA de respuesta al solicitante y estado visible de la solicitud.
3. Contratos marco / pedidos abiertos para compras recurrentes.
4. Ruta formal de **«compra urgente»** con aprobación posterior limitada en monto y con auditoría, en lugar de un desvío informal.
5. Política de consecuencias proporcionales (reporte mensual a líderes, tope de retroactivas por centro).
6. Contabilidad: rechazar el pago de facturas sin OC, salvo la ruta de urgencia.

## 7. Análisis de costos del modelo

> Las cifras siguientes son **estimaciones de orden de magnitud**, no mediciones. El bucle ya emite el evento
> `uso` (tokens de entrada y salida por llamada); la cifra real se obtiene sumándolos en una corrida.

**Qué consume tokens por solicitud revisada** (≈ 3 llamadas al modelo: validar → crear_oc → respuesta final):

| Componente | Tokens aprox. por llamada |
|---|---|
| System prompt (`agent/prompt.md`) | ~700 |
| Definiciones de 7 herramientas | ~1.200 |
| Historial + resultados de herramientas | 500 – 4.000 (crece con cada vuelta) |
| Salida del modelo | 150 – 500 |

Estimación por solicitud: **~6.000 – 12.000 tokens de entrada y ~600 – 1.200 de salida**.

```
costo_por_solicitud = (tokens_entrada × tarifa_entrada + tokens_salida × tarifa_salida) / 1.000.000
costo_mensual       = costo_por_solicitud × solicitudes_por_mes
```

Usar la tarifa vigente del modelo elegido (consultar la página de precios oficial al momento de calcular).

**Palancas para bajar costo, ordenadas por impacto:**
1. **Prompt caching** del system prompt y las herramientas (la parte estática es la mayoría de la entrada).
2. **Modelo pequeño** para el flujo rutinario y modelo mayor solo para casos ambiguos.
3. **Podar resultados de herramientas:** `leer_solicitud` devuelve todo; para el modelo basta con `validar_solicitud`.
4. **Procesamiento por lotes** para la bandeja nocturna, donde no hace falta respuesta inmediata.
5. **Sin LLM** para el camino determinista: `/api/evaluar` ya resuelve la validación sin modelo; el LLM solo aporta conversación y explicación.

Como la lógica de decisión no depende del modelo, el costo del LLM es **independiente de la corrección**: un modelo más barato o una caída del servicio no cambia ninguna decisión de control.

## 8. Consideraciones de producción

- **Seguridad:** el modelo no tiene permiso de escritura (token de confirmación + `resolver()` fuera de su alcance); validación zod en toda entrada; identificadores restringidos a `^[\w-]+$` (evita path traversal); límite de tamaño de body.
- **Inyección de prompt:** correos y cotizaciones son datos no confiables. El prompt lo declara, pero la defensa real es estructural: las decisiones son de código y la escritura exige humano.
- **Autenticación y autorización:** hoy `persona` es un texto libre. En producción debe venir de SSO, y solo roles de Compras pueden aprobar; los escalamientos deberían requerir un rol superior al de quien opera.
- **Auditoría:** persistir cada evaluación, llamada a herramienta, confirmación (quién, cuándo, justificación) y versión del prompt/modelo. El mock ya guarda `confirmadaPor` y `justificacion` en la OC.
- **Persistencia:** sesiones y confirmaciones viven en memoria; en producción necesitan base de datos y expiración de tokens.
- **Observabilidad:** métricas de decisiones por tipo, latencia, tokens, tasa de escalamiento y de confirmaciones rechazadas.
- **Evaluación continua:** `demo.ts` como prueba de regresión de reglas en CI; un conjunto adicional de pruebas con el LLM para medir que explica bien y no contradice la decisión.
- **Límites conocidos:** el parser de cotizaciones asume el formato de texto de los ejemplos; cotizaciones reales en PDF o con formatos libres requerirán extracción más robusta (con revisión humana si la confianza es baja).
- **Despliegue:** `npm start` expone el chat; requiere `ANTHROPIC_API_KEY` y opcionalmente `PORT` y `ANTHROPIC_MODEL`. Apto para cualquier PaaS que ejecute Node 20+ (Render, Railway, Fly.io).
