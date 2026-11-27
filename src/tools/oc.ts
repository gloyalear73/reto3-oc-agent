// Cada export es una herramienta; el modelo la ve como `oc_<export>` (<archivo>_<export>).
// Aquí solo viven herramientas: la lógica de negocio está en src/domain/ y src/sap/.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import {
  confirmacionVerificable,
  consumirPendiente,
  marcarPendiente,
} from "../domain/confirmaciones.ts";
import { conCandado } from "../domain/candado.ts";
import { generarEvidencia } from "../domain/evidencia.ts";
import { resolverCaso, validarCaso } from "../domain/flujo.ts";
import { construirPayload } from "../domain/payload.ts";
import { registrarControl, type ResultadoControl } from "../domain/salida.ts";
import { canonico } from "../domain/util.ts";
import { MockSapAdapter } from "../sap/mock.ts";
import { definir, fail, ok, seguro } from "./tipos.ts";

const caso = z.string().describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, p. ej. sol-001");

const paqueteOpcional = z
  .record(z.string(), z.unknown())
  .optional()
  .describe(
    "OPCIONAL: omítelo. La herramienta lee el paquete directamente del caso. Si lo envías debe ser idéntico al de oc_leer_paquete.",
  );

export const leer_paquete = definir({
  description:
    "Lee y normaliza el paquete de una solicitud (correo, solicitud, cotización, aprobación y factura si existe). Un adjunto ausente se informa en `faltantes`.",
  args: { caso },
  async execute({ caso }, ctx) {
    return seguro(() => {
      const r = resolverCaso(ctx.directory, caso);
      return r.ok ? ok({ ...r.data.paquete, faltantes: r.data.faltantes }) : fail(r.error);
    });
  },
});

export const validar = definir({
  description:
    "Aplica las reglas de control RC1–RC12 al caso y devuelve { apta, bloqueos[], confirmaciones[], derivados, retroactiva }. Los bloqueos impiden crear la OC.",
  args: { caso, paquete: paqueteOpcional },
  async execute({ caso, paquete }, ctx) {
    return seguro(() => {
      const r = validarCaso(ctx.directory, caso, paquete);
      if (!r.ok) return fail(r.error);
      // Las excepciones ya se las va a mostrar el agente al usuario: desde aquí un "confirmo" posterior es verificable.
      const { apta, confirmaciones, bloqueos, retroactiva } = r.data.validacion;
      if (apta && confirmaciones.length > 0) marcarPendiente(ctx.sessionId, caso, confirmaciones);
      // Procesar un caso sin llegar a crearlo también es un intento: queda en el log de control.
      const id = r.data.paquete.solicitud.solicitud_id;
      if (!apta) {
        registrarControl(ctx.directory, { solicitud_id: id, resultado: "bloqueada", numero_oc: null, retroactiva, bloqueos: bloqueos.map((b) => b.codigo), confirmaciones: [] });
      } else if (confirmaciones.length > 0) {
        registrarControl(ctx.directory, { solicitud_id: id, resultado: "pendiente_confirmacion", numero_oc: null, retroactiva, bloqueos: [], confirmaciones: confirmaciones.map((c) => c.codigo) });
      }
      return ok(r.data.validacion);
    });
  },
});

export const generar_evidencia = definir({
  description:
    "Genera la evidencia de aprobación del caso (out/<caso>/aprobacion.txt y .pdf) y devuelve su ruta y sha256.",
  args: { caso },
  async execute({ caso }, ctx) {
    return seguro(async () => {
      const r = resolverCaso(ctx.directory, caso);
      if (!r.ok) return fail(r.error);
      if (!r.data.paquete.aprobacion) return fail("No hay correo de aprobación para generar la evidencia.");
      return ok(await generarEvidencia(ctx.directory, caso, r.data.paquete.aprobacion));
    });
  },
});

export const construir_payload = definir({
  description:
    "Construye la OC tal como quedaría en SAP (esquema validado con zod), genera la evidencia y guarda la trazabilidad de cada valor. Falla si hay bloqueos.",
  args: {
    caso,
    paquete: paqueteOpcional,
    derivados: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("OPCIONAL: omítelo. Los derivados se calculan en oc_validar y la herramienta los reutiliza."),
  },
  async execute({ caso, paquete, derivados }, ctx) {
    return seguro(async () => {
      const r = validarCaso(ctx.directory, caso, paquete);
      if (!r.ok) return fail(r.error);
      const { paquete: p, maestros, validacion } = r.data;
      if (derivados !== undefined && canonico(derivados) !== canonico(validacion.derivados)) {
        return fail("Los derivados enviados no coinciden con los calculados. Omite el argumento `derivados`.");
      }
      if (!validacion.apta) {
        return fail("No se puede construir la OC: hay bloqueos.", { bloqueos: validacion.bloqueos });
      }
      if (!p.aprobacion) return fail("No se puede construir la OC sin correo de aprobación.");

      const evidencia = await generarEvidencia(ctx.directory, caso, p.aprobacion);
      const c = construirPayload(p, maestros, validacion, evidencia.sha256);
      if (!c.ok) return fail(c.error);

      const dir = join(ctx.directory, "out", caso);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "trazabilidad.json"),
        JSON.stringify({ caso, solicitud_id: p.solicitud.solicitud_id, campos: c.data.trazabilidad }, null, 2),
      );

      // Se le muestra al usuario: desde ahora, crear con excepciones exige un mensaje posterior suyo.
      if (c.data.payload.excepciones.length > 0) marcarPendiente(ctx.sessionId, caso, c.data.payload.excepciones);

      return ok({
        payload: c.data.payload,
        iva: c.data.iva,
        trazabilidad: `out/${caso}/trazabilidad.json`,
        evidencia,
        confirmaciones: validacion.confirmaciones,
        derivados: validacion.derivados,
        retroactiva: validacion.retroactiva,
      });
    });
  },
});

