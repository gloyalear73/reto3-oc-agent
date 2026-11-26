import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buscarProveedor } from "../domain/controles.ts";
import { cargarMaestros } from "../domain/maestros.ts";
import type { OrdenCompra } from "../types.ts";
import type { SapAdapter } from "./adapter.ts";

const PRIMER_NUMERO = 4_500_000_001;

interface RegistroOrden {
  numero_oc: string;
  fecha: string;
  orden: OrdenCompra;
}

/** SAP simulado sobre `out/sap/ordenes.jsonl`. Numeración secuencial desde 4500000001. */
export class MockSapAdapter implements SapAdapter {
  private readonly archivo: string;

  constructor(private readonly directory: string) {
    this.archivo = join(directory, "out", "sap", "ordenes.jsonl");
  }

  private registros(): RegistroOrden[] {
    if (!existsSync(this.archivo)) return [];
    return readFileSync(this.archivo, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as RegistroOrden);
  }

  async consultarProveedor(nit: string) {
    const maestros = cargarMaestros(this.directory);
    if (!maestros.ok) return null;
    const p = buscarProveedor(maestros.data.proveedores, nit, "");
    return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null;
  }

  async crearOrden(orden: OrdenCompra) {
    mkdirSync(join(this.directory, "out", "sap"), { recursive: true });
    const numero_oc = String(PRIMER_NUMERO + this.registros().length);
    const fecha = new Date().toISOString().slice(0, 10);
    appendFileSync(this.archivo, JSON.stringify({ numero_oc, fecha, orden } satisfies RegistroOrden) + "\n");
    return { numero_oc, fecha };
  }

  async buscarOrdenPorReferencia(solicitud_id: string) {
    const r = this.registros().find((x) => x.orden.referencia.solicitud_id === solicitud_id);
    return r ? { numero_oc: r.numero_oc, fecha: r.fecha } : null;
  }
}
