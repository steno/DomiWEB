# WhatsApp outreach — menú digital (es-DO)

Canal principal para restaurantes, cafés y bares en RD.

## Mensaje

Hola{{OWNER_GREETING}}, ¿todo bien?

Encontré {{BUSINESS_NAME}} en Google y las reseñas están buenísimas{{REVIEW_SNIPPET}}.

Te armé un menú digital para que tus clientes marquen platos y te pidan por WhatsApp. Míralo aquí (editas platos y bajas el QR en la misma página):

{{CLAIM_URL}}

Cuando envíes tu carta, la publicamos. Si no es para ti, no hay problema.

## Reglas

- Un mensaje por negocio.
- Tono cercano, no vendedor.
- Sin escasez falsa (“solo hoy”, “últimos cupos”).
- No mencionar precios ni paquetes.
- Enviar por WhatsApp al teléfono público del negocio (wa.me).
- **URL estándar = `CLAIM_URL`** (página de reclamo). No mandar `MENU_URL` /menus/ en el primer mensaje — el claim ya embebe el menú, la edición y el QR.
- Nunca localhost.
- Para compartir el **producto** en redes / promo genérica (no 1:1), usar `SHARE_URL` (`tinyurl.com/domenus`), no el link largo de GitHub Pages.
- Solo citar reseñas en español; si no hay, usar el snippet sin comillas en inglés.
