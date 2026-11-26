// @ts-nocheck
// GENERADO por scripts/build-modulo.ts desde src/tools/oc.ts: no editar a mano.
// Herramientas oc_* (leer_paquete, validar, generar_evidencia, construir_payload, crear), sin servidor.
// Requiere: zod, pdf-lib. Uso: oc.validar.execute({ caso }, { directory, sessionId }) → string JSON.
// src/tools/oc.ts
import { mkdirSync as mkdirSync4, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join6 } from "node:path";
import { z as z4 } from "zod/v4";

// src/domain/confirmaciones.ts
var sesiones = /* @__PURE__ */ new Map();
var estado = (id) => {
  let e = sesiones.get(id);
  if (!e) {
    e = { mensajesUsuario: 0, pendientes: /* @__PURE__ */ new Map(), excepciones: /* @__PURE__ */ new Map() };
    sesiones.set(id, e);
  }
  return e;
};
function marcarPendiente(sessionId, caso2, excepciones = []) {
  const e = estado(sessionId);
  if (!e.pendientes.has(caso2)) e.pendientes.set(caso2, e.mensajesUsuario);
  if (!e.excepciones.get(caso2)?.length && excepciones.length > 0) {
    e.excepciones.set(caso2, excepciones.map(({ codigo, detalle }) => ({ codigo, detalle })));
  }
}
function confirmacionVerificable(sessionId, caso2) {
  const e = estado(sessionId);
  const mensajesAlMarcar = e.pendientes.get(caso2);
  return mensajesAlMarcar !== void 0 && e.mensajesUsuario > mensajesAlMarcar;
}
function consumirPendiente(sessionId, caso2) {
  const e = estado(sessionId);
  e.pendientes.delete(caso2);
  e.excepciones.delete(caso2);
}

// src/domain/candado.ts
var colas = /* @__PURE__ */ new Map();
async function conCandado(clave, fn) {
  const anterior = colas.get(clave) ?? Promise.resolve();
  const actual = anterior.then(fn);
  const cola = actual.then(
    () => void 0,
    () => void 0
    // un fallo no debe bloquear a quien espera detrás
  );
  colas.set(clave, cola);
  try {
    return await actual;
  } finally {
    if (colas.get(clave) === cola) colas.delete(clave);
  }
}

// src/domain/evidencia.ts
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
var sha256 = (texto) => createHash("sha256").update(texto, "utf8").digest("hex");
function contenidoEvidencia(a) {
  return [
    "EVIDENCIA DE APROBACI\xD3N",
    `De: ${a.de}`,
    `Para: ${a.para}`,
    `Fecha: ${a.fecha}`,
    `Asunto: ${a.asunto}`,
    "",
    a.texto
  ].join("\n");
}
function ajustar(texto, ancho, max) {
  const salida = [];
  for (const linea of texto.split("\n")) {
    let actual = "";
    for (const palabra of linea.split(" ")) {
      const prueba = actual ? `${actual} ${palabra}` : palabra;
      if (ancho(prueba) > max && actual) {
        salida.push(actual);
        actual = palabra;
      } else actual = prueba;
    }
    salida.push(actual);
  }
  return salida;
}
async function escribirPdf(ruta, texto) {
  try {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const fuente = await doc.embedFont(StandardFonts.Courier);
    const tam = 9;
    const margen = 50;
    const alto = 14;
    let pagina = doc.addPage([595, 842]);
    let y = 842 - margen;
    const seguro2 = texto.replace(/[^ -ÿ\n]/g, "?");
    for (const linea of ajustar(seguro2, (t) => fuente.widthOfTextAtSize(t, tam), 595 - margen * 2)) {
      if (y < margen) {
        pagina = doc.addPage([595, 842]);
        y = 842 - margen;
      }
      pagina.drawText(linea, { x: margen, y, size: tam, font: fuente });
      y -= alto;
    }
    writeFileSync(ruta, await doc.save());
    return true;
  } catch {
    return false;
  }
}
async function generarEvidencia(directory, caso2, aprobacion) {
  const dir = join(directory, "out", caso2);
  mkdirSync(dir, { recursive: true });
  const contenido = contenidoEvidencia(aprobacion);
  const hash = sha256(contenido);
  const completo = `${contenido}

-----
sha256 (del contenido anterior a esta l\xEDnea): ${hash}
`;
  writeFileSync(join(dir, "aprobacion.txt"), completo, "utf8");
  const evidencia = { ruta: `out/${caso2}/aprobacion.txt`, sha256: hash };
  if (await escribirPdf(join(dir, "aprobacion.pdf"), completo)) evidencia.ruta_pdf = `out/${caso2}/aprobacion.pdf`;
  return evidencia;
}

