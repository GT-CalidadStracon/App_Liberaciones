/**
 * Servidor de Liberaciones CQC  (Google Apps Script · Web App)
 * ------------------------------------------------------------------
 * Recibe POST (Content-Type text/plain, cuerpo JSON {action,key,...}) y
 * responde JSON {ok:true,...} o {ok:false,error:"..."}.
 *
 * Sin sesión:  ping, registrar (con la clave de invitación), login (usuario + código).
 * Cualquier usuario activo (rol registro): getConfig, addLib, listLibs, listLibsDia, ultimasLibs, searchLibs,
 *           cambiarCodigo, actualizarPerfil y editLib (solo sus propias liberaciones).
 * Rol editor: además editLib de cualquiera, delLib y saveConfig.
 * Rol admin: además listUsuarios, setUsuario (rol / baja), delUsuario y resetCodigo.
 * Mantenimiento (ejecutar a mano desde el editor): instalar, iniciar,
 *           instalarTriggerRespaldo, respaldar.
 *
 * Cada persona se registra con su nombre completo, un usuario, un código propio y la clave de invitación
 * (hoja "Usuarios"): queda ACTIVA con rol "registro". El rol y la baja se cambian desde la app (admin).
 * El primer admin se pone a mano en la hoja (ROL = admin). (APROBAR_REGISTROS = SI exige aprobar cada alta.)
 *
 * Secretos: NO van en el código. Se leen de Propiedades del script
 *   EQUIPO_KEY  clave de invitación: solo se pide al registrarse
 * Ver README.md.
 */

var VERSION_SERVIDOR = '2.2.0';
var TZ = 'America/Lima';                  // UTC-5 fijo, sin horario de verano
var OFFSET_MS = 5 * 3600 * 1000;
var HOJA_LIB = 'Liberaciones';
var HOJA_CFG = 'Configuracion';
var HOJA_LOG = 'Log';
var HOJA_USU = 'Usuarios';
var PREFIJO_RESPALDO = 'Respaldo Liberaciones ';

var MAX_FOTO_B64 = 4 * 1024 * 1024;       // 4 MB de base64
var MAX_TEXTO = 20000;
var MAX_CELDA = 49000;                    // Google Sheets admite 50 000 por celda
var MAX_DIF_DIAS = 400;
var TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;
var USU_MAX_FALLOS = 5;                   // códigos errados seguidos (por nombre) antes de bloquear
var INV_MAX_FALLOS = 20;                  // claves de invitación erradas antes de bloquear los registros
var BLOQUEO_SEG = 600;                    // 10 min
var MAX_PENDIENTES = 30;                  // solicitudes sin aprobar que admite la hoja Usuarios (solo si APROBAR_REGISTROS = SI)
var REG_MAX_HORA = 20;                    // altas nuevas por hora (si la clave de invitación se filtra, limita el daño)
var CODIGOS_FLOJOS = ['123456', '1234567', '12345678', '123456789', '654321', '123123', '121212', '112233',
                      'abcdef', 'qwerty', 'qwerty123', 'password', 'contrasena', 'liberaciones', 'stracon'];
var LOG_MAX = 1000;                       // filas antes de rotar
var LOG_MANTENER = 500;                   // filas que se conservan al rotar

// Encabezados de la hoja "Liberaciones" (las columnas nuevas van al final)
var H = {
  ID: 'ID', FECHA: 'FECHA', HORA: 'HORA', TEXTO: 'TEXTO COMPLETO', FOTO: 'FOTO', UID: 'UID',
  TIPO: 'TIPO DE LIBERACIÓN', EST: 'ESTRUCTURA', MAT: 'MATERIAL', PROC: 'PROCEDENCIA',
  CAPA: 'CAPA', ESP: 'ESPESOR', AREA: 'ÁREA', COTA: 'COTA',
  TURNO: 'TURNO', FTURNO: 'FECHA TURNO', CREADO: 'CREADO', AJUSTE: 'AJUSTE MANUAL', FORM: 'FORM',
  POR: 'REGISTRADO POR', PORU: 'USUARIO REGISTRO', EPOR: 'EDITADO POR', EEN: 'EDITADO EN'
};
var ENC_LIB = [H.ID, H.FECHA, H.HORA, H.TEXTO, H.FOTO, H.UID, H.TIPO, H.EST, H.MAT, H.PROC,
               H.CAPA, H.ESP, H.AREA, H.COTA, H.TURNO, H.FTURNO, H.CREADO, H.AJUSTE, H.FORM, H.POR, H.PORU, H.EPOR, H.EEN];
// Hoja "Usuarios": NOMBRE (completo), USUARIO (para ingresar), ESTADO (ACTIVO|BAJA|PENDIENTE), ROL (registro|editor|admin),
// ALTA; SAL, HASH y CAMBIAR no se tocan a mano (todo se gestiona desde la app)
var ENC_USU = ['NOMBRE', 'ESTADO', 'ROL', 'ALTA', 'SAL', 'HASH', 'USUARIO', 'CAMBIAR'];
var ENC_CFG = ['VERSIÓN', 'FECHA', 'EDITOR', 'CONFIGURACIÓN'];
var ENC_LOG = ['FECHA', 'ACCIÓN', 'MENSAJE'];

var TZ_HOJA = TZ;          // zona horaria de la hoja (se ajusta al abrirla)
var SS_CACHE = null;

// ═══════════════════════════════════════════════════════════════
//  PUNTOS DE ENTRADA
// ═══════════════════════════════════════════════════════════════

function doGet() {
  // Sin datos: solo para comprobar en el navegador que el despliegue vive.
  return responder_({ ok: true, servicio: 'Liberaciones CQC', version: VERSION_SERVIDOR });
}

function doPost(e) {
  var accion = '';
  try {
    var cuerpo = leerCuerpo_(e);
    accion = String(cuerpo.action == null ? '' : cuerpo.action).slice(0, 40);
    var fn = ACCIONES.hasOwnProperty(accion) ? ACCIONES[accion] : null;
    if (!fn) { fallar_('Acción desconocida: ' + accion.replace(/[^\w.\-]/g, '?')); }
    var usuario = null;
    if (!PUBLICAS.hasOwnProperty(accion)) {          // todo lo demás exige un usuario ACTIVO
      usuario = autenticar_(cuerpo);
      requerirActivo_(usuario);
      if (usuario.cambiar && accion !== 'cambiarCodigo') {   // código temporal: primero debe elegir uno propio
        fallar_('Debes elegir un código nuevo antes de continuar.', true, 'cambiar');
      }
      if (ROL_MIN.hasOwnProperty(accion)) { requerirRol_(usuario, ROL_MIN[accion]); }
    }
    return responder_(fn(cuerpo, usuario));
  } catch (err) {
    return responder_(manejarError_(accion, err));
  }
}

// Sin sesión: ping, registrarse (con la clave de invitación) e ingresar (nombre + código)
var PUBLICAS = { ping: true, registrar: true, login: true };
// Rol mínimo (registro < editor < admin); lo no listado lo puede hacer cualquier usuario activo
var ROL_MIN = { saveConfig: 'editor', delLib: 'editor', listUsuarios: 'admin', setUsuario: 'admin',
                delUsuario: 'admin', resetCodigo: 'admin' };

var ACCIONES = {
  ping: accionPing_,
  registrar: accionRegistrar_,
  login: accionLogin_,
  cambiarCodigo: accionCambiarCodigo_,
  actualizarPerfil: accionActualizarPerfil_,
  listUsuarios: accionListUsuarios_,
  setUsuario: accionSetUsuario_,
  delUsuario: accionDelUsuario_,
  resetCodigo: accionResetCodigo_,
  getConfig: accionGetConfig_,
  saveConfig: accionSaveConfig_,
  addLib: accionAddLib_,
  listLibs: accionListLibs_,
  listLibsDia: accionListLibs_,     // alias: el día de trabajo con ambos turnos
  ultimasLibs: accionUltimasLibs_,
  searchLibs: accionSearchLibs_,
  editLib: accionEditLib_,
  delLib: accionDelLib_
};

function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function leerCuerpo_(e) {
  var txt = e && e.postData && e.postData.contents;
  if (!txt) { fallar_('Solicitud vacía', true); }
  var o;
  try { o = JSON.parse(txt); } catch (x) { fallar_('Solicitud inválida (JSON mal formado)', true); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) { fallar_('Solicitud inválida', true); }
  return o;
}

// ═══════════════════════════════════════════════════════════════
//  ERRORES Y LOG
// ═══════════════════════════════════════════════════════════════

