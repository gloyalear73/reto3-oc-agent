# SOLUCIÓN — Reto 03: Agente conversacional «Órdenes de Compra SAP»

## 1. Problema en una frase

Quien ejerce como analista administrativo digita a mano en SAP, por cada factura, los datos de una compra que llegó por correo, y verifica «de memoria» que el aprobador pueda aprobar ese monto; eso cuesta tiempo, produce errores que se corrigen en cierre contable y deja a la dirección sin saber cuántas órdenes se crean *después* de la factura.

**A quién le duele:** a quien opera el proceso como analista (tiempo y riesgo de error), a Contabilidad/Auditoría (control no sistemático y evidencia dispersa) y a la dirección (no mide el desvío de proceso).

## 2. Arquitectura

```
┌────────────────┐   HTTP    ┌─────────────────────────────────────────────────────┐
│ web/index.html │ ────────▶ │ src/server.ts  (node:http, sin framework)           │
│  chat          │ ◀──────── │   /api/chat · /api/sessions/:id · /api/health       │
│  tool calls    │           │            │                                        │
│  confirmación  │           │            ▼                                        │
└────────────────┘           │ src/agent/ciclo.ts   ciclo: modelo → herramientas   │
                             │            │   ▲                                    │
                             │            ▼   │ tool_result                        │
                             │ src/llm/adapter.ts (interfaz) ── anthropic.ts       │
                             │            │                                        │
                             │            ▼                                        │
                             │ src/tools/oc.ts   oc_leer_paquete · oc_validar ·    │
                             │   oc_generar_evidencia · oc_construir_payload ·     │
                             │   oc_crear           (args con zod; nunca lanzan)   │
                             │            │                                        │
                             │            ▼                                        │
                             │ src/domain/  reglas RC1–RC10, payload, evidencia,   │
                             │              confirmación humana, control/log       │
                             │ src/sap/     adapter.ts (interfaz) ── mock.ts       │
                             └───────┬─────────────────────────────┬───────────────┘
                                     ▼                             ▼
                          fixtures/reto-03/ (solo lectura)   out/ (escritura)
                                                              ├ sap/ordenes.jsonl
                                                              ├ control.csv · log.jsonl
                                                              └ <caso>/aprobacion.txt|pdf · trazabilidad.json
```

**Dónde vive cada cosa** (separación que pide el PRD):

| Qué | Dónde | Por qué |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | Tono, reglas inviolables y flujo. Se edita sin tocar código y se relee en cada turno. |
| **Conocimiento** | `src/knowledge/ordenes-compra.md` | Reglas del proceso y qué recomendar ante cada bloqueo. Se concatena al system prompt. |
| **Ejecución** | `src/tools/oc.ts` + `src/domain/` | Código determinista. Un cambio de reglas de negocio toca `controles.ts`, no el servidor. |

El módulo del bonus (`modulo/`) se **genera** desde esas mismas tres piezas con `npm run build:modulo`; no hay copias que puedan divergir (ver sección 10).

## 3. Ciclo del agente

1. `POST /api/chat` entrega el mensaje a `turno()` (`src/agent/ciclo.ts`). Una sesión procesa un mensaje a la vez; si llega otro mientras tanto responde 429.
2. Se llama al modelo con el system prompt (`prompt.md` + conocimiento) y las definiciones de las herramientas (zod → JSON Schema).
3. Si el modelo pide herramientas, `ejecutarHerramienta()` valida los argumentos con zod, ejecuta, escribe en `out/log.jsonl` (CA4) y devuelve el resultado al modelo. Cada llamada se muestra en el chat con nombre, argumentos y resultado resumido (el detalle se despliega).
4. Se repite hasta que el modelo responde solo con texto.

**Tope de iteraciones (CA1).** `MAX_ITERACIONES` (25 por defecto). Al alcanzarlo se hace una última llamada con `tool_choice: none` y una instrucción de resumir lo logrado y lo que falta.

**Confirmación humana (CA3).** Aquí está la decisión de diseño más importante. Un argumento `confirmado = true` lo puede inventar el modelo, así que no se le cree sin más. El servidor cuenta los mensajes **del usuario** por sesión (`src/domain/confirmaciones.ts`):

- Un caso queda *pendiente* cuando se le muestran al usuario sus excepciones (`oc_validar` o `oc_construir_payload` con confirmaciones) o se intenta crear sin confirmar.
- `oc_crear` solo acepta `confirmado = true` si, **después** de quedar pendiente, llegó un mensaje nuevo del usuario.
- El front resalta ese estado (aviso ámbar + botones «Confirmo» / «No confirmo», que simplemente envían un mensaje al chat, tal como pide el PRD).

