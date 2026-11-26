import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { crearContexto, ejecutarHerramienta, MATRIZ_CONTROLES, type Contexto } from "./tools/oc.ts";
import { llmDisponible, turnoAgente, type Mensaje } from "./agent/loop.ts";
import { listarCasos } from "./data/loader.ts";

const PORT = Number(process.env.PORT ?? 3000);

interface Sesion {
  historial: Mensaje[];
  ctx: Contexto;
}
const sesiones = new Map<string, Sesion>();

function sesion(id: string): Sesion {
  let s = sesiones.get(id);
  if (!s) {
    s = { historial: [], ctx: crearContexto() };
    sesiones.set(id, s);
  }
  return s;
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

async function leerBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let tam = 0;
  for await (const c of req) {
    tam += (c as Buffer).length;
    if (tam > 100_000) throw new Error("Body demasiado grande");
    chunks.push(c as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

const INDEX = () => readFileSync(resolve("public/index.html"), "utf8");

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(INDEX());
    }

    if (req.method === "GET" && url.pathname === "/api/estado") {
      return json(res, 200, { llm: llmDisponible(), casos: listarCasos(), controles: MATRIZ_CONTROLES });
    }

    // Evaluación determinista, sin LLM (misma lógica que demo.ts)
    if (req.method === "POST" && url.pathname === "/api/evaluar") {
      const { sesionId, solicitudId } = await leerBody(req);
      const s = sesion(sesionId ?? "anon");
      const evaluacion = await ejecutarHerramienta("validar_solicitud", { solicitudId }, s.ctx);
      const propuesta = (evaluacion as any)?.decision && (evaluacion as any).decision !== "RECHAZAR"
        ? await ejecutarHerramienta("crear_oc", { solicitudId }, s.ctx)
        : null;
      return json(res, 200, { evaluacion, propuesta });
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const { sesionId, mensaje } = await leerBody(req);
      if (typeof mensaje !== "string" || !mensaje.trim()) return json(res, 400, { error: "mensaje requerido" });
      const s = sesion(sesionId ?? "anon");
      s.historial.push({ role: "user", content: mensaje.slice(0, 4000) });
      const eventos = await turnoAgente(s.historial, s.ctx);
      return json(res, 200, { eventos });
    }

    // Decisión humana sobre una confirmación pendiente. El modelo NO puede invocar este endpoint.
    if (req.method === "POST" && url.pathname === "/api/confirmar") {
      const { sesionId, token, aprobar, persona, justificacion } = await leerBody(req);
      const s = sesion(sesionId ?? "anon");
      const r = await s.ctx.confirmaciones.resolver(token, !!aprobar, String(persona || "usuario-web"), String(justificacion ?? ""));
      if (r.ok && s.historial.length) {
        s.historial.push({ role: "user", content: `[SISTEMA] ${r.mensaje}` });
      }
      return json(res, r.ok ? 200 : 400, r);
    }

    if (req.method === "GET" && url.pathname === "/api/ocs") {
      const s = sesion(url.searchParams.get("sesionId") ?? "anon");
      return json(res, 200, await s.ctx.sap.listar());
    }

    json(res, 404, { error: "no encontrado" });
  } catch (e) {
    json(res, 500, { error: (e as Error).message });
  }
}).listen(PORT, () => {
  console.log(`Agente OC escuchando en http://localhost:${PORT}  (LLM ${llmDisponible() ? "activo" : "sin ANTHROPIC_API_KEY"})`);
});
