/** Clave de acceso, límite por IP y detección de la IP del cliente. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { claveValida, crearLimitador, ipCliente } from "../src/seguridad.ts";

test("claveValida: sin clave configurada todo acceso es válido; con clave solo la correcta", () => {
  assert.equal(claveValida("", undefined), true);
  assert.equal(claveValida("", "cualquiera"), true);
  assert.equal(claveValida("secreta", "secreta"), true);
  assert.equal(claveValida("secreta", "otra"), false);
  assert.equal(claveValida("secreta", ""), false);
  assert.equal(claveValida("secreta", undefined), false);
});

test("crearLimitador: bloquea al pasar el máximo, se libera con la ventana y separa por IP", () => {
  let t = 1_000_000;
  const l = crearLimitador(3, () => t);
  assert.deepEqual([l.permitir("1.1.1.1"), l.permitir("1.1.1.1"), l.permitir("1.1.1.1")], [true, true, true]);
  assert.equal(l.permitir("1.1.1.1"), false, "la cuarta en el mismo minuto se bloquea");
  assert.equal(l.permitir("2.2.2.2"), true, "otra IP no se ve afectada");
  t += 59_000;
  assert.equal(l.permitir("1.1.1.1"), false, "aún dentro de la ventana de 60 s");
  t += 2_000;
  assert.equal(l.permitir("1.1.1.1"), true, "pasada la ventana se libera");
});

test("crearLimitador: acota la memoria con muchas IPs", () => {
  let t = 0;
  const l = crearLimitador(5, () => t, 10);
  for (let i = 0; i < 50; i++) {
    l.permitir(`ip-${i}`);
    t += 70_000; // cada IP queda fuera de ventana antes de la siguiente
  }
  assert.equal(l.permitir("ip-nueva"), true);
});

test("ipCliente: usa el último X-Forwarded-For solo cuando se lo pasan; si no, la IP del socket", () => {
  assert.equal(ipCliente("9.9.9.9, 10.0.0.5", "127.0.0.1"), "10.0.0.5", "el último lo añadió el proxy");
  assert.equal(ipCliente(["8.8.8.8", "10.0.0.7"], "127.0.0.1"), "10.0.0.7");
  assert.equal(ipCliente(undefined, "127.0.0.1"), "127.0.0.1");
  assert.equal(ipCliente(undefined, undefined), "desconocida");
});