// Error "esperado" (mensaje para el usuario). silencioso = no se anota en el Log.
// acceso (opcional) = motivo legible por la app: invalido | pendiente | baja | bloqueado | permiso
function fallar_(msg, silencioso, acceso) {
  throw { esApp: true, message: msg, silencioso: !!silencioso, acceso: acceso || '' };
}

function manejarError_(accion, err) {
  if (err && err.esApp) {
    if (!err.silencioso) { log_(accion, err.message); }
    var r = { ok: false, error: sanear_(err.message) };
    if (err.acceso) { r.acceso = err.acceso; }
    return r;
  }
  var m = sanear_(err && err.message ? err.message : String(err));
  log_(accion, 'ERROR: ' + m);
  return { ok: false, error: 'Error interno del servidor: ' + recortar_(m, 120) };
}

// Quita secretos de cualquier texto antes de loguearlo o devolverlo.
function sanear_(txt) {
  var s = String(txt == null ? '' : txt);
  var secretos = [prop_('EQUIPO_KEY')];
  secretos.forEach(function (x) {
    if (x && x.length >= 4) { s = s.split(x).join('***'); }
  });
  return s;
}

function log_(accion, mensaje) {
  try {
    var ss = abrirHoja_(false);
    var sh = obtenerHoja_(ss, HOJA_LOG, ENC_LOG);
    anexarFila_(sh, [isoLima_(Date.now()), recortar_(sanear_(accion || '-'), 40),
                     recortar_(sanear_(mensaje), 300)]);
    var n = sh.getLastRow();
    if (n > LOG_MAX) { sh.deleteRows(2, n - LOG_MANTENER); }
  } catch (x) { /* el log nunca debe romper una respuesta */ }
}

// ═══════════════════════════════════════════════════════════════
//  SEGURIDAD: clave de invitación y usuarios (nombre + código personal)
// ═══════════════════════════════════════════════════════════════

function prop_(k) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  return v == null ? '' : String(v);
}

// Un valor sirve solo si existe, es largo y no es el texto de ejemplo "CAMBIAR…"
function configurado_(v, minLargo) {
  v = String(v == null ? '' : v);
  return v.length >= minLargo && !/^CAMBIAR/i.test(v);
}

// Comparación sin salida anticipada (tiempo ~ constante)
function igualConst_(a, b) {
  a = String(a == null ? '' : a); b = String(b == null ? '' : b);
  var n = Math.max(a.length, b.length), r = a.length ^ b.length;
  for (var i = 0; i < n; i++) { r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); }
  return r === 0;
}

// Cuenta un fallo en la caché (10 min) con candado, y devuelve el total.
function contarFallo_(cache, clave) {
  var lock = LockService.getScriptLock(), tengo = false;
  try { tengo = lock.tryLock(3000); } catch (x) { tengo = false; }
  try {
    var n = (parseInt(cache.get(clave), 10) || 0) + 1;
    cache.put(clave, String(n), BLOQUEO_SEG);
    return n;
  } finally {
    if (tengo) { lock.releaseLock(); }
  }
}

// Clave de invitación (propiedad EQUIPO_KEY): SOLO se pide para registrarse.
function verificarInvitacion_(clave) {
  var esperada = prop_('EQUIPO_KEY');
  if (!configurado_(esperada, 8)) {
    fallar_('El servidor no está configurado: falta la propiedad EQUIPO_KEY (ver README).');
  }
  var cache = CacheService.getScriptCache();
  if ((parseInt(cache.get('inv_fallos'), 10) || 0) >= INV_MAX_FALLOS) {
    fallar_('Demasiados intentos con la clave de invitación. Espera 10 minutos e inténtalo de nuevo.', true, 'bloqueado');
  }
  if (!igualConst_(clave, esperada)) {
    contarFallo_(cache, 'inv_fallos');
    fallar_('Clave de invitación incorrecta', true);
  }
}

// ── usuarios ────────────────────────────────────────────────────

function hojaUsu_() {
  var ss = abrirHoja_(false);
  var sh = ss.getSheetByName(HOJA_USU) || ss.insertSheet(HOJA_USU);
  var cols = prepararEncabezados_(sh, ENC_USU);
  return { sh: sh, cols: cols };
}

// ESTADO / ROL como los escribe la persona que administra la hoja (sin importar mayúsculas ni tildes)
function estadoDe_(v) {
  var s = clave_(v);
  return s === 'ACTIVO' ? 'ACTIVO' : (s === 'BAJA' ? 'BAJA' : 'PENDIENTE');
}
function rolDe_(v) {
  var s = clave_(v);
  return s === 'ADMIN' ? 'admin' : (s === 'EDITOR' ? 'editor' : 'registro');
}
var RANGO_ROL = { registro: 1, editor: 2, admin: 3 };

function leerUsuarios_(U) {
  var n = U.sh.getLastRow(), out = [];
  if (n < 2) { return out; }
  var vals = U.sh.getRange(2, 1, n - 1, U.cols.total).getValues();
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i], nombre = String(celda_(v, U, 'NOMBRE')).trim();
    if (!nombre) { continue; }
    var usr = String(celda_(v, U, 'USUARIO')).trim(), alta = celda_(v, U, 'ALTA');
    out.push({ fila: i + 2, nombre: nombre, usuario: usr, id: usr || nombre,   // id = con lo que ingresa (los antiguos, con su nombre)
               estado: estadoDe_(celda_(v, U, 'ESTADO')), rol: rolDe_(celda_(v, U, 'ROL')),
               alta: esFecha_(alta) ? isoLima_(alta.getTime()) : String(alta),
               cambiar: verdadero_(celda_(v, U, 'CAMBIAR')),
               sal: String(celda_(v, U, 'SAL')), hash: String(celda_(v, U, 'HASH')) });
  }
  return out;
}

function hashCodigo_(sal, codigo) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sal + ':' + codigo, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { b = b & 255; return (b < 16 ? '0' : '') + b.toString(16); }).join('');
}

function normNombre_(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' '); }

function validarNombre_(v) {
  var s = normNombre_(v);
  if (s.length < 3 || s.length > 40) { fallar_('Escribe tu nombre completo (entre 3 y 40 letras).', true); }
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ .'\-]*$/.test(s)) {
    fallar_('El nombre solo puede llevar letras y espacios.', true);
  }
  return s;
}

// Usuario para ingresar: minúsculas sin tildes, números, punto o guion bajo; 4 a 20 caracteres
function validarUsuario_(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._]{3,19}$/.test(s)) {
    fallar_('El usuario debe tener de 4 a 20 caracteres: letras minúsculas sin tildes, números, punto o guion bajo.', true);
  }
  return s;
}

function validarCodigo_(v) {
  var s = String(v == null ? '' : v).trim();
  if (s.length < 6 || s.length > 40) { fallar_('El código debe tener entre 6 y 40 caracteres.', true); }
  if (/^(.)\1+$/.test(s) || CODIGOS_FLOJOS.indexOf(clave_(s).toLowerCase()) >= 0) {
    fallar_('Ese código es muy fácil de adivinar. Elige otro.', true);
  }
  return s;
}

// Valida usuario + código. Devuelve {fila,nombre,usuario,id,estado,rol,cambiar}. Mensajes genéricos (no dicen si el
// usuario existe) y bloqueo de 10 min tras USU_MAX_FALLOS fallos para ese usuario.
function autenticar_(b) {
  var nombre = normNombre_(b.usuario), codigo = String(b.codigo == null ? '' : b.codigo).trim();
  if (!nombre || !codigo) { fallar_('Usuario o código incorrecto', true, 'invalido'); }   // vacío: ni se cuenta
  var kc = 'f_' + clave_(nombre).slice(0, 60), cache = CacheService.getScriptCache();
  if ((parseInt(cache.get(kc), 10) || 0) >= USU_MAX_FALLOS) {
    fallar_('Demasiados intentos con código incorrecto. Espera 10 minutos e inténtalo de nuevo.', true, 'bloqueado');
  }
  var lista = leerUsuarios_(hojaUsu_()), u = null, kn = clave_(nombre);
  lista.forEach(function (x) { if (!u && clave_(x.id) === kn) { u = x; } });
  var ok = !!(u && u.hash && u.sal && nombre && igualConst_(hashCodigo_(u.sal, codigo), u.hash));
  if (!ok) {
    var fallos = contarFallo_(cache, kc);
    if (fallos >= USU_MAX_FALLOS) {
      log_('login', 'Bloqueo de 10 min por ' + fallos + ' intentos fallidos con el nombre «' + recortar_(nombre, 40) + '»');
      fallar_('Usuario o código incorrecto. Demasiados intentos: bloqueado 10 minutos.', true, 'bloqueado');
    }
    fallar_('Usuario o código incorrecto', true, 'invalido');
  }
  cache.remove(kc);
  return u;
}

