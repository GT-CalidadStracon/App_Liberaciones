# Pruebas automáticas

Cargan `index.html` (y `turno.js`) en un navegador simulado (jsdom) y lo manejan como una persona: clics, escritura, pasar el tiempo, perder la señal. No hace falta navegador ni servidor.

## Cómo correrlas

```
npm install        # solo la primera vez (jsdom, fake-indexeddb, acorn)
npm test           # todo (~25 s)
node --test tests/cola.test.js          # un solo archivo
```

Requiere Node 22 o superior (se probó con Node 24); con la variable `APP_HTML=ruta/copia.html` se pueden correr contra otra copia del index (útil para probar que una prueba detecta un error a propósito). Si una prueba falla, el mensaje dice el frente, el tipo, la semilla y los pasos para reproducirlo.

## Qué cubre cada archivo

| Archivo | Qué prueba |
|---|---|
| `humo.test.js` | La app carga sin errores (con indexedDB ausente / presente / bloqueado), dibuja la pantalla principal, cada frente y tipo, y las pantallas de ajustes y del día. |
| `formularios.test.js` | **Fuzz de formularios**: cada frente × tipo de la configuración de fábrica, 20 corridas con semilla fija, llenando por el DOM hasta que sale el texto. Revisa que no haya `undefined/NaN/null`, que estén las líneas esperadas, el formato de cada valor y que sea determinista. Segunda variante con estados Siempre/Opcional/Nunca de las líneas al azar. |
| `configuracion_aleatoria.test.js` | Fuzz de configuración: materiales con modos de capa/espesor/cota al azar, estructuras y procedencias; toda configuración válida debe poder llenarse. |
| `calculos.test.js` | Cota por capa (Tajo 26→2773, 27→2774; 2E capa 15 = 2810.5 con 0.5 m…), espesor por fórmula, `progLongitud`, `evalFormula` rechaza código peligroso, `numFilter`. |
| `validacion.test.js` | Números > 0, progresivas km+metros, capas enteras: lo mal escrito no genera texto. |
| `cola.test.js` | Cola sin señal con servidor simulado: mismo `uid` en cada reenvío, sin duplicados en el servidor (ni con la respuesta perdida), error de servidor, timeout de 90 s, persistencia al reabrir, fotos en IndexedDB, falta de espacio. |
| `hora.test.js` | Turno y día de trabajo con reloj falso (hora de Lima, cualquier zona del celular), cambio automático con la app abierta, confirmación antes de subir, ajuste manual. |
| `config.test.js` | `sanitizeCfg` / `validateCfg` con entradas malformadas, configuración remota del equipo. |
| `duplicar.test.js` | «Copiar datos» (imán): ida y vuelta exacta del texto, con y sin el formulario guardado. |
| `interpretacion.test.js` | `resumenLib` / `interpretarLib` sobre todo lo que la app puede generar. |
| `reporte.test.js` | Reporte diario en Excel de punta a punta: se arma en la página y se abre con ExcelJS. |
| `pwa.test.js` | El script es ES5 válido, los archivos que usa la página están en el caché del service worker, manifest. |
| `turno.test.js` | Reglas puras de `turno.js` (escrito aparte). |

## Cómo está armado

- `helpers/cargarApp.js`: `cargarApp(opciones)` devuelve un objeto `app` con:
  - `app.json("state")`, `app.get("cfg")`, `app.run("código")`, `app.window.funcion()` para leer variables y llamar funciones globales del `<script>` inline;
  - reloj falso (`app.avanzar(ms)`, `app.reloj.fijar(ms)`): `Date`, `setTimeout` y `setInterval` solo avanzan cuando la prueba lo manda;
  - `crearServidorMock()`: servidor del Apps Script simulado con modos `ok`, `error`, `caida`, `perdida`, `lenta`, `http500` y dedupe por `uid` (mismo contrato que `tools/mock_server.py`);
  - `nuevaPersistencia()` / `app.reabrir()`: simula cerrar y volver a abrir la app con el mismo localStorage/IndexedDB;
  - `app.problemasContrato()`: si cambia el nombre de una variable o función global que las pruebas usan, lo dice con claridad (`GLOBALES_CONTRATO`).
- `helpers/llenar.js`: llena un formulario por el DOM como lo haría una persona (clics en botones, eventos `input`).
- `helpers/textoEsperado.js`: verifica el texto generado (líneas esperadas según la configuración de líneas, formato de valores).

## Qué no se prueba

- Service worker / instalación como app / Background Sync (jsdom no los implementa); solo se revisa que `sw.js` liste los archivos que usa la página.
- Aspecto visual, portapapeles real, cámara real, `showPicker` de fecha.
- Un Apps Script real: solo el contrato simulado.

## Si agregas o cambias algo

- Tipo de liberación nuevo: agrégalo a `TIPO_KEYS` y a `etiquetasEsperadas()` en `helpers/textoEsperado.js`; el fuzz lo recorre solo.
- Archivo local nuevo que usa la página: debe estar en `ARCHIVOS` de `sw.js` (lo exige `pwa.test.js`).
