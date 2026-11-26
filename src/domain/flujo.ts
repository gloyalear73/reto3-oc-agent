import { canonico } from "./util.ts";
import { validar } from "./controles.ts";
import { cargarMaestros } from "./maestros.ts";
import { cargarPaquete, type PaqueteCargado } from "./paquete.ts";
import { exito, falla, type Maestros, type Paquete, type Resultado, type Validacion } from "../types.ts";

const sinFaltantes = ({ faltantes: _f, ...resto }: PaqueteCargado): Paquete => resto;

export interface CasoResuelto {
  paquete: Paquete;
  faltantes: string[];
  maestros: Maestros;
}

/**
 * Fuente de verdad: el paquete SIEMPRE se relee de los fixtures. Si el modelo envía uno propio,
 * debe coincidir con el real; así no puede "arreglar" un monto para que cuadre (PRD 10, riesgo 2).
 */
export function resolverCaso(directory: string, caso: string, suministrado?: unknown): Resultado<CasoResuelto> {
  const cargado = cargarPaquete(directory, caso);
  if (!cargado.ok) return cargado;
  const maestros = cargarMaestros(directory);
  if (!maestros.ok) return maestros;
  const paquete = sinFaltantes(cargado.data);

  if (suministrado !== undefined && suministrado !== null) {
    const { faltantes: _f, ...recibido } = suministrado as Record<string, unknown>;
    if (canonico(recibido) !== canonico(paquete)) {
      return falla(
        "El paquete enviado no coincide con el del caso. Omite el argumento `paquete`: la herramienta lo lee directamente del caso.",
      );
    }
  }
  return exito({ paquete, faltantes: cargado.data.faltantes, maestros: maestros.data });
}

export function validarCaso(
  directory: string,
  caso: string,
  suministrado?: unknown,
): Resultado<CasoResuelto & { validacion: Validacion }> {
  const r = resolverCaso(directory, caso, suministrado);
  if (!r.ok) return r;
  return exito({ ...r.data, validacion: validar(r.data.paquete, r.data.maestros) });
}
