import { z } from "zod/v4";

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string };
export const exito = <T>(data: T): Resultado<T> => ({ ok: true, data });
export const falla = (error: string): Resultado<never> => ({ ok: false, error });

const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "debe tener formato AAAA-MM-DD");

/** Solicitud normalizada (PRD 7.1). Un monto no numérico produce un error legible (HU-6). */
export const SolicitudSchema = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string(),
  proveedor_nombre: z.string(),
  proveedor_nit: z.string().optional(),
  descripcion: z.string(),
  centro_costo: z.string(),
  subarea: z.string(),
  cantidad: z.number(),
  valor_unitario: z.number(),
  valor_total: z.number(),
  moneda: z.enum(["COP", "USD"]),
  indicador_iva: z.string().optional(),
  condiciones_pago: z.string().optional(),
  fecha_solicitud: fechaIso,
});
export type Solicitud = z.infer<typeof SolicitudSchema>;

export const CorreoSchema = z.object({
  id: z.string(),
  de: z.string(),
  asunto: z.string(),
  fecha: z.string(),
  adjuntos: z.array(z.string()).optional(),
});

export const AprobacionSchema = z.object({
  de: z.string(),
  para: z.string().optional(),
  fecha: z.string(),
  asunto: z.string().optional(),
  cuerpo: z.string(),
});

/** Paquete normalizado (PRD 7.2). `referencia`, `para` y `asunto` son extensiones para trazabilidad y evidencia. */
export interface Paquete {
  correo: { id: string; de: string; asunto: string; fecha: string };
  solicitud: Solicitud;
  cotizacion: {
    referencia: string | null;
    proveedor: string;
    nit: string | null;
    total: number;
    moneda: string;
    validez_hasta: string | null;
    /** IVA desglosado en la cotización (null si no lo informa). `tasa` en fracción: 0.19. */
    iva: { tasa: number | null; base: number | null; valor: number | null };
    texto: string;
  } | null;
  aprobacion: { de: string; para: string; fecha: string; asunto: string; aprobado: boolean; texto: string } | null;
  factura: { numero: string; fecha: string; total: number } | null;
}

export interface Proveedor {
  codigo_sap: string;
  nit: string;
  nombre: string;
  condiciones_pago_default: string;
  indicador_iva_default: string;
  activo: boolean;
}
export interface Aprobador {
  email: string;
  nombre?: string;
  tope: number;
}
export interface CentroCosto {
  centro_costo: string;
  nombre?: string;
  subareas: string[];
  aprobadores: Aprobador[];
}
export interface IndicadorIva {
  codigo: string;
  descripcion: string;
  tasa: number;
}
export interface CondicionPago {
  codigo: string;
  descripcion: string;
  dias: number;
}
export interface Maestros {
  proveedores: Proveedor[];
  centros: CentroCosto[];
  indicadores: IndicadorIva[];
  condiciones: CondicionPago[];
}

/** Hallazgo de una regla de control. `valores` muestra los datos comparados (p. ej. RC5). */
export interface Hallazgo {
  codigo: string;
  detalle: string;
  accion_sugerida: string;
  valores?: Record<string, string | number>;
}
export interface Derivado {
  valor: string;
  fuente: string;
}
export interface Validacion {
  apta: boolean;
  bloqueos: Hallazgo[];
  confirmaciones: Hallazgo[];
  derivados: { indicador_iva?: Derivado; condiciones_pago?: Derivado };
  retroactiva: boolean;
}

/** Payload de la OC (PRD 7.4), validado con zod. */
export const OrdenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({
    email: z.string(),
    fecha_aprobacion: z.string(),
    evidencia_sha256: z.string().length(64),
  }),
  posiciones: z
    .array(
      z.object({
        numero: z.number().int().positive(),
        descripcion: z.string().max(40),
        cantidad: z.number(),
        unidad: z.enum(["UN", "H", "MES"]),
        precio_unitario: z.number(),
        centro_costo: z.string(),
        subarea: z.string(),
        indicador_iva: z.string(),
      }),
    )
    .min(1),
  excepciones: z.array(
    z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() }),
  ),
});
export type OrdenCompra = z.infer<typeof OrdenCompraSchema>;

export interface Traza {
  [campo: string]: { valor: unknown; fuente: string; nota?: string };
}