*Límite conocido:* el sistema verifica que el usuario respondió, no lee *qué* respondió; interpretar «no» o «espera» sigue siendo del modelo. Sí queda cubierto el peor caso: el modelo no puede auto-confirmarse en el mismo turno (probado en `test/ciclo.test.ts`).

**Errores (CA5).** Un fallo del proveedor (clave inválida, saldo, 429, 5xx, timeout) se convierte en un mensaje claro en el chat y la sesión sigue viva; el historial conserva la alternancia de roles para poder continuar.

## 4. Elección del modelo

- **Proveedor y modelo:** Anthropic, `claude-sonnet-5-5` por defecto (variable `LLM_MODEL`). Cambiar a `claude-haiku-5-5` no requiere código.
- **Por qué:** la tarea exige llamadas a herramientas fiables en varios pasos y respuestas en tablas claras en español; las *decisiones* de control no dependen del modelo (son código), así que el riesgo de un modelo más pequeño es de redacción, no de corrección. Sonnet es el punto medio razonable para la demo; Haiku es la opción de producción por costo.
- **Aislamiento:** el ciclo solo conoce `ProveedorLlm` (`src/llm/adapter.ts`: `enviar(mensajes, herramientas, opciones) → respuesta`). Otro proveedor = un archivo nuevo en `src/llm/` y un `case` en `src/llm/index.ts`. Se usa `fetch` directo, sin SDK, para no depender de librerías del proveedor.