// src/domain/util.ts
function normalizarNit(nit) {
  const base = nit.trim().split("-")[0] ?? "";
  return base.replace(/\D/g, "");
}
function normalizarNombre(nombre) {
  return nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\b(s a s|sas|s a|sa|ltda|ltd|e u|eu)\b/g, " ").replace(/\s+/g, " ").trim();
}
function parseMonto(texto) {
  const limpio = texto.replace(/[^\d.,]/g, "");
  if (!limpio) return null;
  const n = Number(limpio.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function sumarDias(fechaIso2, dias) {
  const [a, m, d] = fechaIso2.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}
function diasEntre(desde, hasta) {
  const t = (f) => {
    const [a, m, d] = f.split("-").map(Number);
    return Date.UTC(a, m - 1, d);
  };
  return Math.round((t(hasta) - t(desde)) / 864e5);
}
var cop = (n) => `$${Math.round(n).toLocaleString("es-CO")}`;
function canonico(valor) {
  const ordenar = (v) => {
    if (Array.isArray(v)) return v.map(ordenar);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, ordenar(x)])
      );
    }
    return v;
  };
  return JSON.stringify(ordenar(valor));
}
function acortar(texto, max) {
  const limpio = texto.replace(/\s+/g, " ").trim();
  if (limpio.length <= max) return limpio;
  const corte = limpio.slice(0, max);
  if (limpio[max] === " ") return corte.trimEnd();
  const ultimoEspacio = corte.lastIndexOf(" ");
  return (ultimoEspacio > 0 ? corte.slice(0, ultimoEspacio) : corte).trimEnd();
}

