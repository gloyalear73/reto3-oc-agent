/**
 * Bonus (PRD 9.4): genera `modulo/` A PARTIR de las mismas piezas que usa la aplicación, de modo que
 * no existen copias divergentes. Si cambias el prompt, el conocimiento o las herramientas: `npm run build:modulo`.
 *
 *   modulo/agent.md                       ← agent/prompt.md (+ frontmatter)
 *   modulo/skill/ordenes-compra/SKILL.md  ← src/knowledge/ordenes-compra.md (+ frontmatter)
 *   modulo/tools/oc.ts                    ← src/tools/oc.ts empaquetado con sus dependencias internas
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RAIZ } from "../src/config.ts";

const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8").trim();
const escribir = (ruta: string, contenido: string) => {
  const destino = join(RAIZ, ruta);
  mkdirSync(join(destino, ".."), { recursive: true });
  writeFileSync(destino, contenido.endsWith("\n") ? contenido : `${contenido}\n`);
  console.log(`  ✓ ${ruta}`);
};

const agent = `---
description: Agente de órdenes de compra. Lee el paquete de una solicitud, lo valida contra maestros y reglas de control (RC1–RC10), muestra la OC como quedaría en SAP y la crea con confirmación humana cuando hay excepciones.
mode: primary
permission:
  edit: deny
  bash: deny
---

${leer("agent/prompt.md")}
`;

const skill = `---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra de Periferia: reglas de control RC1–RC10, qué es un bloqueo, una confirmación y un derivado, cómo tratar compras retroactivas, evidencia, trazabilidad e idempotencia. Úsalo al procesar o explicar solicitudes de compra.
---

${leer("src/knowledge/ordenes-compra.md")}
`;

console.log("Generando modulo/ desde las fuentes de la aplicación…");
escribir("modulo/agent.md", agent);
escribir("modulo/skill/ordenes-compra/SKILL.md", skill);

try {
  const { build } = await import("esbuild");
  const resultado = await build({
    entryPoints: [join(RAIZ, "src/tools/oc.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node20",
    external: ["zod", "zod/v4", "pdf-lib"],
    logLevel: "silent",
  });
  const codigo = resultado.outputFiles[0]?.text ?? "";
  escribir(
    "modulo/tools/oc.ts",
    `// @ts-nocheck\n// GENERADO por scripts/build-modulo.ts desde src/tools/oc.ts: no editar a mano.\n// Herramientas oc_* (leer_paquete, validar, generar_evidencia, construir_payload, crear), sin servidor.\n// Requiere: zod, pdf-lib. Uso: oc.validar.execute({ caso }, { directory, sessionId }) → string JSON.\n${codigo}`,
  );
} catch (e) {
  // Alternativa: re-exportar. Sigue siendo el mismo código, pero exige el repositorio completo.
  console.log(`  ! esbuild no disponible (${(e as Error).message}); se re-exportan las herramientas.`);
  escribir("modulo/tools/oc.ts", `// Mismas herramientas que usa la aplicación (sin copia divergente).\nexport * from "../../src/tools/oc.ts";`);
}
