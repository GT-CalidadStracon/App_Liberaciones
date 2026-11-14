# Manual de mantenimiento simple — Generador de Liberaciones CQC

Pensado para alguien del área de Calidad, sin conocimientos de programación. Cuando algo no esté aquí, pide ayuda antes de tocar el código.

## 1. Qué piezas tiene el sistema
| Pieza | Dónde vive | Quién la toca |
|---|---|---|
| **La app** (lo que abren los celulares) | Publicada en una página web (GitHub Pages) | Solo para cambios de código |
| **El servidor** (guarda y entrega los datos) | Google Apps Script, unido a la hoja | Solo para cambios de código |
| **Los datos** | Google Sheet "LIBERACIONES CQC" (hojas *Liberaciones*, *Configuracion*, *Usuarios*, *Log*) | Se consultan; no se editan a mano |
| **Las fotos** | Carpeta de Drive, una subcarpeta por día (`dd-mm-aa`) | Solo lectura |

> **Importante:** el dueño de la hoja y la carpeta debe ser una cuenta controlada por el área (no la de una persona que pueda irse). Hoy la hoja actual pertenece a una cuenta externa; pasarla es la tarea pendiente nº 1.

## 2. Tareas de cada día (nada técnico)
1. **Abrir la app** en el celular → debe mostrar la versión abajo ("Versión 2.x").
2. **Al registrar:** confirmar el turno y el día en el cuadro que aparece.
3. **Reporte:** pantalla *Liberaciones* → *Reporte del día completo* (o solo turno día/noche). Se puede descargar varias veces durante el día.
4. Si un celular dice "esperan señal": con señal vuelve a subir solo; si dice "no se pudo subir", tocar *Reintentar*.

## 3. Tareas de cada semana
- Revisar que exista el **respaldo del domingo** ("Respaldo Liberaciones aaaa-mm-dd") junto a la hoja. Se crea solo.
- Mirar la hoja **Log**: si hay muchas líneas de error repetidas, avisar a quien mantiene el código.
- Revisar la hoja *Liberaciones*: la columna **AJUSTE MANUAL = SÍ** marca los registros donde alguien cambió el turno/día a mano. Si hay muchos, recordar la regla al equipo.

## 3a. Pantallas de la app (2.3)
- **Inicio** (al abrir la app): botón **＋ Registrar liberación**, botón **Ver liberaciones anteriores** y las **3 últimas** liberaciones (con copiar, editar ✎ y borrar ✕ según el rol).
- **Registrar liberación:** empieza por **fecha y turno**; al subir (o al guardarse en el celular si no hay señal) la app **vuelve a Inicio** con un aviso. Para repetir una parecida se usa el ícono de copiar de las últimas.
- **Liberaciones anteriores:** filtro de **fechas «Desde / Hasta»** (día de trabajo; al abrir trae los últimos 7 días, hoy incluido) y filtro de **texto** (todas las palabras, sin tildes ni mayúsculas; filtra lo ya cargado, sin volver al servidor).
  - **⬇ Exportar a Excel:** baja un listado `.xlsx` con **lo que se ve** (rango + filtro de texto), una fila por liberación: ID, fecha del día de trabajo, hora, turno, estructura, tipo, material, capa, espesor, área, cota, progresiva, procedencia, ensayo, protocolo, supervisor, texto completo, enlace a la foto y quién la registró. No incluye las fotos. Archivo: `Liberaciones_aaaa-mm-dd_a_aaaa-mm-dd.xlsx` (`_filtro` si hay texto).
  - Si el rango es **un solo día** (mismas fechas en Desde y Hasta) aparecen además los botones del **reporte del día** (completo, solo día, solo noche), como siempre.
  - El servidor devuelve como máximo 1000 liberaciones por consulta (las más recientes); si hay más, la app avisa y hay que acortar el rango.
- **Servidor 2.3.0:** agrega la acción `listRango` (rango de fechas). Hay que **pegar el `Code.gs` nuevo y publicar una nueva versión del despliegue**; con el servidor anterior, Liberaciones anteriores avisa que hay que actualizarlo (lo demás sigue funcionando).

## 3b. Personas con acceso — todo se hace desde la app
Cada persona **se registra sola** (nombre completo, un **usuario** para ingresar, un código propio de 6 o más caracteres y la **clave de invitación**). Si la clave es correcta queda **ACTIVA de inmediato con rol «Registro»**. No hace falta aprobarla.

**Qué puede hacer cada rol**

| Rol | Registrar y consultar | Editar liberaciones | Borrar liberaciones y cambiar ajustes | Administrar usuarios |
|---|---|---|---|---|
| **Registro** (por defecto) | Sí | Solo las que registró él | No | No |
| **Editor** | Sí | Todas | Sí | No |
| **Admin** | Sí | Todas | Sí | Sí |