// src/domain/controles.ts
var TOLERANCIA_COTIZACION = 0.02;
var TOLERANCIA_ARITMETICA = 1;
function buscarProveedor(proveedores, nit, nombre) {
  if (nit && normalizarNit(nit)) {
    const buscado2 = normalizarNit(nit);
    return proveedores.find((p) => normalizarNit(p.nit) === buscado2);
  }
  const buscado = normalizarNombre(nombre);
  return proveedores.find((p) => normalizarNombre(p.nombre) === buscado);
}
function buscarCentro(centros, codigo) {
  return centros.find((c) => c.centro_costo === codigo);
}
function buscarAprobador(centro, email) {
  return centro.aprobadores.find((a) => a.email.toLowerCase() === email.toLowerCase());
}
var listaAprobadores = (centro) => centro.aprobadores.map((a) => `${a.nombre ?? a.email} (tope ${cop(a.tope)})`).join("; ");
function validar(p, m) {
  const bloqueos = [];
  const confirmaciones = [];
  const derivados = {};
  const s = p.solicitud;
  let retroactiva = false;
  const proveedor = buscarProveedor(m.proveedores, s.proveedor_nit, s.proveedor_nombre);
  if (!proveedor) {
    bloqueos.push({
      codigo: "RC1",
      detalle: `El proveedor "${s.proveedor_nombre}" (NIT ${s.proveedor_nit ?? "no informado"}) no existe en el maestro de proveedores.`,
      accion_sugerida: "Pedir al solicitante que gestione el alta del proveedor en el maestro SAP y reenv\xEDe la solicitud con el NIT."
    });
  } else if (!proveedor.activo) {
    bloqueos.push({
      codigo: "RC1",
      detalle: `El proveedor "${proveedor.nombre}" (SAP ${proveedor.codigo_sap}) est\xE1 inactivo.`,
      accion_sugerida: "Solicitar la reactivaci\xF3n del proveedor en SAP o elegir un proveedor activo."
    });
  }
  const centro = buscarCentro(m.centros, s.centro_costo);
  let aprobador;
  if (!p.aprobacion) {
    bloqueos.push({
      codigo: "RC2",
      detalle: "No hay correo de aprobaci\xF3n en el paquete.",
      accion_sugerida: "Pedir al solicitante el correo de aprobaci\xF3n del l\xEDder del centro de costo."
    });
  } else if (!p.aprobacion.aprobado) {
    bloqueos.push({
      codigo: "RC2",
      detalle: `El correo de ${p.aprobacion.de} no contiene la palabra "Aprobado".`,
      accion_sugerida: "Pedir una aprobaci\xF3n expl\xEDcita del l\xEDder antes de continuar."
    });
  } else if (centro) {
    aprobador = buscarAprobador(centro, p.aprobacion.de);
    if (!aprobador) {
      const alcanzan = centro.aprobadores.filter((a) => a.tope >= s.valor_total);
      bloqueos.push({
        codigo: "RC2",
        detalle: `${p.aprobacion.de} no figura como aprobador del centro ${centro.centro_costo} (${centro.nombre ?? ""}). Aprobadores autorizados: ${listaAprobadores(centro)}.`,
        accion_sugerida: alcanzan.length ? `Obtener la aprobaci\xF3n de ${alcanzan.map((a) => a.nombre ?? a.email).join(" o ")}.` : `El valor ${cop(s.valor_total)} supera el tope de todos los aprobadores del centro: requiere aprobaci\xF3n de un nivel superior definido por la compa\xF1\xEDa.`
      });
    }
  }
  if (aprobador && s.valor_total > aprobador.tope) {
    bloqueos.push({
      codigo: "RC3",
      detalle: `El valor ${cop(s.valor_total)} supera el tope de ${aprobador.nombre ?? aprobador.email} (${cop(aprobador.tope)}) en ${s.centro_costo}.`,
      accion_sugerida: "Obtener la aprobaci\xF3n de un aprobador del centro con tope suficiente."
    });
  }
  if (!centro) {
    bloqueos.push({
      codigo: "RC4",
      detalle: `El centro de costo ${s.centro_costo} no existe.`,
      accion_sugerida: "Corregir el centro de costo en la solicitud."
    });
  } else if (!centro.subareas.some((x) => normalizarNombre(x) === normalizarNombre(s.subarea))) {
    bloqueos.push({
      codigo: "RC4",
      detalle: `La sub\xE1rea "${s.subarea}" no pertenece a ${centro.centro_costo}. Sub\xE1reas v\xE1lidas: ${centro.subareas.join(", ")}.`,
      accion_sugerida: "Corregir la sub\xE1rea o el centro de costo en la solicitud."
    });
  }
  const monedaCot = p.cotizacion?.moneda;
  if (s.moneda !== "COP" || monedaCot !== void 0 && monedaCot !== "COP") {
    bloqueos.push({
      codigo: "RC11",
      detalle: `La solicitud est\xE1 en ${s.moneda}${monedaCot && monedaCot !== s.moneda ? ` y la cotizaci\xF3n en ${monedaCot}` : ""}; este proceso solo opera en COP.`,
      accion_sugerida: "Pedir la solicitud y la cotizaci\xF3n en COP, o gestionar la compra por el proceso de moneda extranjera.",
      valores: { moneda_solicitud: s.moneda, moneda_cotizacion: monedaCot ?? "sin cotizaci\xF3n" }
    });
  }
  const codigoIva = s.indicador_iva ?? proveedor?.indicador_iva_default;
  if (codigoIva) {
    const ind = m.indicadores.find((i) => i.codigo === codigoIva);
    if (!ind) {
      bloqueos.push({
        codigo: "RC12",
        detalle: `El indicador de IVA ${codigoIva} no existe en el maestro de indicadores; no se puede calcular el precio neto.`,
        accion_sugerida: "Corregir el indicador de IVA en la solicitud."
      });
    } else if (p.cotizacion) {
      const { tasa, base, valor } = p.cotizacion.iva;
      const pct = (x) => `${+(x * 100).toFixed(2)} %`;
      if (tasa !== null && Math.abs(tasa - ind.tasa) > 1e-9) {
        confirmaciones.push({
          codigo: "RC12",
          detalle: `La cotizaci\xF3n liquida IVA al ${pct(tasa)} pero el indicador ${ind.codigo} (${ind.descripcion}) equivale a ${pct(ind.tasa)}.`,
          accion_sugerida: "Confirmar el indicador correcto con el proveedor o corregir la solicitud antes de crear la OC.",
          valores: { tasa_cotizacion: tasa, indicador: ind.codigo, tasa_indicador: ind.tasa }
        });
      } else if (base !== null && valor !== null && (Math.abs(base + valor - p.cotizacion.total) > 1 || Math.abs(base * (tasa ?? ind.tasa) - valor) > 1)) {
        confirmaciones.push({
          codigo: "RC12",
          detalle: `Las cifras de IVA de la cotizaci\xF3n no cuadran: base ${cop(base)} + IVA ${cop(valor)} frente a un total de ${cop(p.cotizacion.total)}.`,
          accion_sugerida: "Pedir al proveedor una cotizaci\xF3n con el IVA bien desglosado.",
          valores: { base, iva: valor, total: p.cotizacion.total }
        });
      }
    }
  }
  if (!p.cotizacion) {
    confirmaciones.push({
      codigo: "RC5",
      detalle: "No hay cotizaci\xF3n (o es ilegible); el valor no puede contrastarse con el proveedor.",
      accion_sugerida: "Pedir la cotizaci\xF3n o confirmar que se contin\xFAa sin ella."
    });
  } else {
    const dif = s.valor_total === 0 ? Infinity : Math.abs(p.cotizacion.total - s.valor_total) / s.valor_total;
    if (dif > TOLERANCIA_COTIZACION) {
      confirmaciones.push({
        codigo: "RC5",
        detalle: `La cotizaci\xF3n (${cop(p.cotizacion.total)}) difiere ${(dif * 100).toFixed(1)} % de la solicitud (${cop(s.valor_total)}); la tolerancia es 2 %.`,
        accion_sugerida: "Confirmar cu\xE1l valor es el correcto o pedir al solicitante que corrija la solicitud.",
        valores: {
          solicitud: s.valor_total,
          cotizacion: p.cotizacion.total,
          diferencia_pct: Number((dif * 100).toFixed(2))
        }
      });
    }
  }
  if (!s.indicador_iva && proveedor) {
    const ind = m.indicadores.find((i) => i.codigo === proveedor.indicador_iva_default);
    derivados.indicador_iva = { valor: proveedor.indicador_iva_default, fuente: "maestro.proveedores" };
    confirmaciones.push({
      codigo: "RC6",
      detalle: `La solicitud no informa indicador de IVA; se deriv\xF3 ${proveedor.indicador_iva_default}${ind ? ` (${ind.descripcion})` : ""} del maestro del proveedor.`,
      accion_sugerida: "Confirmar que el indicador derivado es el correcto para esta compra.",
      valores: { indicador_derivado: proveedor.indicador_iva_default }
    });
  }
  if (!s.condiciones_pago && proveedor) {
    derivados.condiciones_pago = { valor: proveedor.condiciones_pago_default, fuente: "maestro.proveedores" };
  }
  if (p.factura && p.factura.fecha < s.fecha_solicitud) {
    retroactiva = true;
    confirmaciones.push({
      codigo: "RC8",
      detalle: `La factura ${p.factura.numero} (${p.factura.fecha}) es ${diasEntre(p.factura.fecha, s.fecha_solicitud)} d\xEDas anterior a la solicitud (${s.fecha_solicitud}): la compra se ejecut\xF3 antes de crear la OC.`,
      accion_sugerida: "Confirmar para crear la OC con retroactiva = true (queda en el log de control) y avisar al l\xEDder del centro.",
      valores: { factura: p.factura.numero, fecha_factura: p.factura.fecha, fecha_solicitud: s.fecha_solicitud }
    });
  }
  if (p.aprobacion && p.aprobacion.fecha.slice(0, 10) < s.fecha_solicitud) {
    confirmaciones.push({
      codigo: "RC9",
      detalle: `La aprobaci\xF3n (${p.aprobacion.fecha.slice(0, 10)}) es anterior a la solicitud (${s.fecha_solicitud}).`,
      accion_sugerida: "Confirmar que la aprobaci\xF3n corresponde a esta solicitud."
    });
  }
  const esperado = s.cantidad * s.valor_unitario;
  if (Math.abs(esperado - s.valor_total) > TOLERANCIA_ARITMETICA) {
    bloqueos.push({
      codigo: "RC10",
      detalle: `cantidad \xD7 valor unitario = ${cop(esperado)}, pero valor_total = ${cop(s.valor_total)}.`,
      accion_sugerida: "Pedir al solicitante que corrija las cifras de la solicitud."
    });
  }
  return { apta: bloqueos.length === 0, bloqueos, confirmaciones, derivados, retroactiva };
}

