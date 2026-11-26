import type { DatosOC, OrdenCompra } from "../types.ts";

/**
 * Contrato que debe cumplir cualquier backend SAP.
 * - MockSapAdapter (src/sap/mock.ts): memoria, para demo y pruebas.
 * - Producción: ver SOLUCION.md (BAPI_PO_CREATE1 u OData API_PURCHASEORDER_PROCESS_SRV).
 */
export interface SapAdapter {
  crearOrdenCompra(datos: DatosOC, meta: { creadaPor: string; confirmadaPor: string; justificacion: string }): Promise<OrdenCompra>;
  buscarPorSolicitud(solicitudId: string): Promise<OrdenCompra | null>;
  listar(): Promise<OrdenCompra[]>;
}
