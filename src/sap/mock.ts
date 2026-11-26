import type { DatosOC, OrdenCompra } from "../types.ts";
import type { SapAdapter } from "./adapter.ts";

/** SAP simulado en memoria. Numeración tipo SAP (45000xxxxx) e idempotente por solicitud. */
export class MockSapAdapter implements SapAdapter {
  private ordenes = new Map<string, OrdenCompra>();
  private consecutivo = 4500000000;

  async crearOrdenCompra(
    datos: DatosOC,
    meta: { creadaPor: string; confirmadaPor: string; justificacion: string },
  ): Promise<OrdenCompra> {
    const existente = this.ordenes.get(datos.solicitudId);
    if (existente) return existente; // idempotencia: nunca duplica
    const oc: OrdenCompra = { ...datos, ...meta, numero: String(++this.consecutivo) };
    this.ordenes.set(datos.solicitudId, oc);
    return oc;
  }

  async buscarPorSolicitud(solicitudId: string) {
    return this.ordenes.get(solicitudId) ?? null;
  }

  async listar() {
    return [...this.ordenes.values()];
  }
}