// src/domain/maestros.ts
import { readFileSync } from "node:fs";
import { join as join2 } from "node:path";

// src/types.ts
import { z } from "zod/v4";
var exito = (data) => ({ ok: true, data });
var falla = (error) => ({ ok: false, error });
var fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "debe tener formato AAAA-MM-DD");
var SolicitudSchema = z.object({
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
  fecha_solicitud: fechaIso
});
var CorreoSchema = z.object({
  id: z.string(),
  de: z.string(),
  asunto: z.string(),
  fecha: z.string(),
  adjuntos: z.array(z.string()).optional()
});
var AprobacionSchema = z.object({
  de: z.string(),
  para: z.string().optional(),
  fecha: z.string(),
  asunto: z.string().optional(),
  cuerpo: z.string()
});
var OrdenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable()
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({
    email: z.string(),
    fecha_aprobacion: z.string(),
    evidencia_sha256: z.string().length(64)
  }),
  posiciones: z.array(
    z.object({
      numero: z.number().int().positive(),
      descripcion: z.string().max(40),
      cantidad: z.number(),
      unidad: z.enum(["UN", "H", "MES"]),
      precio_unitario: z.number(),
      centro_costo: z.string(),
      subarea: z.string(),
      indicador_iva: z.string()
    })
  ).min(1),
  excepciones: z.array(
    z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() })
  )
});

// src/domain/maestros.ts
var rutaFixtures = (directory) => join2(directory, "fixtures", "reto-03");
function leer(directory, archivo) {
  const ruta = join2(rutaFixtures(directory), "maestros", archivo);
  try {
    return JSON.parse(readFileSync(ruta, "utf8"));
  } catch (e) {
    throw new Error(`No se pudo leer el maestro ${archivo}: ${e.message}`);
  }
}
function cargarMaestros(directory) {
  try {
    return exito({
      proveedores: leer(directory, "proveedores.json"),
      centros: leer(directory, "centros-costo.json"),
      indicadores: leer(directory, "indicadores-iva.json"),
      condiciones: leer(directory, "condiciones-pago.json")
    });
  } catch (e) {
    return falla(e.message);
  }
}

