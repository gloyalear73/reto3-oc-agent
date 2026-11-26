/**
 * Decisión de producto: los montos son en COP, el IVA de la cotización se contrasta con la tasa del indicador
 * (RC12) y a SAP viaja el precio NETO. Se prueba sobre los fixtures oficiales, alterando solo lo necesario.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { RAIZ } from "../src/config.ts";
import { validar } from "../src/domain/controles.ts";
import { cargarMaestros } from "../src/domain/maestros.ts";
import { cargarPaquete } from "../src/domain/paquete.ts";
import { construirPayload, redondear2 } from "../src/domain/payload.ts";
import type { Paquete } from "../src/types.ts";

const m = (() => {
  const r = cargarMaestros(RAIZ);
  assert.ok(r.ok);
  return r.data;
})();
const caso = (c: string): Paquete => {
  const r = cargarPaquete(RAIZ, c);
  assert.ok(r.ok, "no carga " + c);
  return structuredClone(r.data);
};
const codigos = (xs: { codigo: string }[]) => xs.map((x) => x.codigo);

test("el IVA se lee de la cotización", () => {
  const p = caso("sol-001");
  assert.deepEqual(p.cotizacion?.iva, { tasa: 0.19, base: 9579832, valor: 1820168 });
});

test("los casos oficiales no disparan RC11 ni RC12", () => {
  for (const c of ["sol-001", "sol-004", "sol-005", "sol-006"]) {
    const v = validar(caso(c), m);
    assert.ok(![...v.bloqueos, ...v.confirmaciones].some((h) => h.codigo === "RC11" || h.codigo === "RC12"), c);
  }
});

test("RC11: una solicitud o cotización en USD se bloquea", () => {
  const p = caso("sol-001");
  p.solicitud.moneda = "USD";
  assert.ok(codigos(validar(p, m).bloqueos).includes("RC11"));
  const q = caso("sol-001");
  q.cotizacion!.moneda = "USD";
  assert.ok(codigos(validar(q, m).bloqueos).includes("RC11"));
});

test("RC12: la tasa de la cotización no coincide con el indicador → confirmación", () => {
  const p = caso("sol-001"); // indicador C1 (19 %)
  p.cotizacion!.iva.tasa = 0.05;
  const v = validar(p, m);
  const h = v.confirmaciones.find((c) => c.codigo === "RC12");
  assert.ok(h, "debe pedir confirmación");
  assert.match(h.detalle, /5 %.*19 %/);
  assert.equal(v.apta, true);
});

test("RC12: cifras de IVA que no cuadran → confirmación", () => {
  const p = caso("sol-001");
  p.cotizacion!.iva.valor = 1_000_000;
  assert.ok(codigos(validar(p, m).confirmaciones).includes("RC12"));
});

test("RC12: indicador inexistente → bloqueo", () => {
  const p = caso("sol-001");
  p.solicitud.indicador_iva = "C9";
  assert.ok(codigos(validar(p, m).bloqueos).includes("RC12"));
});

test("a SAP viaja el precio neto: valor con IVA / (1 + tasa), a 2 decimales", () => {
  const casos: Array<[string, number]> = [
    ["sol-001", 79831.93], // 95.000 / 1,19
    ["sol-004", 210084.03], // 250.000 / 1,19
    ["sol-006", 151260.5], // 180.000 / 1,19
  ];
  for (const [c, esperado] of casos) {
    const p = caso(c);
    const r = construirPayload(p, m, validar(p, m), "a".repeat(64));
    assert.ok(r.ok, c);
    assert.equal(r.data.payload.posiciones[0]?.precio_unitario, esperado, c);
    assert.match(String(r.data.trazabilidad["posiciones[0].precio_unitario"]?.nota), /precio neto/);
  }
});

test("indicador sin IVA (C0): el precio neto es el mismo valor", () => {
  const p = caso("sol-001");
  p.solicitud.indicador_iva = "C0";
  p.cotizacion!.iva = { tasa: 0, base: null, valor: null };
  const r = construirPayload(p, m, validar(p, m), "a".repeat(64));
  assert.ok(r.ok);
  assert.equal(r.data.payload.posiciones[0]?.precio_unitario, 95000);
});

test("redondear2 no pierde centavos por coma flotante", () => {
  assert.equal(redondear2(1.005), 1.01);
  assert.equal(redondear2(79831.932773), 79831.93);
});