function requerirActivo_(u) {
  if (u.estado === 'PENDIENTE') { fallar_('Tu solicitud todavía no fue aprobada.', true, 'pendiente'); }
  if (u.estado === 'BAJA') { fallar_('Tu acceso fue dado de baja. Consulta con tu administrador.', true, 'baja'); }
}

function requerirRol_(u, minimo) {
  if (RANGO_ROL[u.rol] < RANGO_ROL[minimo]) {
    fallar_('No tienes permiso para esta acción (se necesita rol de ' + minimo + ').', false, 'permiso');
  }
}

// Usuario actual, releído de la hoja (por si cambió mientras se esperaba el candado)
function buscarUsuario_(U, id) {
  var k = clave_(id), r = null;
  leerUsuarios_(U).forEach(function (x) { if (!r && clave_(x.id) === k) { r = x; } });
  return r;
}

// ¿Quedaría al menos un administrador ACTIVO si "t" pasa a (estado, rol)? t = null → si se borra
function quedaAdmin_(lista, t, estado, rol) {
  return lista.some(function (x) {
    var e = x.estado, r = x.rol;
    if (t && x.fila === t.fila) { if (!estado) { return false; } e = estado; r = rol; }
    return e === 'ACTIVO' && r === 'admin';
  });
}

function ponerCelda_(sh, fila, col0, valor) {     // texto tal cual (sin que Sheets lo interprete)
  var rg = sh.getRange(fila, col0 + 1, 1, 1);
  rg.setNumberFormats([['@']]);
  rg.setValues([[valor]]);
}

// Cambia el autor de las liberaciones de una persona (cuando cambia su usuario/nombre o se borra su cuenta).
// Las filas antiguas, sin USUARIO REGISTRO, se reconocen por el nombre.
function reasignarAutor_(idViejo, nombreViejo, idNuevo, nombreNuevo) {
  var L = hojaLib_(), n = L.sh.getLastRow();
  if (n < 2) { return 0; }
  var poru = leerColumna_(L, H.PORU, n), por = leerColumna_(L, H.POR, n), kv = clave_(idViejo), kn = clave_(nombreViejo);
  var cambios = 0;
  for (var i = 0; i < poru.length; i++) {
    var suyo = poru[i] !== '' ? clave_(poru[i]) === kv : (por[i] !== '' && clave_(por[i]) === kn);
    if (!suyo) { continue; }
    poru[i] = idNuevo; if (nombreNuevo != null) { por[i] = nombreNuevo; }
    cambios++;
  }
  if (cambios) {
    var fmt = poru.map(function () { return ['@']; });
    var rp = L.sh.getRange(2, L.cols.idx[clave_(H.PORU)] + 1, poru.length, 1);
    rp.setNumberFormats(fmt); rp.setValues(poru.map(function (x) { return [x]; }));
    var rn = L.sh.getRange(2, L.cols.idx[clave_(H.POR)] + 1, por.length, 1);
    rn.setNumberFormats(fmt); rn.setValues(por.map(function (x) { return [x]; }));
  }
  return cambios;
}

// Ejecuta fn con el candado del script (un solo escritor a la vez). No anidar.
function conLock_(fn) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); }
  catch (x) { fallar_('El servidor está ocupado, inténtalo de nuevo en unos segundos.'); }
  try { return fn(); }
  finally {
    try { SpreadsheetApp.flush(); } catch (x2) { /* nada */ }
    lock.releaseLock();
  }
}

// ═══════════════════════════════════════════════════════════════
//  UTILIDADES (texto, fechas, hora de Lima)
// ═══════════════════════════════════════════════════════════════

function recortar_(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) : s; }
function p2_(n) { return (n < 10 ? '0' : '') + n; }
function p3_(n) { return (n < 10 ? '00' : n < 100 ? '0' : '') + n; }
function esFecha_(v) { return Object.prototype.toString.call(v) === '[object Date]'; }
function verdadero_(v) { return v === true || v === 1 || /^(true|1|s[ií]|si)$/i.test(String(v == null ? '' : v).trim()); }

// Clave de comparación de encabezados/campos: sin tildes, mayúsculas, espacios simples
function clave_(s) {
  s = String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, ' ');
  try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (x) { /* nada */ }
  return s;
}

function limaPartes_(ms) {
  var d = new Date(ms - OFFSET_MS);   // hora de Lima leída con getUTC*
  return { a: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
           h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
}
function fechaDe_(p) { return p.a + '-' + p2_(p.m) + '-' + p2_(p.d); }
function horaDe_(p) { return p2_(p.h) + ':' + p2_(p.mi); }
function isoLima_(ms) { var p = limaPartes_(ms); return fechaDe_(p) + 'T' + horaDe_(p) + ':' + p2_(p.s) + '-05:00'; }
function utcDeFecha_(f) { return Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10)); }
function sumarDias_(f, n) {
  var d = new Date(utcDeFecha_(f) + n * 86400000);
  return d.getUTCFullYear() + '-' + p2_(d.getUTCMonth() + 1) + '-' + p2_(d.getUTCDate());
}
function aammdd_(f) { return f.slice(2, 4) + f.slice(5, 7) + f.slice(8, 10); }
function ddMMyy_(f) { return f.slice(8, 10) + '-' + f.slice(5, 7) + '-' + f.slice(2, 4); }

// ¿yyyy-MM-dd y existe en el calendario?
function fechaReal_(f) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(f));
  if (!m) { return false; }
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// Regla de turno (hora de Lima): DÍA 07:00–18:59 · NOCHE 19:00–06:59 (de madrugada = fecha de ayer)
function turnoDeFechaHora_(fecha, h) {
  if (h >= 7 && h < 19) { return { turno: 'DÍA', fecha: fecha }; }
  if (h >= 19) { return { turno: 'NOCHE', fecha: fecha }; }
  return { turno: 'NOCHE', fecha: sumarDias_(fecha, -1) };
}
function turnoDeInstante_(ms) {
  var p = limaPartes_(ms);
  return turnoDeFechaHora_(fechaDe_(p), p.h);
}
// Si el usuario eligió el turno pero no hay fecha válida (misma regla que la app)
function fechaParaTurno_(turno, ms) {
  var p = limaPartes_(ms), hoy = fechaDe_(p);
  return (turno === 'NOCHE' && p.h < 12) ? sumarDias_(hoy, -1) : hoy;
}

function normalizarTurno_(v) {
  var s = clave_(v);
  return s === 'DIA' ? 'DÍA' : (s === 'NOCHE' ? 'NOCHE' : '');
}

// Fecha de cliente: yyyy-MM-dd real y a ≤ 400 días de hoy. Si no, ''.
function fechaClienteValida_(v, ahoraMs) {
  if (typeof v !== 'string' || !fechaReal_(v)) { return ''; }
  var hoy = fechaDe_(limaPartes_(ahoraMs));
  var dif = Math.abs(Math.round((utcDeFecha_(v) - utcDeFecha_(hoy)) / 86400000));
  return dif <= MAX_DIF_DIAS ? v : '';
}

// "creado" del celular: razonable si no está >5 min en el futuro ni es más viejo que 400 días
function creadoValido_(v, ahoraMs) {
  var n = typeof v === 'string' && isNaN(+v) ? Date.parse(v) : Number(v);
  if (v == null || v === '' || !isFinite(n) || n <= 0) { return null; }
  n = Math.floor(n);
  if (n > ahoraMs + TOLERANCIA_FUTURO_MS) { return null; }
  if (n < ahoraMs - MAX_DIF_DIAS * 86400000) { return null; }
  return n;
}

// Valor de celda → 'yyyy-MM-dd' ('' si no se entiende). Acepta Date, yyyy-MM-dd y dd/MM/yyyy.
function normFecha_(v) {
  if (esFecha_(v)) {
    try { v = Utilities.formatDate(v, TZ_HOJA, 'yyyy-MM-dd'); } catch (x) { return ''; }
  }
  var s = String(v == null ? '' : v).trim(), f = '', m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) { f = m[1] + '-' + m[2] + '-' + m[3]; }
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s))) { f = m[3] + '-' + p2_(+m[2]) + '-' + p2_(+m[1]); }
  return f && fechaReal_(f) ? f : '';
}
// Valor de celda → 'HH:mm' ('' si no se entiende)
function normHora_(v) {
  if (esFecha_(v)) {
    try { return Utilities.formatDate(v, TZ_HOJA, 'HH:mm'); } catch (x) { return ''; }
  }
  var m = /^(\d{1,2}):(\d{2})/.exec(String(v == null ? '' : v).trim());
  return m && +m[1] <= 23 ? p2_(+m[1]) + ':' + m[2] : '';
}

