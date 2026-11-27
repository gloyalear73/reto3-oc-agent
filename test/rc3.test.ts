/** RC2 y RC3 se reportan a la vez: corregir solo el aprobador no debe llevar a un segundo rechazo. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { RAIZ } from "../src/config.ts";
import { validar } from "../src/domain/controles.ts";
import { cargarMaestros } from "../src/domain/maestros.ts";
import { cargarPaquete } from "../src/domain/paquete.ts";
import type { Paquete } from "../src/types.ts";

const maestros = (() => {
  const r = cargarMaestros(RAIZ);
  assert.ok(r.ok);
  return r.data;
})();
const caso = (c: string): Paquete => {
  const r = cargarPaquete(RAIZ, c);
  assert.ok(r.ok);
  return structuredClone(r.data);
};
const codigos = (xs: { codigo: string }[]) => xs.map((x) => x.codigo);

test("sol-003: aprobador sin autoridad y valor sobre el tope de todos → RC2 y RC3", () => {
  const v = validar(caso("sol-003"), maestros);
  assert.deepEqual(codigos(v.bloqueos), ["RC2", "RC3"]);
  const rc3 = v.bloqueos.find((b) => b.codigo === "RC3");
  assert.match(rc3?.detalle ?? "", /todos los aprobadores/);
  assert.match(rc3?.accion_sugerida ?? "", /nivel superior/);
});

test("aprobador sin autoridad pero valor dentro del tope de otro aprobador → solo RC2", () => {
  const p = caso("sol-003");
  p.solicitud.valor_total = 20_000_000;
  p.solicitud.cantidad = 40;
  p.solicitud.valor_unitario = 500_000; // 40 × 500.000 = 20.000.000
  const v = validar(p, maestros);
  assert.deepEqual(codigos(v.bloqueos), ["RC2"]);
});

test("aprobador válido con valor sobre su tope → solo RC3", () => {
  const p = caso("sol-001");
  const centro = maestros.centros.find((c) => c.centro_costo === p.solicitud.centro_costo);
  assert.ok(centro);
  const ap = centro.aprobadores.find((a) => a.email === p.aprobacion?.de);
  assert.ok(ap);
  p.solicitud.cantidad = 1;
  p.solicitud.valor_unitario = ap.tope + 1;
  p.solicitud.valor_total = ap.tope + 1;
  const v = validar(p, maestros);
  assert.deepEqual(codigos(v.bloqueos), ["RC3"]);
});
