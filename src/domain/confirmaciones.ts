/**
 * Confirmación humana a prueba del modelo (CA3).
 *
 * `confirmado = true` es un argumento que el modelo podría inventar, así que no basta con creerle.
 * El servidor cuenta los mensajes del USUARIO por sesión. Un caso queda "pendiente" cuando se le
 * muestra al usuario (oc_construir_payload) o se intenta crear sin confirmar (oc_crear). Solo se
 * acepta confirmado = true si, después de quedar pendiente, llegó al menos un mensaje nuevo del usuario.
 * Limitación conocida: el sistema no lee el contenido de ese mensaje; eso lo decide el modelo.
 */
export interface Excepcion {
  codigo: string;
  detalle: string;
}

interface Estado {
  mensajesUsuario: number;
  pendientes: Map<string, number>;
  /** Excepciones que se le mostraron al usuario por caso, con sus valores, para que el front las liste. */
  excepciones: Map<string, Excepcion[]>;
}

const sesiones = new Map<string, Estado>();

const estado = (id: string): Estado => {
  let e = sesiones.get(id);
  if (!e) {
    e = { mensajesUsuario: 0, pendientes: new Map(), excepciones: new Map() };
    sesiones.set(id, e);
  }
  return e;
};

export function registrarMensajeUsuario(sessionId: string): void {
  estado(sessionId).mensajesUsuario += 1;
}

/**
 * No sobrescribe: re-mostrar el payload tras el "confirmo" no debe invalidar esa confirmación.
 * Guarda además las excepciones mostradas: el front las lista con sus valores aunque el modelo no las redacte bien.
 */
export function marcarPendiente(sessionId: string, caso: string, excepciones: ReadonlyArray<Excepcion> = []): void {
  const e = estado(sessionId);
  if (!e.pendientes.has(caso)) e.pendientes.set(caso, e.mensajesUsuario);
  if (!e.excepciones.get(caso)?.length && excepciones.length > 0) {
    e.excepciones.set(caso, excepciones.map(({ codigo, detalle }) => ({ codigo, detalle })));
  }
}

export function confirmacionVerificable(sessionId: string, caso: string): boolean {
  const e = estado(sessionId);
  const mensajesAlMarcar = e.pendientes.get(caso);
  return mensajesAlMarcar !== undefined && e.mensajesUsuario > mensajesAlMarcar;
}

export function consumirPendiente(sessionId: string, caso: string): void {
  const e = estado(sessionId);
  e.pendientes.delete(caso);
  e.excepciones.delete(caso);
}

export function pendientesDe(sessionId: string): string[] {
  return [...estado(sessionId).pendientes.keys()];
}

export function excepcionesPendientes(sessionId: string): Array<{ caso: string; items: Excepcion[] }> {
  const e = estado(sessionId);
  return [...e.pendientes.keys()].map((caso) => ({ caso, items: e.excepciones.get(caso) ?? [] }));
}

export function olvidarSesion(sessionId: string): void {
  sesiones.delete(sessionId);
}
