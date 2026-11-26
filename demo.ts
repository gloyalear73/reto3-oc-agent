/**
 * Verificación sin modelo (PRD 6.6): procesa los 6 casos llamando directamente a las herramientas.
 *   npm install && npm run demo      (o: bun install && bun run demo.ts)
 * Sale con código 1 si algún caso no da el resultado esperado.
 */
import { RAIZ } from "./src/config.ts";
import { registrarMensajeUsuario } from "./src/domain/confirmaciones.ts";
import { reiniciarSalida } from "./src/domain/salida.ts";
import { listarCasos } from "./src/domain/paquete.ts";
import { ejecutarHerramienta } from "./src/tools/index.ts";

interface Hallazgo {
  codigo: string;
}
interface Respuesta {
  ok: boolean;
  error?: string;
  data?: Record<string, unknown>;
  [clave: string]: unknown;
}

const ctx = { directory: RAIZ, sessionId: "demo" };
const llamar = async (herramienta: string, args: Record<string, unknown>): Promise<Respuesta> =>
  JSON.parse(await ejecutarHerramienta(herramienta, args, ctx)) as Respuesta;
const codigos = (xs: unknown): string[] => (Array.isArray(xs) ? (xs as Hallazgo[]).map((x) => x.codigo) : []);

// Resultado esperado de cada caso según las reglas RC1–RC10 del PRD (RC11 y RC12 no se disparan en los fixtures oficiales).
const ESPERADO: Record<string, { apta: boolean; bloqueos: string[]; confirmaciones: string[]; retroactiva: boolean }> = {
  "sol-001": { apta: true, bloqueos: [], confirmaciones: [], retroactiva: false },
  "sol-002": { apta: false, bloqueos: ["RC1"], confirmaciones: [], retroactiva: false },
  "sol-003": { apta: false, bloqueos: ["RC2"], confirmaciones: [], retroactiva: false },
  "sol-004": { apta: true, bloqueos: [], confirmaciones: ["RC5"], retroactiva: false },
  "sol-005": { apta: true, bloqueos: [], confirmaciones: ["RC8"], retroactiva: true },
  "sol-006": { apta: true, bloqueos: [], confirmaciones: ["RC6"], retroactiva: false },
};
// Casos que el demo confirma de forma explícita. sol-006 queda pendiente a propósito, para mostrar ese estado.
const CONFIRMAR = new Set(["sol-004", "sol-005"]);

let errores = 0;
const verifica = (cond: boolean, mensaje: string) => {
  if (!cond) {
    errores++;
    console.log(`   ✘ ${mensaje}`);
  }
};

reiniciarSalida(RAIZ);
console.log("== Demo de herramientas oc_* (sin modelo de lenguaje) ==\n");

