# Extracción del nombre del dueño / encargado

Idioma de salida: español dominicano (es-DO). Solo nombre de pila.

## Instrucciones

Lee todas las reseñas de Google y las respuestas del dueño. Extrae el **nombre de pila más probable** del dueño, gerente o persona que atiende el negocio.

Nombres dominicanos comunes (ejemplos, no lista cerrada): Juan, Carlos, José, Luis, Pedro, Miguel, Rafael, Manuel, Francisco, Ramón, Ana, María, Carmen, Rosa, Laura, Patricia, Jennifer, Yohanna, Starlin, Kelvin, etc.

## Reglas

- Si un cliente saluda o menciona al dueño por nombre (“gracias Juan”, “don Carlos”, “la Sra. María”), prioriza eso.
- Las respuestas del dueño firmadas (“Atte. José”, “— Ana”) son fuerte evidencia.
- Si hay varios candidatos, elige el más frecuente / más claro.
- Si no hay evidencia suficiente, devuelve `null` y confianza baja.
- Nunca inventes un nombre.

## Formato de respuesta (JSON)

```json
{
  "firstName": "Carlos",
  "confidence": 0.82,
  "evidence": "Cliente: 'gracias Carlos por el servicio rápido'"
}
```

`confidence` de 0 a 1. `firstName` puede ser `null`.
