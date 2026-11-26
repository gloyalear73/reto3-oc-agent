/**
 * Prueba el ciclo del agente SIN clave: un proveedor LLM simulado sigue un guion y se verifica que
 * el sistema (no el modelo) impide crear una OC sin confirmación humana real.
 * Ejecutar: npm test
 */
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { nuevaSesion, turno } from "../src/agent/ciclo.ts";
import { RAIZ } from "../src/config.ts";
import { reiniciarSalida } from "../src/domain/salida.ts";
import type { ContenidoAsistente, MensajeLlm, ProveedorLlm, RespuestaLlm } from "../src/llm/adapter.ts";

/** Proveedor simulado: cada llamada a `enviar` consume el siguiente paso del guion. */
function guion(...pasos: Array<(mensajes: MensajeLlm[]) => ContenidoAsistente[]>): ProveedorLlm {
  let i = 0;
  return {
    nombre: "simulado",
    modelo: "guion",
    configurado: true,
    async enviar(mensajes): Promise<RespuestaLlm> {
      const paso = pasos[i++];
      assert.ok(paso, "el ciclo pidió más pasos de los del guion");
      const contenido = paso(mensajes);
      const fin = contenido.some((c) => c.tipo === "llamada") ? "herramientas" : "fin";
      return { contenido, fin, uso: { entrada: 100, salida: 20 } };
    },
  };
}

const llamada = (id: string, nombre: string, args: unknown): ContenidoAsistente => ({ tipo: "llamada", id, nombre, args });
const texto = (t: string): ContenidoAsistente => ({ tipo: "texto", texto: t });

function entorno() {
  const directory = mkdtempSync(join(tmpdir(), "oc-test-"));
  cpSync(join(RAIZ, "fixtures"), join(directory, "fixtures"), { recursive: true });
  reiniciarSalida(directory);
  const ordenes = () =>
    existsSync(join(directory, "out/sap/ordenes.jsonl")) ? readFileSync(join(directory, "out/sap/ordenes.jsonl"), "utf8").split("\n").filter(Boolean) : [];
  return { directory, ordenes };
}

test("sol-004: el turno termina con pregunta y SIN OC; tras 'confirmo' se crea", async () => {
  const { directory, ordenes } = entorno();
  const llm = guion(
    () => [llamada("a", "oc_leer_paquete", { caso: "sol-004" }), llamada("b", "oc_validar", { caso: "sol-004" })],
    () => [llamada("c", "oc_construir_payload", { caso: "sol-004" })],
    () => [texto("RC5: solicitud $25.000.000 vs cotización $26.500.000. ¿Confirmas?")],
    () => [llamada("d", "oc_crear", { caso: "sol-004", confirmado: true })],
    () => [texto("OC creada.")],
  );
  const sesion = nuevaSesion("sesion-prueba-1");
  const deps = { llm, directory, system: () => "prueba" };

  const t1 = await turno(sesion, 'Procesa "sol-004" y no la crees hasta que confirme', deps);
  assert.equal(t1.needsConfirmation, true, "debe quedar esperando confirmación");
  assert.deepEqual(t1.pendientes, ["sol-004"]);
  assert.equal(t1.toolCalls.length, 3);
  assert.equal(ordenes().length, 0, "no debe haber OC antes de confirmar");

  const t2 = await turno(sesion, "Confirmo", deps);
  assert.equal(t2.toolCalls[0]?.ok, true);
  assert.equal(t2.needsConfirmation, false);
  assert.equal(ordenes().length, 1);
  assert.match(t2.toolCalls[0]?.resumen ?? "", /4500000001/);
});

