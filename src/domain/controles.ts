import type { Aprobador, CentroCosto, Hallazgo, Maestros, Paquete, Proveedor, Validacion } from "../types.ts";
import { cop, diasEntre, normalizarNit, normalizarNombre } from "./util.ts";

const TOLERANCIA_COTIZACION = 0.02; // RC5
const TOLERANCIA_ARITMETICA = 1; // RC10

/** RC1: por NIT; si la solicitud no trae NIT, por nombre normalizado. */
export function buscarProveedor(
  proveedores: Proveedor[],
  nit: string | undefined,
  nombre: string,
): Proveedor | undefined {
  if (nit && normalizarNit(nit)) {
    const buscado = normalizarNit(nit);
    return proveedores.find((p) => normalizarNit(p.nit) === buscado);
  }
  const buscado = normalizarNombre(nombre);
  return proveedores.find((p) => normalizarNombre(p.nombre) === buscado);
}

export function buscarCentro(centros: CentroCosto[], codigo: string): CentroCosto | undefined {
  return centros.find((c) => c.centro_costo === codigo);
}

export function buscarAprobador(centro: CentroCosto, email: string): Aprobador | undefined {
  return centro.aprobadores.find((a) => a.email.toLowerCase() === email.toLowerCase());
}

const listaAprobadores = (centro: CentroCosto): string =>
  centro.aprobadores.map((a) => `${a.nombre ?? a.email} (tope ${cop(a.tope)})`).join("; ");

/**
 * Aplica RC1–RC10 (PRD 7.3). Función pura: misma entrada, misma salida.
 * Bloqueo = impide crear. Confirmación = permite crear solo con confirmado = true.
 */
