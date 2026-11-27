import type { OrdenCompra } from "../types.ts";

/**
 * Contrato con SAP (PRD 7.4). El resto del sistema solo conoce esta interfaz.
 * `buscarOrdenPorReferencia` exige solo `numero_oc`, como el PRD: quien reintenta ya tiene el número y es lo que
 * necesita. `fecha` es opcional: si el adaptador la entrega, se informa en el reintento; si no, se omite.
 */
export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>;
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>;
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string; fecha?: string } | null>;
}
