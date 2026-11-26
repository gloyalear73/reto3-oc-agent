import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cargarSystem, nuevaSesion, tokensUsadosGlobal, turno, type Sesion } from "./agent/ciclo.ts";
import { config, RAIZ } from "./config.ts";
import { listarCasos } from "./domain/paquete.ts";
import { leerControl, reiniciarSalida } from "./domain/salida.ts";
import { crearProveedor } from "./llm/index.ts";
import { claveValida, crearLimitador, ipCliente } from "./seguridad.ts";

try {
  process.loadEnvFile?.(join(RAIZ, ".env")); // opcional: carga .env si existe (Node ≥ 20.12)
} catch {
  /* sin .env: se usan las variables del entorno */
}

const llm = crearProveedor();
reiniciarSalida(RAIZ); // PRD 8: out/ se limpia al inicio

const cfg = config();
const limiteChat = crearLimitador(cfg.limiteMensajesPorMinuto);
const limiteFallos = crearLimitador(10); // intentos de clave incorrectos por minuto y por IP
const esRutaProtegida = (ruta: string) =>
  ruta === "/api/chat" || ruta === "/api/casos" || ruta === "/api/control" || ruta.startsWith("/api/sessions/");

const MAX_SESIONES = 200;
const ID_SESION = /^[\w-]{8,64}$/;
const sesiones = new Map<string, Sesion>();

function sesion(id: string): Sesion {
  let s = sesiones.get(id);
  if (!s) {
    if (sesiones.size >= MAX_SESIONES) sesiones.delete(sesiones.keys().next().value as string); // descarta la más antigua
    s = nuevaSesion(id);
    sesiones.set(id, s);
  }
  return s;
}

const json = (res: ServerResponse, estado: number, cuerpo: unknown) => {
  res.writeHead(estado, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(cuerpo));
};

async function leerCuerpo(req: IncomingMessage): Promise<unknown> {
  const trozos: Buffer[] = [];
  let total = 0;
  for await (const t of req) {
    total += (t as Buffer).length;
    if (total > 20_000) throw new Error("Cuerpo demasiado grande");
    trozos.push(t as Buffer);
  }
  return trozos.length ? JSON.parse(Buffer.concat(trozos).toString("utf8")) : {};
}

const servidor = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const ruta = url.pathname;

    if (req.method === "GET" && ruta === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return void res.end(readFileSync(join(RAIZ, "web", "index.html"), "utf8"));
    }

    // Nunca expone claves: solo proveedor, modelo y si hay credencial configurada.
    if (req.method === "GET" && ruta === "/api/health") {
      return json(res, 200, { ok: true, provider: llm.nombre, model: llm.modelo, configurado: llm.configurado, protegido: cfg.claveAcceso !== "" });
    }

    const ip = ipCliente(cfg.confiarProxy ? req.headers["x-forwarded-for"] : undefined, req.socket.remoteAddress);
    if (esRutaProtegida(ruta)) {
      const recibida = req.headers["x-access-key"];
      if (!claveValida(cfg.claveAcceso, typeof recibida === "string" ? recibida : undefined)) {
        if (!limiteFallos.permitir(ip)) return json(res, 429, { error: "Demasiados intentos con clave incorrecta. Espera un minuto." });
        return json(res, 401, { error: "Se requiere la clave de acceso.", requiere_clave: true });
      }
    }

    if (req.method === "GET" && ruta === "/api/casos") return json(res, 200, { casos: listarCasos(RAIZ) });
    if (req.method === "GET" && ruta === "/api/control") return json(res, 200, { filas: leerControl(RAIZ) });

    const m = ruta.match(/^\/api\/sessions\/([\w-]+)$/);
    if (req.method === "GET" && m) {
      const s = sesiones.get(m[1]!);
      return s ? json(res, 200, { id: s.id, creada: s.creada, tokens: s.tokens, transcripcion: s.transcripcion }) : json(res, 404, { error: "Sesión inexistente" });
    }

    if (req.method === "POST" && ruta === "/api/chat") {
      if (!limiteChat.permitir(ip)) {
        return json(res, 429, { error: `Demasiados mensajes seguidos (máximo ${cfg.limiteMensajesPorMinuto} por minuto). Espera un momento e inténtalo de nuevo.` });
      }
      const cuerpo = (await leerCuerpo(req)) as { sessionId?: unknown; message?: unknown };
      const message = typeof cuerpo.message === "string" ? cuerpo.message.trim() : "";
      if (!message) return json(res, 400, { error: "Falta `message`." });
      if (message.length > 2000) return json(res, 400, { error: "El mensaje supera 2000 caracteres." });
      const id = typeof cuerpo.sessionId === "string" && ID_SESION.test(cuerpo.sessionId) ? cuerpo.sessionId : randomUUID();

      const s = sesion(id);
      if (s.ocupada) return json(res, 429, { error: "La sesión está procesando un mensaje. Espera su respuesta." });
      s.ocupada = true;
      try {
        const r = await turno(s, message, { llm, directory: RAIZ, system: () => cargarSystem(RAIZ) });
        return json(res, 200, { sessionId: id, ...r });
      } finally {
        s.ocupada = false;
      }
    }

    json(res, 404, { error: "No encontrado" });
  } catch (e) {
    json(res, 500, { error: (e as Error).message });
  }
});

servidor.listen(config().puerto, () => {
  const c = config();
  console.log(`Agente de OC en http://localhost:${c.puerto}  ·  ${llm.nombre}/${llm.modelo}  ·  clave ${llm.configurado ? "configurada" : "NO configurada"}`);
  console.log(`Topes: ${c.maxIteraciones} iteraciones/turno · ${c.maxTokensSesion} tokens/sesión · ${c.maxTokensGlobal} tokens global (usados: ${tokensUsadosGlobal()})`);
});
