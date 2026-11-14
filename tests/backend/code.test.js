'use strict';
// Pruebas de backend/Code.gs con dobles en memoria de los servicios de Apps Script.
// Ejecutar:  node --test tests/backend/code.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CODIGO = fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'Code.gs'), 'utf8');
const KEY = 'KEY-TEST-1234';                       // clave de invitación (solo para registrarse)
const ENC_VIEJOS = ['ID', 'FECHA', 'HORA', 'TEXTO COMPLETO', 'FOTO', 'UID', 'TIPO DE LIBERACIÓN', 'ESTRUCTURA',
  'MATERIAL', 'PROCEDENCIA', 'CAPA', 'ESPESOR', 'ÁREA', 'COTA'];
const ENC_NUEVOS = ['TURNO', 'FECHA TURNO', 'CREADO', 'AJUSTE MANUAL', 'FORM', 'REGISTRADO POR', 'USUARIO REGISTRO', 'EDITADO POR', 'EDITADO EN'];
const ENC_USU = ['NOMBRE', 'ESTADO', 'ROL', 'ALTA', 'SAL', 'HASH', 'USUARIO', 'CAMBIAR'];
// Usuarios de prueba (ya aprobados), con su código
const ANA = { usuario: 'ana', codigo: 'codigo-ana' };            // editor (Ana)
const LUIS = { usuario: 'luis', codigo: 'codigo-luis' };         // admin (Luis)
const BETO = { usuario: 'beto', codigo: 'codigo-beto' };         // registro (Beto Registro)

// ── hora de Lima (UTC-5) ↔ ms ─────────────────────────────────────
function lima(s) { // 'YYYY-MM-DD HH:mm[:ss]'
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 5, +m[5], +(m[6] || 0));
}

// ── dobles de Apps Script ────────────────────────────────────────
function crearHoja(nombre) {
  const filas = [];
  const sh = {
    _filas: filas,
    getName() { return nombre; },
    getLastRow() {
      for (let i = filas.length - 1; i >= 0; i--) {
        if (filas[i] && filas[i].some((x) => x !== '' && x != null)) return i + 1;
      }
      return 0;
    },
    getLastColumn() {
      let m = 0;
      filas.forEach((f) => {
        if (!f) return;
        for (let j = f.length - 1; j >= 0; j--) if (f[j] !== '' && f[j] != null) { m = Math.max(m, j + 1); break; }
      });
      return m;
    },
    getRange(r, c, nr, nc) {
      nr = nr == null ? 1 : nr; nc = nc == null ? 1 : nc;
      if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error('Rango inválido: ' + [r, c, nr, nc]);
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = filas[r - 1 + i] || [], o = [];
            for (let j = 0; j < nc; j++) { const v = row[c - 1 + j]; o.push(v == null ? '' : v); }
            out.push(o);
          }
          return out;
        },
        setValues(vals) {
          if (vals.length !== nr || vals[0].length !== nc) throw new Error('Dimensiones de setValues no coinciden');
          for (let i = 0; i < nr; i++) {
            while (filas.length < r + i) filas.push([]);
            const row = filas[r - 1 + i];
            for (let j = 0; j < nc; j++) row[c - 1 + j] = vals[i][j];
          }
        },
        setNumberFormats(f) {
          if (f.length !== nr || f[0].length !== nc) throw new Error('Dimensiones de setNumberFormats no coinciden');
          sh._formatos = (sh._formatos || []).concat([{ r, c, f }]);
        },
        setNumberFormat() {},
        setFontWeight() { return this; }
      };
    },
    deleteRow(r) { filas.splice(r - 1, 1); },
    deleteRows(r, n) { filas.splice(r - 1, n); },
    // ayudas de prueba
    _poner(arr) { filas.push(arr); },
    _tabla() { // [{ENCABEZADO: valor}, ...]
      const enc = (filas[0] || []).map((x) => (x == null ? '' : x));
      return filas.slice(1).map((f) => { const o = {}; enc.forEach((h, i) => { o[h] = f[i] == null ? '' : f[i]; }); return o; });
    }
  };
  return sh;
}

function iter(arr) { let i = 0; return { hasNext() { return i < arr.length; }, next() { return arr[i++]; } }; }

function crearEntorno(opts) {
  opts = opts || {};
  const estado = { ahora: opts.ahora || lima('2026-11-12 10:00'), lockHeld: false, lockWaits: 0, lockFalla: false, driveFalla: false };
  const props = Object.assign({ EQUIPO_KEY: KEY, FOTOS_ENLACE: 'SI' }, opts.props || {});
  if (opts.sinProps) Object.keys(props).forEach((k) => delete props[k]);

  // Hoja de cálculo
  const hojas = {};
  const ss = {
    id: 'SS-ID-1',
    getId() { return 'SS-ID-1'; },
    getUrl() { return 'https://docs.google.com/spreadsheets/d/SS-ID-1/edit'; },
    getSpreadsheetTimeZone() { return 'America/Lima'; },
    setSpreadsheetTimeZone() {},
    getSheetByName(n) { return hojas[n] || null; },
    insertSheet(n) { hojas[n] = crearHoja(n); return hojas[n]; }
  };
  const SpreadsheetApp = {
    getActiveSpreadsheet() { return opts.sinHojaActiva ? null : ss; },
    openById() { return ss; },
    create() { return ss; },
    flush() {}
  };

  // Drive
  let seq = 0; const archivos = {}; const carpetas = {};
  function Carpeta(nombre, padre) {
    this._n = nombre; this.id = 'fld' + (++seq); this._sub = []; this._arch = []; this._padre = padre;
    carpetas[this.id] = this; if (padre) padre._sub.push(this);
  }
  Carpeta.prototype = {
    getName() { return this._n; }, getId() { return this.id; },
    getFoldersByName(n) { return iter(this._sub.filter((c) => c._n === n)); },
    createFolder(n) { return new Carpeta(n, this); },
    getFilesByName(n) { return iter(this._arch.filter((f) => f._n === n && !f._papelera)); },
    searchFiles() { return iter(this._arch.filter((f) => !f._papelera)); },
    createFile(blob) {
      if (estado.driveFalla) throw new Error('Drive no disponible');
      return new Archivo(blob.getName(), blob.getBytes(), blob.getContentType(), this);
    }
  };
  function Archivo(nombre, bytes, mime, carpeta, id) {
    this._n = nombre; this._bytes = bytes; this._mime = mime; this._carpeta = carpeta;
    this.id = id || 'fil' + (++seq); archivos[this.id] = this; carpeta._arch.push(this);
  }
  Archivo.prototype = {
    getId() { return this.id; }, getName() { return this._n; },
    getUrl() { return 'https://drive.google.com/file/d/' + this.id + '/view?usp=drivesdk'; },
    getBlob() { return Utilities.newBlob(this._bytes, this._mime, this._n); },
    setTrashed(t) { this._papelera = t; return this; },
    setSharing(a, p) { this._sharing = [a, p]; return this; },
    makeCopy(n, carpeta) { return new Archivo(n, this._bytes, this._mime, carpeta || this._carpeta); },
    getParents() { return iter([this._carpeta]); }
  };
  const miUnidad = new Carpeta('Mi unidad', null);
  new Archivo('Liberaciones CQC', [], 'application/vnd.google-apps.spreadsheet', miUnidad, 'SS-ID-1');
  const DriveApp = {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { VIEW: 'VIEW' },
    getFolderById(id) { if (!carpetas[id]) throw new Error('No existe la carpeta'); return carpetas[id]; },
    getFileById(id) { if (!archivos[id]) throw new Error('No existe el archivo'); return archivos[id]; },
    createFolder(n) { return new Carpeta(n, null); }
  };

  const crypto = require('node:crypto');
  let uuidSeq = 0;
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest(alg, texto) {
      return Array.from(crypto.createHash('sha256').update(String(texto), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b));
    },
    getUuid() { uuidSeq++; return crypto.randomUUID(); },
    base64Decode(s) {
      if (/[^A-Za-z0-9+\/=]/.test(s)) throw new Error('base64 inválido');
      return Array.from(Buffer.from(s, 'base64')).map((b) => (b > 127 ? b - 256 : b)); // bytes con signo, como Apps Script
    },
    base64Encode(bytes) { return Buffer.from(bytes.map((b) => b & 255)).toString('base64'); },
    newBlob(bytes, mime, nombre) {
      return { getBytes() { return bytes; }, getContentType() { return mime; }, getName() { return nombre; } };
    },
    formatDate(d, tz, fmt) {
      const x = new Date(d.getTime() + (tz === 'America/Lima' ? -5 : 0) * 3600000);
      const p = (n) => String(n).padStart(2, '0');
      return fmt.replace('yyyy', x.getUTCFullYear()).replace('MM', p(x.getUTCMonth() + 1)).replace('dd', p(x.getUTCDate()))
        .replace('HH', p(x.getUTCHours())).replace('mm', p(x.getUTCMinutes()));
    }
  };

  const LockService = {
    getScriptLock() {
      return {
        waitLock() {
          if (estado.lockFalla) throw new Error('Tiempo de espera agotado');
          if (estado.lockHeld) throw new Error('INTERBLOQUEO: candado ya tomado (anidado)');
          estado.lockHeld = true; estado.lockWaits++;
        },
        tryLock() { if (estado.lockHeld) return false; estado.lockHeld = true; return true; },
        releaseLock() { estado.lockHeld = false; }
      };
    }
  };
  const cacheDatos = {};
  const CacheService = {
    getScriptCache() {
      return {
        get(k) { const e = cacheDatos[k]; if (!e) return null; if (e.exp <= estado.ahora) { delete cacheDatos[k]; return null; } return e.v; },
        put(k, v, s) { cacheDatos[k] = { v: String(v), exp: estado.ahora + (s || 600) * 1000 }; },
        remove(k) { delete cacheDatos[k]; }
      };
    }
  };
  const PropertiesService = {
    getScriptProperties() {
      return {
        getProperty(k) { return Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null; },
        setProperty(k, v) { props[k] = String(v); }
      };
    }
  };
  const ContentService = {
    MimeType: { JSON: 'JSON' },
    createTextOutput(s) { return { getContent() { return s; }, setMimeType() { return this; } }; }
  };
  const triggers = [];
  const ScriptApp = {
    WeekDay: { SUNDAY: 'SUNDAY' },
    getProjectTriggers() { return triggers.slice(); },
    deleteTrigger(t) { triggers.splice(triggers.indexOf(t), 1); },
    newTrigger(fn) {
      const t = { fn, getHandlerFunction() { return fn; } };
      const b = { timeBased() { return b; }, onWeekDay() { return b; }, atHour() { return b; }, create() { triggers.push(t); return t; } };
      return b;
    }
  };

  const sandbox = { SpreadsheetApp, DriveApp, Utilities, LockService, CacheService, PropertiesService, ContentService, ScriptApp, __estado: estado };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(CODIGO, ctx, { filename: 'Code.gs' });
  vm.runInContext('Date.now = function () { return __estado.ahora; };', ctx);

  const env = {
    ctx, estado, props, hojas, ss, carpetas, archivos, triggers, DriveApp, miUnidad,
    // cada llamada es una "ejecución" nueva: se reinician las variables globales de caché
    // quien: {usuario,codigo} (por defecto Ana, editora y ya aprobada); null = sin credenciales
    llamar(accion, datos, quien) {
      vm.runInContext('SS_CACHE = null; TZ_HOJA = TZ;', ctx);
      const cred = (quien === null) ? {} : (quien && typeof quien === 'object' ? quien : ANA);
      const cuerpo = JSON.stringify(Object.assign({ action: accion }, cred, datos || {}));
      return JSON.parse(ctx.doPost({ postData: { contents: cuerpo } }).getContent());
    },
    // agrega un usuario a la hoja "Usuarios" (como si ya estuviera registrado)
    usuario(nombre, codigo, estado, rol, usr, cambiar) {
      let sh = ss.getSheetByName('Usuarios');
      if (!sh) { sh = ss.insertSheet('Usuarios'); sh._poner(ENC_USU.slice()); }
      const sal = 'sal-' + nombre;
      sh._poner([nombre, estado || 'ACTIVO', rol || 'registro', '2026-11-01T08:00:00-05:00', sal, ctx.hashCodigo_(sal, codigo), usr == null ? '' : usr, cambiar ? 'SI' : '']);
    },
    correr(nombre) { vm.runInContext('SS_CACHE = null; TZ_HOJA = TZ;', ctx); return ctx[nombre](); },
    libs() { return hojas['Liberaciones']._tabla(); },
    ahora(s) { estado.ahora = lima(s); },
    // crea la hoja "Liberaciones" con el esquema antiguo (14 columnas) y filas heredadas
    hojaAntigua(filas) {
      const sh = ss.insertSheet('Liberaciones');
      sh._poner(ENC_VIEJOS.slice());
      (filas || []).forEach((f) => sh._poner(f));
      return sh;
    }
  };
  if (!opts.sinUsuarios) {
    env.usuario('Ana', ANA.codigo, 'ACTIVO', 'editor', ANA.usuario);
    env.usuario('Luis', LUIS.codigo, 'ACTIVO', 'admin', LUIS.usuario);
    env.usuario('Beto Registro', BETO.codigo, 'ACTIVO', 'registro', BETO.usuario);
  }
  return env;
}