export function validar(p: Paquete, m: Maestros): Validacion {
  const bloqueos: Hallazgo[] = [];
  const confirmaciones: Hallazgo[] = [];
  const derivados: Validacion["derivados"] = {};
  const s = p.solicitud;
  let retroactiva = false;

  // RC1 · proveedor existente y activo
  const proveedor = buscarProveedor(m.proveedores, s.proveedor_nit, s.proveedor_nombre);
  if (!proveedor) {
    bloqueos.push({
      codigo: "RC1",
      detalle: `El proveedor "${s.proveedor_nombre}" (NIT ${s.proveedor_nit ?? "no informado"}) no existe en el maestro de proveedores.`,
      accion_sugerida:
        "Pedir al solicitante que gestione el alta del proveedor en el maestro SAP y reenvíe la solicitud con el NIT.",
    });
  } else if (!proveedor.activo) {
    bloqueos.push({
      codigo: "RC1",
      detalle: `El proveedor "${proveedor.nombre}" (SAP ${proveedor.codigo_sap}) está inactivo.`,
      accion_sugerida: "Solicitar la reactivación del proveedor en SAP o elegir un proveedor activo.",
    });
  }

  // RC2 · aprobación existente, con "Aprobado" y emitida por un aprobador del centro
  const centro = buscarCentro(m.centros, s.centro_costo);
  let aprobador: Aprobador | undefined;
  if (!p.aprobacion) {
    bloqueos.push({
      codigo: "RC2",
      detalle: "No hay correo de aprobación en el paquete.",
      accion_sugerida: "Pedir al solicitante el correo de aprobación del líder del centro de costo.",
    });
  } else if (!p.aprobacion.aprobado) {
    bloqueos.push({
      codigo: "RC2",
      detalle: `El correo de ${p.aprobacion.de} no contiene la palabra "Aprobado".`,
      accion_sugerida: "Pedir una aprobación explícita del líder antes de continuar.",
    });
  } else if (centro) {
    aprobador = buscarAprobador(centro, p.aprobacion.de);
    if (!aprobador) {
      const alcanzan = centro.aprobadores.filter((a) => a.tope >= s.valor_total);
      bloqueos.push({
        codigo: "RC2",
        detalle:
          `${p.aprobacion.de} no figura como aprobador del centro ${centro.centro_costo} (${centro.nombre ?? ""}). ` +
          `Aprobadores autorizados: ${listaAprobadores(centro)}.`,
        accion_sugerida: alcanzan.length
          ? `Obtener la aprobación de ${alcanzan.map((a) => a.nombre ?? a.email).join(" o ")}.`
          : `El valor ${cop(s.valor_total)} supera el tope de todos los aprobadores del centro: requiere aprobación de un nivel superior definido por la compañía.`,
      });
    }
  }

  // RC3 · valor dentro del tope del aprobador (solo evaluable si el aprobador es válido)
  if (aprobador && s.valor_total > aprobador.tope) {
    bloqueos.push({
      codigo: "RC3",
      detalle: `El valor ${cop(s.valor_total)} supera el tope de ${aprobador.nombre ?? aprobador.email} (${cop(aprobador.tope)}) en ${s.centro_costo}.`,
      accion_sugerida: "Obtener la aprobación de un aprobador del centro con tope suficiente.",
    });
  }

  // RC4 · subárea perteneciente al centro de costo
  if (!centro) {
    bloqueos.push({
      codigo: "RC4",
      detalle: `El centro de costo ${s.centro_costo} no existe.`,
      accion_sugerida: "Corregir el centro de costo en la solicitud.",
    });
  } else if (!centro.subareas.some((x) => normalizarNombre(x) === normalizarNombre(s.subarea))) {
    bloqueos.push({
      codigo: "RC4",
      detalle: `La subárea "${s.subarea}" no pertenece a ${centro.centro_costo}. Subáreas válidas: ${centro.subareas.join(", ")}.`,
      accion_sugerida: "Corregir la subárea o el centro de costo en la solicitud.",
    });
  }

  // RC5 · cotización vs solicitud (±2 %)
  if (!p.cotizacion) {
    confirmaciones.push({
      codigo: "RC5",
      detalle: "No hay cotización (o es ilegible); el valor no puede contrastarse con el proveedor.",
      accion_sugerida: "Pedir la cotización o confirmar que se continúa sin ella.",
    });
  } else {
    const dif = s.valor_total === 0 ? Infinity : Math.abs(p.cotizacion.total - s.valor_total) / s.valor_total;
    if (dif > TOLERANCIA_COTIZACION) {
      confirmaciones.push({
        codigo: "RC5",
        detalle: `La cotización (${cop(p.cotizacion.total)}) difiere ${(dif * 100).toFixed(1)} % de la solicitud (${cop(s.valor_total)}); la tolerancia es 2 %.`,
        accion_sugerida: "Confirmar cuál valor es el correcto o pedir al solicitante que corrija la solicitud.",
        valores: {
          solicitud: s.valor_total,
          cotizacion: p.cotizacion.total,
          diferencia_pct: Number((dif * 100).toFixed(2)),
        },
      });
    }
  }

  // RC6 · indicador de IVA ausente: se deriva del proveedor y se confirma
  if (!s.indicador_iva && proveedor) {
    const ind = m.indicadores.find((i) => i.codigo === proveedor.indicador_iva_default);
    derivados.indicador_iva = { valor: proveedor.indicador_iva_default, fuente: "maestro.proveedores" };
    confirmaciones.push({
      codigo: "RC6",
      detalle: `La solicitud no informa indicador de IVA; se derivó ${proveedor.indicador_iva_default}${ind ? ` (${ind.descripcion})` : ""} del maestro del proveedor.`,
      accion_sugerida: "Confirmar que el indicador derivado es el correcto para esta compra.",
      valores: { indicador_derivado: proveedor.indicador_iva_default },
    });
  }

  // RC7 · condiciones de pago ausentes: se derivan del proveedor (solo informa)
  if (!s.condiciones_pago && proveedor) {
    derivados.condiciones_pago = { valor: proveedor.condiciones_pago_default, fuente: "maestro.proveedores" };
  }

  // RC8 · factura anterior a la solicitud: compra retroactiva
  if (p.factura && p.factura.fecha < s.fecha_solicitud) {
    retroactiva = true;
    confirmaciones.push({
      codigo: "RC8",
      detalle: `La factura ${p.factura.numero} (${p.factura.fecha}) es ${diasEntre(p.factura.fecha, s.fecha_solicitud)} días anterior a la solicitud (${s.fecha_solicitud}): la compra se ejecutó antes de crear la OC.`,
      accion_sugerida:
        "Confirmar para crear la OC con retroactiva = true (queda en el log de control) y avisar al líder del centro.",
      valores: { factura: p.factura.numero, fecha_factura: p.factura.fecha, fecha_solicitud: s.fecha_solicitud },
    });
  }

  // RC9 · la aprobación no puede ser anterior a la solicitud (se compara la fecha local, sin zona horaria)
  if (p.aprobacion && p.aprobacion.fecha.slice(0, 10) < s.fecha_solicitud) {
    confirmaciones.push({
      codigo: "RC9",
      detalle: `La aprobación (${p.aprobacion.fecha.slice(0, 10)}) es anterior a la solicitud (${s.fecha_solicitud}).`,
      accion_sugerida: "Confirmar que la aprobación corresponde a esta solicitud.",
    });
  }

  // RC10 · coherencia aritmética de la solicitud
  const esperado = s.cantidad * s.valor_unitario;
  if (Math.abs(esperado - s.valor_total) > TOLERANCIA_ARITMETICA) {
    bloqueos.push({
      codigo: "RC10",
      detalle: `cantidad × valor unitario = ${cop(esperado)}, pero valor_total = ${cop(s.valor_total)}.`,
      accion_sugerida: "Pedir al solicitante que corrija las cifras de la solicitud.",
    });
  }

  return { apta: bloqueos.length === 0, bloqueos, confirmaciones, derivados, retroactiva };
}