**Costo estimado por caso** (tarifas oficiales de [Claude Platform Docs – Pricing](https://platform.claude.com/docs/en/about-claude/pricing), por millón de tokens):

| Modelo | Entrada | Escritura caché 5 min | Lectura caché | Salida |
|---|---|---|---|---|
| Sonnet 5.5 | $2,00 | $2,50 | $0,10 | $10,00 |
| Haiku 5.5 (≤100k) | $0,10 | $0,125 | $0,01 | $0,50 |

Base de la estimación (tamaños **medidos** en el repositorio): system prompt + conocimiento ≈ 7.300 caracteres, definiciones de herramientas ≈ 3.000 caracteres (≈ 3.000 tokens de prefijo fijo); resultados de herramientas: `oc_leer_paquete` ≈ 1.600 caracteres, `oc_construir_payload` ≈ 1.400, `oc_validar` ≈ 400.

| Escenario | Llamadas al modelo | Tokens aprox. (entrada / salida) | Sonnet 5.5 | Haiku 5.5 |
|---|---|---|---|---|
| Caso limpio (sol-001) | 4 | ~15.000 / ~300 | ~US$ 0,02–0,03 | ~US$ 0,002 |
| Caso con excepción y confirmación (sol-004) | 5–6 | ~21.000 / ~800 | ~US$ 0,03–0,05 | ~US$ 0,003 |

La horquilla del extremo bajo supone que el prefijo se sirve desde caché; sin caché, el extremo alto. **Son estimaciones**: el servidor devuelve `tokensSesion` en cada respuesta, y esa es la cifra real a usar tras la primera corrida en vivo.

**Tope de gasto (PRD 8).** `MAX_ITERACIONES` (25/turno), `MAX_TOKENS_SESION` (200.000) y `MAX_TOKENS_GLOBAL` (2.000.000 por proceso). Con Sonnet, el peor caso por sesión es del orden de US$ 0,5 y el global del orden de US$ 5. Aun así conviene fijar además un límite de gasto en la consola del proveedor.

## 5. Matriz de controles

Implementada en `src/domain/controles.ts` como una función pura `validar(paquete, maestros)`; misma entrada, misma salida, sin modelo.

| Regla | Implementación | Resultado en los 6 casos |
|---|---|---|
| RC1 | Proveedor por NIT normalizado (sin puntos ni dígito de verificación); sin NIT, por nombre normalizado (sin tildes ni sufijos S.A.S./Ltda.); además debe estar `activo`. | sol-002 **bloqueo** (NIT 901999000 inexistente). sol-006 se resuelve por nombre. |
| RC2 | Aprobación presente, con «Aprobado» (descartando «no aprobado») y emitida por un aprobador del centro. | sol-003 **bloqueo**: `fvargas` (Comercial) aprueba un gasto de CC-2020. Se reporta junto con RC3. |
| RC3 | Valor ≤ tope del aprobador en ese centro. Si el aprobador no es válido (RC2), se compara con el mayor tope del centro. | sol-003 **bloqueo**: $74 M supera el tope de todos los aprobadores del centro (máximo $30 M). |
| RC4 | Subárea ∈ centro de costo (comparación sin tildes/mayúsculas). | Sin hallazgos. |
| RC5 | `abs(cot − sol)/sol ≤ 2 %`; sin cotización → confirmación. El hallazgo trae ambos valores. | sol-004 **confirmación**: $26,5 M vs $25 M = 6,0 %. |
| RC6 | Sin indicador → se deriva del proveedor y se pide confirmación. | sol-006 → `C1`. |
| RC7 | Sin condiciones de pago → se derivan del proveedor (solo informa). | sol-006 → `Z030`. |
| RC8 | Factura con fecha < `fecha_solicitud` → `retroactiva = true` + confirmación. | sol-005: factura FC-88231 del 10-ago, 17 días antes. |
| RC9 | Fecha de aprobación ≥ `fecha_solicitud`, comparando la fecha local (sin pasar a UTC). | Sin hallazgos. |
| RC10 | `cantidad × valor_unitario = valor_total` (±1). | Sin hallazgos. |
| RC11 *(decisión de producto)* | Solicitud o cotización en moneda distinta de COP → **bloqueo**. | Sin hallazgos (los 6 casos son COP). |
| RC12 *(decisión de producto)* | La tasa de IVA de la cotización (`IVA 19%`) debe ser igual a la `tasa` del indicador de la solicitud (o el del proveedor, si se derivó), y base + IVA = total y base × tasa = IVA (±1 peso). Distinto → **confirmación**; indicador inexistente → **bloqueo**. | Sin hallazgos: las 6 cotizaciones liquidan 19 % y el indicador es C1. |

Cada bloqueo y confirmación devuelve `detalle` y `accion_sugerida` (lo que pide el objetivo O2), y `demo.ts` verifica con asserts los seis resultados esperados.

**La más difícil: RC2 con RC3.** En sol-003 el valor ($74 M) también supera el tope de la única aprobadora del centro ($30 M). Pero el problema real es que quien aprobó *no es aprobador de ese centro*; reportar además «tope excedido» contra una persona sin autoridad mezclaría dos causas. Decisión: se reportan **las dos**. Con aprobador inválido, RC3 se compara con el mayor tope del centro y se reporta si ni ese alcanza. Así, quien gestiona la corrección de RC2 sabe desde el primer rechazo que además necesita un nivel superior, y no vuelve a fallar con RC3 en un segundo intento. Si el valor sí cabe en el tope de otro aprobador del centro, solo se reporta RC2.

## 6. Diseño del adaptador SAP real

**Elección: OData `API_PURCHASEORDER_PROCESS_SRV`** (S/4HANA), con **Plan B** de carga por archivo.

*Cómo se enchufa.* Las herramientas reciben el adaptador por el contexto (`ctx.sap`, de tipo `SapAdapter`); si no llega ninguno usan el SAP simulado sobre `out/sap/`. Pasar a SAP real es escribir otra clase con los mismos tres métodos y entregarla al construir el contexto, sin tocar herramientas, controles ni prompt. `test/sap.test.ts` lo demuestra con un SAP en memoria. Extensión sobre el PRD: `buscarOrdenPorReferencia` devuelve también `fecha`, para informar la fecha original al reintentar; SAP real la entrega en la cabecera del documento.

*Por qué, dada una viabilidad no confirmada.* OData es la API oficial y pública de S/4HANA para órdenes de compra, funciona sobre HTTPS (apta para un agente en la nube sin RFC abierto) y tiene semántica clara de errores. `BAPI_PO_CREATE1` por RFC solo si el cliente está en ECC. SAP Integration Suite es una buena capa intermedia si TI exige un gateway, pero añade un componente que el reto no necesita probar.

**Mapeo del payload de 7.4** (nombres a validar contra el sistema del cliente):

| Payload | OData (`A_PurchaseOrder` / `A_PurchaseOrderItem`) |
|---|---|
| `sociedad` | `CompanyCode` |
| `organizacion_compras` | `PurchasingOrganization` |
| `proveedor.codigo_sap` | `Supplier` |
| `moneda` | `DocumentCurrency` |
| `condiciones_pago` | `PaymentTerms` (p. ej. `Z030`) |
| `posiciones[].numero` | `PurchaseOrderItem` |
| `posiciones[].descripcion` | `PurchaseOrderItemText` (40 caracteres) |
| `posiciones[].cantidad` / `unidad` | `OrderQuantity` / `PurchaseOrderQuantityUnit` |
| `posiciones[].precio_unitario` | `NetPriceAmount` (precio **neto**, sin IVA) |
| `posiciones[].indicador_iva` | `TaxCode` |
| `posiciones[].centro_costo` | imputación (`A_PurOrdAccountAssignment` → `CostCenter`, categoría `K`) |
| `referencia.solicitud_id` | campo de referencia externa de cabecera (para idempotencia) |
| evidencia (`aprobacion.pdf`) | adjunto vía `API_CV_ATTACHMENT_SRV` |

**Brechas que el payload simplificado no cubre y SAP exigirá:** grupo de compras, centro/almacén, grupo de artículos y la *subárea* (hoy sin campo SAP definido; probablemente una orden interna o un campo de usuario). Deben definirse con el área de Compras antes de producción.

**Autenticación.** Usuario de comunicación de SAP con *communication arrangement* de mínimo privilegio (solo OC), o OAuth 2.0 con SAML bearer; la credencial vive en un gestor de secretos y en la configuración del *adapter*, **nunca** en el agente, el prompt ni el front. El agente solo conoce `SapAdapter`. Las llamadas de escritura requieren obtener un token CSRF previo.

**Idempotencia y error parcial.**
- Antes de crear: consulta por la referencia externa (`solicitud_id`); si existe, devuelve esa OC (como hoy hace `buscarOrdenPorReferencia`).
- La creación de cabecera + posiciones + imputación va en **una sola petición** (deep insert) o un `$batch` con *changeset*, de modo que falle o se aplique completa.
- Timeout o 5xx con resultado incierto: **no se reintenta a ciegas**; se consulta por referencia externa y solo se reintenta si no existe. Error funcional de SAP (4xx con mensaje de negocio) no se reintenta: se muestra a quien opera.
- Si queda una OC a medias (por ejemplo sin adjunto), el estado se registra en `control.csv` y se reintenta *solo* el paso pendiente.

**Plan B (conexión no viable).** El agente igual elimina la digitación: genera, por caso, un paquete «listo para pegar»: tabla de la OC campo a campo, la evidencia en PDF con su hash y un archivo de carga masiva (CSV/Excel con las columnas del *template* de carga de OC del cliente) para cargarlo en bloque. Quien opera revisa y sube; el control, la trazabilidad y `control.csv` siguen funcionando igual.

## 7. Lectura del proceso: las OC retroactivas

**Qué le diría a la dirección.** Una OC retroactiva no es un error de digitación: es un proceso que corre *al revés*. En la muestra, sol-005 lo muestra con claridad: la factura FC-88231 es del 10 de agosto, la solicitud del 27 y la aprobación del 28; la propia aprobadora escribe «ya llegó la factura, por favor crear la OC para poder radicarla». La aprobación dejó de ser un control preventivo y pasó a ser un trámite de legalización: se aprobó un gasto ya ejecutado, sin que nadie pudiera negarse. Eso rompe tres cosas a la vez: el control de topes (RC3), la comparación de precio (la cotización es de agosto 5 y la compra ya estaba hecha) y la planeación contable (gasto sin compromiso previo). Con seis casos no se puede inferir una tasa (uno de seis no es una cifra), pero sí que **hoy nadie la mide**; el agente empieza a hacerlo en `out/control.csv` (`retroactiva`) sin bloquear a quien opera.

**Qué cambio de proceso propondría.**
1. **Medir primero**: porcentaje de OC retroactivas por centro de costo, líder, proveedor y días de desfase; reporte mensual a los líderes. Sin línea base no se demuestra mejora.
2. **«Sin OC no hay pago»**: Contabilidad no radica facturas sin OC, salvo una ruta formal de **compra urgente** con tope de monto, aprobación posterior del líder y registro, en lugar del desvío informal de hoy.
3. **Acortar el camino legítimo**: con el agente, procesar una solicitud pasa de digitación manual a minutos; esa es la mejor razón para que el solicitante la envíe *antes*. Un SLA visible de respuesta refuerza el cambio.
4. **Contratos marco / pedidos abiertos** para compras recurrentes de bajo monto (papelería, tóner, licencias), que son la causa probable del patrón.

**Qué no decide el agente.** Si se *toleran con marca* o se *rechazan* es política de la compañía (pregunta abierta del PRD, sección 10). Hoy las deja pasar solo con confirmación humana explícita y marcadas; si la dirección decide rechazarlas, basta mover RC8 de «confirmación» a «bloqueo» en `controles.ts`, sin tocar nada más.

## 8. Decisiones y trade-offs

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| 1 | **Las reglas de control son código determinista**; el modelo orquesta y explica. | Dejar que el LLM evalúe RC1–RC10 desde el prompt. | Una regla de control debe dar el mismo resultado siempre, ser auditable y probarse sin clave (`demo.ts`). El modelo no puede «razonar» un valor que no está. |
| 2 | **Las herramientas releen el caso**; `paquete`, `derivados` y `payload` son opcionales y, si se envían, deben coincidir con el real. | Confiar en los argumentos que el modelo reenvía (el contrato literal del PRD). | Elimina el riesgo «el modelo arregla un monto para que cuadre» (PRD 10) y ahorra tokens. Se mantienen en el contrato para cumplir la firma del PRD. |
| 3 | **Confirmación por contador de mensajes del usuario**, además del flag `confirmado`. | (a) Creer `confirmado = true`; (b) un endpoint/botón de aprobación fuera del chat, que era mi primer diseño. | (a) deja a un modelo equivocado crear OC. (b) incumple CA3: la confirmación debe ser un mensaje del usuario. El contador es estructural pero no lee el texto (límite declarado en la sección 3). Una excepción: un rechazo explícito al inicio del mensaje («no confirmo», «no la crees», «cancela») cierra lo pendiente; solo puede cerrar, nunca abrir, y para crear después hay que volver a mostrar las excepciones. |
| 4 | **`node:http` + `fetch` + `tsx`, sin framework ni SDK.** | Express/Hono y el SDK del proveedor. | Menos dependencias que justificar (PRD 8), arranque rápido y control total del formato de errores. A cambio hay que mantener el enrutado a mano (seis rutas). |
| 5 | **Una posición por OC.** | Soportar varias posiciones por solicitud. | Los fixtures traen una sola línea (`cantidad × valor_unitario`). El esquema ya es un arreglo, así que extenderlo no rompe el contrato. |
| 6 | **`zod/v4` (subruta)** en lugar de `zod` raíz. | `import { z } from "zod"`. | Necesito `z.toJSONSchema` para entregar los esquemas al modelo sin otra librería; la subruta funciona tanto con zod 3.25 como con 4.x. |
| 7 | **Candado por solicitud** (`conCandado`) alrededor de «¿existe la OC? → créala». | Confiar solo en la idempotencia de SAP. | Una prueba de concurrencia mostró que dos sesiones simultáneas creaban dos OC. El candado es en proceso; con varias instancias la atomicidad debe venir de SAP (referencia externa única). |
| 8 | **Clave de acceso opcional + límite de mensajes por IP** (`ACCESS_KEY`, `RATE_LIMIT_POR_MIN`, `TRUST_PROXY`). | Dejar el enlace abierto solo con topes de tokens. | El enlace público gasta la clave del modelo. La comparación es en tiempo constante y hay freno a la fuerza bruta. Opcional en local; **obligatoria en el despliegue público** (`REQUIRE_ACCESS_KEY=1`: sin `ACCESS_KEY` el servidor no arranca). El PRD (9.2) habla de «si aplica, la clave de acceso». |
| 9 | **Las excepciones a confirmar las pinta el servidor** (`excepciones[]` en la respuesta del chat). | Depender de que el modelo las transcriba bien. | Evita que un monto o un código mal copiado llegue a quien confirma. |
| 10 | **Montos siempre en COP, IVA validado y precio neto a SAP** (decisión de producto). Moneda distinta → bloqueo RC11; IVA de la cotización ≠ tasa del indicador → confirmación RC12; `precio_unitario` = valor con IVA / (1 + tasa), a 2 decimales. | (a) Enviar el valor con IVA; (b) convertir USD; (c) ignorar la tasa del maestro. | SAP calcula el IVA con el indicador, así que recibir un precio bruto lo duplicaría. La tasa sale del maestro, no del código. A cambio, el precio tiene redondeo (95.000 → 79.831,93; ×120 = 9.579.831,60 frente a la base de la cotización, 9.579.832); la traza lo documenta. |
| 11 | **Front en HTML, CSS y JavaScript planos** (`web/index.html`, un solo archivo servido por el propio backend). | React, Svelte o Vue con un paso de compilación. | El PRD permite HTML plano. Una sola pantalla de chat no justifica un framework: no hay compilación, el arranque es un comando y no hay otro servidor ni CORS. El texto de la API se escapa antes de pintarlo. A cambio, el estado de la interfaz se maneja a mano y no hay streaming (opcional en el PRD). |

## 9. Supuestos

1. **El valor de la solicitud incluye IVA y a SAP viaja el precio neto** (es el estándar de SAP, por eso se toma la decisión de hacer el ajuste). Las cotizaciones dicen «Precio unitario (IVA incl.)» y su total coincide con `valor_total`; por eso `precio_unitario` del payload es el `valor_unitario` de la solicitud dividido por (1 + la tasa del indicador de IVA), a 2 decimales (95.000 con C1 → 79.831,93). Todos los montos son en COP (RC11) y el IVA de la cotización se contrasta con el indicador (RC12).
2. **Unidad de medida:** `H` si la descripción menciona «horas»; en cualquier otro caso `UN`. `MES` no se infiere porque «12 meses» en una licencia no es una unidad de compra.
3. **Descripción de la posición:** se corta en el límite de palabra a ≤ 40 caracteres (límite SAP) y queda anotado en la traza.
4. **RC3 se evalúa siempre.** Con aprobador válido, contra su tope; sin aprobador válido (RC2), contra el mayor tope del centro, y se reporta solo si ni ese alcanza (sección 5).
5. **RC9 compara la fecha local** del correo (sin conversión a UTC): una aprobación a las 18:45 del mismo día no es «anterior».
6. **NIT del proveedor:** el payload usa el del maestro (sin dígito de verificación), no el de la cotización.
7. **Los maestros están completos y son verdad** (PRD 10). En producción se consultan en SAP en tiempo real; `consultarProveedor` ya se invoca como segunda verificación antes de crear.
8. **«Aprobado» se detecta por texto** (con exclusión de «no aprobado»). No se valida firma digital; el correo es evidencia suficiente (PRD 10).
9. **Una sola sociedad/organización de compras (`1000`)**, constante de configuración.
10. **`buscarOrdenPorReferencia` devuelve solo `numero_oc`**, como el PRD: quien reintenta ya tiene el número de OC, que es lo que necesita, y no hace falta consultar más datos. `fecha` es opcional: si el adaptador la entrega se informa en el reintento; si no, se omite.
11. **Sesiones y confirmaciones en memoria:** un reinicio del servidor las pierde. `out/` se limpia al arrancar (PRD 8), por lo que las OC de la demo no sobreviven a un reinicio. El tope global de tokens también se reinicia.

### 9.1 Ambigüedades del PRD y cómo se trataron

| Ambigüedad | Tratamiento | Para cerrarla hace falta |
|---|---|---|
| El PRD (sección 0) remite a una rúbrica en la sección 10 para los 70/100 puntos de aprobación, pero esa sección trata de riesgos, supuestos y preguntas abiertas; no se recibió la rúbrica de puntaje. | Se cubrieron todas las HU, los criterios de aceptación, los requisitos no funcionales, las 12 secciones de este documento y el bonus. | Pedir la rúbrica a quien evalúa y contrastarla con la cobertura (sección 10). |
| sol-003 incumple RC2 y RC3 a la vez. | **Resuelto por producto: se reportan ambas**, para que la persona no corrija RC2 y falle después por RC3 (supuesto 4). | Confirmar con quien evalúa que el resultado esperado de sol-003 admite RC2 y RC3. |
| RC8 (retroactiva): ¿la factura se compara con la fecha de la solicitud o con la de la OC? | Con `fecha_solicitud`. | Definición de negocio. |
| Qué es una «confirmación»: ¿cualquier mensaje posterior o uno afirmativo? | Solo se verifica que exista un mensaje posterior de la persona; no se lee su contenido (decisión 3). El prompt obliga a preguntar y a no confirmar por su cuenta. | Un clasificador de intención o botones tipados. |
| `confirmado_por` no tiene identidad. | Valor fijo «analista (chat)». | Autenticación real. |
| Topes en USD frente a COP. | **Resuelto por producto: Para este MVP solo se trabajará en COP; otra moneda se bloquea (RC11).** | Regla de cambio, solo si más adelante se admite otra moneda. |
| Precio enviado a SAP: ¿bruto o neto? | **Resuelto por producto: neto** (supuesto 1, RC12). | Confirmar con SAP real el número de decimales y el redondeo del `NetPriceAmount`. |
| Coincidencia de nombre de proveedor sin NIT. | Normaliza tildes, mayúsculas y sufijos societarios; si hay NIT, manda el NIT. | Reglas de homónimos con el maestro real. |
| La cotización trae su propio IVA: ¿se contrasta con el indicador? | **Resuelto por producto: sí** (RC12, confirmación). La `tasa` del maestro se usa también para el precio neto. | Si difieren, qué IVA prevalece; hoy prevalece el indicador de la solicitud tras confirmar. |
| `out/` se limpia al inicio, pero la idempotencia debería ser durable. | Se respeta el PRD; la idempotencia vale dentro de la vida del proceso. | Persistencia real (SAP). |

## 10. Cobertura

| Historia | Estado | Notas |
|---|---|---|
| HU-1 Leer el paquete | **Hecho** | Adjunto ausente → `null` + `faltantes`; JSON malformado o monto no numérico → `{ ok:false, error }` legible. |
| HU-2 Validar | **Hecho** | RC1–RC10 + RC11 (moneda COP) + RC12 (IVA vs indicador); `bloqueos`, `confirmaciones`, `derivados`, `retroactiva`. |
| HU-3 Payload | **Hecho** | Validado con zod; traza por campo en `out/<caso>/trazabilidad.json`. |
| HU-4 Evidencia | **Hecho** (P0 + P1) | `aprobacion.txt` con sha256 y `aprobacion.pdf` (pdf-lib). |
| HU-5 Crear OC | **Hecho** | Números desde 4500000001, `ordenes.jsonl`, idempotencia, `control.csv` con cada intento: también los casos procesados sin crearse (bloqueada, pendiente_confirmacion); se omiten filas repetidas y las posteriores a la creación. |
| HU-6 Errores | **Hecho** | Errores tipados; un caso malo no impide el siguiente. |
| `oc_leer_excel` (P1) | **No hecho** | Opcional; los fixtures traen la solicitud como JSON. |
| Bonus `modulo/` | **Hecho** | `agent.md`, `skill/ordenes-compra/SKILL.md` y `tools/oc.ts` generados desde las fuentes con `npm run build:modulo` (la herramienta se empaqueta con esbuild; `agent.md` y `SKILL.md` son exactamente `prompt.md` y el conocimiento, con su *frontmatter*). |
| Front, API y adaptador LLM | **Hecho** | Chat, aviso de confirmación, historial de llamadas, `/api/health`. Las llamadas a herramientas se ven por defecto (el PRD, CA4, las pide en el historial); un interruptor «Vista técnica» las oculta para una vista de usuario final. Los errores de herramienta siempre se muestran. |
| Link público | **Pendiente de despliegue** | `Dockerfile` y `render.yaml` listos; falta publicarlo y poner la clave (README). |

**Verificado:** `npm run demo` (6 casos con asserts, idempotencia, defensas) y `npm test` (31 pruebas, incluidas 10 de moneda, IVA y precio neto, 3 de RC2/RC3, 2 de rechazo, 1 del log de control, 1 del adaptador SAP mínimo y 1 del arranque con clave obligatoria: adaptador SAP inyectable, concurrencia —dos solicitudes simultáneas generan una sola OC—, seguridad —clave, límite por minuto, IP detrás del proxy— y el ciclo con un proveedor simulado: pregunta antes de crear, auto-confirmación rechazada, idempotencia, bloqueos firmes, error de proveedor, tope de iteraciones, excepciones con valores reales). También se probó la interfaz de punta a punta con un navegador y una API del modelo simulada (clave de acceso, aviso de confirmación, creación). El adaptador de Anthropic se probó contra un servidor local que valida el formato exacto de la petición (herramientas, `tool_result`, caché, y que la clave no viaja en el cuerpo ni en los logs). **No se ha ejecutado una conversación real con el modelo** hasta contar con la clave del despliegue; antes de la defensa conviene correr la demo del PRD (sección 11) en vivo.

**Pendientes por falta de definición** (sección 9.1): ligar la confirmación a las excepciones exactas mostradas (token o hash), normalización avanzada de proveedores y redondeo del precio neto en el SAP real.

**Qué falta para producción:** SAP real (sección 6), autenticación y roles (quién puede confirmar excepciones), persistencia de sesiones, del tope de tokens y de `control.csv`, interpretación del contenido del mensaje de confirmación, lectura de `.xlsx`/PDF reales, observabilidad y pruebas de evaluación con el modelo.

## 11. Uso de IA

- **Asistente usado:** Claude (Anthropic) a través de Claude Code, en una sesión de trabajo continua.
- **Para qué:** (1) diseñar la arquitectura y el contrato de herramientas; (2) escribir el código TypeScript, `demo.ts`, las pruebas con proveedor simulado y el front; (3) redactar prompt, conocimiento y esta documentación; (4) estimar costos con tarifas oficiales y tamaños medidos.
- **Qué se descartó de lo propuesto y por qué:**
  - La confirmación solo con el flag `confirmado`: se reforzó con el contador de mensajes (sección 8, #3).
  - Usar el SDK del proveedor y un framework HTTP: se prefirió `fetch` y `node:http` (decisión #4).
  - También se tomo la decision de no incluir el IVA en SAP, el estándar de SAP es que viaja el valor neto, el IVA se calcula aparte
  - También se tomo la decision con un MVP como en COP, no se dio el manejo de otras monedas.
- **Cómo se verificó lo generado:** ejecución de `demo.ts` contra los fixtures y comparación con los resultados esperables del PRD, pruebas automáticas, `tsc --noEmit` y prueba del adaptador contra una API simulada.

## 12. Riesgos de llevar esto a producción

| Riesgo | Mitigación |
|---|---|
| El modelo inventa o altera un valor. | Las herramientas son la única fuente; releen el caso y rechazan datos distintos; el payload se reconstruye en servidor. |
| Una OC se crea sin confirmación real. | Contador de mensajes del usuario + idempotencia. Siguiente paso: leer la intención del mensaje con un clasificador y exigir rol autorizado. |
| Inyección de prompt desde un correo o cotización. | El prompt trata los documentos como datos; la defensa real es estructural (reglas en código, escritura condicionada). |
| Doble creación por reintentos o concurrencia. | Idempotencia por `solicitud_id` y candado por solicitud (probado con peticiones simultáneas). Solo protege dentro de un proceso: con varias instancias se necesita unicidad en SAP. |
| Abuso del link público / gasto de la clave. | **Capas, de la más eficiente a la menos:** (1) clave de acceso obligatoria en el despliegue, que se entrega solo a quien evalúa: sin ella no se llega al modelo; (2) clave de Anthropic exclusiva de este agente, con alerta y límite de gasto propios, para que un exceso no afecte otros proyectos; (3) topes de la aplicación antes de llamar al modelo (iteraciones, tokens por sesión y globales, `max_tokens` de salida); (4) límite de mensajes por minuto e IP con freno a la fuerza bruta, como defensa secundaria. **Límites conocidos:** los contadores son en memoria y se reinician con el servidor (el plan gratuito de Render lo duerme); una IP compartida puede dar falsos positivos y una IP rotada los esquiva; el límite del proveedor puede medir con retraso. **Para producción:** presupuesto diario persistido (Redis o una base pequeña), claves o enlaces con vencimiento y revocación, cuotas por usuario autenticado, CAPTCHA (p. ej. Cloudflare Turnstile) si el acceso fuera abierto, y caché de respuestas repetidas. No se hicieron aquí porque, con la clave obligatoria, solo quien la tenga puede forzar un reinicio y gastar, y el costo extra de operación no se justifica en un MVP de evaluación. |
| Datos personales en logs. | `log.jsonl` registra argumentos y resúmenes (sin claves ni cabeceras); definir retención y enmascarado antes de usar datos reales. |
| Maestros desactualizados. | Consulta en tiempo real a SAP (`consultarProveedor` ya está en la interfaz). |
| Formatos reales distintos a los fixtures (xlsx, PDF escaneado). | Parsers con validación estricta y degradación a «faltante»/confirmación en lugar de adivinar. |
| Política de retroactivas indefinida. | Medición desde el día uno; el cambio a bloqueo es una línea. |
| El proveedor LLM falla o sube de precio. | Interfaz `ProveedorLlm`; cambio de modelo por variable de entorno; las decisiones de control no dependen del modelo. |

### 12.1 Visión de producción: chat y consola de operación

En producción son dos pantallas sobre el mismo backend. En el reto, el interruptor «Vista técnica» del chat junta ambas porque el PRD (6.1 y CA4) pide ver cada llamada a herramienta en el historial.

| Aspecto | Chat del usuario final | Consola de operación o auditoría |
|---|---|---|
| Quién la usa | Quien procesa las solicitudes de compra. | Equipo dueño del producto: soporte, auditoría, producto. |
| Qué ve | La conversación, el aviso de confirmación y los resultados en lenguaje claro. | Todas las conversaciones de todos los usuarios, con la traza completa. |
| Llamadas a herramientas | Ocultas. | Cada una con nombre, argumentos, resultado, tokens, costo y tiempo. |
| Acceso | Inicia sesión; solo ve sus conversaciones. | Rol de soporte, auditoría o administrador; cada consulta queda registrada. |
| Identidad | Se sabe quién confirmó cada excepción (hoy `confirmado_por` es un valor fijo). | Filtros por usuario, fecha, solicitud, resultado y errores. |
| Métricas | No aplica. | Casos por día, bloqueos por regla RC, retroactivas, costo y errores del modelo. |

**Qué falta en el backend para llegar ahí**

| Necesidad | Hoy | En producción |
|---|---|---|
| Quién es el usuario | Sin autenticación. | Inicio de sesión y roles (usuario, auditor, administrador). |
| Conversaciones | En memoria; se pierden al reiniciar. | Base de datos: una fila por mensaje y por llamada a herramienta. |
| Traza de herramientas | `out/log.jsonl`, que se borra al arrancar. | Almacén persistente y consultable. |
| Log de control | `out/control.csv`. | Tabla con la misma estructura. |
| Consultar conversaciones ajenas | `/api/sessions/:id`, accesible con solo conocer el id. | API de administración con rol de auditor. |
| Costo y tokens | Contadores en memoria. | Registro por sesión y usuario. |
| Observabilidad | Vista técnica dentro del chat. | Herramienta de observabilidad de agentes (Langfuse, LangSmith u OpenTelemetry con un panel) en lugar de una consola propia. |

**Cuidados.** Las trazas contienen proveedores, montos y correos: hay que definir retención, quién las ve y qué se enmascara. El acceso a las conversaciones debe quedar auditado. La traza se escribe en el servidor, de modo que lo que ve el auditor coincide con lo registrado y no con lo que afirme el modelo. El log de control del negocio se mantiene aparte de la observabilidad, porque lo consume contabilidad. El salto desde este reto es pequeño: la traza ya se genera en el servidor, y pasarla a una base de datos o a una herramienta de observabilidad es cambiar dónde se escribe.