const TEXTO = 'TIPO DE LIBERACIÓN: LIBERACIÓN DE RELLENO\nESTRUCTURA: PAD 2E SUR\nMATERIAL: SUELO DE BAJA PERMEABILIDAD\n' +
  'PROCEDENCIA: CANTERA 1\nCAPA: 3\nESPESOR: 0.30 m\nÁREA: 500 m²\nCOTA: 3500.25 msnm\nSUPERVISOR CQC: JUAN PEREZ';
function camposDe(t) { return t.split('\n').map((l) => { const i = l.indexOf(': '); return [l.slice(0, i), l.slice(i + 2)]; }); }
const JPG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]), Buffer.from('JFIF-pruebas-de-foto')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('png-pruebas')]);
let nUid = 0;
function nuevo(extra) {
  return Object.assign({ uid: 'u' + (++nUid), texto: TEXTO, campos: camposDe(TEXTO), foto: null, nombreFoto: 'RELLENO - SBP - PAD 2E', form: '{"v":1}' }, extra || {});
}
function foto(buf, mime) { return { data: buf.toString('base64'), mime: mime || 'image/jpeg' }; }

// ═══════════════════════════════════════════════════════════════
test('doGet, ping y acción desconocida', () => {
  const env = crearEntorno();
  assert.equal(JSON.parse(env.ctx.doGet().getContent()).ok, true);
  assert.equal(env.llamar('ping').ok, true);
  const r = env.llamar('loQueSea');
  assert.equal(r.ok, false);
  assert.match(r.error, /desconocida/i);
  assert.equal(env.llamar('constructor').ok, false);
});

test('sin usuario no se hace nada; ping es público; cuerpo roto se rechaza', () => {
  const env = crearEntorno();
  assert.equal(env.llamar('ping', {}, null).ok, true);
  for (const accion of ['getConfig', 'addLib', 'listLibs', 'listLibsDia', 'ultimasLibs', 'searchLibs', 'saveConfig', 'delLib', 'cambiarCodigo']) {
    const r = env.llamar(accion, nuevo(), null);
    assert.deepEqual([r.ok, r.acceso], [false, 'invalido'], accion);
  }
  // la clave de invitación NO sirve para entrar
  assert.equal(env.llamar('getConfig', { key: KEY }, null).ok, false);
  const cuerpoRoto = JSON.parse(env.ctx.doPost({ postData: { contents: '{no json' } }).getContent());
  assert.equal(cuerpoRoto.ok, false);
  assert.equal(env.hojas['Liberaciones'] ? env.libs().length : 0, 0);
});

// ── registro, ingreso y roles ────────────────────────────────────
const regis = (env, nombre, usuario, codigo, extra) =>
  env.llamar('registrar', Object.assign({ key: KEY, nombre, usuario, codigo }, extra || {}), null);