// src/domain/paquete.ts
import { existsSync, readdirSync, readFileSync as readFileSync2 } from "node:fs";
import { join as join3 } from "node:path";
import { z as z2 } from "zod/v4";
var NOMBRE_CASO = /^[\w-]+$/;
function listarCasos(directory) {
  const base = join3(rutaFixtures(directory), "solicitudes");
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}
function leerJson(ruta, nombre, esquema) {
  let crudo;
  try {
    crudo = JSON.parse(readFileSync2(ruta, "utf8"));
  } catch (e) {
    return falla(`${nombre} est\xE1 ausente o es un JSON malformado (${e.message}).`);
  }
  const r = esquema.safeParse(crudo);
  if (!r.success) return falla(`${nombre} tiene datos inv\xE1lidos:
${z2.prettifyError(r.error)}`);
  return exito(r.data);
}
var unaLinea = (texto, re) => texto.match(re)?.[1]?.trim() ?? null;
function parsearIva(texto) {
  const pct = texto.match(/^IVA\s*(\d+(?:[.,]\d+)?)\s*%/im)?.[1];
  const tasa = pct ? Number(pct.replace(",", ".")) / 100 : null;
  const base = parseMonto(texto.match(/^Base gravable[^:\n]*:\s*(.+)$/im)?.[1] ?? "");
  const valor = parseMonto(texto.match(/^IVA[^:\n]*:\s*(.+)$/im)?.[1] ?? "");
  return { tasa, base, valor };
}
function parsearCotizacion(texto) {
  const lineaTotal = texto.match(/^TOTAL[^:\n]*:\s*(.+)$/im)?.[1] ?? "";
  const total = parseMonto(lineaTotal);
  if (total === null) return null;
  const fecha = unaLinea(texto, /^Fecha:\s*(\d{4}-\d{2}-\d{2})/im);
  const dias = Number(unaLinea(texto, /Validez de la oferta:\s*(\d+)\s*d[ií]as/i));
  const nitCrudo = unaLinea(texto, /^NIT:\s*(.+)$/im);
  return {
    referencia: unaLinea(texto, /^COTIZACI[ÓO]N\s+(\S+)/im),
    proveedor: unaLinea(texto, /^Proveedor:\s*(.+)$/im) ?? "",
    nit: nitCrudo ? normalizarNit(nitCrudo) : null,
    total,
    moneda: /\bUSD\b/.test(lineaTotal) ? "USD" : "COP",
    validez_hasta: fecha && dias ? sumarDias(fecha, dias) : null,
    iva: parsearIva(texto),
    texto
  };
}
function parsearFactura(texto) {
  const total = parseMonto(texto.match(/^TOTAL:\s*(.+)$/im)?.[1] ?? "");
  const numero = unaLinea(texto, /FACTURA[^\n]*?No\.?\s*([A-Z0-9-]+)/i);
  const fecha = unaLinea(texto, /Fecha de emisi[óo]n:\s*(\d{4}-\d{2}-\d{2})/i);
  if (total === null || !numero || !fecha) return null;
  return { numero, fecha, total };
}
function esAprobado(cuerpo) {
  return /\baprobad[oa]\b/i.test(cuerpo) && !/\bno\s+(?:est[aá]\s+)?aprobad[oa]\b/i.test(cuerpo);
}
function cargarPaquete(directory, caso2) {
  if (!NOMBRE_CASO.test(caso2)) return falla(`Nombre de caso inv\xE1lido: "${caso2}".`);
  const dir = join3(rutaFixtures(directory), "solicitudes", caso2);
  if (!existsSync(dir)) {
    return falla(`No existe el caso "${caso2}". Casos disponibles: ${listarCasos(directory).join(", ") || "ninguno"}.`);
  }
  const correo = leerJson(join3(dir, "correo.json"), "correo.json", CorreoSchema);
  if (!correo.ok) return correo;
  const solicitud = leerJson(join3(dir, "solicitud.json"), "solicitud.json", SolicitudSchema);
  if (!solicitud.ok) return solicitud;
  const faltantes = [];
  let cotizacion = null;
  const rutaCot = join3(dir, "cotizacion.txt");
  if (existsSync(rutaCot)) {
    cotizacion = parsearCotizacion(readFileSync2(rutaCot, "utf8"));
    if (!cotizacion) faltantes.push("cotizacion.txt (ilegible: no se encontr\xF3 el total)");
  } else faltantes.push("cotizacion.txt");
  let aprobacion = null;
  const rutaApr = join3(dir, "aprobacion.json");
  if (existsSync(rutaApr)) {
    const a = leerJson(rutaApr, "aprobacion.json", AprobacionSchema);
    if (a.ok) {
      aprobacion = {
        de: a.data.de,
        para: a.data.para ?? "",
        fecha: a.data.fecha,
        asunto: a.data.asunto ?? "",
        aprobado: esAprobado(a.data.cuerpo),
        texto: a.data.cuerpo
      };
    } else faltantes.push("aprobacion.json (malformado)");
  } else faltantes.push("aprobacion.json");
  let factura = null;
  const rutaFac = join3(dir, "factura.txt");
  if (existsSync(rutaFac)) {
    factura = parsearFactura(readFileSync2(rutaFac, "utf8"));
    if (!factura) faltantes.push("factura.txt (ilegible)");
  } else if (correo.data.adjuntos?.some((a) => /^factura/i.test(a))) {
    faltantes.push("factura.txt");
  }
  return exito({
    correo: { id: correo.data.id, de: correo.data.de, asunto: correo.data.asunto, fecha: correo.data.fecha },
    solicitud: solicitud.data,
    cotizacion,
    aprobacion,
    factura,
    faltantes
  });
}

// src/domain/flujo.ts
var sinFaltantes = ({ faltantes: _f, ...resto }) => resto;
function resolverCaso(directory, caso2, suministrado) {
  const cargado = cargarPaquete(directory, caso2);
  if (!cargado.ok) return cargado;
  const maestros = cargarMaestros(directory);
  if (!maestros.ok) return maestros;
  const paquete = sinFaltantes(cargado.data);
  if (suministrado !== void 0 && suministrado !== null) {
    const { faltantes: _f, ...recibido } = suministrado;
    if (canonico(recibido) !== canonico(paquete)) {
      return falla(
        "El paquete enviado no coincide con el del caso. Omite el argumento `paquete`: la herramienta lo lee directamente del caso."
      );
    }
  }
  return exito({ paquete, faltantes: cargado.data.faltantes, maestros: maestros.data });
}
function validarCaso(directory, caso2, suministrado) {
  const r = resolverCaso(directory, caso2, suministrado);
  if (!r.ok) return r;
  return exito({ ...r.data, validacion: validar(r.data.paquete, r.data.maestros) });
}

