import { normalizarNit } from "./data/parsing.ts";
import type { Caso, DatosOC, Decision, Evaluacion, Hallazgo, Maestros, Severidad } from "./types.ts";

/**
 * MATRIZ DE CONTROLES
 * bloqueante   -> falla = RECHAZAR (no se puede crear la OC, ni con confirmación humana)
 * escalamiento -> falla = ESCALAR  (un humano puede autorizar con justificación)
 */
export const MATRIZ_CONTROLES: ReadonlyArray<{ id: string; nombre: string; severidad: Severidad }> = [
  { id: "C01", nombre: "Proveedor existe en maestro", severidad: "bloqueante" },
  { id: "C02", nombre: "Proveedor activo (no bloqueado)", severidad: "bloqueante" },
  { id: "C03", nombre: "NIT de cotización coincide con proveedor", severidad: "bloqueante" },
  { id: "C04", nombre: "Centro de costo y subárea válidos", severidad: "bloqueante" },
  { id: "C05", nombre: "Aprobación presente y en estado aprobado", severidad: "bloqueante" },
  { id: "C06", nombre: "Aprobador es el líder del centro de costo", severidad: "bloqueante" },
  { id: "C07", nombre: "Monto dentro del tope del líder", severidad: "escalamiento" },
  { id: "C08", nombre: "Monto aprobado cubre el total", severidad: "escalamiento" },
  { id: "C09", nombre: "Cotización aritméticamente consistente", severidad: "escalamiento" },
  { id: "C10", nombre: "Indicador de IVA válido", severidad: "escalamiento" },
  { id: "C11", nombre: "Condición de pago existe en maestro", severidad: "escalamiento" },
  { id: "C12", nombre: "No es compra retroactiva", severidad: "escalamiento" },
  { id: "C13", nombre: "Sin OC previa para la misma solicitud", severidad: "bloqueante" },
];

const meta = (id: string) => MATRIZ_CONTROLES.find((c) => c.id === id)!;
const COP = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;