test('registrar con APROBAR_REGISTROS=SI: crea solicitud PENDIENTE con código cifrado y exige la clave de invitación', () => {
  const env = crearEntorno({ sinUsuarios: true, props: { APROBAR_REGISTROS: 'SI' } });
  let r = regis(env, 'Carla Pérez', 'cperez', 'mi-codigo-1', { key: 'otra' });
  assert.deepEqual(r, { ok: false, error: 'Clave de invitación incorrecta' });
  assert.equal(env.hojas['Usuarios'], undefined);
  r = regis(env, '  Carla   Pérez ', ' CPerez ', ' mi-codigo-1 ');
  assert.deepEqual(r, { ok: true, nombre: 'Carla Pérez', usuario: 'cperez', estado: 'PENDIENTE', rol: 'registro' });
  const t = env.hojas['Usuarios']._tabla();
  assert.equal(t.length, 1);
  assert.deepEqual([t[0].NOMBRE, t[0].USUARIO, t[0].ESTADO, t[0].ROL], ['Carla Pérez', 'cperez', 'PENDIENTE', 'registro']);
  assert.match(t[0].ALTA, /^2026-11-12T10:00:00-05:00$/);
  assert.match(t[0].HASH, /^[0-9a-f]{64}$/);
  assert.ok(JSON.stringify(env.hojas['Usuarios']._filas).indexOf('mi-codigo-1') < 0, 'el código no se guarda en claro');
  // pendiente: puede ingresar para saber su estado, pero no hacer nada
  const cred = { usuario: 'CPEREZ', codigo: 'mi-codigo-1' };
  assert.deepEqual(env.llamar('login', {}, cred), { ok: true, nombre: 'Carla Pérez', usuario: 'cperez', estado: 'PENDIENTE', rol: 'registro', cambiar: false });
  r = env.llamar('addLib', nuevo(), cred);
  assert.deepEqual([r.ok, r.acceso], [false, 'pendiente']);
  assert.equal(env.hojas['Liberaciones'] ? env.libs().length : 0, 0);
  // un admin la activa desde la app (o se escribe ACTIVO en la hoja)
  env.usuario('Luis', LUIS.codigo, 'ACTIVO', 'admin', LUIS.usuario);
  assert.equal(env.llamar('setUsuario', { objetivo: 'cperez', estado: 'ACTIVO' }, LUIS).ok, true);
  assert.equal(env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12' }), cred).ok, true);
  assert.equal(env.libs()[0]['REGISTRADO POR'], 'Carla Pérez');
});

test('registrar: valida nombre, usuario y código; rechaza duplicados y (con aprobación) limita las pendientes', () => {
  const env = crearEntorno({ sinUsuarios: true, props: { APROBAR_REGISTROS: 'SI' } });
  const reg = (nombre, usuario, codigo) => regis(env, nombre, usuario, codigo);
  assert.match(reg('Al', 'pedrog', 'abcdefgh1').error, /nombre completo/);
  assert.match(reg('x'.repeat(41), 'pedrog', 'abcdefgh1').error, /nombre completo/);
  assert.match(reg('=HYPERLINK("x")', 'pedrog', 'abcdefgh1').error, /letras/);
  assert.match(reg('Pedro 2', 'pedrog', 'abcdefgh1').error, /letras/);
  assert.match(reg('Pedro Gómez', 'ped', 'abcdefgh1').error, /usuario debe tener/);              // muy corto
  assert.match(reg('Pedro Gómez', 'p'.repeat(21), 'abcdefgh1').error, /usuario debe tener/);
  assert.match(reg('Pedro Gómez', 'pedro gómez', 'abcdefgh1').error, /usuario debe tener/);     // espacios y tildes
  assert.match(reg('Pedro Gómez', '=1+1', 'abcdefgh1').error, /usuario debe tener/);
  assert.match(reg('Pedro Gómez', '', 'abcdefgh1').error, /usuario debe tener/);
  assert.match(reg('Pedro Gómez', 'pedrog', '12345').error, /entre 6 y 40/);
  assert.match(reg('Pedro Gómez', 'pedrog', 'x'.repeat(41)).error, /entre 6 y 40/);
  assert.match(reg('Pedro Gómez', 'pedrog', '123456').error, /fácil de adivinar/);
  assert.match(reg('Pedro Gómez', 'pedrog', 'aaaaaaa').error, /fácil de adivinar/);
  assert.match(reg('Pedro Gómez', 'pedrog', 'Password').error, /fácil de adivinar/);
  assert.equal(env.hojas['Usuarios'] ? env.hojas['Usuarios']._tabla().length : 0, 0);
  assert.equal(reg('Pedro Gómez', 'pedrog', 'codigo-pedro').ok, true);
  assert.match(reg('pedro gomez', 'otro.pedro', 'otro-codigo-1').error, /Ya existe una persona/);   // mismo nombre sin tildes ni mayúsculas
  assert.match(reg('Pedro Gómez López', 'PedroG', 'otro-codigo-1').error, /usuario ya existe/);      // mismo usuario
  env.usuario('Ana', 'codigo-ana', 'ACTIVO', 'editor', 'anita');
  assert.match(reg('Ana María', 'ANITA', 'otro-codigo-1').error, /usuario ya existe/);
  // tope de solicitudes sin aprobar (ya hay 1 pendiente: Pedro; se completan 30)
  for (let i = 0; i < 29; i++) env.usuario('Pendiente ' + String.fromCharCode(97 + i), 'codigo-' + i, 'PENDIENTE', 'registro', 'pend' + i);
  const r = reg('Persona Nueva', 'pnueva', 'codigo-nueva-1');
  assert.equal(r.ok, false); assert.match(r.error, /demasiadas solicitudes/);
  env.hojas['Usuarios']._filas[1][1] = 'ACTIVO';                                  // se aprueba a Pedro → hay lugar
  assert.equal(reg('Persona Nueva', 'pnueva', 'codigo-nueva-1').ok, true);
});

test('registrar con la clave de invitación: la persona queda ACTIVA con rol registro; registra y edita lo suyo, no borra ni cambia ajustes', () => {
  const env = crearEntorno({ sinUsuarios: true });
  const r = regis(env, 'Carla Pérez', 'cperez', 'mi-codigo-1');
  assert.deepEqual(r, { ok: true, nombre: 'Carla Pérez', usuario: 'cperez', estado: 'ACTIVO', rol: 'registro' });
  const t = env.hojas['Usuarios']._tabla();
  assert.deepEqual([t[0].NOMBRE, t[0].USUARIO, t[0].ESTADO, t[0].ROL], ['Carla Pérez', 'cperez', 'ACTIVO', 'registro']);
  const cred = { usuario: 'cperez', codigo: 'mi-codigo-1' };
  assert.deepEqual(env.llamar('login', {}, cred), { ok: true, nombre: 'Carla Pérez', usuario: 'cperez', estado: 'ACTIVO', rol: 'registro', cambiar: false });
  assert.equal(env.llamar('login', {}, { usuario: 'Carla Pérez', codigo: 'mi-codigo-1' }).ok, false, 'se ingresa con el usuario, no con el nombre');
  const a = env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12' }), cred);
  assert.equal(a.ok, true, a.error);
  assert.equal(env.libs()[0]['REGISTRADO POR'], 'Carla Pérez');
  assert.equal(env.libs()[0]['USUARIO REGISTRO'], 'cperez');
  assert.equal(env.llamar('listLibs', { fecha: '2026-11-12' }, cred).ok, true);
  assert.equal(env.llamar('delLib', { id: a.id }, cred).acceso, 'permiso');
  assert.equal(env.llamar('saveConfig', { config: { frentes: [] }, baseVersion: 0 }, cred).acceso, 'permiso');
  assert.equal(env.llamar('listUsuarios', {}, cred).acceso, 'permiso');
  assert.equal(env.llamar('editLib', { id: a.id, texto: TEXTO.replace('CAPA: 3', 'CAPA: 4') }, cred).ok, true);   // lo suyo sí
});

test('registrar: tope de altas por hora (si la clave de invitación se filtra) y se libera pasada la hora', () => {
  const env = crearEntorno({ sinUsuarios: true });
  const reg = (i) => regis(env, 'Persona ' + String.fromCharCode(65 + i), 'persona' + i, 'codigo-largo-' + i);
  for (let i = 0; i < 20; i++) assert.equal(reg(i).ok, true, 'alta ' + i);
  const r = reg(20);
  assert.equal(r.ok, false); assert.match(r.error, /demasiados registros/);
  assert.equal(env.hojas['Usuarios']._tabla().length, 20);
  env.estado.ahora += 3600 * 1000 + 1000;
  assert.equal(reg(20).ok, true);
});

test('registrar: sin clave de invitación configurada no atiende; 20 claves malas bloquean los registros', () => {
  const sin = crearEntorno({ sinUsuarios: true, props: { EQUIPO_KEY: 'CAMBIAR-clave-de-invitacion' } });
  const r = regis(sin, 'Pedro Gómez', 'pedrog', 'codigo-pedro', { key: 'CAMBIAR-clave-de-invitacion' });
  assert.equal(r.ok, false); assert.match(r.error, /no está configurado/);
  const env = crearEntorno({ sinUsuarios: true });
  for (let i = 0; i < 20; i++) regis(env, 'Pedro Gómez', 'pedrog', 'codigo-pedro', { key: 'mala' + i });
  const b = regis(env, 'Pedro Gómez', 'pedrog', 'codigo-pedro');
  assert.equal(b.ok, false); assert.equal(b.acceso, 'bloqueado');
  env.estado.ahora += 10 * 60000 + 1000;
  assert.equal(regis(env, 'Pedro Gómez', 'pedrog', 'codigo-pedro').ok, true);
});

test('roles: registro registra y edita lo suyo; editor edita todo, borra y guarda ajustes; admin además gestiona usuarios', () => {
  const env = crearEntorno();
  const a = env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12' }), BETO);
  assert.equal(a.ok, true);
  assert.equal(env.libs()[0]['REGISTRADO POR'], 'Beto Registro');
  const it = env.llamar('listLibs', { fecha: '2026-11-12' }, BETO).items[0];
  assert.equal(it.por, 'Beto Registro'); assert.equal(it.propia, true);
  assert.equal(env.llamar('listLibs', { fecha: '2026-11-12' }, ANA).items[0].propia, false);
  assert.equal(env.llamar('getConfig', {}, BETO).ok, true);
  // registro: no borra, no cambia ajustes, no administra usuarios
  let r = env.llamar('delLib', { id: a.id }, BETO);
  assert.deepEqual([r.ok, r.acceso], [false, 'permiso']);
  r = env.llamar('saveConfig', { config: { frentes: [] }, baseVersion: 0 }, BETO);
  assert.deepEqual([r.ok, r.acceso], [false, 'permiso']);
  ['listUsuarios', 'setUsuario', 'delUsuario', 'resetCodigo'].forEach((x) => {
    assert.equal(env.llamar(x, { objetivo: 'ana', rol: 'admin' }, BETO).acceso, 'permiso', x + ' (registro)');
    assert.equal(env.llamar(x, { objetivo: 'beto', rol: 'admin' }, ANA).acceso, 'permiso', x + ' (editor)');
  });
  assert.equal(env.libs().length, 1);
  assert.equal(env.llamar('delLib', { id: a.id }, ANA).ok, true);                 // editor
  assert.equal(env.llamar('saveConfig', { config: { frentes: [] }, baseVersion: 0 }, LUIS).ok, true);   // admin
  assert.equal(env.llamar('listUsuarios', {}, LUIS).ok, true);
});

test('baja: quien está de baja pierde el acceso al instante, sin afectar a los demás', () => {
  const env = crearEntorno();
  assert.equal(env.llamar('ultimasLibs', {}, BETO).ok, true);
  env.hojas['Usuarios']._filas[3][1] = 'BAJA';                                    // Beto
  const r = env.llamar('ultimasLibs', {}, BETO);
  assert.deepEqual([r.ok, r.acceso], [false, 'baja']);
  assert.deepEqual(env.llamar('login', {}, BETO), { ok: true, nombre: 'Beto Registro', usuario: 'beto', estado: 'BAJA', rol: 'registro', cambiar: false });
  assert.equal(env.llamar('ultimasLibs', {}, ANA).ok, true);
});

test('login: mensajes genéricos; 5 fallos bloquean 10 min a ese usuario (aun con el código correcto)', () => {
  const env = crearEntorno();
  const mala = { usuario: 'ana', codigo: 'mal' };
  for (let i = 1; i <= 4; i++) {
    const r = env.llamar('login', {}, mala);
    assert.deepEqual(r, { ok: false, error: 'Usuario o código incorrecto', acceso: 'invalido' });
  }
  // un usuario que no existe responde igual que uno que existe con código malo
  assert.deepEqual(env.llamar('login', {}, { usuario: 'fantasma', codigo: 'xxxxxxx' }),
    { ok: false, error: 'Usuario o código incorrecto', acceso: 'invalido' });
  let r = env.llamar('login', {}, mala);
  assert.equal(r.acceso, 'bloqueado'); assert.match(r.error, /bloqueado/);
  env.estado.ahora += 5 * 60000;
  r = env.llamar('login', {}, ANA);                                               // correcto pero bloqueado
  assert.equal(r.ok, false); assert.equal(r.acceso, 'bloqueado');
  assert.equal(env.llamar('delLib', { id: 'X' }, ANA).ok, false);
  assert.equal(env.llamar('login', {}, LUIS).ok, true);                           // los demás no se ven afectados
  env.estado.ahora += 5 * 60000 + 1000;                                           // pasaron 10 min desde el 5º fallo
  assert.equal(env.llamar('login', {}, ANA).ok, true);
  for (let i = 0; i < 4; i++) env.llamar('login', {}, mala);                      // un acierto reinicia el contador
  assert.equal(env.llamar('login', {}, ANA).ok, true);
  for (let i = 0; i < 4; i++) env.llamar('login', {}, mala);
  assert.equal(env.llamar('login', {}, ANA).ok, true);
  assert.equal(env.estado.lockHeld, false);
});

test('cambiarCodigo: pide el código actual, valida el nuevo y deja de valer el anterior', () => {
  const env = crearEntorno();
  let r = env.llamar('cambiarCodigo', { nuevoCodigo: '12345' }, BETO);
  assert.equal(r.ok, false); assert.match(r.error, /entre 6 y 40/);
  r = env.llamar('cambiarCodigo', { nuevoCodigo: BETO.codigo }, BETO);
  assert.equal(r.ok, false); assert.match(r.error, /distinto al actual/);
  assert.equal(env.llamar('cambiarCodigo', { nuevoCodigo: 'nuevo-codigo-9' }, { usuario: 'beto', codigo: 'equivocado' }).ok, false);
  const hashAntes = env.hojas['Usuarios']._tabla()[2].HASH;
  assert.equal(env.llamar('cambiarCodigo', { nuevoCodigo: 'nuevo-codigo-9' }, BETO).ok, true);
  assert.notEqual(env.hojas['Usuarios']._tabla()[2].HASH, hashAntes);
  assert.equal(env.llamar('login', {}, BETO).ok, false);
  assert.equal(env.llamar('login', {}, { usuario: 'beto', codigo: 'nuevo-codigo-9' }).ok, true);
  assert.match(JSON.stringify(env.hojas['Log']._filas), /Beto Registro cambió su código/);
});

test('personas anteriores (sin usuario) ingresan con su nombre y completan su usuario en Mi perfil sin perder sus liberaciones', () => {
  const env = crearEntorno({ sinUsuarios: true });
  env.usuario('Rosa Díaz', 'codigo-rosa', 'ACTIVO', 'registro');                  // sin USUARIO
  const vieja = { usuario: 'rosa díaz', codigo: 'codigo-rosa' };
  assert.deepEqual(env.llamar('login', {}, vieja), { ok: true, nombre: 'Rosa Díaz', usuario: '', estado: 'ACTIVO', rol: 'registro', cambiar: false });
  const a = env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12' }), vieja);
  assert.equal(a.ok, true);
  assert.equal(env.libs()[0]['USUARIO REGISTRO'], 'Rosa Díaz');
  const p = env.llamar('actualizarPerfil', { nuevoUsuario: 'rdiaz' }, vieja);
  assert.deepEqual(p, { ok: true, nombre: 'Rosa Díaz', usuario: 'rdiaz' });
  assert.equal(env.libs()[0]['USUARIO REGISTRO'], 'rdiaz');
  const nueva = { usuario: 'rdiaz', codigo: 'codigo-rosa' };
  assert.equal(env.llamar('login', {}, vieja).ok, false);
  assert.equal(env.llamar('editLib', { id: a.id, texto: TEXTO.replace('CAPA: 3', 'CAPA: 4') }, nueva).ok, true);   // sigue siendo suya
});

test('actualizarPerfil: cambia nombre y usuario, evita repetidos y conserva la autoría de sus liberaciones', () => {
  const env = crearEntorno();
  const a = env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12' }), BETO);
  assert.match(env.llamar('actualizarPerfil', {}, BETO).error, /nada que cambiar/);
  assert.match(env.llamar('actualizarPerfil', { nuevoUsuario: 'LUIS' }, BETO).error, /usuario ya existe/);
  assert.match(env.llamar('actualizarPerfil', { nombre: 'ana' }, BETO).error, /Ya existe una persona/);
  assert.match(env.llamar('actualizarPerfil', { nuevoUsuario: 'b b' }, BETO).error, /usuario debe tener/);
  assert.match(env.llamar('actualizarPerfil', { nombre: 'B3to' }, BETO).error, /letras/);
  const r = env.llamar('actualizarPerfil', { nombre: 'Alberto Ríos', nuevoUsuario: 'arios' }, BETO);
  assert.deepEqual(r, { ok: true, nombre: 'Alberto Ríos', usuario: 'arios' });
  assert.equal(env.llamar('login', {}, BETO).ok, false);                          // el usuario viejo ya no vale
  const nueva = { usuario: 'arios', codigo: BETO.codigo };
  assert.deepEqual(env.llamar('login', {}, nueva).nombre, 'Alberto Ríos');
  assert.equal(env.libs()[0]['REGISTRADO POR'], 'Alberto Ríos');
  assert.equal(env.libs()[0]['USUARIO REGISTRO'], 'arios');
  assert.equal(env.llamar('listLibs', { fecha: '2026-11-12' }, nueva).items[0].propia, true);
  assert.equal(env.llamar('editLib', { id: a.id, texto: TEXTO }, nueva).ok, true);
  // puede dejar su propio usuario tal cual y cambiar solo el nombre
  assert.equal(env.llamar('actualizarPerfil', { nombre: 'Alberto Ríos Peña', nuevoUsuario: 'arios' }, nueva).ok, true);
});

// ── editar liberaciones ──────────────────────────────────────────
test('editLib: registro edita solo las suyas; editor y admin cualquiera; conserva ID y anota quién y cuándo', () => {
  const env = crearEntorno();
  const a = env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12' }), BETO);
  const otra = env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12' }), ANA);
  const txt = TEXTO.replace('CAPA: 3', 'CAPA: 5').replace('ESPESOR: 0.30 m', 'ESPESOR: 0.25 m');
  env.ahora('2026-11-12 11:30');
  let r = env.llamar('editLib', { id: a.id, texto: txt, campos: camposDe(txt), form: '{"v":2}' }, BETO);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.id, a.id); assert.equal(r.item.texto, txt); assert.equal(r.item.editadoPor, 'Beto Registro');
  let fila = env.libs().filter((x) => x.ID === a.id)[0];
  assert.deepEqual([fila.CAPA, fila.ESPESOR, fila.FORM, fila['EDITADO POR'], fila['EDITADO EN']],
    ['5', '0.25 m', '{"v":2}', 'Beto Registro', '2026-11-12T11:30:00-05:00']);
  assert.equal(fila['REGISTRADO POR'], 'Beto Registro');
  assert.equal(fila.UID, env.libs()[0].UID);
  // no puede tocar las de otra persona
  r = env.llamar('editLib', { id: otra.id, texto: txt }, BETO);
  assert.deepEqual([r.ok, r.acceso], [false, 'permiso']);
  assert.equal(env.libs().filter((x) => x.ID === otra.id)[0].CAPA, '3');
  // el editor y el admin sí
  assert.equal(env.llamar('editLib', { id: a.id, texto: TEXTO }, ANA).ok, true);
  assert.equal(env.libs().filter((x) => x.ID === a.id)[0]['EDITADO POR'], 'Ana');
  assert.equal(env.llamar('editLib', { id: otra.id, texto: txt }, LUIS).ok, true);
  // validaciones
  assert.match(env.llamar('editLib', { id: '', texto: txt }, ANA).error, /Falta el ID/);
  assert.match(env.llamar('editLib', { id: a.id, texto: '  ' }, ANA).error, /Falta el texto/);
  assert.match(env.llamar('editLib', { id: 'L261112-099', texto: txt }, ANA).error, /ya no existe/);
  assert.equal(env.llamar('editLib', { id: a.id, texto: 'x'.repeat(20001) }, ANA).ok, false);
  assert.equal(env.estado.lockHeld, false);
});

