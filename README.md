# Agente conversacional «Órdenes de Compra SAP» — Reto 03

Agente de chat que lee el paquete de una solicitud de compra, lo valida contra los maestros y las reglas RC1–RC10, muestra la OC como quedaría en SAP, genera la evidencia de aprobación y crea la OC en un SAP simulado. Las excepciones se devuelven a quien opera el agente con una recomendación; las que lo permiten requieren su confirmación en el chat.

Documentación completa del planteamiento: [SOLUCION.md](SOLUCION.md).

**Link de prueba:** `<pegar aquí la URL pública del despliegue>`
**Clave de acceso:** no aplica (el link es público; el gasto está acotado por topes, ver variables).

## Levantar en local (un comando)

Requisitos: Node 20.12 o superior (o Bun).

```bash
npm install
cp .env.example .env        # y pega tu clave en ANTHROPIC_API_KEY
npm run dev                 # front + backend en http://localhost:3000
```

Sin clave el servidor arranca igual, pero el chat responderá que falta configurarla. Todo lo demás funciona sin modelo.

## Verificación sin modelo (`demo.ts`)

```bash
npm run demo        # o: bun install && bun run demo.ts
```

Procesa los 6 casos de `fixtures/reto-03/solicitudes/` llamando directamente a las herramientas; imprime por caso `apta`, bloqueos, confirmaciones, `retroactiva`, número de OC o motivo; muestra la idempotencia (sol-001 dos veces) y la confirmación explícita (sol-004). Sale con código 1 si algo no coincide. No necesita clave y `out/` se limpia al inicio.

```bash
npm test            # pruebas del ciclo del agente con un proveedor LLM simulado
npm run typecheck   # tsc --noEmit
```

## Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | **Obligatoria para el chat.** Solo vive en el backend: nunca llega al front, a la API ni a los logs. |
| `LLM_PROVIDER` | `anthropic` | Proveedor (hoy solo `anthropic`). |
| `LLM_MODEL` | `claude-sonnet-5-5` | Modelo. `claude-haiku-5-5` es la opción barata. |
| `PORT` | `3000` | Puerto HTTP. |
| `MAX_ITERACIONES` | `25` | Tope de llamadas modelo↔herramientas por turno. |
| `MAX_TOKENS_SESION` | `200000` | Tope de tokens por sesión. |
| `MAX_TOKENS_GLOBAL` | `2000000` | Tope de tokens del proceso (protege tu clave en un link público). |
| `LLM_TIMEOUT_MS` | `60000` | Timeout hacia el proveedor. |

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation, pendientes[], tokensSesion }` |
| `GET` | `/api/sessions/:id` | Historial completo de la sesión (mensajes y llamadas a herramientas). |
| `GET` | `/api/health` | `{ ok, provider, model, configurado }`, sin exponer claves. |
| `GET` | `/api/casos` | Casos disponibles. |
| `GET` | `/api/control` | Filas de `out/control.csv`. |

## Prueba rápida de la demo del PRD

En una sesión nueva:

```
Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP, qué
validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.
```

Resultado esperado: payload en tabla, la confirmación RC5 con ambos valores ($25.000.000 vs $26.500.000), llamadas a herramientas visibles y una pregunta que cierra el turno. Tras «Confirmo», número de OC y ruta de la evidencia.

## Estructura

```
agent/prompt.md              comportamiento del agente
src/knowledge/               conocimiento del proceso
src/tools/oc.ts              herramientas oc_* (zod; devuelven JSON; nunca lanzan)
src/domain/                  reglas RC1–RC10, payload, evidencia, confirmación, control
src/sap/                     SapAdapter (interfaz) y mock sobre archivos
src/llm/                     ProveedorLlm (interfaz) y adaptador de Anthropic
src/agent/ciclo.ts           ciclo del agente
src/server.ts · web/         API HTTP y front de chat
fixtures/reto-03/            entregados por Periferia (no modificar)
out/                         generado en ejecución: sap/, control.csv, log.jsonl, <caso>/
modulo/                      bonus: agente reutilizable (se regenera con npm run build:modulo)
demo.ts · test/              verificación sin modelo y pruebas
```

## Bonus: módulo reutilizable

`modulo/` contiene `agent.md`, `skill/ordenes-compra/SKILL.md` y `tools/oc.ts`, **generados** desde `agent/prompt.md`, `src/knowledge/ordenes-compra.md` y `src/tools/oc.ts`. Para regenerarlos tras un cambio: `npm run build:modulo`.

## Despliegue (Render)

El repositorio trae `Dockerfile` y `render.yaml`.

1. Sube el repositorio a GitHub.
2. En Render: **New → Blueprint** y elige el repositorio.
3. Pega `ANTHROPIC_API_KEY` en las variables de entorno del servicio.
4. Render entrega la URL pública (chequeo de salud en `/api/health`). Pégala arriba en «Link de prueba».

Notas: el plan gratuito duerme el servicio tras un rato sin uso; ábrelo unos minutos antes de la defensa. Las sesiones y las OC viven en memoria/`out/` y se pierden al reiniciar.

## Seguridad

- La clave del modelo solo se lee de la variable de entorno del backend. `.env` está en `.gitignore`.
- Las herramientas no ejecutan comandos de shell y los nombres de caso se validan (`^[\w-]+$`).
- No hay credenciales ni datos personales reales: los fixtures son ficticios.
