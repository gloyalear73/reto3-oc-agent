import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import {
  AprobacionSchema,
  CorreoSchema,
  exito,
  falla,
  SolicitudSchema,
  type Paquete,
  type Resultado,
} from "../types.ts";
import { rutaFixtures } from "./maestros.ts";
import { normalizarNit, parseMonto, sumarDias } from "./util.ts";

export type PaqueteCargado = Paquete & { faltantes: string[] };

export const NOMBRE_CASO = /^[\w-]+$/;

export function listarCasos(directory: string): string[] {
  const base = join(rutaFixtures(directory), "solicitudes");
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function leerJson<S extends z.ZodType>(ruta: string, nombre: string, esquema: S): Resultado<z.infer<S>> {
  let crudo: unknown;
  try {
    crudo = JSON.parse(readFileSync(ruta, "utf8"));
  } catch (e) {
    return falla(`${nombre} está ausente o es un JSON malformado (${(e as Error).message}).`);
  }
  const r = esquema.safeParse(crudo);
  if (!r.success) return falla(`${nombre} tiene datos inválidos:\n${z.prettifyError(r.error)}`);
  return exito(r.data);
}

const unaLinea = (texto: string, re: RegExp): string | null => texto.match(re)?.[1]?.trim() ?? null;

export function parsearCotizacion(texto: string): Paquete["cotizacion"] {
  const lineaTotal = texto.match(/^TOTAL[^:\n]*:\s*(.+)$/im)?.[1] ?? "";
  const total = parseMonto(lineaTotal);
  if (total === null) return null;
  const fecha = unaLinea(texto, /^Fecha:\s*(\d{4}-\d{2}-\d{2})/im);
  const dias = Number(unaLinea(texto, /Validez de la oferta:\s*(\d+)\s*d[ií]as/i));
  const nitCrudo = unaLinea(texto, /^NIT:\s*(.+)$/im);
  return {
    referencia: unaLinea(texto, /^COTIZACI[ÓO]N\s+(\S+)/im),
    proveedor: unaLinea(texto, /^Proveedor:\s*(.+)$/im) ?? "",
    nit: nitCrudo ? normalizarNit(nitCrudo) : null,
    total,
    moneda: /\bUSD\b/.test(lineaTotal) ? "USD" : "COP",
    validez_hasta: fecha && dias ? sumarDias(fecha, dias) : null,
    texto,
  };
}

export function parsearFactura(texto: string): Paquete["factura"] {
  const total = parseMonto(texto.match(/^TOTAL:\s*(.+)$/im)?.[1] ?? "");
  const numero = unaLinea(texto, /FACTURA[^\n]*?No\.?\s*([A-Z0-9-]+)/i);
  const fecha = unaLinea(texto, /Fecha de emisi[óo]n:\s*(\d{4}-\d{2}-\d{2})/i);
  if (total === null || !numero || !fecha) return null;
  return { numero, fecha, total };
}

/** Frases que niegan la aprobación ("no aprobado", "no está aprobado") no cuentan como "Aprobado". */
export function esAprobado(cuerpo: string): boolean {
  return /\baprobad[oa]\b/i.test(cuerpo) && !/\bno\s+(?:est[aá]\s+)?aprobad[oa]\b/i.test(cuerpo);
}

/** HU-1: un adjunto ausente se reporta como null y en `faltantes`; solo correo y solicitud son indispensables. */
export function cargarPaquete(directory: string, caso: string): Resultado<PaqueteCargado> {
  if (!NOMBRE_CASO.test(caso)) return falla(`Nombre de caso inválido: "${caso}".`);
  const dir = join(rutaFixtures(directory), "solicitudes", caso);
  if (!existsSync(dir)) {
    return falla(`No existe el caso "${caso}". Casos disponibles: ${listarCasos(directory).join(", ") || "ninguno"}.`);
  }

  const correo = leerJson(join(dir, "correo.json"), "correo.json", CorreoSchema);
  if (!correo.ok) return correo;
  const solicitud = leerJson(join(dir, "solicitud.json"), "solicitud.json", SolicitudSchema);
  if (!solicitud.ok) return solicitud;

  const faltantes: string[] = [];

  let cotizacion: Paquete["cotizacion"] = null;
  const rutaCot = join(dir, "cotizacion.txt");
  if (existsSync(rutaCot)) {
    cotizacion = parsearCotizacion(readFileSync(rutaCot, "utf8"));
    if (!cotizacion) faltantes.push("cotizacion.txt (ilegible: no se encontró el total)");
  } else faltantes.push("cotizacion.txt");

  let aprobacion: Paquete["aprobacion"] = null;
  const rutaApr = join(dir, "aprobacion.json");
  if (existsSync(rutaApr)) {
    const a = leerJson(rutaApr, "aprobacion.json", AprobacionSchema);
    if (a.ok) {
      aprobacion = {
        de: a.data.de,
        para: a.data.para ?? "",
        fecha: a.data.fecha,
        asunto: a.data.asunto ?? "",
        aprobado: esAprobado(a.data.cuerpo),
        texto: a.data.cuerpo,
      };
    } else faltantes.push("aprobacion.json (malformado)");
  } else faltantes.push("aprobacion.json");

  let factura: Paquete["factura"] = null;
  const rutaFac = join(dir, "factura.txt");
  if (existsSync(rutaFac)) {
    factura = parsearFactura(readFileSync(rutaFac, "utf8"));
    if (!factura) faltantes.push("factura.txt (ilegible)");
  } else if (correo.data.adjuntos?.some((a) => /^factura/i.test(a))) {
    faltantes.push("factura.txt");
  }

  return exito({
    correo: { id: correo.data.id, de: correo.data.de, asunto: correo.data.asunto, fecha: correo.data.fecha },
    solicitud: solicitud.data,
    cotizacion,
    aprobacion,
    factura,
    faltantes,
  });
}
