# WhatsApp close — menú digital pago y entrega (es-DO)

Usar **solo después** de que diga que sí al precio.
No enviar en el primer mensaje ni en el de precio.

## Mensaje

Dale. Para pasártelo:

1. Transferencia *{{PRICE_ONCE}}* a:
   Banco: {{TRANSFER_BANK}}
   Cuenta: {{TRANSFER_ACCOUNT}}
   A nombre de: {{TRANSFER_NAME}}

2. Cuando me mandes el comprobante, en {{DELIVERY_HOURS}} te dejo:
   • el menú en tu link (con el QR)
   • los cambios de platos/precios que me digas al inicio

¿Me confirmas cuando hagas la transferencia?

## Reglas

- Tercer mensaje del funnel (después de interés + precio).
- Datos de transferencia desde `.env` (TRANSFER_BANK / TRANSFER_ACCOUNT / TRANSFER_NAME).
- Sin escasez falsa.
- Tono cercano, claro, un solo next step.