// Turno y fecha de turno de una fila: lo guardado si es válido; si no, calculado de FECHA+HORA.
function derivarTurno_(fTurno, turno, fecha, hora) {
  var ft = normFecha_(fTurno), tu = normalizarTurno_(turno);
  if (ft && tu) { return { turno: tu, fechaTurno: ft }; }
  var fc = normFecha_(fecha), hh = normHora_(hora);
  var auto = (fc && hh) ? turnoDeFechaHora_(fc, parseInt(hh, 10)) : null;
  return { turno: tu || (auto ? auto.turno : ''), fechaTurno: ft || (auto ? auto.fecha : fc) };
}

// ═══════════════════════════════════════════════════════════════
//  HOJAS DE CÁLCULO
// ═══════════════════════════════════════════════════════════════

// Abre la hoja de cálculo: propiedad HOJA_ID, o la hoja a la que está unido el script.
function abrirHoja_(crear) {
  if (SS_CACHE) { return SS_CACHE; }
  var id = prop_('HOJA_ID'), ss = null;
  if (id) { ss = SpreadsheetApp.openById(id); }
  else {
    try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (x) { ss = null; }
    if (!ss && crear) {
      ss = SpreadsheetApp.create('Liberaciones CQC');
      PropertiesService.getScriptProperties().setProperty('HOJA_ID', ss.getId());
    }
  }
  if (!ss) { fallar_('El servidor no encuentra la hoja de cálculo: ejecuta iniciar() o define HOJA_ID (ver README).'); }
  try { TZ_HOJA = ss.getSpreadsheetTimeZone() || TZ; } catch (x2) { TZ_HOJA = TZ; }
  SS_CACHE = ss;
  return ss;
}

function obtenerHoja_(ss, nombre, encabezados) {
  var sh = ss.getSheetByName(nombre);
  if (!sh) { sh = ss.insertSheet(nombre); }
  prepararEncabezados_(sh, encabezados);
  return sh;
}

// Garantiza que existan todos los encabezados (los que falten se agregan al final,
// sin tocar los existentes). Devuelve {idx:{CLAVE:columna0}, total:n}
function prepararEncabezados_(sh, requeridos) {
  var ult = sh.getLastColumn();
  var actual = (ult > 0 && sh.getLastRow() > 0) ? sh.getRange(1, 1, 1, ult).getValues()[0] : [];
  var idx = {}, i;
  for (i = 0; i < actual.length; i++) {
    var k = clave_(actual[i]);
    if (k && !(k in idx)) { idx[k] = i; }
  }
  var nuevos = [];
  requeridos.forEach(function (h) {
    var kh = clave_(h);
    if (!(kh in idx)) { idx[kh] = actual.length + nuevos.length; nuevos.push(h); }
  });
  if (nuevos.length) {
    var rg = sh.getRange(1, actual.length + 1, 1, nuevos.length);
    rg.setValues([nuevos]);
    try { rg.setFontWeight('bold'); } catch (x) { /* estético */ }
  }
  return { idx: idx, total: actual.length + nuevos.length };
}

// Agrega una fila al final guardando todo como texto (evita que Sheets convierta
// fechas, quite ceros o interprete "=..." como fórmula). Los números van como número.
function anexarFila_(sh, valores) {
  var fila = sh.getLastRow() + 1;
  var rg = sh.getRange(fila, 1, 1, valores.length);
  rg.setNumberFormats([valores.map(function (v) { return typeof v === 'number' ? '0' : '@'; })]);
  rg.setValues([valores]);
  return fila;
}

function hojaLib_() {
  var ss = abrirHoja_(false);
  var sh = ss.getSheetByName(HOJA_LIB) || ss.insertSheet(HOJA_LIB);
  return { sh: sh, cols: prepararEncabezados_(sh, ENC_LIB), ss: ss };
}

function leerColumna_(L, nombre, n) {
  if (n < 2) { return []; }
  var i = L.cols.idx[clave_(nombre)];
  var v = L.sh.getRange(2, i + 1, n - 1, 1).getValues(), out = [];
  for (var k = 0; k < v.length; k++) { out.push(v[k][0]); }
  return out;
}

function celda_(v, L, nombre) {
  var i = L.cols.idx[clave_(nombre)];
  return (i == null || i >= v.length) ? '' : v[i];
}

// Fila de la hoja → objeto de trabajo (con turno derivado si es una fila antigua)
function filaAObj_(v, L, nroFila) {
  var d = derivarTurno_(celda_(v, L, H.FTURNO), celda_(v, L, H.TURNO), celda_(v, L, H.FECHA), celda_(v, L, H.HORA));
  var cre = celda_(v, L, H.CREADO);
  return {
    fila: nroFila,
    id: String(celda_(v, L, H.ID)),
    uid: String(celda_(v, L, H.UID)),
    fechaReal: normFecha_(celda_(v, L, H.FECHA)),
    hora: normHora_(celda_(v, L, H.HORA)),
    texto: String(celda_(v, L, H.TEXTO)),
    foto: String(celda_(v, L, H.FOTO)),
    form: String(celda_(v, L, H.FORM)),
    creado: esFecha_(cre) ? cre.toISOString() : String(cre),
    ajuste: String(celda_(v, L, H.AJUSTE)),
    por: String(celda_(v, L, H.POR)),
    poru: String(celda_(v, L, H.PORU)),
    epor: String(celda_(v, L, H.EPOR)),
    een: String(celda_(v, L, H.EEN)),
    turno: d.turno,
    fechaTurno: d.fechaTurno
  };
}

// Lee desde la fila "desde" (≥2) hasta la última.
function leerFilas_(L, desde) {
  var n = L.sh.getLastRow();
  if (n < 2 || desde > n) { return []; }
  var vals = L.sh.getRange(desde, 1, n - desde + 1, L.cols.total).getValues(), out = [];
  for (var i = 0; i < vals.length; i++) {
    if (String(celda_(vals[i], L, H.ID)) === '' && String(celda_(vals[i], L, H.TEXTO)) === '') { continue; }
    out.push(filaAObj_(vals[i], L, desde + i));
  }
  return out;
}

// Forma que ve la app. "fecha" = fecha de TURNO (día de trabajo); "fechaReal" = fecha calendario.
function aItem_(o, u) {
  return { id: o.id, uid: o.uid, fecha: o.fechaTurno, fechaTurno: o.fechaTurno, turno: o.turno,
           fechaReal: o.fechaReal, hora: o.hora, texto: o.texto, foto: o.foto, form: o.form,
           creado: o.creado, ajusteManual: o.ajuste, por: o.por, porUsuario: o.poru,
           editadoPor: o.epor, editadoEn: o.een, propia: !!(u && esAutor_(o, u)) };
}
// ¿La liberación es de esta persona? (las filas antiguas se reconocen por el nombre)
function esAutor_(o, u) {
  return o.poru !== '' ? clave_(o.poru) === clave_(u.id) : (o.por !== '' && clave_(o.por) === clave_(u.nombre));
}

// ═══════════════════════════════════════════════════════════════
//  ACCIONES
// ═══════════════════════════════════════════════════════════════

function accionPing_() {
  return { ok: true, servidor: VERSION_SERVIDOR };
}

// ── configuración compartida (hoja con UNA sola fila: la configuración vigente) ──

function hojaCfg_() { return obtenerHoja_(abrirHoja_(false), HOJA_CFG, ENC_CFG); }

// Última configuración válida: {version,fecha,por,config} o null
function ultimaConfig_(sh) {
  var n = sh.getLastRow();
  for (var r = n, k = 0; r >= 2 && k < 20; r--, k++) {
    var v = sh.getRange(r, 1, 1, 4).getValues()[0];
    try {
      var cfg = JSON.parse(String(v[3]));
      if (cfg && typeof cfg === 'object') {
        return { version: Number(v[0]) || 0, fecha: esFecha_(v[1]) ? isoLima_(v[1].getTime()) : String(v[1]),
                 por: String(v[2]), config: cfg };
      }
    } catch (x) { /* fila dañada: probar la anterior */ }
  }
  return null;
}

function accionGetConfig_() {
  var u = ultimaConfig_(hojaCfg_());
  if (!u) { return { ok: true }; }
  return { ok: true, config: u.config, version: u.version, fecha: u.fecha, por: u.por };
}