export function evaluarCaso(caso: Caso, maestros: Maestros, solicitudesConOC: ReadonlySet<string>): Evaluacion {
  const { solicitud, cotizacion, aprobacion, factura, correo } = caso;
  const hallazgos: Hallazgo[] = [];
  const reg = (id: string, ok: boolean, detalle: string) => {
    const m = meta(id);
    hallazgos.push({ control: id, nombre: m.nombre, ok, severidad: m.severidad, detalle });
  };

  // C01-C03 proveedor
  const proveedor = maestros.proveedores.find((p) => normalizarNit(p.nit) === normalizarNit(solicitud.proveedorNit));
  reg("C01", !!proveedor, proveedor ? `${proveedor.nombre} (${proveedor.id})` : `NIT ${solicitud.proveedorNit} no existe en el maestro`);
  reg(
    "C02",
    proveedor?.estado === "activo",
    proveedor ? `Estado del proveedor: ${proveedor.estado}` : "Sin proveedor para validar estado",
  );
  const nitOk = normalizarNit(cotizacion.nit) === normalizarNit(solicitud.proveedorNit);
  reg("C03", nitOk, nitOk ? `NIT ${cotizacion.nit} coincide` : `Cotización trae NIT ${cotizacion.nit}; la solicitud indica ${solicitud.proveedorNit}`);

  // C04 centro de costo
  const centro = maestros.centrosCosto.find((c) => c.codigo === solicitud.centroCosto);
  const subOk = !!centro?.subareas.includes(solicitud.subarea);
  reg(
    "C04",
    !!centro && subOk,
    !centro
      ? `Centro de costo ${solicitud.centroCosto} no existe`
      : subOk
        ? `${centro.codigo} ${centro.nombre} / ${solicitud.subarea}`
        : `La subárea "${solicitud.subarea}" no pertenece a ${centro.codigo}`,
  );

  // C05-C08 aprobación
  reg("C05", aprobacion.estado === "aprobado", `Estado de la aprobación: ${aprobacion.estado}`);
  const esLider = !!centro && centro.lider.id === aprobacion.aprobadorId;
  reg(
    "C06",
    esLider,
    !centro
      ? "Sin centro de costo para validar al líder"
      : esLider
        ? `${aprobacion.aprobador} es líder de ${centro.codigo}`
        : `${aprobacion.aprobador} no es el líder de ${centro.codigo} (líder: ${centro.lider.nombre})`,
  );
  const tope = centro?.lider.topeAprobacion;
  reg(
    "C07",
    tope !== undefined && cotizacion.total <= tope,
    tope === undefined ? "Sin tope definido" : `Total ${COP(cotizacion.total)} vs tope ${COP(tope)} de ${centro!.lider.nombre}`,
  );
  reg(
    "C08",
    aprobacion.monto >= cotizacion.total,
    `Monto aprobado ${COP(aprobacion.monto)} vs total cotizado ${COP(cotizacion.total)}`,
  );

  // C09 consistencia aritmética
  const sumaItems = solicitud.items.reduce((a, i) => a + i.cantidad * i.valorUnitario, 0);
  const aritmeticaOk =
    sumaItems === cotizacion.subtotal && cotizacion.subtotal + cotizacion.iva === cotizacion.total;
  reg(
    "C09",
    aritmeticaOk,
    aritmeticaOk
      ? "Ítems = subtotal y subtotal + IVA = total"
      : `Ítems ${COP(sumaItems)}, subtotal ${COP(cotizacion.subtotal)}, IVA ${COP(cotizacion.iva)}, total ${COP(cotizacion.total)}`,
  );

  // C10 indicador IVA: se deduce la tasa efectiva de la cotización
  const tasaEfectiva = cotizacion.subtotal > 0 ? Math.round((cotizacion.iva / cotizacion.subtotal) * 100) : NaN;
  const indicador = maestros.indicadoresIva.find((i) => i.tasa === tasaEfectiva);
  reg(
    "C10",
    !!indicador,
    indicador
      ? `Tasa ${tasaEfectiva}% -> indicador ${indicador.codigo}`
      : `La tasa efectiva ${tasaEfectiva}% no corresponde a ningún indicador del maestro`,
  );

  // C11 condición de pago
  const condicion = maestros.condicionesPago.find((c) => c.dias === cotizacion.condicionPagoDias);
  reg(
    "C11",
    !!condicion,
    condicion
      ? `"${cotizacion.condicionPagoTexto}" -> ${condicion.codigo}`
      : `"${cotizacion.condicionPagoTexto}" no existe en el maestro de condiciones de pago`,
  );

  // C12 retroactividad: existe factura emitida antes de la fecha de proceso de la OC
  const retroactiva = !!factura && factura.fecha <= correo.fecha;
  reg(
    "C12",
    !retroactiva,
    factura
      ? `Factura ${factura.numero} del ${factura.fecha} es anterior a la OC (${correo.fecha}): compra ya ejecutada sin OC`
      : "Sin factura previa",
  );

  // C13 duplicados
  const duplicada = solicitudesConOC.has(solicitud.id);
  reg("C13", !duplicada, duplicada ? `Ya existe una OC para ${solicitud.id}` : "Sin OC previa");

  // Decisión
  const fallidos = hallazgos.filter((h) => !h.ok);
  const decision: Decision = fallidos.some((h) => h.severidad === "bloqueante")
    ? "RECHAZAR"
    : fallidos.length > 0
      ? "ESCALAR"
      : "CREAR";

  const resumen =
    decision === "CREAR"
      ? "Todos los controles aprobados."
      : `${fallidos.length} control(es) fallido(s): ${fallidos.map((h) => h.control).join(", ")}.`;

  const datosOC: DatosOC | null =
    decision === "RECHAZAR" || !proveedor || !centro
      ? null
      : {
          solicitudId: solicitud.id,
          proveedorId: proveedor.id,
          proveedorNombre: proveedor.nombre,
          centroCosto: solicitud.centroCosto,
          subarea: solicitud.subarea,
          indicadorIva: indicador?.codigo ?? proveedor.defaults.indicadorIva,
          condicionPago: condicion?.codigo ?? proveedor.defaults.condicionPago,
          moneda: solicitud.moneda,
          subtotal: cotizacion.subtotal,
          iva: cotizacion.iva,
          total: cotizacion.total,
          aprobador: aprobacion.aprobador,
          retroactiva,
          fechaDocumento: correo.fecha,
        };

  return { solicitudId: solicitud.id, decision, resumen, hallazgos, datosOC };
}
