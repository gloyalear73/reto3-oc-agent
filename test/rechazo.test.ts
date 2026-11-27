import assert from "node:assert/strict";
import { test } from "node:test";
import { esRechazo } from "../src/domain/confirmaciones.ts";

test("esRechazo reconoce negativas claras y no confunde confirmaciones", () => {
  for (const t of ["No confirmo, no la crees.", "no confirmo", "No la crees", "No lo crear", "Cancela", "Rechazo la excepción"]) {
    assert.equal(esRechazo(t), true, t);
  }
  for (const t of ["Confirmo", "Sí, confírmalo", "no sé, confirmo", "Procesa sol-001", "ok, sigue", "confirmo, no hay problema"]) {
    assert.equal(esRechazo(t), false, t);
  }
});