// ── usuarios: registrarse, ingresar, perfil y administración ────

// registrar {key (clave de invitación), nombre, usuario, codigo}: da de alta a la persona (ACTIVA, rol registro).
// Con APROBAR_REGISTROS = SI queda PENDIENTE hasta que un admin la active (setUsuario) o se pone ACTIVO en la hoja.
function accionRegistrar_(b) {
  verificarInvitacion_(b.key);
  var nombre = validarNombre_(b.nombre), usuario = validarUsuario_(b.usuario), codigo = validarCodigo_(b.codigo);
  var cache = CacheService.getScriptCache(), auto = !verdadero_(prop_('APROBAR_REGISTROS'));
  if ((parseInt(cache.get('reg_n'), 10) || 0) >= REG_MAX_HORA) {
    fallar_('Hay demasiados registros en la última hora. Inténtalo más tarde o avisa a tu administrador.');
  }
  return conLock_(function () {
    var U = hojaUsu_(), lista = leerUsuarios_(U), kn = clave_(nombre), ku = clave_(usuario), pend = 0;
    lista.forEach(function (x) {
      if (x.estado === 'PENDIENTE') { pend++; }
      if (clave_(x.id) === ku) { fallar_('Ese usuario ya existe. Elige otro.', true); }
    });
    lista.forEach(function (x) {
      if (clave_(x.nombre) === kn) { fallar_('Ya existe una persona con ese nombre. Agrega tu segundo nombre o apellido.', true); }
    });
    if (!auto && pend >= MAX_PENDIENTES) { fallar_('Hay demasiadas solicitudes sin aprobar. Avisa a tu administrador.'); }
    var sal = String(Utilities.getUuid()).replace(/-/g, '');
    var v = { NOMBRE: nombre, USUARIO: usuario, ESTADO: auto ? 'ACTIVO' : 'PENDIENTE', ROL: 'registro',
              ALTA: isoLima_(Date.now()), SAL: sal, HASH: hashCodigo_(sal, codigo), CAMBIAR: '' };
    var fila = [];
    for (var c = 0; c < U.cols.total; c++) { fila.push(''); }
    Object.keys(v).forEach(function (h) { fila[U.cols.idx[clave_(h)]] = v[h]; });
    anexarFila_(U.sh, fila);
    cache.put('reg_n', String((parseInt(cache.get('reg_n'), 10) || 0) + 1), 3600);
    log_('registrar', (auto ? 'Alta de ' : 'Solicitud de ') + nombre + ' (' + usuario + ')');
    return { ok: true, nombre: nombre, usuario: usuario, estado: auto ? 'ACTIVO' : 'PENDIENTE', rol: 'registro' };
  });
}

// login {usuario, codigo}: dice quién es y en qué estado está (también si aún está pendiente o de baja)
function accionLogin_(b) {
  var u = autenticar_(b);
  return { ok: true, nombre: u.nombre, usuario: u.usuario, estado: u.estado, rol: u.rol, cambiar: u.cambiar };
}

// cambiarCodigo {usuario, codigo, nuevoCodigo}: también quita la marca de "código temporal"
function accionCambiarCodigo_(b, usuario) {
  var nuevo = validarCodigo_(b.nuevoCodigo);
  if (nuevo === String(b.codigo == null ? '' : b.codigo).trim()) { fallar_('Elige un código distinto al actual.', true); }
  return conLock_(function () {
    var U = hojaUsu_(), yo = buscarUsuario_(U, usuario.id);
    if (!yo) { fallar_('No se encontró tu usuario.'); }
    var sal = String(Utilities.getUuid()).replace(/-/g, '');
    ponerCelda_(U.sh, yo.fila, U.cols.idx[clave_('SAL')], sal);
    ponerCelda_(U.sh, yo.fila, U.cols.idx[clave_('HASH')], hashCodigo_(sal, nuevo));
    ponerCelda_(U.sh, yo.fila, U.cols.idx[clave_('CAMBIAR')], '');
    log_('cambiarCodigo', yo.nombre + ' cambió su código');
    return { ok: true };
  });
}

// actualizarPerfil {nombre?, nuevoUsuario?}: la persona edita su nombre completo y/o su usuario
function accionActualizarPerfil_(b, usuario) {
  var nombre = b.nombre != null && b.nombre !== '' ? validarNombre_(b.nombre) : '';
  var nuevoU = b.nuevoUsuario != null && b.nuevoUsuario !== '' ? validarUsuario_(b.nuevoUsuario) : '';
  if (!nombre && !nuevoU) { fallar_('No hay nada que cambiar.', true); }
  return conLock_(function () {
    var U = hojaUsu_(), lista = leerUsuarios_(U), yo = buscarUsuario_(U, usuario.id);
    if (!yo) { fallar_('No se encontró tu usuario.'); }
    nombre = nombre || yo.nombre; nuevoU = nuevoU || yo.usuario;
    lista.forEach(function (x) {
      if (x.fila === yo.fila) { return; }
      if (nuevoU && clave_(x.id) === clave_(nuevoU)) { fallar_('Ese usuario ya existe. Elige otro.', true); }
      if (clave_(x.nombre) === clave_(nombre)) { fallar_('Ya existe una persona con ese nombre.', true); }
    });
    var idNuevo = nuevoU || nombre;
    if (nombre !== yo.nombre) { ponerCelda_(U.sh, yo.fila, U.cols.idx[clave_('NOMBRE')], nombre); }
    if (nuevoU !== yo.usuario) { ponerCelda_(U.sh, yo.fila, U.cols.idx[clave_('USUARIO')], nuevoU); }
    if (nombre !== yo.nombre || clave_(idNuevo) !== clave_(yo.id)) { reasignarAutor_(yo.id, yo.nombre, idNuevo, nombre); }
    log_('actualizarPerfil', yo.nombre + ' (' + yo.id + ') ahora es ' + nombre + ' (' + idNuevo + ')');
    return { ok: true, nombre: nombre, usuario: nuevoU };
  });
}

// listUsuarios (admin): sin claves ni hashes
function accionListUsuarios_() {
  var items = leerUsuarios_(hojaUsu_()).map(function (x) {
    return { nombre: x.nombre, usuario: x.usuario, id: x.id, estado: x.estado, rol: x.rol, alta: x.alta, cambiar: x.cambiar };
  });
  return { ok: true, items: items };
}

// setUsuario {objetivo, rol?, estado?} (admin): cambia el rol (registro|editor|admin) o activa / da de baja (ACTIVO|BAJA)
function accionSetUsuario_(b, yo) {
  var rol = b.rol != null && b.rol !== '' ? String(b.rol).toLowerCase() : '';
  var estado = b.estado != null && b.estado !== '' ? String(b.estado).toUpperCase() : '';
  if (rol && !RANGO_ROL.hasOwnProperty(rol)) { fallar_('Rol inválido (registro, editor o admin).'); }
  if (estado && estado !== 'ACTIVO' && estado !== 'BAJA') { fallar_('Estado inválido (ACTIVO o BAJA).'); }
  if (!rol && !estado) { fallar_('No hay nada que cambiar.'); }
  return conLock_(function () {
    var U = hojaUsu_(), lista = leerUsuarios_(U), t = buscarUsuario_(U, b.objetivo);
    if (!t) { fallar_('No se encontró a esa persona.'); }
    var propio = clave_(t.id) === clave_(yo.id);
    var nRol = rol || t.rol, nEst = estado || t.estado;
    if (propio && (nRol !== t.rol || nEst !== t.estado)) {
      fallar_('No puedes cambiar tu propio rol ni darte de baja.', false, 'permiso');
    }
    if (!quedaAdmin_(lista, t, nEst, nRol)) { fallar_('Debe quedar al menos un administrador activo.'); }
    if (nEst !== t.estado) { ponerCelda_(U.sh, t.fila, U.cols.idx[clave_('ESTADO')], nEst); }
    if (nRol !== t.rol || !rol) { ponerCelda_(U.sh, t.fila, U.cols.idx[clave_('ROL')], nRol); }
    log_('setUsuario', yo.nombre + ' → ' + t.nombre + ': ' + nEst + ' / ' + nRol);
    return { ok: true, usuario: t.id, estado: nEst, rol: nRol };
  });
}