test('editLib: cambiar turno o día lo marca como ajuste manual; sin cambios no toca turno ni día', () => {
  const env = crearEntorno();
  const a = env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12' }), BETO);
  assert.equal(env.llamar('editLib', { id: a.id, texto: TEXTO, turno: 'DÍA', fecha: '2026-11-12' }, BETO).ok, true);
  let f = env.libs()[0];
  assert.deepEqual([f.TURNO, f['FECHA TURNO'], f['AJUSTE MANUAL']], ['DÍA', '2026-11-12', 'NO']);
  env.estado.ahora = lima('2026-11-12 11:00');
  assert.equal(env.llamar('editLib', { id: a.id, texto: TEXTO, turno: 'noche', fecha: '2026-11-11' }, BETO).ok, true);
  f = env.libs()[0];
  assert.deepEqual([f.TURNO, f['FECHA TURNO'], f['AJUSTE MANUAL']], ['NOCHE', '2026-11-11', 'SÍ']);
  assert.equal(f.ID, a.id);
  assert.equal(env.llamar('listLibs', { fecha: '2026-11-11' }, BETO).items.length, 1);
  assert.equal(env.llamar('listLibs', { fecha: '2026-11-12' }, BETO).items.length, 0);
  // valores inválidos se ignoran (se conserva lo que había)
  assert.equal(env.llamar('editLib', { id: a.id, texto: TEXTO, turno: 'TARDE', fecha: '2026-02-31' }, BETO).ok, true);
  f = env.libs()[0];
  assert.deepEqual([f.TURNO, f['FECHA TURNO']], ['NOCHE', '2026-11-11']);
});

test('editLib: la foto se conserva, se reemplaza (la anterior va a la papelera) o se quita', () => {
  const env = crearEntorno();
  env.props.CARPETA_RAIZ_ID = env.DriveApp.createFolder('Raíz').getId();
  const a = env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12', foto: foto(JPG) }), BETO);
  const idFoto = (u) => /\/d\/([\w-]+)/.exec(u)[1];
  const url1 = env.libs()[0].FOTO, f1 = idFoto(url1);
  assert.equal(env.llamar('editLib', { id: a.id, texto: TEXTO }, BETO).ok, true);                   // sin foto nueva: se conserva
  assert.equal(env.libs()[0].FOTO, url1); assert.ok(!env.archivos[f1]._papelera);
  assert.equal(env.llamar('editLib', { id: a.id, texto: TEXTO, foto: foto(PNG, 'image/png'), nombreFoto: 'otra' }, BETO).ok, true);
  const url2 = env.libs()[0].FOTO;
  assert.notEqual(url2, url1); assert.ok(env.archivos[f1]._papelera, 'la foto anterior va a la papelera');
  assert.ok(!env.archivos[idFoto(url2)]._papelera);
  assert.match(env.llamar('editLib', { id: a.id, texto: TEXTO, foto: foto(Buffer.from('no es imagen'), 'image/jpeg') }, BETO).error, /no es una imagen/);
  assert.equal(env.libs()[0].FOTO, url2);
  assert.equal(env.llamar('editLib', { id: a.id, texto: TEXTO, quitarFoto: true }, BETO).ok, true);
  assert.equal(env.libs()[0].FOTO, ''); assert.ok(env.archivos[idFoto(url2)]._papelera);
});

