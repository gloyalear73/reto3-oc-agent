import { randomUUID } from "node:crypto";
import type { DatosOC, Decision, OrdenCompra } from "./types.ts";
import type { SapAdapter } from "./sap/adapter.ts";

export interface ConfirmacionPendiente {
  token: string;
  solicitudId: string;
  decision: Decision;
  datosOC: DatosOC;
  motivo: string;
  estado: "pendiente" | "aprobada" | "rechazada";
}

/**
 * Human-in-the-loop: la herramienta crear_oc NUNCA escribe en SAP. Solo registra una
 * confirmación pendiente. La escritura ocurre cuando una persona la aprueba mediante
 * `resolver()`, invocado por la UI o por demo.ts; el modelo no tiene forma de hacerlo.
 */
export class ConfirmationStore {
  private pendientes = new Map<string, ConfirmacionPendiente>();

  constructor(private sap: SapAdapter) {}

  solicitar(solicitudId: string, decision: Decision, datosOC: DatosOC, motivo: string): ConfirmacionPendiente {
    // Reutiliza la pendiente de la misma solicitud para no generar tokens duplicados.
    for (const p of this.pendientes.values()) {
      if (p.solicitudId === solicitudId && p.estado === "pendiente") return p;
    }
    const p: ConfirmacionPendiente = { token: randomUUID(), solicitudId, decision, datosOC, motivo, estado: "pendiente" };
    this.pendientes.set(p.token, p);
    return p;
  }

  obtener(token: string) {
    return this.pendientes.get(token);
  }

  listarPendientes() {
    return [...this.pendientes.values()].filter((p) => p.estado === "pendiente");
  }

  /** Ejecuta o descarta la confirmación. Solo debe llamarla código controlado por una persona. */
  async resolver(
    token: string,
    aprobar: boolean,
    persona: string,
    justificacion: string,
  ): Promise<{ ok: boolean; mensaje: string; oc?: OrdenCompra }> {
    const p = this.pendientes.get(token);
    if (!p) return { ok: false, mensaje: "Token de confirmación inexistente." };
    if (p.estado !== "pendiente") return { ok: false, mensaje: `La confirmación ya fue ${p.estado}.` };

    if (!aprobar) {
      p.estado = "rechazada";
      return { ok: true, mensaje: `Confirmación rechazada por ${persona}. No se creó la OC.` };
    }
    if (p.decision === "ESCALAR" && justificacion.trim().length < 10) {
      return { ok: false, mensaje: "Un escalamiento requiere una justificación de al menos 10 caracteres." };
    }
    const oc = await this.sap.crearOrdenCompra(p.datosOC, {
      creadaPor: "agente-oc",
      confirmadaPor: persona,
      justificacion: justificacion || "Aprobación estándar: todos los controles cumplidos",
    });
    p.estado = "aprobada";
    return { ok: true, mensaje: `OC ${oc.numero} creada y confirmada por ${persona}.`, oc };
  }
}
