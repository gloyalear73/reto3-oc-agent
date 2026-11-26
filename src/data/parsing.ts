import type { Cotizacion, Factura } from "../types.ts";

/** Normaliza un NIT: quita puntos/espacios y descarta el dígito de verificación. */
export function normalizarNit(nit: string): string {
  const base = nit.split("-")[0] ?? nit;
  return base.replace(/\D/g, "");
}

function campo(texto: string, etiqueta: RegExp): string | null {
  const m = texto.match(new RegExp(`^\\s*${etiqueta.source}\\s*:\\s*(.+)$`, "im"));
  return m ? m[1]!.trim() : null;
}

function numero(valor: string | null): number {
  if (!valor) return NaN;
  return Number(valor.replace(/[^\d.-]/g, ""));
}

/** Parser determinista del texto de la cotización. */
export function parsearCotizacion(texto: string): Cotizacion {
  const num = texto.match(/COTIZACI[ÓO]N\s+No\.?\s*(\S+)/i)?.[1] ?? "SIN-NUMERO";
  const condicion = campo(texto, /Condici[óo]n de pago/) ?? "";
  const dias = condicion.match(/(\d+)\s*d[ií]as/i)?.[1];
  const contado = /contado/i.test(condicion);
  return {
    numero: num,
    proveedor: campo(texto, /Proveedor/) ?? "",
    nit: campo(texto, /NIT/) ?? "",
    fecha: campo(texto, /Fecha/) ?? "",
    condicionPagoTexto: condicion,
    condicionPagoDias: dias ? Number(dias) : contado ? 0 : null,
    subtotal: numero(campo(texto, /Subtotal/)),
    iva: numero(campo(texto, /IVA(?:\s*\([^)]*\))?/)),
    total: numero(campo(texto, /Total/)),
  };
}

export function parsearFactura(texto: string): Factura {
  return {
    numero: texto.match(/FACTURA[^\n]*No\.?\s*(\S+)/i)?.[1] ?? "SIN-NUMERO",
    proveedor: campo(texto, /Proveedor/) ?? "",
    nit: campo(texto, /NIT/) ?? "",
    fecha: campo(texto, /Fecha/) ?? "",
    total: numero(campo(texto, /Total/)),
  };
}