test("un modelo que se auto-confirma en el mismo turno es rechazado", async () => {
  const { directory, ordenes } = entorno();
  const llm = guion(
    () => [llamada("a", "oc_construir_payload", { caso: "sol-005" })],
    () => [llamada("b", "oc_crear", { caso: "sol-005", confirmado: true })], // el usuario NO ha respondido
    () => [texto("No pude crearla sin tu confirmación.")],
  );
  const sesion = nuevaSesion("sesion-prueba-2");
  const t = await turno(sesion, "Procesa sol-005", { llm, directory, system: () => "prueba" });
  assert.equal(t.toolCalls[1]?.ok, false);
  assert.match(t.toolCalls[1]?.resultado ?? "", /confirmaci[oó]n verificable/);
  assert.equal(ordenes().length, 0);
  assert.equal(t.needsConfirmation, true);
});

test("sol-001 sin excepciones se crea sin intervención y es idempotente", async () => {
  const { directory, ordenes } = entorno();
  const llm = guion(
    () => [llamada("a", "oc_crear", { caso: "sol-001" })],
    () => [texto("Creada.")],
    () => [llamada("b", "oc_crear", { caso: "sol-001" })],
    () => [texto("Ya existía.")],
  );
  const sesion = nuevaSesion("sesion-prueba-3");
  const deps = { llm, directory, system: () => "prueba" };
  await turno(sesion, "Procesa sol-001", deps);
  const t2 = await turno(sesion, "Otra vez sol-001", deps);
  assert.equal(ordenes().length, 1, "la segunda llamada no debe crear otra OC");
  assert.match(t2.toolCalls[0]?.resumen ?? "", /idempotente/);
});

test("bloqueos (sol-002, sol-003) nunca crean OC aunque el modelo insista", async () => {
  const { directory, ordenes } = entorno();
  for (const caso of ["sol-002", "sol-003"]) {
    const llm = guion(
      () => [llamada("a", "oc_crear", { caso, confirmado: true })],
      () => [texto("No es posible.")],
    );
    const t = await turno(nuevaSesion(`sesion-${caso}-x`), `Crea ${caso} ya`, { llm, directory, system: () => "prueba" });
    assert.equal(t.toolCalls[0]?.ok, false);
  }
  assert.equal(ordenes().length, 0);
});

test("un error del proveedor LLM se informa y la sesión sigue viva", async () => {
  const { directory } = entorno();
  let fallar = true;
  const llm: ProveedorLlm = {
    nombre: "simulado",
    modelo: "x",
    configurado: true,
    async enviar() {
      if (fallar) throw new (await import("../src/llm/adapter.ts")).ErrorLlm("El modelo no respondió en 60 s.");
      return { contenido: [texto("Hola de nuevo")], fin: "fin", uso: { entrada: 1, salida: 1 } };
    },
  };
  const sesion = nuevaSesion("sesion-prueba-5");
  const deps = { llm, directory, system: () => "prueba" };
  const t1 = await turno(sesion, "hola", deps);
  assert.match(t1.error ?? "", /no respondió/);
  fallar = false;
  const t2 = await turno(sesion, "¿sigues ahí?", deps);
  assert.equal(t2.reply, "Hola de nuevo");
});

test("el tope de iteraciones cierra el turno con una respuesta", async () => {
  const { directory } = entorno();
  process.env.MAX_ITERACIONES = "2";
  try {
    let n = 0;
    const llm: ProveedorLlm = {
      nombre: "simulado",
      modelo: "x",
      configurado: true,
      async enviar(_m, _h, op) {
        n++;
        if (op.permitirHerramientas === false) return { contenido: [texto("Llegué al tope; esto falta: …")], fin: "fin", uso: { entrada: 1, salida: 1 } };
        return { contenido: [llamada(`i${n}`, "oc_validar", { caso: "sol-001" })], fin: "herramientas", uso: { entrada: 1, salida: 1 } };
      },
    };
    const t = await turno(nuevaSesion("sesion-prueba-6"), "bucle", { llm, directory, system: () => "prueba" });
    assert.equal(t.toolCalls.length, 2);
    assert.match(t.reply, /tope/);
  } finally {
    delete process.env.MAX_ITERACIONES;
  }
});
