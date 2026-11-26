## Proceso de creación de órdenes de compra (OC)

Cada compra llega por correo con tres piezas: la solicitud (Excel), la cotización del proveedor y el correo de aprobación del líder. Hoy la analista digita en SAP proveedor, descripción, centro de costo, subárea, valor, indicador de IVA, aprobador y condiciones de pago, y adjunta el correo de aprobación como evidencia. El agente automatiza la lectura, la validación y la preparación de la OC; **las excepciones no se resuelven a la fuerza: se clasifican y se devuelven a la analista con una recomendación**.

## Reglas de control

Un **bloqueo** impide crear la OC. Una **confirmación** la permite solo si la analista confirma. Un **derivado** es un valor que se completa desde los maestros y debe informarse.

| Regla | Qué verifica | Tipo |
|---|---|---|
| RC1 | El proveedor existe en el maestro (por NIT; sin NIT, por nombre) y está activo. | Bloqueo |
| RC2 | Hay aprobación, contiene «Aprobado» y viene de un correo listado como aprobador del centro de costo. | Bloqueo |
| RC3 | El valor total no supera el tope del aprobador en ese centro. | Bloqueo |
| RC4 | La subárea pertenece al centro de costo. | Bloqueo |
| RC5 | Cotización vs solicitud dentro de ±2 %. Sin cotización o fuera de tolerancia: se muestran ambos valores. | Confirmación |
| RC6 | Indicador de IVA ausente: se deriva del proveedor. | Confirmación + derivado |
| RC7 | Condiciones de pago ausentes: se derivan del proveedor. | Derivado (informa) |
| RC8 | Factura con fecha anterior a la solicitud: compra retroactiva. | Confirmación |
| RC9 | La aprobación no puede ser anterior a la solicitud. | Confirmación |
| RC10 | cantidad × valor unitario = valor total (± 1). | Bloqueo |

## Qué significa y qué recomendar

- **RC1 (proveedor inexistente o inactivo):** no se puede comprar a un proveedor que no está dado de alta o activo en SAP. Recomendar el alta o la reactivación y reenviar la solicitud. No es un dato que la analista pueda corregir en el chat.
- **RC2 (aprobador sin autoridad):** el correo de aprobación no sirve si quien aprueba no es aprobador de ese centro de costo, aunque sea un líder. Recomendar la aprobación de quien corresponde. Si el valor supera el tope de todos los aprobadores del centro, hace falta un nivel superior; no se sugiere partir la compra.
- **RC3 (tope excedido):** el aprobador existe pero no tiene autoridad para ese monto; se necesita un aprobador con tope suficiente.
- **RC5 (cotización ≠ solicitud):** puede ser un error de digitación de la solicitud o un precio que cambió. La analista decide con ambos valores a la vista; el agente nunca ajusta una cifra para que cuadre.
- **RC6/RC7 (datos derivados):** el agente solo completa desde los maestros del proveedor y lo declara. El indicador de IVA se confirma porque afecta el costo.
- **RC8 (compra retroactiva):** la OC se pide después de que llegó la factura, es decir, la cotización y el control previo se saltaron. La OC se puede crear con confirmación, pero queda marcada `retroactiva = true` en `out/control.csv` para que la dirección la mida. Que se permita o se rechace es una política de la compañía; el agente la mide, no la decide.

## Evidencia y trazabilidad

- La evidencia de aprobación es el correo del líder guardado en `out/<caso>/aprobacion.txt` (y `.pdf`) con su `sha256`; ese hash va dentro de la OC.
- Cada valor de la OC es trazable a su fuente (`solicitud`, `cotizacion`, `maestro.<nombre>` o `derivado`) en `out/<caso>/trazabilidad.json`.
- Cada intento de creación (creada, idempotente, bloqueada o pendiente de confirmación) queda en `out/control.csv`.

## Idempotencia

Crear dos veces la misma solicitud devuelve la OC existente. Nunca hay una segunda OC para la misma solicitud.
