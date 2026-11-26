import type { OrdenCompra } from "../types.ts";

/**
 * Contrato con SAP (PRD 7.4). El resto del sistema solo conoce esta interfaz.
 * Extensión sobre el PRD: `buscarOrdenPorReferencia` devuelve además `fecha` (la de creación de la OC), para informar
 * la fecha original cuando se reintenta una solicitud ya creada. SAP real la entrega en la cabecera del documento.
 */
export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>;
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>;
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string; fecha: string } | null>;
}
