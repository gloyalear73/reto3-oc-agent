// Tipos de dominio. SUPUESTO: la forma de los JSON se infirmó del instructivo;
// al recibir los fixtures reales, ajustar aquí y en src/data/loader.ts.

export interface Proveedor {
  id: string;
  nombre: string;
  nit: string;
  estado: "activo" | "bloqueado" | "inactivo";
  defaults: { indicadorIva: string; condicionPago: string; moneda: string };
}

export interface Lider {
  id: string;
  nombre: string;
  email: string;
  topeAprobacion: number;
}

export interface CentroCosto {
  codigo: string;
  nombre: string;
  subareas: string[];
  lider: Lider;
}

export interface IndicadorIva {
  codigo: string;
  tasa: number;
  descripcion: string;
}

export interface CondicionPago {
  codigo: string;
  dias: number;
  descripcion: string;
}

export interface Maestros {
  proveedores: Proveedor[];
  centrosCosto: CentroCosto[];
  indicadoresIva: IndicadorIva[];
  condicionesPago: CondicionPago[];
}

export interface ItemSolicitud {
  descripcion: string;
  cantidad: number;
  valorUnitario: number;
}

export interface Solicitud {
  id: string;
  solicitante: string;
  centroCosto: string;
  subarea: string;
  proveedorNit: string;
  descripcion: string;
  items: ItemSolicitud[];
  moneda: string;
  fecha: string;
}

export interface Correo {
  id: string;
  de: string;
  para: string;
  asunto: string;
  fecha: string; // YYYY-MM-DD, fecha de proceso (determinista)
  cuerpo: string;
  adjuntos: string[];
}

export interface Aprobacion {
  aprobador: string;
  aprobadorId: string;
  fecha: string;
  monto: number;
  moneda: string;
  estado: "aprobado" | "rechazado" | "pendiente";
  canal: string;
}

export interface Cotizacion {
  numero: string;
  proveedor: string;
  nit: string;
  fecha: string;
  condicionPagoTexto: string;
  condicionPagoDias: number | null;
  subtotal: number;
  iva: number;
  total: number;
}

export interface Factura {
  numero: string;
  proveedor: string;
  nit: string;
  fecha: string;
  total: number;
}

export interface Caso {
  solicitud: Solicitud;
  correo: Correo;
  cotizacion: Cotizacion;
  aprobacion: Aprobacion;
  factura: Factura | null;
}

export type Severidad = "bloqueante" | "escalamiento";
export type Decision = "CREAR" | "ESCALAR" | "RECHAZAR";

export interface Hallazgo {
  control: string;
  nombre: string;
  ok: boolean;
  severidad: Severidad;
  detalle: string;
}

export interface DatosOC {
  solicitudId: string;
  proveedorId: string;
  proveedorNombre: string;
  centroCosto: string;
  subarea: string;
  indicadorIva: string;
  condicionPago: string;
  moneda: string;
  subtotal: number;
  iva: number;
  total: number;
  aprobador: string;
  retroactiva: boolean;
  fechaDocumento: string;
}

export interface Evaluacion {
  solicitudId: string;
  decision: Decision;
  resumen: string;
  hallazgos: Hallazgo[];
  datosOC: DatosOC | null;
}

export interface OrdenCompra extends DatosOC {
  numero: string;
  creadaPor: string;
  confirmadaPor: string;
  justificacion: string;
}
