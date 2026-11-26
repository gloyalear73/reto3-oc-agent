import { z } from "zod/v4";
import { evaluarCaso, MATRIZ_CONTROLES } from "../controls.ts";
import { ConfirmationStore } from "../confirmations.ts";
import { cargarCaso, cargarMaestros, listarCasos } from "../data/loader.ts";
import { normalizarNit } from "../data/parsing.ts";
import { MockSapAdapter } from "../sap/mock.ts";
import type { SapAdapter } from "../sap/adapter.ts";
import type { Maestros } from "../types.ts";

export interface Contexto {
  maestros: Maestros;
  sap: SapAdapter;
  confirmaciones: ConfirmationStore;
}

export function crearContexto(sap: SapAdapter = new MockSapAdapter()): Contexto {
  return { maestros: cargarMaestros(), sap, confirmaciones: new ConfirmationStore(sap) };
}

export interface Herramienta<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  /** true si la herramienta pide una decisión humana (la UI la resalta). */
  requiereConfirmacion?: boolean;
  execute: (args: z.infer<S>, ctx: Contexto) => Promise<unknown>;
}

const solicitudId = z.string().regex(/^[\w-]+$/).describe("Identificador de la solicitud, p. ej. sol-001");

async function solicitudesConOC(ctx: Contexto) {
  return new Set((await ctx.sap.listar()).map((o) => o.solicitudId));
}

const listarSolicitudes: Herramienta = {
  name: "listar_solicitudes",
  description: "Lista los identificadores de solicitudes de compra disponibles en el buzón.",
  schema: z.object({}),
  execute: async () => ({ solicitudes: listarCasos() }),
};

const leerSolicitud: Herramienta<z.ZodObject<{ solicitudId: typeof solicitudId }>> = {
  name: "leer_solicitud",
  description:
    "Lee TODOS los documentos de una solicitud: correo, solicitud, cotización (ya parseada), aprobación y factura si existe.",
  schema: z.object({ solicitudId }),
  execute: async ({ solicitudId }) => cargarCaso(solicitudId),
};

const consultarProveedor: Herramienta<z.ZodObject<{ nit: z.ZodString }>> = {
  name: "consultar_proveedor",
  description: "Busca un proveedor en el maestro por NIT (acepta puntos y dígito de verificación).",
  schema: z.object({ nit: z.string().min(5).describe("NIT del proveedor") }),
  execute: async ({ nit }, ctx) => {
    const p = ctx.maestros.proveedores.find((x) => normalizarNit(x.nit) === normalizarNit(nit));
    return p ?? { encontrado: false, mensaje: `NIT ${nit} no existe en el maestro de proveedores` };
  },
};

const consultarCentroCosto: Herramienta<z.ZodObject<{ codigo: z.ZodString }>> = {
  name: "consultar_centro_costo",
  description: "Devuelve un centro de costo con sus subáreas, su líder y el tope de aprobación del líder.",
  schema: z.object({ codigo: z.string().describe("Código del centro de costo, p. ej. CC100") }),
  execute: async ({ codigo }, ctx) =>
    ctx.maestros.centrosCosto.find((c) => c.codigo === codigo) ?? { encontrado: false, mensaje: `Centro ${codigo} no existe` },
};

const validarSolicitud: Herramienta<z.ZodObject<{ solicitudId: typeof solicitudId }>> = {
  name: "validar_solicitud",
  description:
    "Ejecuta la matriz de controles C01-C13 sobre una solicitud y devuelve la decisión determinista: CREAR, ESCALAR o RECHAZAR, con el detalle de cada control. Debe llamarse antes de proponer una OC.",
  schema: z.object({ solicitudId }),
  execute: async ({ solicitudId }, ctx) => {
    const caso = cargarCaso(solicitudId);
    return evaluarCaso(caso, ctx.maestros, await solicitudesConOC(ctx));
  },
};

const crearOC: Herramienta<z.ZodObject<{ solicitudId: typeof solicitudId; motivo: z.ZodOptional<z.ZodString> }>> = {
  name: "crear_oc",
  description:
    "Propone la creación de la orden de compra en SAP. NO escribe en SAP: genera una solicitud de confirmación humana que una persona debe aprobar en la interfaz. Solo aplica si la decisión es CREAR o ESCALAR; con RECHAZAR se rehúsa.",
  schema: z.object({
    solicitudId,
    motivo: z.string().optional().describe("Resumen para el aprobador humano (obligatorio al escalar)"),
  }),
  requiereConfirmacion: true,
  execute: async ({ solicitudId, motivo }, ctx) => {
    const caso = cargarCaso(solicitudId);
    const ev = evaluarCaso(caso, ctx.maestros, await solicitudesConOC(ctx));
    if (ev.decision === "RECHAZAR" || !ev.datosOC) {
      return { estado: "RECHAZADA", mensaje: "No se puede crear la OC: hay controles bloqueantes.", evaluacion: ev };
    }
    const pendiente = ctx.confirmaciones.solicitar(solicitudId, ev.decision, ev.datosOC, motivo ?? ev.resumen);
    return {
      estado: "REQUIERE_CONFIRMACION",
      token: pendiente.token,
      decision: ev.decision,
      mensaje:
        ev.decision === "ESCALAR"
          ? "Escalamiento: una persona debe autorizar con justificación antes de crear la OC."
          : "Confirmación humana requerida antes de escribir en SAP.",
      resumen: ev.resumen,
      datosOC: ev.datosOC,
    };
  },
};

const consultarOC: Herramienta<z.ZodObject<{ solicitudId: typeof solicitudId }>> = {
  name: "consultar_oc",
  description: "Consulta si ya existe una OC creada en SAP para una solicitud.",
  schema: z.object({ solicitudId }),
  execute: async ({ solicitudId }, ctx) =>
    (await ctx.sap.buscarPorSolicitud(solicitudId)) ?? { existe: false, mensaje: `No hay OC para ${solicitudId}` },
};

export const HERRAMIENTAS: Herramienta<any>[] = [
  listarSolicitudes,
  leerSolicitud,
  consultarProveedor,
  consultarCentroCosto,
  validarSolicitud,
  crearOC,
  consultarOC,
];

export { MATRIZ_CONTROLES };

/** Punto único de ejecución: valida con zod antes de llamar a la herramienta. */
export async function ejecutarHerramienta(nombre: string, entrada: unknown, ctx: Contexto) {
  const h = HERRAMIENTAS.find((t) => t.name === nombre);
  if (!h) return { error: `Herramienta desconocida: ${nombre}` };
  const parsed = h.schema.safeParse(entrada ?? {});
  if (!parsed.success) return { error: "Argumentos inválidos", detalle: z.prettifyError(parsed.error) };
  try {
    return await h.execute(parsed.data, ctx);
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Definiciones en el formato `tools` de la API de Anthropic. */
export function definicionesParaModelo() {
  return HERRAMIENTAS.map((h) => {
    const { $schema, ...input_schema } = z.toJSONSchema(h.schema) as Record<string, unknown>;
    return { name: h.name, description: h.description, input_schema };
  });
}
