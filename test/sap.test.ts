/**
 * Prueba la inyección del adaptador SAP: las herramientas usan el que reciben en `ctx.sap`
 * y no el simulado sobre archivos. Así cambiar a SAP real solo exige otra implementación de `SapAdapter`.
 */
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RAIZ } from "../src/config.ts";
import { reiniciarSalida } from "../src/domain/salida.ts";
import type { SapAdapter } from "../src/sap/adapter.ts";
import { ejecutarHerramienta } from "../src/tools/index.ts";
import type { OrdenCompra } from "../src/types.ts";

/** SAP falso en memoria: registra lo que recibe y numera desde 4600000001 para distinguirlo del simulado. */
function sapEnMemoria() {
  const ordenes = new Map<string, { numero_oc: string; fecha: string; orden: OrdenCompra }>();
  const adaptador: SapAdapter = {
    async consultarProveedor() {
      return { codigo_sap: "999999", activo: true };
    },
    async crearOrden(orden) {
      const numero_oc = String(4_600_000_001 + ordenes.size);
      const fecha = "2026-01-15";
      ordenes.set(orden.referencia.solicitud_id, { numero_oc, fecha, orden });
      return { numero_oc, fecha };
    },
    async buscarOrdenPorReferencia(id) {
      const r = ordenes.get(id);
      return r ? { numero_oc: r.numero_oc, fecha: r.fecha } : null;
    },
  };
  return { adaptador, ordenes };
}

const llamar = async (nombre: string, args: Record<string, unknown>, ctx: Parameters<typeof ejecutarHerramienta>[2]) =>
  JSON.parse(await ejecutarHerramienta(nombre, args, ctx)) as { ok: boolean; data?: Record<string, unknown>; error?: string };

test("oc_crear usa el adaptador inyectado, no escribe en out/sap y la idempotencia devuelve la fecha original", async () => {
  const directory = mkdtempSync(join(tmpdir(), "oc-sap-"));
  cpSync(join(RAIZ, "fixtures"), join(directory, "fixtures"), { recursive: true });
  reiniciarSalida(directory);
  const { adaptador, ordenes } = sapEnMemoria();
  const ctx = { directory, sessionId: "sesion-sap-1", sap: adaptador };

  const primera = await llamar("oc_crear", { caso: "sol-001" }, ctx);
  assert.equal(primera.ok, true, primera.error ?? "");
  assert.equal(primera.data?.numero_oc, "4600000001", "debe venir del adaptador inyectado");
  assert.equal(primera.data?.idempotente, false);
  assert.equal(ordenes.size, 1);
  assert.equal(existsSync(join(directory, "out", "sap", "ordenes.jsonl")), false, "el SAP simulado sobre archivos no debe usarse");

  const segunda = await llamar("oc_crear", { caso: "sol-001" }, ctx);
  assert.equal(segunda.ok, true);
  assert.equal(segunda.data?.idempotente, true);
  assert.equal(segunda.data?.numero_oc, "4600000001");
  assert.equal(segunda.data?.fecha, "2026-01-15", "el reintento informa la fecha original de la OC");
  assert.equal(ordenes.size, 1, "no debe crear una segunda OC");
});

test("sin adaptador inyectado se usa el SAP simulado sobre archivos", async () => {
  const directory = mkdtempSync(join(tmpdir(), "oc-sap-"));
  cpSync(join(RAIZ, "fixtures"), join(directory, "fixtures"), { recursive: true });
  reiniciarSalida(directory);
  const r = await llamar("oc_crear", { caso: "sol-001" }, { directory, sessionId: "sesion-sap-2" });
  assert.equal(r.ok, true, r.error ?? "");
  assert.equal(r.data?.numero_oc, "4500000001");
  assert.equal(existsSync(join(directory, "out", "sap", "ordenes.jsonl")), true);
});

test("dos sesiones que crean la misma solicitud a la vez generan una sola OC", async () => {
  const directory = mkdtempSync(join(tmpdir(), "oc-conc-"));
  cpSync(join(RAIZ, "fixtures"), join(directory, "fixtures"), { recursive: true });
  reiniciarSalida(directory);
  const crear = (sessionId: string) => llamar("oc_crear", { caso: "sol-001" }, { directory, sessionId });

  const [a, b] = await Promise.all([crear("sesion-A-0001"), crear("sesion-B-0002")]);

  assert.equal(a.ok, true, a.error ?? "");
  assert.equal(b.ok, true, b.error ?? "");
  assert.equal(a.data?.numero_oc, b.data?.numero_oc, "ambas deben recibir la misma OC");
  assert.equal([a, b].filter((x) => x.data?.idempotente === true).length, 1, "exactamente una es la reintentada");
  const lineas = readFileSync(join(directory, "out", "sap", "ordenes.jsonl"), "utf8").split("\n").filter(Boolean);
  assert.equal(lineas.length, 1, "solo debe quedar una OC en SAP");
});

test("un adaptador cuya búsqueda solo devuelve numero_oc (contrato del PRD) sirve: el reintento omite la fecha", async () => {
  const directory = mkdtempSync(join(tmpdir(), "oc-sap-min-"));
  cpSync(join(RAIZ, "fixtures"), join(directory, "fixtures"), { recursive: true });
  reiniciarSalida(directory);
  const guardadas = new Map<string, string>();
  const adaptador: SapAdapter = {
    async consultarProveedor() {
      return { codigo_sap: "100234", activo: true };
    },
    async crearOrden(orden) {
      guardadas.set(orden.referencia.solicitud_id, "4700000001");
      return { numero_oc: "4700000001", fecha: "2026-02-01" };
    },
    async buscarOrdenPorReferencia(id) {
      const numero_oc = guardadas.get(id);
      return numero_oc ? { numero_oc } : null; // sin fecha
    },
  };
  const ctx = { directory, sessionId: "sesion-sap-min", sap: adaptador };
  const primera = await llamar("oc_crear", { caso: "sol-001" }, ctx);
  assert.equal(primera.ok, true, primera.error ?? "");
  const segunda = await llamar("oc_crear", { caso: "sol-001" }, ctx);
  assert.equal(segunda.ok, true, segunda.error ?? "");
  assert.equal(segunda.data?.idempotente, true);
  assert.equal(segunda.data?.numero_oc, "4700000001");
  assert.equal("fecha" in (segunda.data ?? {}), false, "sin fecha del adaptador no se inventa una");
});
