import type { OrdenCompra } from "../types.ts";

/**
 * Contrato con SAP (PRD 7.4). El resto del sistema solo conoce esta interfaz.
 * `fecha` en buscarOrdenPorReferencia es una extensión opcional para devolver la fecha original en reintentos.
 */
export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>;
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>;
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string; fecha?: string } | null>;
}