- **Mi perfil** (botón **⚙ Configuración ▾** arriba → *Mi perfil*): cambiar nombre completo, usuario y código y ver el rol. Ese mismo menú tiene *Inicio* (primera opción), *Ajustes del generador* y *Cerrar sesión*.
- **Administrar usuarios** (solo admin: Mi perfil → *Gestionar usuarios*): cambiar el rol, **dar de baja / reactivar**, **restablecer el código** (genera un código temporal que se entrega a la persona; al ingresar debe elegir uno propio) y **borrar** la cuenta (sus liberaciones se conservan). Un admin no puede cambiarse el rol, darse de baja ni borrarse a sí mismo, y siempre queda al menos un admin.
- **Editar una liberación:** botón ✎ en «Últimas liberaciones» (Inicio) y en *Liberaciones anteriores*. Se abre el formulario con sus datos; al guardar conserva el mismo ID. En la hoja *Liberaciones* quedan anotados *EDITADO POR* y *EDITADO EN*. Para editar hace falta señal.
- **Primer admin (tú):** regístrate como cualquiera y, **solo esta vez**, cambia en la hoja *Usuarios* tu **ROL** a `admin`. Desde ahí todo lo demás se hace en la app.
- **Quién entra:** quien tenga la clave de invitación puede darse de alta (máximo 20 altas por hora). Por eso la clave se comparte solo con el equipo y se cambia si se filtra (Propiedades del script → `EQUIPO_KEY`; las personas ya registradas no se ven afectadas). La columna *REGISTRADO POR* de *Liberaciones* permite ver quién subió qué.
- **Si prefieres aprobar cada alta:** poner la propiedad `APROBAR_REGISTROS` = `SI`; las personas quedan **PENDIENTES** hasta que un admin las apruebe en *Gestionar usuarios*.
- **Personas registradas antes de los usuarios** (sin usuario): ingresan escribiendo su nombre completo y eligen su usuario en *Mi perfil*.
- Las columnas de la hoja *Usuarios* (SAL, HASH, CAMBIAR…) no se tocan a mano.

## 4. Cambios de configuración (frentes, materiales, supervisores, número de reporte)
Se hacen **desde la app**: botón **⚙ Configuración › Ajustes del generador** (solo con rol de **editor** o **administrador**). La hoja *Configuracion* guarda **una sola fila** con la configuración vigente (sin historial de versiones); arriba de Ajustes, la tarjeta **Última modificación** muestra quién y cuándo la cambió. Si dos personas editan a la vez, la app avisa del conflicto.
- Número de reporte: Ajustes → Reporte → `numRef` y `fechaRef` (número que corresponde a esa fecha; los días siguientes suman 1).
- Evitar nombres duplicados (por ejemplo "STOCKPILE 5" y "STOCK PILE 5").

## 5. Qué hacer si…
| Problema | Qué hacer |
|---|---|
| "Usuario o código incorrecto" | Revisar usuario y código. Si olvidó el código: un admin entra a *Gestionar usuarios* → **Restablecer código** y le entrega el código temporal. |
| "Bloqueado 10 minutos" | Esperar 10 minutos (5 códigos errados bloquean a esa persona; los demás no se ven afectados). |
| "Solicitud pendiente" | Solo aparece si se exige aprobación: un admin pulsa **Aprobar** en *Gestionar usuarios* (§3b). |
| "Tu acceso fue dado de baja" | Es a propósito. Si fue un error, un admin la **reactiva** en *Gestionar usuarios*. |
| "No tienes permiso" | Borrar liberaciones, cambiar ajustes y editar las de otras personas lo hacen editores y administradores; administrar usuarios, solo administradores (§3b). |
| El reporte sale vacío o con "OTRO" | Avisar; normalmente es una liberación antigua sin datos estructurados. |
| Se registró en el turno o día equivocado | Borrar la liberación (un editor o administrador) y registrarla de nuevo con el turno/día correcto. |
| Nadie puede subir liberaciones | Abrir la hoja: ¿está llena o bloqueada? Mirar *Log*. Si el servidor dejó de responder, ver §6. |
| Se borró algo por error | Hoja → Archivo → Historial de versiones, o el último respaldo del domingo. Las fotos borradas quedan en la papelera de Drive. |

## 6. Mantenimiento del servidor (solo quien maneje Apps Script)
Los pasos completos están en `backend/README.md`. Resumen:
1. Hoja → Extensiones → Apps Script → pegar `backend/Code.gs` → guardar.
2. Ejecutar `instalar` una vez (crea columnas, carpeta de fotos, respaldo semanal).
3. Poner `EQUIPO_KEY` (clave de invitación) en *Propiedades del script* (nunca en el código). Ya no existen `PIN_EDITOR` ni `PIN_ADMIN`: se pueden borrar.
4. Implementar como Aplicación web y, para actualizar sin cambiar la URL: *Administrar implementaciones → editar → Nueva versión*.

## 7. Cambios en la app (solo quien maneje el código)
1. Editar los archivos del repositorio. Probar: `npm test`.
2. Subir `APP_VERSION` (en `index.html`) y el nombre de caché `liberaciones-vN` (en `sw.js`).
3. Publicar. Los celulares reciben la versión nueva al abrir con señal. La dirección del servidor está en `servidor.js` (si cambia, editar solo esa línea).
4. Si algo sale mal: volver al commit anterior (`git revert`) y publicar de nuevo.

## 8. Cosas que NO hacer
- No editar a mano las hojas *Liberaciones* ni *Configuracion*.
- No compartir el código personal con nadie. Si alguien deja el equipo: un admin lo da de baja en *Gestionar usuarios* (no hace falta cambiar nada más).
- No cambiar el nombre de las pestañas ni de los encabezados de la hoja.