export const crear = definir({
  description:
    "Crea la OC en SAP. Solo si el caso es apto y, cuando hay confirmaciones, el usuario ya confirmó en un mensaje posterior (confirmado = true). Es idempotente por solicitud.",
  args: {
    caso,
    payload: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("OPCIONAL: omítelo. La OC se reconstruye en el servidor; un payload distinto se rechaza."),
    confirmado: z
      .boolean()
      .optional()
      .describe("true SOLO después de que el usuario confirme explícitamente en su mensaje más reciente."),
  },
  async execute({ caso, payload, confirmado }, ctx) {
    const registrar = (
      solicitud_id: string,
      resultado: ResultadoControl,
      extra: { numero_oc?: string; retroactiva?: boolean; bloqueos?: string[]; confirmaciones?: string[] } = {},
    ) =>
      registrarControl(ctx.directory, {
        solicitud_id,
        resultado,
        numero_oc: extra.numero_oc ?? null,
        retroactiva: extra.retroactiva ?? false,
        bloqueos: extra.bloqueos ?? [],
        confirmaciones: extra.confirmaciones ?? [],
      });

    return seguro(async () => {
      const r = validarCaso(ctx.directory, caso);
      if (!r.ok) {
        registrar(caso, "error");
        return fail(r.error);
      }
      const { paquete: p, maestros, validacion: v } = r.data;
      const id = p.solicitud.solicitud_id;
      const codigos = (xs: { codigo: string }[]) => xs.map((x) => x.codigo);
      const sap = ctx.sap ?? new MockSapAdapter(ctx.directory);

      // Sección crítica: «¿ya existe la OC? → créala» es atómico por solicitud. Dos sesiones que piden lo mismo
      // a la vez no duplican la OC: la segunda espera y recibe la existente (idempotente).
      return conCandado(`${ctx.directory}::${id}`, async () => {
        // Idempotencia: la misma solicitud nunca genera una segunda OC.
        const existente = await sap.buscarOrdenPorReferencia(id);
        if (existente) {
          registrar(id, "idempotente", { numero_oc: existente.numero_oc, retroactiva: v.retroactiva });
          return ok({ numero_oc: existente.numero_oc, ...(existente.fecha ? { fecha: existente.fecha } : {}), idempotente: true });
        }

        if (!v.apta) {
          registrar(id, "bloqueada", { retroactiva: v.retroactiva, bloqueos: codigos(v.bloqueos) });
          return fail("La OC no se puede crear: hay bloqueos.", { bloqueos: v.bloqueos });
        }

        if (v.confirmaciones.length > 0) {
          if (!confirmado) {
            marcarPendiente(ctx.sessionId, caso, v.confirmaciones);
            registrar(id, "pendiente_confirmacion", {
              retroactiva: v.retroactiva,
              confirmaciones: codigos(v.confirmaciones),
            });
            return fail("Requiere confirmación humana antes de crear la OC. Pregúntale al usuario y espera su respuesta.", {
              requiere_confirmacion: true,
              confirmaciones: v.confirmaciones,
            });
          }
          if (!confirmacionVerificable(ctx.sessionId, caso)) {
            registrar(id, "pendiente_confirmacion", {
              retroactiva: v.retroactiva,
              confirmaciones: codigos(v.confirmaciones),
            });
            return fail(
              "No hay una confirmación verificable: el usuario debe responder en un mensaje posterior a ver las excepciones. Muéstraselas y espera.",
              { requiere_confirmacion: true, confirmaciones: v.confirmaciones },
            );
          }
        }

        if (!p.aprobacion) return fail("No se puede crear la OC sin correo de aprobación.");
        const evidencia = await generarEvidencia(ctx.directory, caso, p.aprobacion);
        const c = construirPayload(p, maestros, v, evidencia.sha256);
        if (!c.ok) return fail(c.error);
        if (payload !== undefined && canonico(payload) !== canonico(c.data.payload)) {
          return fail("El payload enviado no coincide con el validado. Omite `payload`: la OC se construye en el servidor.");
        }

        // Defensa en profundidad: SAP (en producción, en tiempo real) debe confirmar al proveedor.
        const enSap = await sap.consultarProveedor(c.data.payload.proveedor.nit);
        if (!enSap?.activo) {
          registrar(id, "bloqueada", { retroactiva: v.retroactiva, bloqueos: ["RC1"] });
          return fail("SAP no reconoce al proveedor como activo.");
        }

        const orden = {
          ...c.data.payload,
          excepciones: c.data.payload.excepciones.map((e) => ({ ...e, confirmado_por: "analista (chat)" })),
        };
        const creada = await sap.crearOrden(orden);
        consumirPendiente(ctx.sessionId, caso);
        registrar(id, "creada", {
          numero_oc: creada.numero_oc,
          retroactiva: v.retroactiva,
          confirmaciones: codigos(v.confirmaciones),
        });
        return ok({ numero_oc: creada.numero_oc, fecha: creada.fecha, idempotente: false, evidencia: evidencia.ruta });
      });
    });
  },
});