// ── administración de usuarios (solo admin) ──────────────────────
test('listUsuarios: el admin ve a todos sin códigos ni hashes', () => {
  const env = crearEntorno();
  const r = env.llamar('listUsuarios', {}, LUIS);
  assert.equal(r.ok, true); assert.equal(r.items.length, 3);
  assert.deepEqual(r.items[2], { nombre: 'Beto Registro', usuario: 'beto', id: 'beto', estado: 'ACTIVO', rol: 'registro',
    alta: '2026-11-01T08:00:00-05:00', cambiar: false });
  const txt = JSON.stringify(r);
  assert.ok(!/HASH|SAL|sal-|[0-9a-f]{64}/i.test(txt.replace(/"alta"/g, '')), 'no sale ningún hash ni sal');
});

test('setUsuario: el admin cambia roles y da de baja o reactiva; no se toca a sí mismo ni deja la app sin admin', () => {
  const env = crearEntorno();
  assert.equal(env.llamar('setUsuario', { objetivo: 'beto', rol: 'editor' }, LUIS).ok, true);
  assert.equal(env.hojas['Usuarios']._tabla()[2].ROL, 'editor');
  assert.equal(env.llamar('delLib', { id: 'X' }, BETO).acceso === 'permiso', false);                // ya es editor
  assert.equal(env.llamar('setUsuario', { objetivo: 'beto', estado: 'BAJA' }, LUIS).ok, true);
  assert.equal(env.llamar('ultimasLibs', {}, BETO).acceso, 'baja');
  assert.equal(env.llamar('setUsuario', { objetivo: 'BETO', estado: 'ACTIVO', rol: 'registro' }, LUIS).ok, true);
  assert.equal(env.llamar('ultimasLibs', {}, BETO).ok, true);
  // validaciones
  assert.match(env.llamar('setUsuario', { objetivo: 'beto', rol: 'jefe' }, LUIS).error, /Rol inválido/);
  assert.match(env.llamar('setUsuario', { objetivo: 'beto', estado: 'PENDIENTE' }, LUIS).error, /Estado inválido/);
  assert.match(env.llamar('setUsuario', { objetivo: 'beto' }, LUIS).error, /nada que cambiar/);
  assert.match(env.llamar('setUsuario', { objetivo: 'nadie', rol: 'editor' }, LUIS).error, /No se encontró/);
  // sobre sí mismo
  let r = env.llamar('setUsuario', { objetivo: 'luis', rol: 'registro' }, LUIS);
  assert.deepEqual([r.ok, r.acceso], [false, 'permiso']);
  r = env.llamar('setUsuario', { objetivo: 'luis', estado: 'BAJA' }, LUIS);
  assert.deepEqual([r.ok, r.acceso], [false, 'permiso']);
  assert.equal(env.hojas['Usuarios']._tabla()[1].ESTADO, 'ACTIVO');
  // un segundo admin puede cambiar al primero, pero nunca quedar sin admin activo
  assert.equal(env.llamar('setUsuario', { objetivo: 'ana', rol: 'admin' }, LUIS).ok, true);
  assert.equal(env.llamar('setUsuario', { objetivo: 'luis', rol: 'editor' }, ANA).ok, true);
  const lista = env.ctx.leerUsuarios_({ sh: env.hojas['Usuarios'], cols: { idx: { NOMBRE: 0, ESTADO: 1, ROL: 2, ALTA: 3, SAL: 4, HASH: 5, USUARIO: 6, CAMBIAR: 7 }, total: 8 } });
  const ana = lista.filter((x) => x.usuario === 'ana')[0];
  assert.equal(env.ctx.quedaAdmin_(lista, ana, 'BAJA', 'admin'), false);
  assert.equal(env.ctx.quedaAdmin_(lista, ana, 'ACTIVO', 'editor'), false);
  assert.equal(env.ctx.quedaAdmin_(lista, ana, 'ACTIVO', 'admin'), true);
  assert.equal(env.ctx.quedaAdmin_(lista, null, '', ''), true);
});

test('delUsuario: el admin borra una cuenta (sus liberaciones se conservan) pero no la suya', () => {
  const env = crearEntorno();
  const a = env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12' }), BETO);
  const r = env.llamar('delUsuario', { objetivo: 'beto' }, LUIS);
  assert.equal(r.ok, true);
  assert.equal(env.hojas['Usuarios']._tabla().length, 2);
  assert.equal(env.llamar('login', {}, BETO).ok, false);
  assert.equal(env.libs()[0]['REGISTRADO POR'], 'Beto Registro');                              // conserva el nombre
  assert.equal(env.libs()[0]['USUARIO REGISTRO'], '(eliminado)');
  // si alguien se registra luego con el mismo usuario, no hereda esas liberaciones
  assert.equal(regis(env, 'Beto Otro', 'beto', 'codigo-nuevo-1').ok, true);
  const nuevoBeto = { usuario: 'beto', codigo: 'codigo-nuevo-1' };
  assert.deepEqual(env.llamar('editLib', { id: a.id, texto: TEXTO }, nuevoBeto).acceso, 'permiso');
  assert.equal(env.llamar('delUsuario', { objetivo: 'inexistente' }, LUIS).yaNoExistia, true);
  const yo = env.llamar('delUsuario', { objetivo: 'luis' }, LUIS);
  assert.deepEqual([yo.ok, yo.acceso], [false, 'permiso']);
});