for (const caso of listarCasos(RAIZ)) {
  const paquete = await llamar("oc_leer_paquete", { caso });
  const idSolicitud = (paquete.data?.solicitud as { solicitud_id?: string } | undefined)?.solicitud_id ?? "?";
  const v = await llamar("oc_validar", { caso });
  const d = v.data as { apta: boolean; bloqueos: Hallazgo[]; confirmaciones: Hallazgo[]; retroactiva: boolean; derivados: object };

  console.log(`▶ ${caso}  (${idSolicitud})`);
  console.log(`   apta: ${d.apta}   retroactiva: ${d.retroactiva}`);
  for (const b of d.bloqueos as Array<Hallazgo & { detalle: string; accion_sugerida: string }>) {
    console.log(`   ✗ BLOQUEO ${b.codigo}: ${b.detalle}\n       → ${b.accion_sugerida}`);
  }
  for (const c of d.confirmaciones as Array<Hallazgo & { detalle: string }>) {
    console.log(`   ? CONFIRMACIÓN ${c.codigo}: ${c.detalle}`);
  }
  if (Object.keys(d.derivados).length) console.log(`   derivados: ${JSON.stringify(d.derivados)}`);

  const esp = ESPERADO[caso];
  if (esp) {
    verifica(d.apta === esp.apta, `apta esperada ${esp.apta}`);
    verifica(JSON.stringify(codigos(d.bloqueos)) === JSON.stringify(esp.bloqueos), `bloqueos esperados [${esp.bloqueos}]`);
    verifica(
      JSON.stringify(codigos(d.confirmaciones)) === JSON.stringify(esp.confirmaciones),
      `confirmaciones esperadas [${esp.confirmaciones}]`,
    );
    verifica(d.retroactiva === esp.retroactiva, `retroactiva esperada ${esp.retroactiva}`);
  }

  if (!d.apta) {
    const r = await llamar("oc_crear", { caso });
    console.log(`   → oc_crear rechazado: ${r.error}\n`);
    verifica(r.ok === false, "una solicitud bloqueada no debe crear OC");
    continue;
  }

  const payload = await llamar("oc_construir_payload", { caso });
  verifica(payload.ok === true, "el payload debe construirse");
  console.log(`   payload: ${payload.data?.trazabilidad}   evidencia: ${(payload.data?.evidencia as { ruta?: string })?.ruta}`);

  if (d.confirmaciones.length === 0) {
    const r = await llamar("oc_crear", { caso });
    console.log(`   → OC ${r.data?.numero_oc} creada sin intervención humana\n`);
    verifica(r.ok === true, "el caso limpio debe crear la OC");
    continue;
  }

  // Con excepciones: primero sin confirmar (queda pendiente)...
  const sinConfirmar = await llamar("oc_crear", { caso });
  console.log(`   → oc_crear sin confirmar: ${sinConfirmar.error}`);
  verifica(sinConfirmar.ok === false, "debe exigir confirmación");

  if (!CONFIRMAR.has(caso)) {
    console.log("   → queda PENDIENTE de confirmación (no se crea)\n");
    continue;
  }
  // ...un "confirmado = true" sin mensaje nuevo del usuario no debe valer.
  const falso = await llamar("oc_crear", { caso, confirmado: true });
  verifica(falso.ok === false, "confirmado = true sin mensaje posterior del usuario debe rechazarse");
  console.log("   → confirmado = true sin respuesta del usuario: RECHAZADO (no hay confirmación verificable)");

  registrarMensajeUsuario(ctx.sessionId); // simula que el usuario escribe "confirmo"
  const creada = await llamar("oc_crear", { caso, confirmado: true });
  console.log(`   → usuario confirma → OC ${creada.data?.numero_oc} creada\n`);
  verifica(creada.ok === true, "con confirmación real debe crear la OC");
}

console.log("== Idempotencia: sol-001 por segunda vez ==");
const otra = await llamar("oc_crear", { caso: "sol-001" });
console.log(`   número: ${otra.data?.numero_oc}   idempotente: ${otra.data?.idempotente}\n`);
verifica(otra.data?.idempotente === true && otra.data?.numero_oc === "4500000001", "debe devolver la OC existente");

console.log("== Defensa: un modelo que altera el payload de sol-006 (pendiente) aun con confirmación ==");
registrarMensajeUsuario(ctx.sessionId); // el usuario sí confirmó, pero el payload enviado no es el validado
const alterado = await llamar("oc_crear", { caso: "sol-006", confirmado: true, payload: { posiciones: [{ precio_unitario: 1 }] } });
console.log(`   ${alterado.error}\n`);
verifica(alterado.ok === false && String(alterado.error).includes("no coincide"), "un payload alterado debe rechazarse");

console.log("== out/control.csv ==");
const { readFileSync } = await import("node:fs");
console.log(readFileSync(`${RAIZ}/out/control.csv`, "utf8"));
console.log("== out/sap/ordenes.jsonl ==");
for (const l of readFileSync(`${RAIZ}/out/sap/ordenes.jsonl`, "utf8").split("\n").filter(Boolean)) {
  const o = JSON.parse(l) as { numero_oc: string; orden: { referencia: { solicitud_id: string }; proveedor: { nombre: string }; excepciones: Array<{ codigo: string }> } };
  console.log(`   OC ${o.numero_oc} · ${o.orden.referencia.solicitud_id} · ${o.orden.proveedor.nombre} · excepciones: ${o.orden.excepciones.map((e) => e.codigo).join(",") || "—"}`);
}

console.log(errores === 0 ? "\n✔ Los 6 casos coinciden con lo esperado" : `\n✘ ${errores} verificación(es) fallida(s)`);
process.exit(errores === 0 ? 0 : 1);
