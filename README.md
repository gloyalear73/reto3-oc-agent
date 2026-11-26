# Agente de órdenes de compra (Reto 3)

Agente conversacional en TypeScript que lee solicitudes de compra, aplica una matriz de controles y prepara la
OC en un SAP simulado. **La escritura en SAP siempre requiere confirmación humana.**

## Uso rápido

```bash
npm install            # zod, tsx, typescript
npm run demo           # verificación determinista de los casos, SIN modelo de lenguaje
npm start              # chat en http://localhost:3000
```

Variables de entorno (solo para el chat con LLM):

| Variable | Descripción |
|---|---|
| `ANTHROPIC_API_KEY` | Clave de la API. Sin ella el panel «Evaluar sin LLM» sigue funcionando. |
| `ANTHROPIC_MODEL` | Modelo a usar (por defecto `claude-sonnet-5-5`). |
| `PORT` | Puerto HTTP (por defecto 3000). |
| `FIXTURES_DIR` | Ruta de los fixtures (por defecto `fixtures/reto-03`). |

## Reemplazar los fixtures de ejemplo por los oficiales

1. Copiar `maestros/` y `solicitudes/` oficiales sobre `fixtures/reto-03/`.
2. Ejecutar `npm run demo` y revisar diferencias.
3. Ajustar `src/types.ts`, `src/data/loader.ts`, `src/data/parsing.ts` y `src/controls.ts` a la forma real de los datos y a las reglas del PRD.
4. Actualizar `ESPERADO` en `demo.ts`.

Documentación completa en [SOLUCION.md](SOLUCION.md).

## Despliegue

El repo incluye `Dockerfile` y `render.yaml`.

1. Sube el repositorio a GitHub.
2. En Render: **New → Blueprint** y selecciona el repo (toma `render.yaml`).
3. Pega `ANTHROPIC_API_KEY` en las variables de entorno del servicio.
4. Render entrega la URL pública. El chequeo de salud usa `/api/estado`.

Notas: el plan gratuito de Render duerme el servicio tras inactividad (abre la URL unos minutos antes de la defensa técnica)
y el estado de sesiones y OC vive en memoria, por lo que se pierde al reiniciar.
