import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Aprobacion, Caso, Correo, Maestros, Solicitud } from "../types.ts";
import { parsearCotizacion, parsearFactura } from "./parsing.ts";

export const FIXTURES_DIR = resolve(process.env.FIXTURES_DIR ?? "fixtures/reto-03");

const leerJson = <T>(ruta: string): T => JSON.parse(readFileSync(ruta, "utf8")) as T;

export function cargarMaestros(dir = FIXTURES_DIR): Maestros {
  const m = join(dir, "maestros");
  return {
    proveedores: leerJson(join(m, "proveedores.json")),
    centrosCosto: leerJson(join(m, "centros-costo.json")),
    indicadoresIva: leerJson(join(m, "indicadores-iva.json")),
    condicionesPago: leerJson(join(m, "condiciones-pago.json")),
  };
}

export function listarCasos(dir = FIXTURES_DIR): string[] {
  const base = join(dir, "solicitudes");
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

export function cargarCaso(id: string, dir = FIXTURES_DIR): Caso {
  // Evita path traversal: el id debe ser un nombre de carpeta simple.
  if (!/^[\w-]+$/.test(id)) throw new Error(`Identificador de solicitud inválido: ${id}`);
  const carpeta = join(dir, "solicitudes", id);
  if (!existsSync(carpeta)) throw new Error(`No existe la solicitud ${id}`);
  const facturaPath = join(carpeta, "factura.txt");
  return {
    solicitud: leerJson<Solicitud>(join(carpeta, "solicitud.json")),
    correo: leerJson<Correo>(join(carpeta, "correo.json")),
    aprobacion: leerJson<Aprobacion>(join(carpeta, "aprobacion.json")),
    cotizacion: parsearCotizacion(readFileSync(join(carpeta, "cotizacion.txt"), "utf8")),
    factura: existsSync(facturaPath) ? parsearFactura(readFileSync(facturaPath, "utf8")) : null,
  };
}
