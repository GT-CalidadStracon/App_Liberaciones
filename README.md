# Generador de Liberaciones CQC

App web (PWA) para que Calidad registre las liberaciones de obra desde el celular y descargue el **reporte diario** en Excel.

## Reglas de negocio (acordadas con el área)
- **Día de trabajo:** turno **DÍA** de 07:00 a 18:59, turno **NOCHE** de 19:00 a 06:59 del día siguiente. Una liberación registrada el 14 a las 04:00 pertenece al día de trabajo del **13**.
- El turno y el día se detectan solos (hora de Lima), se pueden cambiar a mano y **siempre se confirman antes de registrar**.
- **Reporte del día, progresivo:** incluye todo lo registrado hasta el momento (ambos turnos); se puede descargar varias veces durante el día. También hay reporte solo del turno día o solo del turno noche.
- Un día o turno sin liberaciones no genera reporte.
- Número del reporte: `numRef` + días desde `fechaRef` (Ajustes → reporte). Los reportes por turno usan el mismo número con sufijo `-D` / `-N`. Un reporte descargado con el día abierto lleva `_corte-HHMM` en el nombre y "PARCIAL" en el encabezado.

## Archivos
| Archivo | Para qué sirve |
|---|---|
| `index.html` | La app completa (formularios, cola sin señal, reporte). |
| `turno.js` | Regla única de turno/día de trabajo (la usan la app y las pruebas). |
| `sw.js`, `manifest.webmanifest`, iconos, logos, `exceljs.min.js` | Instalación como app y generador de Excel. |
| `backend/Code.gs` | Servidor (Google Apps Script) — ver `backend/README.md`. |
| `tests/` | Pruebas automáticas (`npm test`). |
| `tools/mock_server.py` | Servidor simulado para probar sin tocar el sistema real. |
| `docs/MANTENIMIENTO.md` | Manual de mantenimiento simple. |

## Probar en local
```bash
python -m http.server 8765 --bind 127.0.0.1
python tools/mock_server.py            # servidor simulado en el puerto 8766, clave KEY-TEST
```
La app trae la dirección del servidor en `servidor.js` (vacía = modo local sin sistema del equipo). Para apuntar a otro servidor en pruebas: `http://127.0.0.1:8765/index.html#s=<URL https>&invitar=<clave>`.
> `tools/mock_server.py` usa el contrato anterior (clave compartida) y está pendiente de actualizar; las pruebas automáticas (`npm test`) ya usan el servidor simulado nuevo.

## Cambiar la versión
Al publicar cambios: subir `APP_VERSION` en `index.html` y el nombre de caché en `sw.js` (`liberaciones-vN`).
