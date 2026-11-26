import { z } from "zod/v4";
import { registrarLog } from "../domain/salida.ts";
import * as oc from "./oc.ts";
import { fail, type ContextoHerramienta } from "./tipos.ts";

interface HerramientaRegistrada {
  nombre: string;
  description: string;
  esquema: z.ZodObject<z.ZodRawShape>;
  execute(args: unknown, ctx: ContextoHerramienta): Promise<string>;
}

const ARCHIVO = "oc";

/** Cada export de src/tools/oc.ts se registra como `<archivo>_<export>`. */
export const HERRAMIENTAS: HerramientaRegistrada[] = Object.entries(oc).map(([nombre, h]) => ({
  nombre: `${ARCHIVO}_${nombre}`,
  description: h.description,
  esquema: z.object(h.args as z.ZodRawShape),
  execute: h.execute as unknown as HerramientaRegistrada["execute"],
}));

/** Definiciones neutrales para el adaptador LLM (JSON Schema). */
export function definicionesParaModelo() {
  return HERRAMIENTAS.map((h) => {
    const { $schema: _s, ...esquema } = z.toJSONSchema(h.esquema) as Record<string, unknown>;
    return { nombre: h.nombre, descripcion: h.description, esquema };
  });
}

/** Resumen corto del resultado para mostrar en el chat y el log. */
export function resumir(nombre: string, resultado: string): string {
  let r: { ok?: boolean; error?: string; data?: Record<string, unknown> } & Record<string, unknown>;
  try {
    r = JSON.parse(resultado);
  } catch {
    return resultado.slice(0, 160);
  }
  if (r.ok === false) {
    const extra = Array.isArray(r.bloqueos) ? ` · bloqueos: ${r.bloqueos.map((b: { codigo: string }) => b.codigo).join(", ")}` : "";
    return `ERROR: ${r.error ?? "desconocido"}${extra}`;
  }
  const d = r.data ?? {};
  const cods = (x: unknown) => (Array.isArray(x) ? x.map((h: { codigo: string }) => h.codigo).join(", ") || "—" : "—");
  switch (nombre) {
    case "oc_leer_paquete": {
      const f = d.faltantes as string[] | undefined;
      const sol = d.solicitud as { solicitud_id?: string } | undefined;
      return `Paquete de ${sol?.solicitud_id ?? "?"} leído${f?.length ? ` · faltan: ${f.join(", ")}` : ""}`;
    }
    case "oc_validar":
      return `apta=${d.apta} · bloqueos: ${cods(d.bloqueos)} · confirmaciones: ${cods(d.confirmaciones)} · retroactiva=${d.retroactiva}`;
    case "oc_generar_evidencia":
      return `${d.ruta} · sha256 ${String(d.sha256).slice(0, 12)}…`;
    case "oc_construir_payload":
      return `Payload listo · confirmaciones: ${cods(d.confirmaciones)} · traza ${d.trazabilidad}`;
    case "oc_crear":
      return `OC ${d.numero_oc}${d.idempotente ? " (ya existía: idempotente)" : " creada"}`;
    default:
      return resultado.slice(0, 160);
  }
}

/** Punto único de ejecución: valida args con zod, ejecuta, registra en out/log.jsonl y nunca lanza. */
export async function ejecutarHerramienta(nombre: string, args: unknown, ctx: ContextoHerramienta): Promise<string> {
  const h = HERRAMIENTAS.find((x) => x.nombre === nombre);
  let resultado: string;
  if (!h) {
    resultado = fail(`Herramienta desconocida: ${nombre}. Disponibles: ${HERRAMIENTAS.map((x) => x.nombre).join(", ")}.`);
  } else {
    const parsed = h.esquema.safeParse(args ?? {});
    resultado = parsed.success
      ? await h.execute(parsed.data, ctx).catch((e: Error) => fail(`Error inesperado: ${e.message}`))
      : fail(`Argumentos inválidos para ${nombre}:\n${z.prettifyError(parsed.error)}`);
  }
  try {
    registrarLog(ctx.directory, {
      sessionId: ctx.sessionId,
      herramienta: nombre,
      args,
      resumen: resumir(nombre, resultado),
    });
  } catch {
    /* el log no debe romper la herramienta */
  }
  return resultado;
}