// src/domain/payload.ts
import { z as z3 } from "zod/v4";
var redondear2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
function desgloseIva(valorUnitario, cantidad, codigo, tasa) {
  const neto = redondear2(valorUnitario / (1 + tasa));
  const totalConIva = redondear2(valorUnitario * cantidad);
  const base = redondear2(neto * cantidad);
  return {
    indicador: codigo,
    tasa,
    valor_unitario_con_iva: valorUnitario,
    precio_unitario_neto: neto,
    iva_unitario: redondear2(valorUnitario - neto),
    cantidad,
    base_total: base,
    iva_total: redondear2(totalConIva - base),
    total_con_iva: totalConIva
  };
}
var SOCIEDAD = "1000";
function inferirUnidad(descripcion) {
  return /\bhoras?\b/i.test(descripcion) ? "H" : "UN";
}
function construirPayload(p, m, v, evidenciaSha256) {
  if (!v.apta) return falla("No se puede construir la OC: hay bloqueos sin resolver.");
  if (!p.aprobacion) return falla("No se puede construir la OC sin correo de aprobaci\xF3n.");
  const s = p.solicitud;
  const prov = buscarProveedor(m.proveedores, s.proveedor_nit, s.proveedor_nombre);
  if (!prov) return falla("Proveedor no encontrado en el maestro.");
  const condiciones = s.condiciones_pago ?? v.derivados.condiciones_pago?.valor ?? prov.condiciones_pago_default;
  const iva = s.indicador_iva ?? v.derivados.indicador_iva?.valor ?? prov.indicador_iva_default;
  const descripcion = acortar(s.descripcion, 40);
  const indicador = m.indicadores.find((i) => i.codigo === iva);
  if (!indicador) return falla(`El indicador de IVA ${iva} no existe en el maestro; no se puede calcular el precio neto.`);
  const precioNeto = redondear2(s.valor_unitario / (1 + indicador.tasa));
  const candidato = {
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
        indicador_iva: iva
      }
    ],
    excepciones: v.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: null }))
  };
  const validado = OrdenCompraSchema.safeParse(candidato);
  if (!validado.success) return falla(`El payload no cumple el esquema de la OC:
${z3.prettifyError(validado.error)}`);
  const trazabilidad = {
    "referencia.solicitud_id": { valor: s.solicitud_id, fuente: "solicitud" },
    "referencia.correo_id": { valor: p.correo.id, fuente: "correo" },
    "referencia.cotizacion_ref": { valor: candidato.referencia.cotizacion_ref, fuente: "cotizacion" },
    sociedad: { valor: SOCIEDAD, fuente: "derivado", nota: "constante de configuraci\xF3n SAP del reto" },
    organizacion_compras: { valor: SOCIEDAD, fuente: "derivado", nota: "constante de configuraci\xF3n SAP del reto" },
    "proveedor.codigo_sap": { valor: prov.codigo_sap, fuente: "maestro.proveedores" },
    "proveedor.nit": { valor: prov.nit, fuente: "maestro.proveedores" },
    "proveedor.nombre": { valor: prov.nombre, fuente: "maestro.proveedores" },
    moneda: { valor: s.moneda, fuente: "solicitud" },
    condiciones_pago: s.condiciones_pago ? { valor: condiciones, fuente: "solicitud" } : { valor: condiciones, fuente: "derivado", nota: "RC7: tomado de maestro.proveedores.condiciones_pago_default" },
    "aprobador.email": { valor: p.aprobacion.de, fuente: "aprobacion" },
    "aprobador.fecha_aprobacion": { valor: p.aprobacion.fecha, fuente: "aprobacion" },
    "aprobador.evidencia_sha256": { valor: evidenciaSha256, fuente: "derivado", nota: "sha256 de out/<caso>/aprobacion.txt" },
    "posiciones[0].numero": { valor: 10, fuente: "derivado", nota: "primera posici\xF3n" },
    "posiciones[0].descripcion": {
      valor: descripcion,
      fuente: "solicitud",
      nota: s.descripcion === descripcion ? void 0 : "acortada a 40 caracteres (l\xEDmite SAP)"
    },
    "posiciones[0].cantidad": { valor: s.cantidad, fuente: "solicitud" },
    "posiciones[0].unidad": { valor: candidato.posiciones[0]?.unidad, fuente: "derivado", nota: "H si la descripci\xF3n menciona horas; si no, UN" },
    "posiciones[0].precio_unitario": {
      valor: precioNeto,
      fuente: "derivado",
      nota: `precio neto = valor_unitario con IVA (${s.valor_unitario}) / (1 + tasa ${indicador.tasa} del indicador ${indicador.codigo}), a 2 decimales`
    },
    "posiciones[0].centro_costo": { valor: s.centro_costo, fuente: "solicitud" },
    "posiciones[0].subarea": { valor: s.subarea, fuente: "solicitud" },
    "posiciones[0].indicador_iva": s.indicador_iva ? { valor: iva, fuente: "solicitud" } : { valor: iva, fuente: "derivado", nota: "RC6: tomado de maestro.proveedores.indicador_iva_default" },
    excepciones: { valor: candidato.excepciones.map((e) => e.codigo), fuente: "derivado", nota: "confirmaciones de oc_validar" }
  };
  return exito({ payload: validado.data, trazabilidad, iva: desgloseIva(s.valor_unitario, s.cantidad, indicador.codigo, indicador.tasa) });
}

// src/domain/salida.ts
import { appendFileSync, existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync3, rmSync, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join4 } from "node:path";
var CABECERA_CSV = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n";
var csv = (v) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
function registrarControl(directory, fila) {
  const out = join4(directory, "out");
  mkdirSync2(out, { recursive: true });
  const archivo = join4(out, "control.csv");
  if (!existsSync2(archivo)) writeFileSync2(archivo, CABECERA_CSV);
  const linea = [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc ?? "",
    String(fila.retroactiva),
    fila.bloqueos.join(";"),
    fila.confirmaciones.join(";"),
    (/* @__PURE__ */ new Date()).toISOString()
  ].map(csv).join(",");
  appendFileSync(archivo, linea + "\n");
}

