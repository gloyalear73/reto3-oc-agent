import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exito, falla, type Maestros, type Resultado } from "../types.ts";

export const rutaFixtures = (directory: string) => join(directory, "fixtures", "reto-03");

function leer<T>(directory: string, archivo: string): T {
  const ruta = join(rutaFixtures(directory), "maestros", archivo);
  try {
    return JSON.parse(readFileSync(ruta, "utf8")) as T;
  } catch (e) {
    throw new Error(`No se pudo leer el maestro ${archivo}: ${(e as Error).message}`);
  }
}

export function cargarMaestros(directory: string): Resultado<Maestros> {
  try {
    return exito({
      proveedores: leer(directory, "proveedores.json"),
      centros: leer(directory, "centros-costo.json"),
      indicadores: leer(directory, "indicadores-iva.json"),
      condiciones: leer(directory, "condiciones-pago.json"),
    });
  } catch (e) {
    return falla((e as Error).message);
  }
}
