# Servidor de Liberaciones (Google Apps Script)

Un solo archivo: `Code.gs`. Guarda las liberaciones en tu Google Sheet y las fotos en Drive.

## 1. Pegar el código

1. Abre el Google Sheet de las liberaciones → **Extensiones → Apps Script**
   (o entra a script.google.com y abre el proyecto que ya usa la app).
2. Borra el contenido de `Code.gs` y pega todo el contenido de `backend/Code.gs`. Guarda (Ctrl+S).
3. Si el proyecto NO está dentro del Sheet, agrega la propiedad `HOJA_ID` (paso 2) con el ID del Sheet
   (el texto largo entre `/d/` y `/edit` de su dirección).
4. Recomendado: **Configuración del proyecto (engranaje) → Zona horaria → (GMT-05:00) Lima**.

## 2. Propiedades (los secretos NO van en el código)

1. Elige la función **`instalar`** en el menú superior y pulsa **Ejecutar** (acepta los permisos la primera vez).
   Crea las hojas y columnas que falten (incluida *Usuarios*, con listas desplegables), la carpeta de fotos en Drive y propiedades de ejemplo, y programa el respaldo semanal.
2. Engranaje → **Propiedades del script** → edita:

| Propiedad | Qué poner |
|---|---|
| `EQUIPO_KEY` | **Clave de invitación**: solo se pide al registrarse (viene en el enlace `#invitar=`). Mínimo 8 caracteres. Los celulares no la guardan. |
| `CARPETA_RAIZ_ID` | Ya creada por `instalar`. Si ya tenías una carpeta de fotos, pega aquí su ID (lo de `/folders/...`). |
| `FOTOS_ENLACE` | `SI` (las fotos se ven con el enlace; así salen las miniaturas en la app) o `NO`. |
| `RESPALDOS_MAX` | Cuántos respaldos conservar (12). `0` = no borrar nunca. |

Mientras `EQUIPO_KEY` empiece con `CAMBIAR`, nadie puede registrarse (a propósito).

### Personas y roles (hoja *Usuarios*)
Cada persona se registra desde la app con su **nombre completo, un usuario** (4–20 caracteres: minúsculas, números, punto o guion bajo), **un código propio** (mín. 6 caracteres) y la **clave de invitación**; si es correcta queda **ACTIVA** al instante con rol `registro`. Ingresa con **usuario + código**.
Roles: `registro` (registra, consulta y edita **sus** liberaciones), `editor` (edita todas, borra y guarda ajustes), `admin` (además administra usuarios). Las acciones del servidor: `listUsuarios`, `setUsuario` (rol / ACTIVO / BAJA), `delUsuario`, `resetCodigo` (código temporal; `CAMBIAR = SI` obliga a elegir uno nuevo), `actualizarPerfil`, `cambiarCodigo` y `editLib` (con rol `registro`, solo sobre sus propias liberaciones). Las cuatro primeras son solo para admin. Todo se hace desde la app; la hoja solo se toca para el primer admin.
Opcional: la propiedad `APROBAR_REGISTROS = SI` deja las altas en `PENDIENTE` hasta que un admin las apruebe. Máximo 20 altas por hora.
El código se guarda cifrado (SHA-256 con sal): nadie puede leerlo. Se actualiza el servidor sin perder usuarios (las columnas nuevas se agregan solas; quien no tenga usuario ingresa con su nombre).
La primera persona (administración) se registra y luego se pone ROL = `admin` directamente en la hoja.

## 3. Publicar como Web App

1. **Implementar → Nueva implementación → Tipo: Aplicación web**.
2. **Ejecutar como: Yo**. **Quién tiene acceso: Cualquier persona** (o "cualquier usuario con el enlace").
3. **Implementar** y copia la URL que termina en `/exec`. Esa URL va en `servidor.js` de la app (las personas no la escriben).

## 4. Actualizar sin cambiar la URL

Cada vez que cambies `Code.gs`: **Implementar → Administrar implementaciones → ✏️ (editar) →
Versión: "Nueva versión" → Implementar**. La URL sigue igual.
(Si eliges "Nueva implementación" se crea otra URL y habría que reconectar los celulares.)

## 5. Respaldo semanal

- `instalar` ya lo programa (domingos ~2 a. m.). Para (re)instalarlo solo: ejecuta **`instalarTriggerRespaldo`**.
- Para probar ya: ejecuta **`respaldar`**. Crea `Respaldo Liberaciones aaaa-mm-dd_hhmm` en la misma carpeta del Sheet
  y manda a la papelera los más viejos (solo los que empiezan con ese nombre).

## Cosas que conviene saber

- **Turnos** (hora de Lima): DÍA 07:00–18:59; NOCHE 19:00–06:59 (de madrugada cuenta como el día anterior).
  El ID es `L` + aammdd de la **fecha del turno** + correlativo (`L261112-003`).
- Columnas nuevas (se agregan solas al final): TURNO, FECHA TURNO, CREADO, AJUSTE MANUAL, FORM, REGISTRADO POR.
  Las filas antiguas no se tocan; su turno se calcula al leerlas.
- Si alguien adivina el código de otra persona: 5 fallos seguidos bloquean 10 minutos **a esa persona** (los demás no se ven afectados). 20 claves de invitación erradas bloquean los registros 10 minutos. Máximo 30 solicitudes sin aprobar (solo con aprobación exigida).
- Errores en la hoja **Log** (se limpia sola, no guarda datos sensibles).
- Probar el código: `node --test tests/backend/code.test.js` (desde la carpeta del repo, con Node 18+).