// delUsuario {objetivo} (admin): borra su cuenta; sus liberaciones se conservan con su nombre
function accionDelUsuario_(b, yo) {
  return conLock_(function () {
    var U = hojaUsu_(), lista = leerUsuarios_(U), t = buscarUsuario_(U, b.objetivo);
    if (!t) { return { ok: true, yaNoExistia: true }; }
    if (clave_(t.id) === clave_(yo.id)) { fallar_('No puedes borrar tu propia cuenta.', false, 'permiso'); }
    if (!quedaAdmin_(lista, t, '', '')) { fallar_('Debe quedar al menos un administrador activo.'); }
    U.sh.deleteRow(t.fila);
    reasignarAutor_(t.id, t.nombre, '(eliminado)', null);
    CacheService.getScriptCache().remove('f_' + clave_(t.id).slice(0, 60));
    log_('delUsuario', yo.nombre + ' borró a ' + t.nombre + ' (' + t.id + ')');
    return { ok: true };
  });
}

function codigoTemporal_() {
  var alf = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''), t = '';
  for (var i = 0; i < 8; i++) { t += alf.charAt(parseInt(hex.substr(i * 2, 2), 16) % alf.length); }
  return t;
}

// resetCodigo {objetivo} (admin): código temporal de un solo uso; la persona debe elegir uno nuevo al entrar
function accionResetCodigo_(b, yo) {
  return conLock_(function () {
    var U = hojaUsu_(), t = buscarUsuario_(U, b.objetivo);
    if (!t) { fallar_('No se encontró a esa persona.'); }
    if (clave_(t.id) === clave_(yo.id)) { fallar_('Para cambiar tu propio código usa Mi perfil.', false, 'permiso'); }
    var temporal = codigoTemporal_(), sal = String(Utilities.getUuid()).replace(/-/g, '');
    ponerCelda_(U.sh, t.fila, U.cols.idx[clave_('SAL')], sal);
    ponerCelda_(U.sh, t.fila, U.cols.idx[clave_('HASH')], hashCodigo_(sal, temporal));
    ponerCelda_(U.sh, t.fila, U.cols.idx[clave_('CAMBIAR')], 'SI');
    CacheService.getScriptCache().remove('f_' + clave_(t.id).slice(0, 60));   // por si estaba bloqueada
    log_('resetCodigo', yo.nombre + ' restableció el código de ' + t.nombre);   // el código temporal NO se anota
    return { ok: true, temporal: temporal, nombre: t.nombre, usuario: t.id };
  });
}

function accionSaveConfig_(b, quien) {
  var cfg = b.config;
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg) || !Array.isArray(cfg.frentes)) {
    fallar_('Configuración inválida (falta la lista de frentes).');
  }
  var json = JSON.stringify(cfg);
  if (json.length > MAX_CELDA) {
    fallar_('La configuración es demasiado grande para guardarla (máx. ' + MAX_CELDA + ' caracteres).');
  }
  return conLock_(function () {
    var sh = hojaCfg_();
    var ult = ultimaConfig_(sh), actual = ult ? ult.version : 0;
    var base = Number(b.baseVersion) || 0;
    if (!verdadero_(b.force) && base !== actual) {
      return { ok: false, conflict: true, version: actual, fecha: ult ? ult.fecha : '', por: ult ? ult.por : '' };
    }
    var nueva = actual + 1, fecha = isoLima_(Date.now());
    // Una sola fila: se sobrescribe (sin historial). El número es solo un contador interno
    // para detectar que dos personas guardaron a la vez; la app no lo muestra.
    var vals = [nueva, fecha, quien.nombre, json];
    var rg = sh.getRange(2, 1, 1, 4);
    rg.setNumberFormats([['0', '@', '@', '@']]);
    rg.setValues([vals]);
    var n = sh.getLastRow();
    if (n > 2) { sh.deleteRows(3, n - 2); }   // filas de versiones anteriores
    log_('saveConfig', 'por ' + quien.nombre);
    return { ok: true, version: nueva, fecha: fecha, por: quien.nombre };
  });
}

// ── fotos ───────────────────────────────────────────────────────

// {data(base64),mime} → {bytes,mime,ext} o null si no hay foto. Rechaza lo inválido.
function validarFoto_(f) {
  if (f == null || f === '') { return null; }
  if (typeof f === 'string') { f = { data: f }; }
  var data = String(f.data == null ? '' : f.data);
  if (!data) { return null; }
  var mime = String(f.mime || '').toLowerCase(), m = /^data:([\w\/+.\-]+);base64,/i.exec(data);
  if (m) { data = data.slice(m[0].length); if (!mime) { mime = m[1].toLowerCase(); } }
  if (!mime) { mime = 'image/jpeg'; }
  if (mime === 'image/jpg') { mime = 'image/jpeg'; }
  if (mime !== 'image/jpeg' && mime !== 'image/png') {
    fallar_('Formato de foto no permitido: solo se aceptan imágenes JPG o PNG.');
  }
  if (data.length > MAX_FOTO_B64) {
    fallar_('La foto es demasiado grande (máximo 4 MB). Toma la foto con menor resolución e inténtalo de nuevo.');
  }
  data = data.replace(/\s+/g, '');
  var bytes;
  try { bytes = Utilities.base64Decode(data); }
  catch (x) { fallar_('La foto está dañada (no se pudo leer).'); }
  var b0 = bytes[0] & 255, b1 = bytes[1] & 255, b2 = bytes[2] & 255, b3 = bytes[3] & 255;
  var esJpg = b0 === 0xFF && b1 === 0xD8 && b2 === 0xFF;
  var esPng = b0 === 0x89 && b1 === 0x50 && b2 === 0x4E && b3 === 0x47;
  if ((mime === 'image/jpeg' && !esJpg) || (mime === 'image/png' && !esPng)) {
    fallar_('El archivo de la foto no es una imagen ' + (mime === 'image/png' ? 'PNG' : 'JPG') + ' válida.');
  }
  return { bytes: bytes, mime: mime, ext: mime === 'image/png' ? 'png' : 'jpg' };
}

function carpetaRaiz_() {
  var id = prop_('CARPETA_RAIZ_ID');
  if (!id) { fallar_('Falta la carpeta de fotos: ejecuta iniciar() o define CARPETA_RAIZ_ID (ver README).'); }
  return DriveApp.getFolderById(id);
}

function subcarpetaDia_(raiz, fechaTurno) {
  var nombre = ddMMyy_(fechaTurno), it = raiz.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : raiz.createFolder(nombre);
}

