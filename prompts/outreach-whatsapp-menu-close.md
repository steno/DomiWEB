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
   • el menú publicado en tu link
   • el QR listo (está en la página de reclamo)
   • tus platos/precios si ya los editaste o me mandaste la carta

¿Me confirmas cuando hagas la transferencia?

## Reglas

- Tercer mensaje del funnel (después de interés + precio).
- Datos de transferencia desde `.env` (TRANSFER_BANK / TRANSFER_ACCOUNT / TRANSFER_NAME).
- Sin escasez falsa.
- Tono cercano, claro, un solo next step.
