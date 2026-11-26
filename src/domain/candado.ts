/**
 * Exclusión mutua por clave, dentro del proceso. Garantiza que dos llamadas con la misma clave se ejecuten
 * una tras otra, nunca entremezcladas. Se usa para que «¿ya existe la OC? → créala» sea atómico por solicitud:
 * sin esto, dos sesiones simultáneas pasaban la comprobación a la vez y creaban dos OC.
 *
 * Límite conocido: solo protege dentro de un proceso. Con varias instancias del servidor, la atomicidad debe
 * venir del sistema de registro (en SAP real, la referencia externa única de la OC).
 */
const colas = new Map<string, Promise<unknown>>();

export async function conCandado<T>(clave: string, fn: () => Promise<T>): Promise<T> {
  const anterior = colas.get(clave) ?? Promise.resolve();
  const actual = anterior.then(fn);
  const cola = actual.then(
    () => undefined,
    () => undefined, // un fallo no debe bloquear a quien espera detrás
  );
  colas.set(clave, cola);
  try {
    return await actual;
  } finally {
    if (colas.get(clave) === cola) colas.delete(clave);
  }
}
