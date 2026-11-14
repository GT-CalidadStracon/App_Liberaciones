'use strict';
// Entorno de pruebas del backend: dobles en memoria de los servicios de Apps Script (hoja, Drive, candado, caché...).
// Lo usan tests/backend/*.test.js. Con opts.extra = ['Migracion.gs'] se cargan también archivos extra de backend/.
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
    clear() { filas.length = 0; return sh; },
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
    getFiles() { return iter(this._arch.filter((f) => !f._papelera)); },
    getFolders() { return iter(this._sub.slice()); },
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
  (opts.extra || []).forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'backend', f), 'utf8'), ctx, { filename: f }));
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

module.exports = { crearEntorno, lima, KEY, ENC_VIEJOS, ENC_NUEVOS, ENC_USU, ANA, LUIS, BETO, TEXTO, camposDe, JPG, PNG, nuevo, foto, crearHoja, iter };