// src/sap/mock.ts
import { appendFileSync as appendFileSync2, existsSync as existsSync3, mkdirSync as mkdirSync3, readFileSync as readFileSync4 } from "node:fs";
import { join as join5 } from "node:path";
var PRIMER_NUMERO = 4500000001;
var MockSapAdapter = class {
  constructor(directory) {
    this.directory = directory;
    this.archivo = join5(directory, "out", "sap", "ordenes.jsonl");
  }
  directory;
  archivo;
  registros() {
    if (!existsSync3(this.archivo)) return [];
    return readFileSync4(this.archivo, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  }
  async consultarProveedor(nit) {
    const maestros = cargarMaestros(this.directory);
    if (!maestros.ok) return null;
    const p = buscarProveedor(maestros.data.proveedores, nit, "");
    return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null;
  }
  async crearOrden(orden) {
    mkdirSync3(join5(this.directory, "out", "sap"), { recursive: true });
    const numero_oc = String(PRIMER_NUMERO + this.registros().length);
    const fecha = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    appendFileSync2(this.archivo, JSON.stringify({ numero_oc, fecha, orden }) + "\n");
    return { numero_oc, fecha };
  }
  async buscarOrdenPorReferencia(solicitud_id) {
    const r = this.registros().find((x) => x.orden.referencia.solicitud_id === solicitud_id);
    return r ? { numero_oc: r.numero_oc, fecha: r.fecha } : null;
  }
};

// src/tools/tipos.ts
var definir = (h) => h;
var ok = (data) => JSON.stringify({ ok: true, data });
var fail = (error, extra = {}) => JSON.stringify({ ok: false, error, ...extra });
async function seguro(fn) {
  try {
    return await fn();
  } catch (e) {
    return fail(`Error inesperado: ${e.message}`);
  }
}

// src/tools/oc.ts
var caso = z4.string().describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, p. ej. sol-001");
var paqueteOpcional = z4.record(z4.string(), z4.unknown()).optional().describe(
  "OPCIONAL: om\xEDtelo. La herramienta lee el paquete directamente del caso. Si lo env\xEDas debe ser id\xE9ntico al de oc_leer_paquete."
);
var leer_paquete = definir({
  description: "Lee y normaliza el paquete de una solicitud (correo, solicitud, cotizaci\xF3n, aprobaci\xF3n y factura si existe). Un adjunto ausente se informa en `faltantes`.",
  args: { caso },
  async execute({ caso: caso2 }, ctx) {
    return seguro(() => {
      const r = resolverCaso(ctx.directory, caso2);
      return r.ok ? ok({ ...r.data.paquete, faltantes: r.data.faltantes }) : fail(r.error);
    });
  }
});
var validar2 = definir({
  description: "Aplica las reglas de control RC1\u2013RC12 al caso y devuelve { apta, bloqueos[], confirmaciones[], derivados, retroactiva }. Los bloqueos impiden crear la OC.",
  args: { caso, paquete: paqueteOpcional },
  async execute({ caso: caso2, paquete }, ctx) {
    return seguro(() => {
      const r = validarCaso(ctx.directory, caso2, paquete);
      if (!r.ok) return fail(r.error);
      const { apta, confirmaciones } = r.data.validacion;
      if (apta && confirmaciones.length > 0) marcarPendiente(ctx.sessionId, caso2, confirmaciones);
      return ok(r.data.validacion);
    });
  }
});
var generar_evidencia = definir({
  description: "Genera la evidencia de aprobaci\xF3n del caso (out/<caso>/aprobacion.txt y .pdf) y devuelve su ruta y sha256.",
  args: { caso },
  async execute({ caso: caso2 }, ctx) {
    return seguro(async () => {
      const r = resolverCaso(ctx.directory, caso2);
      if (!r.ok) return fail(r.error);
      if (!r.data.paquete.aprobacion) return fail("No hay correo de aprobaci\xF3n para generar la evidencia.");
      return ok(await generarEvidencia(ctx.directory, caso2, r.data.paquete.aprobacion));
    });
  }
});
var construir_payload = definir({
  description: "Construye la OC tal como quedar\xEDa en SAP (esquema validado con zod), genera la evidencia y guarda la trazabilidad de cada valor. Falla si hay bloqueos.",
  args: {
    caso,
    paquete: paqueteOpcional,
    derivados: z4.record(z4.string(), z4.unknown()).optional().describe("OPCIONAL: om\xEDtelo. Los derivados se calculan en oc_validar y la herramienta los reutiliza.")
  },
  async execute({ caso: caso2, paquete, derivados }, ctx) {
    return seguro(async () => {
      const r = validarCaso(ctx.directory, caso2, paquete);
      if (!r.ok) return fail(r.error);
      const { paquete: p, maestros, validacion } = r.data;
      if (derivados !== void 0 && canonico(derivados) !== canonico(validacion.derivados)) {
        return fail("Los derivados enviados no coinciden con los calculados. Omite el argumento `derivados`.");
      }
      if (!validacion.apta) {
        return fail("No se puede construir la OC: hay bloqueos.", { bloqueos: validacion.bloqueos });
      }
      if (!p.aprobacion) return fail("No se puede construir la OC sin correo de aprobaci\xF3n.");
      const evidencia = await generarEvidencia(ctx.directory, caso2, p.aprobacion);
      const c = construirPayload(p, maestros, validacion, evidencia.sha256);
      if (!c.ok) return fail(c.error);
      const dir = join6(ctx.directory, "out", caso2);
      mkdirSync4(dir, { recursive: true });
      writeFileSync3(
        join6(dir, "trazabilidad.json"),
        JSON.stringify({ caso: caso2, solicitud_id: p.solicitud.solicitud_id, campos: c.data.trazabilidad }, null, 2)
      );
      if (c.data.payload.excepciones.length > 0) marcarPendiente(ctx.sessionId, caso2, c.data.payload.excepciones);
      return ok({
        payload: c.data.payload,
        iva: c.data.iva,
        trazabilidad: `out/${caso2}/trazabilidad.json`,
        evidencia,
        confirmaciones: validacion.confirmaciones,
        derivados: validacion.derivados,
        retroactiva: validacion.retroactiva
      });
    });
  }
});
var crear = definir({
  description: "Crea la OC en SAP. Solo si el caso es apto y, cuando hay confirmaciones, el usuario ya confirm\xF3 en un mensaje posterior (confirmado = true). Es idempotente por solicitud.",
  args: {
    caso,
    payload: z4.record(z4.string(), z4.unknown()).optional().describe("OPCIONAL: om\xEDtelo. La OC se reconstruye en el servidor; un payload distinto se rechaza."),
    confirmado: z4.boolean().optional().describe("true SOLO despu\xE9s de que el usuario confirme expl\xEDcitamente en su mensaje m\xE1s reciente.")
  },
  async execute({ caso: caso2, payload, confirmado }, ctx) {
    const registrar = (solicitud_id, resultado, extra = {}) => registrarControl(ctx.directory, {
      solicitud_id,
      resultado,
      numero_oc: extra.numero_oc ?? null,
      retroactiva: extra.retroactiva ?? false,
      bloqueos: extra.bloqueos ?? [],
      confirmaciones: extra.confirmaciones ?? []
    });
    return seguro(async () => {
      const r = validarCaso(ctx.directory, caso2);
      if (!r.ok) {
        registrar(caso2, "error");
        return fail(r.error);
      }
      const { paquete: p, maestros, validacion: v } = r.data;
      const id = p.solicitud.solicitud_id;
      const codigos = (xs) => xs.map((x) => x.codigo);
      const sap = ctx.sap ?? new MockSapAdapter(ctx.directory);
      return conCandado(`${ctx.directory}::${id}`, async () => {
        const existente = await sap.buscarOrdenPorReferencia(id);
        if (existente) {
          registrar(id, "idempotente", { numero_oc: existente.numero_oc, retroactiva: v.retroactiva });
          return ok({ numero_oc: existente.numero_oc, fecha: existente.fecha, idempotente: true });
        }
        if (!v.apta) {
          registrar(id, "bloqueada", { retroactiva: v.retroactiva, bloqueos: codigos(v.bloqueos) });
          return fail("La OC no se puede crear: hay bloqueos.", { bloqueos: v.bloqueos });
        }
        if (v.confirmaciones.length > 0) {
          if (!confirmado) {
            marcarPendiente(ctx.sessionId, caso2, v.confirmaciones);
            registrar(id, "pendiente_confirmacion", {
              retroactiva: v.retroactiva,
              confirmaciones: codigos(v.confirmaciones)
            });
            return fail("Requiere confirmaci\xF3n humana antes de crear la OC. Preg\xFAntale al usuario y espera su respuesta.", {
              requiere_confirmacion: true,
              confirmaciones: v.confirmaciones
            });
          }
          if (!confirmacionVerificable(ctx.sessionId, caso2)) {
            registrar(id, "pendiente_confirmacion", {
              retroactiva: v.retroactiva,
              confirmaciones: codigos(v.confirmaciones)
            });
            return fail(
              "No hay una confirmaci\xF3n verificable: el usuario debe responder en un mensaje posterior a ver las excepciones. Mu\xE9straselas y espera.",
              { requiere_confirmacion: true, confirmaciones: v.confirmaciones }
            );
          }
        }
        if (!p.aprobacion) return fail("No se puede crear la OC sin correo de aprobaci\xF3n.");
        const evidencia = await generarEvidencia(ctx.directory, caso2, p.aprobacion);
        const c = construirPayload(p, maestros, v, evidencia.sha256);
        if (!c.ok) return fail(c.error);
        if (payload !== void 0 && canonico(payload) !== canonico(c.data.payload)) {
          return fail("El payload enviado no coincide con el validado. Omite `payload`: la OC se construye en el servidor.");
        }
        const enSap = await sap.consultarProveedor(c.data.payload.proveedor.nit);
        if (!enSap?.activo) {
          registrar(id, "bloqueada", { retroactiva: v.retroactiva, bloqueos: ["RC1"] });
          return fail("SAP no reconoce al proveedor como activo.");
        }
        const orden = {
          ...c.data.payload,
          excepciones: c.data.payload.excepciones.map((e) => ({ ...e, confirmado_por: "analista (chat)" }))
        };
        const creada = await sap.crearOrden(orden);
        consumirPendiente(ctx.sessionId, caso2);
        registrar(id, "creada", {
          numero_oc: creada.numero_oc,
          retroactiva: v.retroactiva,
          confirmaciones: codigos(v.confirmaciones)
        });
        return ok({ numero_oc: creada.numero_oc, fecha: creada.fecha, idempotente: false, evidencia: evidencia.ruta });
      });
    });
  }
});
export {
  construir_payload,
  crear,
  generar_evidencia,
  leer_paquete,
  validar2 as validar
};
