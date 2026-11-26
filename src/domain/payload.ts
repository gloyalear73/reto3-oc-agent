import { exito, falla, OrdenCompraSchema, type Maestros, type OrdenCompra, type Paquete, type Resultado, type Traza, type Validacion } from "../types.ts";
import { z } from "zod/v4";
import { buscarProveedor } from "./controles.ts";
import { acortar } from "./util.ts";

/** Redondeo a 2 decimales (precio unitario SAP). */
export const redondear2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

const SOCIEDAD = "1000";

/** Unidad SAP: solo "horas" se reconoce como H; el resto de compras son unidades. */
export function inferirUnidad(descripcion: string): "UN" | "H" | "MES" {
  return /\bhoras?\b/i.test(descripcion) ? "H" : "UN";
}

/**
 * HU-3: construye la OC (PRD 7.4). Cada valor sale de solicitud, cotización, maestro o derivado,
 * y esa procedencia queda en la traza. Las excepciones llevan `confirmado_por = null` hasta confirmar.
 */
export function construirPayload(
  p: Paquete,
  m: Maestros,
  v: Validacion,
  evidenciaSha256: string,
): Resultado<{ payload: OrdenCompra; trazabilidad: Traza }> {
  if (!v.apta) return falla("No se puede construir la OC: hay bloqueos sin resolver.");
  if (!p.aprobacion) return falla("No se puede construir la OC sin correo de aprobación.");
  const s = p.solicitud;
  const prov = buscarProveedor(m.proveedores, s.proveedor_nit, s.proveedor_nombre);
  if (!prov) return falla("Proveedor no encontrado en el maestro.");

  const condiciones = s.condiciones_pago ?? v.derivados.condiciones_pago?.valor ?? prov.condiciones_pago_default;
  const iva = s.indicador_iva ?? v.derivados.indicador_iva?.valor ?? prov.indicador_iva_default;
  const descripcion = acortar(s.descripcion, 40);
  const indicador = m.indicadores.find((i) => i.codigo === iva);
  if (!indicador) return falla(`El indicador de IVA ${iva} no existe en el maestro; no se puede calcular el precio neto.`);
  // Supuesto: el valor de la solicitud incluye IVA y SAP recibe el precio NETO (sin IVA) por unidad.
  const precioNeto = redondear2(s.valor_unitario / (1 + indicador.tasa));

  const candidato: OrdenCompra = {
    referencia: { solicitud_id: s.solicitud_id, correo_id: p.correo.id, cotizacion_ref: p.cotizacion?.referencia ?? null },
    sociedad: SOCIEDAD,
    organizacion_compras: SOCIEDAD,
    proveedor: { codigo_sap: prov.codigo_sap, nit: prov.nit, nombre: prov.nombre },
    moneda: s.moneda,
    condiciones_pago: condiciones,
    aprobador: { email: p.aprobacion.de, fecha_aprobacion: p.aprobacion.fecha, evidencia_sha256: evidenciaSha256 },
    posiciones: [
      {
        numero: 10,
        descripcion,
        cantidad: s.cantidad,
        unidad: inferirUnidad(s.descripcion),
        precio_unitario: precioNeto,
        centro_costo: s.centro_costo,
        subarea: s.subarea,
        indicador_iva: iva,
      },
    ],
    excepciones: v.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: null })),
  };

  const validado = OrdenCompraSchema.safeParse(candidato);
  if (!validado.success) return falla(`El payload no cumple el esquema de la OC:\n${z.prettifyError(validado.error)}`);

  const trazabilidad: Traza = {
    "referencia.solicitud_id": { valor: s.solicitud_id, fuente: "solicitud" },
    "referencia.correo_id": { valor: p.correo.id, fuente: "correo" },
    "referencia.cotizacion_ref": { valor: candidato.referencia.cotizacion_ref, fuente: "cotizacion" },
    sociedad: { valor: SOCIEDAD, fuente: "derivado", nota: "constante de configuración SAP del reto" },
    organizacion_compras: { valor: SOCIEDAD, fuente: "derivado", nota: "constante de configuración SAP del reto" },
    "proveedor.codigo_sap": { valor: prov.codigo_sap, fuente: "maestro.proveedores" },
    "proveedor.nit": { valor: prov.nit, fuente: "maestro.proveedores" },
    "proveedor.nombre": { valor: prov.nombre, fuente: "maestro.proveedores" },
    moneda: { valor: s.moneda, fuente: "solicitud" },
    condiciones_pago: s.condiciones_pago
      ? { valor: condiciones, fuente: "solicitud" }
      : { valor: condiciones, fuente: "derivado", nota: "RC7: tomado de maestro.proveedores.condiciones_pago_default" },
    "aprobador.email": { valor: p.aprobacion.de, fuente: "aprobacion" },
    "aprobador.fecha_aprobacion": { valor: p.aprobacion.fecha, fuente: "aprobacion" },
    "aprobador.evidencia_sha256": { valor: evidenciaSha256, fuente: "derivado", nota: "sha256 de out/<caso>/aprobacion.txt" },
    "posiciones[0].numero": { valor: 10, fuente: "derivado", nota: "primera posición" },
    "posiciones[0].descripcion": {
      valor: descripcion,
      fuente: "solicitud",
      nota: s.descripcion === descripcion ? undefined : "acortada a 40 caracteres (límite SAP)",
    },
    "posiciones[0].cantidad": { valor: s.cantidad, fuente: "solicitud" },
    "posiciones[0].unidad": { valor: candidato.posiciones[0]?.unidad, fuente: "derivado", nota: "H si la descripción menciona horas; si no, UN" },
    "posiciones[0].precio_unitario": {
      valor: precioNeto,
      fuente: "derivado",
      nota: `precio neto = valor_unitario con IVA (${s.valor_unitario}) / (1 + tasa ${indicador.tasa} del indicador ${indicador.codigo}), a 2 decimales`,
    },
    "posiciones[0].centro_costo": { valor: s.centro_costo, fuente: "solicitud" },
    "posiciones[0].subarea": { valor: s.subarea, fuente: "solicitud" },
    "posiciones[0].indicador_iva": s.indicador_iva
      ? { valor: iva, fuente: "solicitud" }
      : { valor: iva, fuente: "derivado", nota: "RC6: tomado de maestro.proveedores.indicador_iva_default" },
    excepciones: { valor: candidato.excepciones.map((e) => e.codigo), fuente: "derivado", nota: "confirmaciones de oc_validar" },
  };

  return exito({ payload: validado.data, trazabilidad });
}
