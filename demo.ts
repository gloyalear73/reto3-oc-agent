/**
 * Script de verificación determinista: procesa los casos llamando directamente a las
 * herramientas, SIN modelo de lenguaje. Uso: `npx tsx demo.ts` o `bun demo.ts`.
 * Sale con código 1 si algún caso no coincide con el resultado esperado.
 */
import { crearContexto, ejecutarHerramienta } from "./src/tools/oc.ts";
import { listarCasos } from "./src/data/loader.ts";
import type { Evaluacion } from "./src/types.ts";

// Resultados esperados para los fixtures de EJEMPLO. Ajustar al recibir los fixtures reales.
const ESPERADO: Record<string, { decision: string; fallan: string[] }> = {
  "sol-001": { decision: "CREAR", fallan: [] },
  "sol-002": { decision: "RECHAZAR", fallan: ["C02"] },
  "sol-003": { decision: "ESCALAR", fallan: ["C07"] },
  "sol-004": { decision: "RECHAZAR", fallan: ["C06"] },
  "sol-005": { decision: "ESCALAR", fallan: ["C12"] },
  "sol-006": { decision: "RECHAZAR", fallan: ["C03", "C11"] },
};

const verde = (s: string) => `\x1b[32m${s}\x1b[0m`;
const rojo = (s: string) => `\x1b[31m${s}\x1b[0m`;
const amarillo = (s: string) => `\x1b[33m${s}\x1b[0m`;
const color = (d: string) => (d === "CREAR" ? verde : d === "ESCALAR" ? amarillo : rojo)(d);

const ctx = crearContexto();
let errores = 0;

console.log("== Demo determinista del agente de órdenes de compra (sin LLM) ==\n");

for (const id of listarCasos()) {
  const ev = (await ejecutarHerramienta("validar_solicitud", { solicitudId: id }, ctx)) as Evaluacion;
  console.log(`▶ ${id}  →  ${color(ev.decision)}   ${ev.resumen}`);
  for (const h of ev.hallazgos.filter((x) => !x.ok)) {
    console.log(`    ✗ ${h.control} ${h.nombre} [${h.severidad}]: ${h.detalle}`);
  }

  // Verificación contra lo esperado
  const esp = ESPERADO[id];
  if (esp) {
    const fallan = ev.hallazgos.filter((h) => !h.ok).map((h) => h.control);
    const ok = ev.decision === esp.decision && JSON.stringify(fallan) === JSON.stringify(esp.fallan);
    if (!ok) {
      errores++;
      console.log(rojo(`    ⚠ Esperado ${esp.decision} [${esp.fallan}] pero se obtuvo ${ev.decision} [${fallan}]`));
    }
  }

  // Flujo de OC: la herramienta nunca escribe; solo pide confirmación humana.
  const r = (await ejecutarHerramienta("crear_oc", { solicitudId: id }, ctx)) as any;
  console.log(`    crear_oc → ${r.estado}`);

  if (r.estado === "REQUIERE_CONFIRMACION") {
    // Se simula a la persona aprobando (en el chat es un botón).
    const just = ev.decision === "ESCALAR" ? "Aprobado por Compras: compra urgente ya ejecutada, se regulariza." : "";
    const res = await ctx.confirmaciones.resolver(r.token, true, "demo-usuario", just);
    console.log(`    confirmación humana → ${res.mensaje}`);
  }
  console.log();
}

// Idempotencia: reintentar una solicitud ya creada debe bloquearse (C13).
const reintento = (await ejecutarHerramienta("validar_solicitud", { solicitudId: "sol-001" }, ctx)) as Evaluacion;
const dup = reintento.hallazgos.find((h) => h.control === "C13");
console.log(`Idempotencia (sol-001 reprocesada) → ${reintento.decision}, C13 ok=${dup?.ok}`);
if (reintento.decision !== "RECHAZAR" || dup?.ok !== false) {
  errores++;
  console.log(rojo("    ⚠ Se esperaba RECHAZAR por duplicado"));
}

// Un modelo no puede saltarse el control humano: sin resolver(), SAP queda intacto.
const ctx2 = crearContexto();
await ejecutarHerramienta("crear_oc", { solicitudId: "sol-001" }, ctx2);
const sinAprobar = await ctx2.sap.listar();
console.log(`Sin aprobación humana, OCs en SAP → ${sinAprobar.length} (esperado 0)`);
if (sinAprobar.length !== 0) errores++;

console.log("\nOCs creadas en el SAP simulado:");
for (const oc of await ctx.sap.listar()) {
  console.log(
    `  OC ${oc.numero} · ${oc.solicitudId} · ${oc.proveedorNombre} · $${oc.total.toLocaleString("es-CO")} · ` +
      `confirmada por ${oc.confirmadaPor}${oc.retroactiva ? " · RETROACTIVA" : ""}`,
  );
}

console.log(errores === 0 ? verde("\n✔ Todos los casos coinciden con lo esperado") : rojo(`\n✘ ${errores} verificación(es) fallida(s)`));
process.exit(errores === 0 ? 0 : 1);