test('resetCodigo: el admin da un código temporal; la persona debe elegir uno nuevo antes de hacer nada', () => {
  const env = crearEntorno();
  let r = env.llamar('resetCodigo', { objetivo: 'luis' }, LUIS);
  assert.deepEqual([r.ok, r.acceso], [false, 'permiso']);
  r = env.llamar('resetCodigo', { objetivo: 'nadie' }, LUIS);
  assert.match(r.error, /No se encontró/);
  // estaba bloqueada por intentos fallidos: el reinicio la libera
  for (let i = 0; i < 5; i++) env.llamar('login', {}, { usuario: 'beto', codigo: 'mal-' + i });
  assert.equal(env.llamar('login', {}, BETO).acceso, 'bloqueado');
  r = env.llamar('resetCodigo', { objetivo: 'beto' }, LUIS);
  assert.equal(r.ok, true);
  assert.match(r.temporal, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(r.usuario, 'beto');
  assert.ok(!JSON.stringify(env.hojas['Log']._filas).includes(r.temporal), 'el código temporal no se anota en el Log');
  assert.equal(env.llamar('login', {}, BETO).ok, false);                                        // el viejo ya no vale
  const temp = { usuario: 'beto', codigo: r.temporal };
  const lg = env.llamar('login', {}, temp);
  assert.deepEqual([lg.ok, lg.cambiar], [true, true]);
  let x = env.llamar('addLib', nuevo(), temp);
  assert.deepEqual([x.ok, x.acceso], [false, 'cambiar']);
  x = env.llamar('listLibs', { fecha: '2026-11-12' }, temp);
  assert.equal(x.acceso, 'cambiar');
  x = env.llamar('cambiarCodigo', { nuevoCodigo: r.temporal }, temp);
  assert.match(x.error, /distinto al actual/);
  assert.equal(env.llamar('cambiarCodigo', { nuevoCodigo: 'mi-nuevo-codigo-5' }, temp).ok, true);
  const propio = { usuario: 'beto', codigo: 'mi-nuevo-codigo-5' };
  assert.deepEqual(env.llamar('login', {}, propio).cambiar, false);
  assert.equal(env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12' }), propio).ok, true);
  assert.equal(env.hojas['Usuarios']._tabla()[2].CAMBIAR, '');
});

// ── addLib ───────────────────────────────────────────────────────
test('addLib crea la fila con todas las columnas y la foto en Drive', () => {
  const env = crearEntorno();
  env.hojaAntigua();
  env.props.CARPETA_RAIZ_ID = env.DriveApp.createFolder('Raíz').getId();
  const it = nuevo({ turno: 'DÍA', fecha: '2026-11-12', creado: lima('2026-11-12 09:41:07'), foto: foto(JPG) });
  const r = env.llamar('addLib', it);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.id, 'L261112-001');
  const f = env.libs()[0];
  assert.equal(f.ID, 'L261112-001');
  assert.equal(f.FECHA, '2026-11-12'); assert.equal(f.HORA, '09:41');
  assert.equal(f['TEXTO COMPLETO'], TEXTO);
  assert.equal(f.UID, it.uid);
  assert.equal(f['TIPO DE LIBERACIÓN'], 'LIBERACIÓN DE RELLENO');
  assert.equal(f.ESTRUCTURA, 'PAD 2E SUR'); assert.equal(f.MATERIAL, 'SUELO DE BAJA PERMEABILIDAD');
  assert.equal(f.PROCEDENCIA, 'CANTERA 1'); assert.equal(f.CAPA, '3');
  assert.equal(f.ESPESOR, '0.30 m'); assert.equal(f['ÁREA'], '500 m²'); assert.equal(f.COTA, '3500.25 msnm');
  assert.equal(f.TURNO, 'DÍA'); assert.equal(f['FECHA TURNO'], '2026-11-12');
  assert.equal(f.CREADO, '2026-11-12T09:41:07-05:00'); assert.equal(f['AJUSTE MANUAL'], 'NO');
  assert.equal(f.FORM, '{"v":1}');
  // foto: <raíz>/12-11-26/001_<nombre>.jpg
  const raiz = env.carpetas[env.props.CARPETA_RAIZ_ID];
  assert.equal(raiz._sub.length, 1);
  assert.equal(raiz._sub[0]._n, '12-11-26');
  assert.equal(raiz._sub[0]._arch[0]._n, '001_RELLENO - SBP - PAD 2E.jpg');
  assert.match(f.FOTO, /^https:\/\/drive\.google\.com\/file\/d\/fil\d+\//);
  assert.deepEqual(Array.from(raiz._sub[0]._arch[0]._bytes.map((b) => b & 255)), Array.from(JPG));
  assert.equal(r.foto, f.FOTO);
});

test('addLib agrega las columnas nuevas sin mover las existentes ni tocar filas antiguas', () => {
  const env = crearEntorno();
  const sh = env.hojaAntigua([['L261020-001', '2026-10-20', '08:00', 'texto viejo', '', 'uv1', 'T', 'E', 'M', 'P', '1', '0.3', '10', '1']]);
  const antes = sh._filas[1].slice();
  assert.equal(env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12' })).ok, true);
  assert.deepEqual(sh._filas[0], ENC_VIEJOS.concat(ENC_NUEVOS));
  assert.deepEqual(sh._filas[1].slice(0, 14), antes);
  assert.equal(env.libs().length, 2);
});

test('addLib es idempotente por UID: no duplica fila ni foto', () => {
  const env = crearEntorno();
  env.props.CARPETA_RAIZ_ID = env.DriveApp.createFolder('Raíz').getId();
  const it = nuevo({ turno: 'DÍA', fecha: '2026-11-12', foto: foto(JPG) });
  const a = env.llamar('addLib', it);
  const archivosAntes = Object.keys(env.archivos).length;
  const b = env.llamar('addLib', Object.assign({}, it, { foto: foto(PNG, 'image/png') }));
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.equal(b.duplicado, true); assert.equal(b.id, a.id);
  assert.equal(env.libs().length, 1);
  assert.equal(Object.keys(env.archivos).length, archivosAntes);
  assert.equal(a.duplicado, undefined);
});

test('addLib exige uid y texto', () => {
  const env = crearEntorno();
  assert.equal(env.llamar('addLib', nuevo({ uid: '' })).ok, false);
  assert.equal(env.llamar('addLib', nuevo({ texto: '  ' })).ok, false);
  assert.equal(env.hojas['Liberaciones'] ? env.libs().length : 0, 0);
});

test('el ID usa la FECHA TURNO y el correlativo del día de trabajo', () => {
  const env = crearEntorno();
  env.ahora('2026-11-12 14:00');
  const d1 = env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12', creado: lima('2026-11-12 13:00') }));
  const d2 = env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12', creado: lima('2026-11-12 13:30') }));
  env.ahora('2026-11-13 02:00');
  // madrugada del 13: sigue siendo el día de trabajo del 12 (NOCHE)
  const n1 = env.llamar('addLib', nuevo({ creado: lima('2026-11-13 02:00') }));
  // y un día distinto empieza su propio correlativo
  env.ahora('2026-11-13 09:00');
  const o1 = env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-13', creado: lima('2026-11-13 09:00') }));
  assert.deepEqual([d1.id, d2.id, n1.id, o1.id], ['L261112-001', 'L261112-002', 'L261112-003', 'L261113-001']);
  const filaN = env.libs()[2];
  assert.equal(filaN.FECHA, '2026-11-13'); assert.equal(filaN.HORA, '02:00');           // momento real
  assert.equal(filaN['FECHA TURNO'], '2026-11-12'); assert.equal(filaN.TURNO, 'NOCHE'); // día de trabajo
});

test('el correlativo no repite IDs tras borrar ni choca con IDs antiguos por fecha calendario', () => {
  const env = crearEntorno();
  // fila antigua: 06/11 04:33 (turno NOCHE del 05) con ID por fecha calendario L261106-001
  env.hojaAntigua([
    ['L261106-001', '2026-11-06', '04:33', 'a', '', 'v1', '', '', '', '', '', '', '', ''],
    ['L261106-002', '2026-11-06', '09:10', 'b', '', 'v2', '', '', '', '', '', '', '', '']
  ]);
  env.ahora('2026-11-06 12:00');
  const r = env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-06' }));
  assert.equal(r.id, 'L261106-003'); // 1 fila del día de trabajo, pero 001 y 002 ya existen

  const env2 = crearEntorno();
  const ids = [1, 2, 3].map(() => env2.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12' })).id);
  assert.deepEqual(ids, ['L261112-001', 'L261112-002', 'L261112-003']);
  assert.equal(env2.llamar('delLib', { id: 'L261112-002' }).ok, true);
  const nuevoId = env2.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12' })).id;
  assert.equal(nuevoId, 'L261112-004');
});

// ── turno ────────────────────────────────────────────────────────
test('turno calculado sin turno/fecha: bordes 00:00, 06:59, 07:00, 18:59, 19:00, 23:59', () => {
  const casos = [
    ['00:00', 'NOCHE', '2026-11-11'], ['06:59', 'NOCHE', '2026-11-11'],
    ['07:00', 'DÍA', '2026-11-12'], ['18:59', 'DÍA', '2026-11-12'],
    ['19:00', 'NOCHE', '2026-11-12'], ['23:59', 'NOCHE', '2026-11-12']
  ];
  casos.forEach(([hora, turno, fechaTurno]) => {
    const env = crearEntorno();
    env.ahora('2026-11-12 ' + hora + ':30');
    // (a) a partir de "creado"
    const r = env.llamar('addLib', nuevo({ creado: lima('2026-11-12 ' + hora + ':30') }));
    assert.equal(r.ok, true, hora);
    assert.equal(r.turno, turno, 'turno ' + hora); assert.equal(r.fechaTurno, fechaTurno, 'fecha ' + hora);
    assert.equal(r.ajusteManual, 'NO');
    // (b) sin "creado": hora del servidor
    const r2 = env.llamar('addLib', nuevo());
    assert.equal(r2.turno, turno, 'servidor ' + hora); assert.equal(r2.fechaTurno, fechaTurno);
    const f = env.libs()[0];
    assert.equal(f.TURNO, turno); assert.equal(f['FECHA TURNO'], fechaTurno);
    assert.equal(f.FECHA, '2026-11-12'); assert.equal(f.HORA, hora);
  });
});

test('turno de madrugada cruza fin de mes y de año', () => {
  const env = crearEntorno();
  env.ahora('2027-01-01 00:30');
  const r = env.llamar('addLib', nuevo({ creado: lima('2027-01-01 00:30') }));
  assert.equal(r.fechaTurno, '2026-12-31'); assert.equal(r.id, 'L261231-001');
  env.ahora('2026-12-01 03:00');
  assert.equal(env.llamar('addLib', nuevo({ creado: lima('2026-12-01 03:00') })).fechaTurno, '2026-11-30');
});

test('validación de turno y fecha enviados por el cliente', () => {
  const env = crearEntorno();             // ahora = 2026-11-12 10:00 → DÍA 2026-11-12
  const probar = (extra) => env.llamar('addLib', nuevo(extra));
  // válidos y confirmados por el usuario
  let r = probar({ turno: 'DÍA', fecha: '2026-11-12' });
  assert.deepEqual([r.turno, r.fechaTurno, r.ajusteManual], ['DÍA', '2026-11-12', 'NO']);
  // turno sin tilde / minúsculas
  r = probar({ turno: 'dia', fecha: '2026-11-12' });
  assert.equal(r.turno, 'DÍA');
  // turno inválido → calculado
  r = probar({ turno: 'TARDE', fecha: '2026-11-12' });
  assert.equal(r.turno, 'DÍA');
  // fechas inválidas → calculadas
  ['2026-02-30', '12/11/2026', '2026-13-01', 'hoy', '', null, 20261112].forEach((fe) => {
    r = probar({ turno: 'DÍA', fecha: fe });
    assert.equal(r.fechaTurno, '2026-11-12', String(fe));
  });
  // 400 días: justo el límite sí, uno más no
  r = probar({ turno: 'DÍA', fecha: '2025-10-08' });
  assert.equal(r.fechaTurno, '2025-10-08');
  r = probar({ turno: 'DÍA', fecha: '2025-10-07' });
  assert.equal(r.fechaTurno, '2026-11-12');
  r = probar({ turno: 'DÍA', fecha: '2027-12-17' });  // +400
  assert.equal(r.fechaTurno, '2027-12-17');
  r = probar({ turno: 'DÍA', fecha: '2027-12-18' });
  assert.equal(r.fechaTurno, '2026-11-12');
  // fecha manual distinta de la calculada → AJUSTE MANUAL = SÍ
  r = probar({ turno: 'DÍA', fecha: '2026-11-10' });
  assert.deepEqual([r.fechaTurno, r.ajusteManual], ['2026-11-10', 'SÍ']);
  assert.equal(r.id, 'L261110-001');
  // turno distinto del que corresponde por hora → SÍ
  r = probar({ turno: 'NOCHE', fecha: '2026-11-12' });
  assert.equal(r.ajusteManual, 'SÍ');
  // el cliente avisa ajuste manual aunque coincida
  r = probar({ turno: 'DÍA', fecha: '2026-11-12', ajusteManual: true });
  assert.equal(r.ajusteManual, 'SÍ');
  // solo turno: fecha calculada según el turno elegido
  r = probar({ turno: 'NOCHE' });
  assert.deepEqual([r.turno, r.fechaTurno], ['NOCHE', '2026-11-11']);   // 10:00 y NOCHE → la noche que empezó ayer
});

test('"creado" del celular: se usa si es razonable; si está en el futuro se usa la hora del servidor', () => {
  const env = crearEntorno();             // ahora 2026-11-12 10:00
  env.llamar('addLib', nuevo({ creado: lima('2026-11-12 06:00') }));
  let f = env.libs()[0];
  assert.deepEqual([f.FECHA, f.HORA, f.TURNO, f['FECHA TURNO']], ['2026-11-12', '06:00', 'NOCHE', '2026-11-11']);
  assert.equal(f.CREADO, '2026-11-12T06:00:00-05:00');
  env.llamar('addLib', nuevo({ creado: lima('2026-11-12 10:04') }));            // +4 min: tolerado
  assert.equal(env.libs()[1].HORA, '10:04');
  env.llamar('addLib', nuevo({ creado: lima('2026-11-12 10:10') }));            // +10 min: servidor
  assert.equal(env.libs()[2].HORA, '10:00');
  env.llamar('addLib', nuevo({ creado: 'basura' }));
  assert.equal(env.libs()[3].HORA, '10:00');
  env.llamar('addLib', nuevo({ creado: lima('2024-01-01 10:00') }));            // demasiado viejo
  assert.equal(env.libs()[4].FECHA, '2026-11-12');
});

// ── listados ─────────────────────────────────────────────────────
function cargarDia(env) {
  env.props.CARPETA_RAIZ_ID = env.DriveApp.createFolder('Raíz').getId();
  env.ahora('2026-11-12 08:00');
  const a = env.llamar('addLib', nuevo({ creado: lima('2026-11-12 08:00'), foto: foto(JPG), texto: TEXTO + '\nOBS: dia uno' }));
  env.ahora('2026-11-12 20:00');
  const b = env.llamar('addLib', nuevo({ creado: lima('2026-11-12 20:00') }));
  env.ahora('2026-11-13 03:00');
  const c = env.llamar('addLib', nuevo({ creado: lima('2026-11-13 03:00') }));
  env.ahora('2026-11-13 09:00');
  const d = env.llamar('addLib', nuevo({ creado: lima('2026-11-13 09:00') }));
  return [a, b, c, d];
}

test('listLibs por fecha de turno y por turno; trae turno y fechaTurno', () => {
  const env = crearEntorno();
  const [a, b, c, d] = cargarDia(env);
  assert.deepEqual([a.id, b.id, c.id, d.id], ['L261112-001', 'L261112-002', 'L261112-003', 'L261113-001']);
  let r = env.llamar('listLibs', { fecha: '2026-11-12' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map((x) => x.id), ['L261112-001', 'L261112-002', 'L261112-003']); // ambos turnos, orden de hoja
  assert.deepEqual(r.items.map((x) => x.turno), ['DÍA', 'NOCHE', 'NOCHE']);
  assert.ok(r.items.every((x) => x.fechaTurno === '2026-11-12' && x.fecha === '2026-11-12'));
  assert.equal(r.items[2].fechaReal, '2026-11-13'); assert.equal(r.items[2].hora, '03:00');
  assert.equal(r.hoja, env.ss.getUrl());
  assert.equal(r.items[0].foto.indexOf('https://drive.google.com/file/d/'), 0);
  assert.equal(r.items[0].fotoData, undefined);

  r = env.llamar('listLibs', { fecha: '2026-11-12', turno: 'NOCHE' });
  assert.deepEqual(r.items.map((x) => x.id), ['L261112-002', 'L261112-003']);
  r = env.llamar('listLibs', { fecha: '2026-11-12', turno: 'DÍA' });
  assert.deepEqual(r.items.map((x) => x.id), ['L261112-001']);
  r = env.llamar('listLibsDia', { fecha: '2026-11-13' });
  assert.deepEqual(r.items.map((x) => x.id), ['L261113-001']);
  assert.deepEqual(env.llamar('listLibs', { fecha: '2026-11-20' }).items, []);
  assert.equal(env.llamar('listLibs', { fecha: 'ayer' }).ok, false);
  assert.equal(env.llamar('listLibs', {}).ok, false);
  assert.equal(env.llamar('listLibs', { fecha: '2026-11-12', turno: 'TARDE' }).ok, false);
});

test('listLibs con fotos:true devuelve fotoData en base64 desde Drive', () => {
  const env = crearEntorno();
  cargarDia(env);
  const r = env.llamar('listLibs', { fecha: '2026-11-12', fotos: true }, KEY);
  assert.equal(r.items[0].fotoData, JPG.toString('base64'));
  assert.equal(r.items[0].fotoMime, 'image/jpeg');
  assert.equal(r.items[1].fotoData, undefined);   // sin foto
});

test('filas antiguas sin TURNO/FECHA TURNO se calculan al vuelo desde FECHA+HORA', () => {
  const env = crearEntorno();
  const sh = env.hojaAntigua([
    ['L261106-001', '2026-11-06', '04:33', 'madrugada', '', 'v1', 'T', 'E', '', '', '', '', '', ''],
    ['L261106-002', '2026-11-06', '09:10', 'dia', '', 'v2', '', '', '', '', '', '', '', ''],
    ['L261106-003', '2026-11-06', '18:59', 'limite dia', '', 'v3', '', '', '', '', '', '', '', ''],
    ['L261106-004', '2026-11-06', '19:00', 'limite noche', '', 'v4', '', '', '', '', '', '', '', ''],
    // FECHA como Date de Sheets (medianoche de Lima) y HORA como Date (1899-12-30)
    ['L261107-001', new Date(Date.UTC(2026, 10, 7, 5, 0)), new Date(Date.UTC(1899, 11, 30, 6, 59 + 0)), 'fecha date', '', 'v5', '', '', '', '', '', '', '', ''],
    ['L261108-001', '08/11/2026', '07:00', 'formato dd/MM/yyyy', '', 'v6', '', '', '', '', '', '', '', '']
  ]);
  void sh;
  let r = env.llamar('listLibs', { fecha: '2026-11-05' });
  assert.deepEqual(r.items.map((x) => [x.id, x.turno, x.hora]), [['L261106-001', 'NOCHE', '04:33']]);
  r = env.llamar('listLibs', { fecha: '2026-11-06' });
  assert.deepEqual(r.items.map((x) => [x.id, x.turno]), [['L261106-002', 'DÍA'], ['L261106-003', 'DÍA'], ['L261106-004', 'NOCHE'], ['L261107-001', 'NOCHE']]);   // el último: Date de Sheets 07/11 01:59 → noche del 06
  r = env.llamar('listLibs', { fecha: '2026-11-06', turno: 'NOCHE' });
  assert.deepEqual(r.items.map((x) => x.id), ['L261106-004', 'L261107-001']);
  r = env.llamar('listLibs', { fecha: '2026-11-08' });
  assert.deepEqual(r.items.map((x) => [x.id, x.turno]), [['L261108-001', 'DÍA']]);
});

test('ultimasLibs y searchLibs', () => {
  const env = crearEntorno();
  cargarDia(env);
  let r = env.llamar('ultimasLibs', { n: 2 });
  assert.deepEqual(r.items.map((x) => x.id), ['L261113-001', 'L261112-003']);
  assert.equal(env.llamar('ultimasLibs', {}).items.length, 3);
  assert.equal(env.llamar('ultimasLibs', { n: 999 }).items.length, 4);
  r = env.llamar('searchLibs', { q: 'liberacion relleno' });   // sin tildes
  assert.equal(r.items.length, 4);
  assert.equal(r.items[0].id, 'L261113-001');                  // más nueva primero
  r = env.llamar('searchLibs', { q: 'dia uno' });
  assert.deepEqual(r.items.map((x) => x.id), ['L261112-001']);
  assert.deepEqual(env.llamar('searchLibs', { q: 'inexistente' }).items, []);
  assert.deepEqual(env.llamar('searchLibs', { q: 'a' }).items, []);
});

// ── configuración ────────────────────────────────────────────────
test('getConfig vacío, saveConfig con versión y conflicto', () => {
  const env = crearEntorno();
  assert.deepEqual(env.llamar('getConfig'), { ok: true });
  const cfg1 = { frentes: [{ id: 'a' }], x: 1 };
  let r = env.llamar('saveConfig', { config: cfg1, baseVersion: 0 });
  assert.equal(r.ok, true); assert.equal(r.version, 1); assert.equal(r.por, 'Ana');
  assert.match(r.fecha, /^2026-11-12T10:00:00-05:00$/);
  let g = env.llamar('getConfig');
  assert.deepEqual(g.config, cfg1); assert.equal(g.version, 1); assert.equal(g.por, 'Ana');

  // otro editor guarda con base vieja → conflicto
  r = env.llamar('saveConfig', { config: { frentes: [], x: 2 }, baseVersion: 0 }, LUIS);
  assert.equal(r.ok, false); assert.equal(r.conflict, true);
  assert.equal(r.version, 1); assert.equal(r.por, 'Ana');
  assert.equal(env.llamar('getConfig').version, 1);   // no se guardó nada
  // con base correcta
  r = env.llamar('saveConfig', { config: { frentes: [], x: 2 }, baseVersion: 1 }, LUIS);
  assert.deepEqual([r.ok, r.version, r.por], [true, 2, 'Luis']);
  // forzar sobre una base vieja
  r = env.llamar('saveConfig', { config: { frentes: [], x: 3 }, baseVersion: 1, force: true });
  assert.deepEqual([r.ok, r.version], [true, 3]);
  g = env.llamar('getConfig');
  assert.deepEqual(g.config, { frentes: [], x: 3 });
  // sin historial: la hoja guarda UNA sola fila (la vigente), con quién y cuándo la cambió
  assert.equal(env.hojas['Configuracion']._tabla().length, 1);
  assert.deepEqual(env.hojas['Configuracion']._filas[0], ['VERSIÓN', 'FECHA', 'EDITOR', 'CONFIGURACIÓN']);
  assert.equal(env.hojas['Configuracion']._filas.length, 2);
  assert.equal(env.hojas['Configuracion']._filas[1][2], 'Ana');
  assert.equal(g.por, 'Ana');
});

test('saveConfig: sin permiso, config inválida, y continúa sobre filas heredadas', () => {
  const env = crearEntorno();
  const sh = env.ss.insertSheet('Configuracion');
  sh._poner(['VERSIÓN', 'FECHA', 'EDITOR', 'CONFIGURACIÓN']);
  sh._poner([4, '2026-10-01 10:00', 'Viejo', '{"frentes":[],"v":4}']);
  sh._poner([5, '2026-10-02 10:00', 'Viejo', '{"frentes":[],"v":5}']);
  assert.equal(env.llamar('getConfig').version, 5);
  let r = env.llamar('saveConfig', { config: { frentes: [] }, baseVersion: 5 }, { usuario: 'Ana', codigo: 'mal' });
  assert.equal(r.ok, false); assert.equal(r.acceso, 'invalido');
  r = env.llamar('saveConfig', { config: { frentes: [] }, baseVersion: 5 }, BETO);
  assert.equal(r.ok, false); assert.equal(r.acceso, 'permiso');
  r = env.llamar('saveConfig', { config: 'texto', baseVersion: 5 });
  assert.equal(r.ok, false);
  r = env.llamar('saveConfig', { config: { sinFrentes: 1 }, baseVersion: 5 });
  assert.equal(r.ok, false);
  r = env.llamar('saveConfig', { config: { frentes: [], enorme: 'x'.repeat(50000) }, baseVersion: 5 });
  assert.equal(r.ok, false); assert.match(r.error, /demasiado grande/);
  r = env.llamar('saveConfig', { config: { frentes: [], v: 6 }, baseVersion: 5 });
  assert.deepEqual([r.ok, r.version], [true, 6]);
  // las filas heredadas de versiones anteriores se compactan en una sola
  assert.equal(env.hojas['Configuracion']._filas.length, 2);
  assert.equal(env.llamar('getConfig').config.v, 6);
});

// ── secretos ─────────────────────────────────────────────────────
test('nunca se devuelven ni se loguean la clave de invitación ni los códigos', () => {
  const env = crearEntorno();
  const respuestas = [
    env.llamar('login', {}, { usuario: 'Ana', codigo: 'incorrecto-123' }), env.llamar('login', {}, ANA),
    env.llamar('registrar', { key: KEY, usuario: 'Pedro Gómez', codigo: 'secreto-pedro-77' }, null),
    env.llamar('registrar', { key: 'mala-clave', usuario: 'Pedro Gómez', codigo: 'secreto-pedro-77' }, null),
    env.llamar('cambiarCodigo', { nuevoCodigo: 'otro-secreto-88' }, BETO),
    env.llamar('addLib', nuevo({ uid: '' })), env.llamar('loQueSea'), env.llamar('getConfig', {}, null), env.llamar('getConfig')
  ];
  const secretos = [KEY, 'secreto-pedro-77', 'otro-secreto-88', ANA.codigo, LUIS.codigo, BETO.codigo];
  respuestas.forEach((r) => {
    const s = JSON.stringify(r);
    secretos.forEach((x) => assert.ok(s.indexOf(x) < 0, s));
  });
  const logTxt = JSON.stringify(env.hojas['Log'] ? env.hojas['Log']._filas : []);
  const hojaTxt = JSON.stringify(env.hojas['Usuarios']._filas);
  secretos.slice(1).forEach((x) => { assert.ok(logTxt.indexOf(x) < 0); assert.ok(hojaTxt.indexOf(x) < 0, 'el código no debe estar en claro en la hoja'); });
  assert.ok(logTxt.indexOf(KEY) < 0);
  assert.ok(logTxt.length > 10, 'debe haber registrado errores');
});

// ── fotos ────────────────────────────────────────────────────────
test('fotos: rechaza > 4 MB, mime no permitido, archivo dañado; acepta PNG', () => {
  const env = crearEntorno();
  env.props.CARPETA_RAIZ_ID = env.DriveApp.createFolder('Raíz').getId();
  let r = env.llamar('addLib', nuevo({ foto: { data: 'A'.repeat(4 * 1024 * 1024 + 4), mime: 'image/jpeg' } }));
  assert.equal(r.ok, false); assert.match(r.error, /4 MB/);
  r = env.llamar('addLib', nuevo({ foto: foto(JPG, 'image/gif') }));
  assert.equal(r.ok, false); assert.match(r.error, /JPG o PNG/);
  r = env.llamar('addLib', nuevo({ foto: { data: Buffer.from('no soy una imagen').toString('base64'), mime: 'image/jpeg' } }));
  assert.equal(r.ok, false); assert.match(r.error, /válida/);
  r = env.llamar('addLib', nuevo({ foto: { data: '***', mime: 'image/jpeg' } }));
  assert.equal(r.ok, false);
  assert.equal(env.hojas['Liberaciones'] ? env.libs().length : 0, 0);   // nada guardado
  // exactamente 4 MB de base64 pasa el límite de tamaño (luego falla por no ser imagen, no por tamaño)
  r = env.llamar('addLib', nuevo({ foto: { data: 'A'.repeat(4 * 1024 * 1024), mime: 'image/jpeg' } }));
  assert.doesNotMatch(r.error || '', /4 MB/);
  // PNG y data URL
  r = env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12', foto: { data: 'data:image/png;base64,' + PNG.toString('base64') } }));
  assert.equal(r.ok, true, r.error);
  const arch = Object.keys(env.archivos).map((k) => env.archivos[k]).filter((a) => a._mime === 'image/png');
  assert.equal(arch.length, 1); assert.match(arch[0]._n, /^001_.*\.png$/);
  assert.deepEqual(arch[0]._sharing, ['ANYONE_WITH_LINK', 'VIEW']);
});

test('si Drive falla no se crea la fila y el candado se libera', () => {
  const env = crearEntorno();
  env.props.CARPETA_RAIZ_ID = env.DriveApp.createFolder('Raíz').getId();
  env.estado.driveFalla = true;
  const it = nuevo({ turno: 'DÍA', fecha: '2026-11-12', foto: foto(JPG) });
  const r = env.llamar('addLib', it);
  assert.equal(r.ok, false); assert.match(r.error, /Error interno/);
  assert.equal(env.estado.lockHeld, false);
  assert.equal(env.libs().length, 0);
  env.estado.driveFalla = false;
  const r2 = env.llamar('addLib', it);                // el reintento funciona y usa el mismo correlativo
  assert.equal(r2.ok, true); assert.equal(r2.id, 'L261112-001');
});

// ── candado ──────────────────────────────────────────────────────
test('las escrituras usan el candado de script; si no se obtiene, falla sin escribir', () => {
  const env = crearEntorno();
  env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12' }));
  env.llamar('saveConfig', { config: { frentes: [] }, baseVersion: 0 });
  assert.equal(env.estado.lockWaits, 2);
  env.llamar('listLibs', { fecha: '2026-11-12' });
  assert.equal(env.estado.lockWaits, 2);               // las lecturas no lo toman
  env.estado.lockFalla = true;
  const r = env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12' }));
  assert.equal(r.ok, false); assert.match(r.error, /ocupado/);
  assert.equal(env.libs().length, 1);
});

// ── delLib ───────────────────────────────────────────────────────
test('delLib borra la fila y manda la foto a la papelera; exige rol de editor; repetir es inocuo', () => {
  const env = crearEntorno();
  env.props.CARPETA_RAIZ_ID = env.DriveApp.createFolder('Raíz').getId();
  const a = env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12', foto: foto(JPG) }));
  env.llamar('addLib', nuevo({ turno: 'DÍA', fecha: '2026-11-12' }));
  assert.equal(env.llamar('delLib', { id: a.id }, BETO).acceso, 'permiso');
  assert.equal(env.llamar('delLib', { id: a.id }, null).ok, false);
  assert.equal(env.libs().length, 2);
  const idArch = /\/d\/(fil\d+)/.exec(a.foto)[1];
  const r = env.llamar('delLib', { id: a.id });
  assert.deepEqual(r, { ok: true, id: a.id });
  assert.equal(env.archivos[idArch]._papelera, true);
  assert.deepEqual(env.libs().map((x) => x.ID), ['L261112-002']);
  assert.equal(env.llamar('delLib', { id: a.id }).yaNoExistia, true);
  assert.equal(env.llamar('delLib', {}).ok, false);
  const log = JSON.stringify(env.hojas['Log']._filas);
  assert.match(log, /eliminada por Ana/);
});

// ── instalación, respaldo y log ──────────────────────────────────
test('iniciar crea hojas, encabezados, carpeta y propiedades de ejemplo (que no sirven)', () => {
  const env = crearEntorno({ sinProps: true });
  env.correr('iniciar');
  assert.deepEqual(env.hojas['Liberaciones']._filas[0], ENC_VIEJOS.concat(ENC_NUEVOS));
  assert.deepEqual(env.hojas['Configuracion']._filas[0], ['VERSIÓN', 'FECHA', 'EDITOR', 'CONFIGURACIÓN']);
  assert.deepEqual(env.hojas['Log']._filas[0].slice(0, 3), ['FECHA', 'ACCIÓN', 'MENSAJE']);
  assert.deepEqual(env.hojas['Usuarios']._filas[0], ENC_USU);
  assert.ok(env.carpetas[env.props.CARPETA_RAIZ_ID]);
  assert.match(env.props.EQUIPO_KEY, /^CAMBIAR/); assert.equal(env.props.PIN_EDITOR, undefined);
  // con la clave de ejemplo nadie puede registrarse
  assert.match(env.llamar('registrar', { key: env.props.EQUIPO_KEY, usuario: 'Pedro Gómez', codigo: 'codigo-pedro' }, null).error, /no está configurado/);
  // repetir no duplica ni pisa
  env.props.EQUIPO_KEY = 'mi-clave-real-123';
  const carpeta = env.props.CARPETA_RAIZ_ID;
  env.correr('iniciar');
  assert.equal(env.props.EQUIPO_KEY, 'mi-clave-real-123'); assert.equal(env.props.CARPETA_RAIZ_ID, carpeta);
  assert.equal(env.hojas['Liberaciones']._filas.length, 1);
});

test('instalar programa un único trigger semanal de respaldo', () => {
  const env = crearEntorno({ sinProps: true });
  env.correr('instalar'); env.correr('instalar');
  assert.equal(env.triggers.length, 1);
  assert.equal(env.triggers[0].getHandlerFunction(), 'respaldar');
});

test('respaldar copia la hoja junto al original con fecha en el nombre y conserva solo los últimos N', () => {
  const env = crearEntorno({ props: { RESPALDOS_MAX: '2' } });
  env.hojaAntigua();
  env.ahora('2026-11-08 02:00'); env.correr('respaldar');
  env.ahora('2026-11-09 02:00'); env.correr('respaldar');
  env.ahora('2026-11-12 02:00'); const n = env.correr('respaldar');
  assert.equal(n, 'Respaldo Liberaciones 2026-11-12_0200');
  const nombres = env.miUnidad._arch.map((f) => [f._n, !!f._papelera]);
  assert.deepEqual(nombres, [
    ['Liberaciones CQC', false],
    ['Respaldo Liberaciones 2026-11-08_0200', true],
    ['Respaldo Liberaciones 2026-11-09_0200', false],
    ['Respaldo Liberaciones 2026-11-12_0200', false]
  ]);
});

test('el Log rota y no supera el máximo', () => {
  const env = crearEntorno();
  for (let i = 0; i < 1100; i++) env.llamar('accionRara' + (i % 7));
  const filas = env.hojas['Log']._filas.length;
  assert.ok(filas <= 1001 && filas > 400, 'filas=' + filas);
  assert.deepEqual(env.hojas['Log']._filas[0].slice(0, 3), ['FECHA', 'ACCIÓN', 'MENSAJE']);
  assert.match(env.hojas['Log']._filas[filas - 1][0], /^2026-11-12T10:00:00-05:00$/);
});
