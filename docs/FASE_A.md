# Fase A — Poner el sistema en manos del área

Objetivo: que la hoja, las fotos y la app **no dependan de una cuenta ajena ni de una persona**.
Decisiones tomadas: cuenta Google **nueva del área de Calidad** y **GitHub Pages del área**.

Quién hace qué: los pasos marcados **[TÚ]** requieren iniciar sesión, crear cuentas o aceptar permisos, y los hace Andoni.
Los marcados **[CLAUDE]** los hace Claude (código, pruebas, ajustes de URL), con la sesión que Andoni abra.

---

## A1. Cuenta Google del área [TÚ]
1. Crear una cuenta Google nueva (p. ej. `calidad.<nombre-del-área>@gmail.com`).
2. **Guardar usuario, contraseña y recuperación en un lugar del área** (no solo en tu cabeza ni tu teléfono).
   Activar la verificación en dos pasos con **dos** responsables del área (tú + tu jefe/compañero).
3. Esa cuenta será dueña de la hoja y de la carpeta de fotos. **No** la uses para otra cosa.

## A2. Copiar la hoja [TÚ]
1. Con la cuenta del área, abrir la hoja actual (enlace que te compartieron) → **Archivo → Hacer una copia**.
   Nombre: `LIBERACIONES CQC`. Si "Hacer una copia" está bloqueado, pedir al dueño actual que te la transfiera
   o descargarla como Excel (`Archivo → Descargar → .xlsx`) y subirla a la cuenta del área.
2. Comprobar que la copia tiene las hojas esperadas (*Liberaciones*, *Configuracion* si existe) y las 38 filas.
3. **No borres ni toques la hoja original** hasta terminar la Fase B.

## A3. Copiar las fotos [TÚ]
Una carpeta de Drive no se puede copiar entera de una cuenta a otra con un clic.
1. Con tu cuenta personal, abrir la carpeta original → clic derecho → **Descargar** (se baja un ZIP con subcarpetas `dd-mm-aa`).
2. Descomprimir en tu computador.
3. En Drive de la cuenta del área, crear la carpeta **`Liberaciones CQC - Fotos`** y subir las subcarpetas.
> Aviso: las filas antiguas de la hoja guardan en la columna FOTO el **enlace a la foto de la cuenta ajena**.
> Mientras esa cuenta siga activa, esos enlaces funcionan; si se borra o cambia, se rompen.
> En la **Fase B** se reemplazan por los enlaces nuevos.

## A4. Instalar el servidor [TÚ + CLAUDE]
1. [TÚ] Con la cuenta del área, abrir la hoja copiada → **Extensiones → Apps Script**.
2. [TÚ] Pegar el contenido de `backend/Code.gs` → guardar. Zona horaria del proyecto: **(GMT-05:00) Lima**.
3. [TÚ] Ejecutar la función **`instalar`** (aceptar permisos). Si Google avisa "app no verificada": *Avanzado → Ir a (proyecto)*; es tu propio script.
4. [TÚ] En *Propiedades del script*: `EQUIPO_KEY` (clave de invitación, mín. 8 caracteres) y `CARPETA_RAIZ_ID` = ID de la carpeta de fotos de A3.
   **Anota la clave de invitación en el lugar seguro del área.** No la pegues en chats masivos. (Ya no hay PIN: cada persona tiene su código.)
5. [TÚ] **Implementar → Nueva implementación → Aplicación web** (Ejecutar como: Yo; Acceso: Cualquier persona). Copiar la URL `/exec`.
6. [CLAUDE] Con la URL y la clave: prueba de humo (ping, getConfig, registrar una liberación de prueba, listar, borrar) y comprobación del respaldo (`respaldar`).

## A5. Repositorio y publicación [TÚ + CLAUDE]
1. [TÚ] Crear una cuenta de GitHub del área (o una organización) con correo del área y 2FA. Anotar credenciales en el lugar seguro.
2. [TÚ] Crear un repositorio **público** (GitHub Pages gratis lo requiere) llamado, p. ej., `liberaciones-cqc`.
   > Es público solo el código de la app; **los datos y las claves no están en el código**.
3. [CLAUDE] Subir el código (`git remote add` + `git push`) cuando me confirmes la dirección y tengas la sesión iniciada.
4. [TÚ] En el repositorio: **Settings → Pages → Branch: main → Save**. La app quedará en `https://<cuenta>.github.io/liberaciones-cqc/`.
5. [CLAUDE] Verificar que carga, que el service worker se instala y que el enlace de invitación (`#invitar=`) funciona.

## A6. Conectar los celulares [TÚ]
1. Mandar a cada persona el **enlace de invitación** (`https://<app>/#invitar=<clave>`). La persona escribe su nombre, elige su código y la clave de invitación, y queda activa al instante (ver manual §3b) → *Agregar a pantalla de inicio*.
2. Los celulares que usaban la app vieja deben **borrar la app vieja** y abrir la nueva (la dirección cambió).

## A7. Cierre de la Fase A
- [ ] Hoja y carpeta en la cuenta del área, con 2 responsables con acceso de recuperación.
- [ ] Servidor desplegado y probado (prueba de humo OK, respaldo OK).
- [ ] App publicada en GitHub del área.
- [ ] Un celular real registró una liberación de prueba y se descargó el reporte.
- [ ] Credenciales guardadas en el lugar del área.
- [ ] Original (cuenta ajena) intacto hasta terminar la Fase B.

## Riesgos a vigilar
- **Una sola persona con las llaves**: por eso 2 responsables en la cuenta del área.
- **Enlaces de fotos viejos**: se corrigen en la Fase B.
- **URL nueva de la app**: hay que avisar a todos los que la usan.
- **Cuenta Gmail gratuita**: tiene límites de Apps Script (≈6 min por ejecución, cuota diaria). Para este volumen sobran; si el uso crece, valorar Google Workspace.