function nombreSeguro_(s) {
  s = String(s == null ? '' : s).replace(/[\\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.slice(0, 100).trim() || 'foto';
}

// Guarda la foto en <raíz>/<dd-MM-yy>/<NNN>_<nombre>.jpg y devuelve la URL.
function guardarFoto_(foto, fechaTurno, correl, nombreFoto) {
  var sub = subcarpetaDia_(carpetaRaiz_(), fechaTurno);
  var nombre = p3_(correl) + '_' + nombreSeguro_(nombreFoto) + '.' + foto.ext;
  var archivo = null, it = sub.getFilesByName(nombre);
  // Reintento de una subida que quedó a medias: reutiliza el archivo solo si pesa lo mismo.
  while (it.hasNext()) {
    var c = it.next();
    if (c.getBlob().getBytes().length === foto.bytes.length) { archivo = c; break; }
  }
  if (!archivo) { archivo = sub.createFile(Utilities.newBlob(foto.bytes, foto.mime, nombre)); }
  if (prop_('FOTOS_ENLACE') !== 'NO') {
    try { archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
    catch (x) { log_('addLib', 'No se pudo compartir la foto por enlace (política del dominio)'); }
  }
  return archivo.getUrl();
}

function idDrive_(url) {
  var m = /\/d\/([\w-]+)/.exec(url || '') || /[?&]id=([\w-]+)/.exec(url || '');
  return m ? m[1] : '';
}

// ── addLib ──────────────────────────────────────────────────────

// Campos "CLAVE: valor" del texto → mapa por clave_ (para las columnas de resumen)
function camposDe_(b, texto) {
  var m = {};
  function poner(k, v) { k = clave_(k); if (k && !(k in m)) { m[k] = recortar_(v, 2000).trim(); } }
  if (Array.isArray(b.campos)) {
    b.campos.forEach(function (p) { if (Array.isArray(p) && p.length >= 2) { poner(p[0], p[1]); } });
  }
  if (!Object.keys(m).length) {
    texto.split('\n').forEach(function (l) {
      var i = l.indexOf(': ');
      if (i > 0) { poner(l.slice(0, i), l.slice(i + 2)); }
    });
  }
  return m;
}

function accionAddLib_(b, usuario) {
  var uid = String(b.uid == null ? '' : b.uid).trim();
  if (!uid || uid.length > 100) { fallar_('Falta el identificador único (uid) de la liberación.'); }
  var texto = String(b.texto == null ? '' : b.texto).replace(/\r\n?/g, '\n').trim();
  if (!texto) { fallar_('Falta el texto de la liberación.'); }
  if (texto.length > MAX_TEXTO) { fallar_('El texto de la liberación es demasiado largo.'); }
  var foto = validarFoto_(b.foto);
  var form = b.form == null ? '' : (typeof b.form === 'string' ? b.form : JSON.stringify(b.form));
  if (form.length > MAX_CELDA) { form = ''; }             // el FORM es opcional: no bloquea el guardado
  var campos = camposDe_(b, texto);

  // Momento real, turno y fecha de turno
  var ahora = Date.now();
  var creadoMs = creadoValido_(b.creado, ahora);
  var inst = creadoMs != null ? creadoMs : ahora;
  var auto = turnoDeInstante_(inst);
  var turno = normalizarTurno_(b.turno);
  var fecha = fechaClienteValida_(b.fecha, ahora);
  if (!turno && !fecha) { turno = auto.turno; fecha = auto.fecha; }
  else if (!turno) { turno = auto.turno; }
  else if (!fecha) { fecha = fechaParaTurno_(turno, inst); }
  var ajuste = (turno !== auto.turno || fecha !== auto.fecha || verdadero_(b.ajusteManual)) ? 'SÍ' : 'NO';
  var pInst = limaPartes_(inst);

  return conLock_(function () {
    var L = hojaLib_();
    var n = L.sh.getLastRow();
    var ids = leerColumna_(L, H.ID, n), uids = leerColumna_(L, H.UID, n);

    // Idempotencia: el mismo uid no crea otra fila ni otra foto
    for (var i = 0; i < uids.length; i++) {
      if (String(uids[i]) === uid) { return { ok: true, id: String(ids[i]), duplicado: true }; }
    }

    // Correlativo del día de trabajo: máximo entre (filas de ese día) y (mayor sufijo usado)
    var fts = leerColumna_(L, H.FTURNO, n), tus = leerColumna_(L, H.TURNO, n);
    var fcs = leerColumna_(L, H.FECHA, n), hrs = leerColumna_(L, H.HORA, n);
    var prefijo = 'L' + aammdd_(fecha) + '-', usados = {}, cuenta = 0, mayor = 0;
    for (var j = 0; j < ids.length; j++) {
      var sid = String(ids[j]);
      usados[sid] = true;
      if (sid.indexOf(prefijo) === 0) {
        var suf = parseInt(sid.slice(prefijo.length), 10);
        if (suf > mayor) { mayor = suf; }
      }
      if (derivarTurno_(fts[j], tus[j], fcs[j], hrs[j]).fechaTurno === fecha) { cuenta++; }
    }
    var correl = Math.max(cuenta, mayor) + 1;
    while (usados[prefijo + p3_(correl)]) { correl++; }
    var id = prefijo + p3_(correl);

    var url = foto ? guardarFoto_(foto, fecha, correl, b.nombreFoto) : '';

    var v = {};
    v[H.ID] = id; v[H.FECHA] = fechaDe_(pInst); v[H.HORA] = horaDe_(pInst);
    v[H.TEXTO] = texto; v[H.FOTO] = url; v[H.UID] = uid;
    v[H.TIPO] = campos[clave_(H.TIPO)] || ''; v[H.EST] = campos[clave_(H.EST)] || '';
    v[H.MAT] = campos[clave_(H.MAT)] || ''; v[H.PROC] = campos[clave_(H.PROC)] || '';
    v[H.CAPA] = campos[clave_(H.CAPA)] || ''; v[H.ESP] = campos[clave_(H.ESP)] || '';
    v[H.AREA] = campos[clave_(H.AREA)] || '';
    var sup = campos['COTA SUP.'] || '', inf = campos['COTA INF.'] || '';
    v[H.COTA] = campos[clave_(H.COTA)] || (sup && inf ? sup + ' / ' + inf : (sup || inf));
    v[H.TURNO] = turno; v[H.FTURNO] = fecha; v[H.CREADO] = isoLima_(inst);
    v[H.AJUSTE] = ajuste; v[H.FORM] = form; v[H.POR] = usuario ? usuario.nombre : '';
    v[H.PORU] = usuario ? usuario.id : '';

    var fila = [];
    for (var c = 0; c < L.cols.total; c++) { fila.push(''); }
    Object.keys(v).forEach(function (h) { fila[L.cols.idx[clave_(h)]] = v[h]; });
    anexarFila_(L.sh, fila);

    return { ok: true, id: id, turno: turno, fechaTurno: fecha, ajusteManual: ajuste, foto: url };
  });
}

// ── listados ────────────────────────────────────────────────────

// listLibs / listLibsDia {fecha, turno?, fotos?}: liberaciones del día de trabajo (FECHA TURNO).
// Sin "turno" devuelve ambos turnos (es lo que necesita el reporte del día). Orden: el de la hoja.
function accionListLibs_(b, usuario) {
  var fecha = typeof b.fecha === 'string' && fechaReal_(b.fecha) ? b.fecha : '';
  if (!fecha) { fallar_('Fecha inválida (use aaaa-mm-dd).'); }
  var turno = '';
  if (b.turno != null && b.turno !== '') {
    turno = normalizarTurno_(b.turno);
    if (!turno) { fallar_('Turno inválido (use DÍA o NOCHE).'); }
  }
  var L = hojaLib_();
  var items = leerFilas_(L, 2).filter(function (o) {
    return o.fechaTurno === fecha && (!turno || o.turno === turno);
  }).map(function (o) { return aItem_(o, usuario); });
  if (verdadero_(b.fotos)) { items.forEach(adjuntarFoto_); }
  return { ok: true, items: items, hoja: L.ss.getUrl(), fecha: fecha };
}

// Añade fotoData (base64 sin prefijo) y fotoMime desde Drive, para el reporte de Excel
function adjuntarFoto_(it) {
  var id = idDrive_(it.foto);
  if (!id) { return; }
  try {
    var blob = DriveApp.getFileById(id).getBlob();
    it.fotoData = Utilities.base64Encode(blob.getBytes());
    it.fotoMime = blob.getContentType() || 'image/jpeg';
  } catch (x) { log_('listLibs', 'No se pudo leer una foto de ' + it.id); }
}

// ultimasLibs {n}: las n más recientes de la hoja (más nueva primero), n entre 1 y 20
function accionUltimasLibs_(b, usuario) {
  var n = Math.max(1, Math.min(20, parseInt(b.n, 10) || 3));
  var L = hojaLib_(), ult = L.sh.getLastRow();
  var items = leerFilas_(L, Math.max(2, ult - n + 1)).reverse().slice(0, n).map(function (o) { return aItem_(o, usuario); });
  return { ok: true, items: items };
}

// searchLibs {q}: todas las palabras deben aparecer (sin tildes ni mayúsculas); máx. 30, más nuevas primero
function accionSearchLibs_(b, usuario) {
  var palabras = clave_(b.q).split(' ').filter(function (w) { return w; });
  if (clave_(b.q).length < 2) { return { ok: true, items: [] }; }
  var L = hojaLib_(), todas = leerFilas_(L, 2), out = [];
  for (var i = todas.length - 1; i >= 0 && out.length < 30; i--) {
    var t = clave_(todas[i].texto + ' ' + todas[i].id);
    if (palabras.every(function (w) { return t.indexOf(w) >= 0; })) { out.push(aItem_(todas[i], usuario)); }
  }
  return { ok: true, items: out };
}

// editLib {id, texto, campos?, form?, turno?, fecha?, foto?, nombreFoto?, quitarFoto?}: corrige una liberación.
// Conserva su ID. Registro: solo las suyas; editor y admin: cualquiera. Anota quién editó y cuándo.
function accionEditLib_(b, usuario) {
  var id = String(b.id == null ? '' : b.id).trim();
  if (!id) { fallar_('Falta el ID de la liberación.'); }
  var texto = String(b.texto == null ? '' : b.texto).replace(/\r\n?/g, '\n').trim();
  if (!texto) { fallar_('Falta el texto de la liberación.'); }
  if (texto.length > MAX_TEXTO) { fallar_('El texto de la liberación es demasiado largo.'); }
  var foto = validarFoto_(b.foto);
  var form = b.form == null ? null : (typeof b.form === 'string' ? b.form : JSON.stringify(b.form));
  if (form !== null && form.length > MAX_CELDA) { form = null; }       // opcional: no bloquea; se conserva el anterior
  var campos = camposDe_(b, texto), ahora = Date.now();
  return conLock_(function () {
    var L = hojaLib_(), n = L.sh.getLastRow(), ids = leerColumna_(L, H.ID, n), pos = -1;
    for (var i = ids.length - 1; i >= 0; i--) { if (String(ids[i]) === id) { pos = i; break; } }
    if (pos < 0) { fallar_('Esa liberación ya no existe (alguien la borró).'); }
    var fila = pos + 2, o = filaAObj_(L.sh.getRange(fila, 1, 1, L.cols.total).getValues()[0], L, fila);
    if (RANGO_ROL[usuario.rol] < RANGO_ROL.editor && !esAutor_(o, usuario)) {
      fallar_('Solo puedes editar las liberaciones que registraste tú.', false, 'permiso');
    }
    var turno = normalizarTurno_(b.turno) || o.turno, fecha = fechaClienteValida_(b.fecha, ahora) || o.fechaTurno;
    var ponerTexto = function (h, v) { ponerCelda_(L.sh, fila, L.cols.idx[clave_(h)], v); };
    ponerTexto(H.TEXTO, texto);
    ponerTexto(H.TIPO, campos[clave_(H.TIPO)] || ''); ponerTexto(H.EST, campos[clave_(H.EST)] || '');
    ponerTexto(H.MAT, campos[clave_(H.MAT)] || ''); ponerTexto(H.PROC, campos[clave_(H.PROC)] || '');
    ponerTexto(H.CAPA, campos[clave_(H.CAPA)] || ''); ponerTexto(H.ESP, campos[clave_(H.ESP)] || '');
    ponerTexto(H.AREA, campos[clave_(H.AREA)] || '');
    var sup = campos['COTA SUP.'] || '', inf = campos['COTA INF.'] || '';
    ponerTexto(H.COTA, campos[clave_(H.COTA)] || (sup && inf ? sup + ' / ' + inf : (sup || inf)));
    if (form !== null) { ponerTexto(H.FORM, form); }
    if (turno !== o.turno || fecha !== o.fechaTurno) {
      ponerTexto(H.TURNO, turno); ponerTexto(H.FTURNO, fecha); ponerTexto(H.AJUSTE, 'SÍ');
    }
    var fotoVieja = idDrive_(o.foto);
    if (foto) {
      var correl = parseInt((/-(\d+)$/.exec(id) || [])[1], 10) || 1;
      var urlNueva = guardarFoto_(foto, fecha, correl, b.nombreFoto);
      ponerTexto(H.FOTO, urlNueva);
      if (idDrive_(urlNueva) === fotoVieja) { fotoVieja = ''; }   // misma foto reutilizada: no se borra
    } else if (verdadero_(b.quitarFoto)) { ponerTexto(H.FOTO, ''); }
    else { fotoVieja = ''; }
    if (fotoVieja) { try { DriveApp.getFileById(fotoVieja).setTrashed(true); } catch (x) { /* ya no estaba */ } }
    ponerTexto(H.EPOR, usuario.nombre); ponerTexto(H.EEN, isoLima_(ahora));
    log_('editLib', id + ' editada por ' + usuario.nombre);
    var nuevo = filaAObj_(L.sh.getRange(fila, 1, 1, L.cols.total).getValues()[0], L, fila);
    return { ok: true, id: id, item: aItem_(nuevo, usuario) };
  });
}

// delLib {id}: borra la fila y manda la foto a la papelera de Drive (rol editor o admin)
function accionDelLib_(b, quien) {
  var id = String(b.id == null ? '' : b.id).trim();
  if (!id) { fallar_('Falta el ID de la liberación.'); }
  return conLock_(function () {
    var L = hojaLib_(), n = L.sh.getLastRow();
    var ids = leerColumna_(L, H.ID, n), pos = -1;
    for (var i = ids.length - 1; i >= 0; i--) { if (String(ids[i]) === id) { pos = i; break; } }
    if (pos < 0) { return { ok: true, id: id, yaNoExistia: true }; }   // ya estaba borrada: nada que hacer
    var fila = pos + 2;
    var url = String(L.sh.getRange(fila, L.cols.idx[clave_(H.FOTO)] + 1, 1, 1).getValues()[0][0]);
    L.sh.deleteRow(fila);
    var fid = idDrive_(url);
    if (fid) { try { DriveApp.getFileById(fid).setTrashed(true); } catch (x) { /* foto ya borrada */ } }
    log_('delLib', id + ' eliminada por ' + quien.nombre);
    return { ok: true, id: id };
  });
}

// ═══════════════════════════════════════════════════════════════
//  INSTALACIÓN Y RESPALDO  (se ejecutan a mano desde el editor)
// ═══════════════════════════════════════════════════════════════

// Crea hojas, encabezados, carpeta raíz y propiedades de ejemplo. Se puede repetir sin daño.
function iniciar() {
  var ss = abrirHoja_(true);
  obtenerHoja_(ss, HOJA_LIB, ENC_LIB);
  obtenerHoja_(ss, HOJA_CFG, ENC_CFG);
  obtenerHoja_(ss, HOJA_LOG, ENC_LOG);
  var usu = obtenerHoja_(ss, HOJA_USU, ENC_USU);
  try {   // listas desplegables para aprobar / dar de baja sin escribir
    var cols = prepararEncabezados_(usu, ENC_USU), maxFilas = 500;
    var regla = function (lista) {
      return SpreadsheetApp.newDataValidation().requireValueInList(lista, true).setAllowInvalid(false).build();
    };
    usu.getRange(2, cols.idx[clave_('ESTADO')] + 1, maxFilas, 1).setDataValidation(regla(['PENDIENTE', 'ACTIVO', 'BAJA']));
    usu.getRange(2, cols.idx[clave_('ROL')] + 1, maxFilas, 1).setDataValidation(regla(['registro', 'editor', 'admin']));
  } catch (xv) { /* estético: si falla, se escribe a mano */ }
  try { ss.setSpreadsheetTimeZone(TZ); TZ_HOJA = TZ; } catch (x) { /* sin permiso: no es grave */ }

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('CARPETA_RAIZ_ID')) {
    props.setProperty('CARPETA_RAIZ_ID', DriveApp.createFolder('Liberaciones CQC - Fotos').getId());
  }
  // Valores de ejemplo (NO sirven hasta que los cambies): el servidor rechaza todo lo que empiece con CAMBIAR
  var ejemplo = { EQUIPO_KEY: 'CAMBIAR-clave-de-invitacion', FOTOS_ENLACE: 'SI', RESPALDOS_MAX: '12' };
  Object.keys(ejemplo).forEach(function (k) {
    if (!props.getProperty(k)) { props.setProperty(k, ejemplo[k]); }
  });
  log_('iniciar', 'Instalación/verificación completada');
  return 'Listo. Ahora cambia EQUIPO_KEY (clave de invitación) en Propiedades del script.';
}

// Copia la hoja a un archivo de respaldo (misma carpeta de Drive) y borra los más viejos.
function respaldar() {
  var ss = abrirHoja_(false);
  var archivo = DriveApp.getFileById(ss.getId());
  var padres = archivo.getParents();
  var carpeta = padres.hasNext() ? padres.next() : carpetaRaiz_();
  var p = limaPartes_(Date.now());
  var nombre = PREFIJO_RESPALDO + fechaDe_(p) + '_' + p2_(p.h) + p2_(p.mi);
  archivo.makeCopy(nombre, carpeta);

  var max = parseInt(prop_('RESPALDOS_MAX'), 10);
  if (isFinite(max) && max > 0) {
    var lista = [], it = carpeta.searchFiles("title contains '" + PREFIJO_RESPALDO.trim() + "' and trashed = false");
    while (it.hasNext()) {
      var f = it.next();
      if (f.getName().indexOf(PREFIJO_RESPALDO) === 0) { lista.push({ n: f.getName(), f: f }); }
    }
    lista.sort(function (a, c) { return a.n < c.n ? 1 : (a.n > c.n ? -1 : 0); });   // el más nuevo primero
    for (var i = max; i < lista.length; i++) { lista[i].f.setTrashed(true); }      // a la papelera (recuperable)
  }
  log_('respaldar', 'Creado ' + nombre);
  return nombre;
}

// Programa el respaldo semanal (domingo ~2 a.m.). Quita triggers repetidos.
function instalarTriggerRespaldo() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'respaldar') { ScriptApp.deleteTrigger(t); }
  });
  ScriptApp.newTrigger('respaldar').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(2).create();
  return 'Respaldo semanal programado (domingos, ~2 a.m.).';
}

// Todo en uno: preparar hojas/carpeta/propiedades + respaldo semanal.
function instalar() {
  iniciar();
  return instalarTriggerRespaldo();
}
