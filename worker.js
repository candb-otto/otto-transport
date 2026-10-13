/**
 * OTTO TRANSPORT SYSTEM - Cloudflare Worker (complete backend)
 * Version: Phase A - full port of the Apps Script backend
 *
 * This one file replaces every .gs file (Config, Utils, Auth, Code, Dashboard,
 * Users, Vehicles, Drivers, Masters, GvRequests, Allocations, Notifications,
 * Reports, Exports). Function names, checks, statuses and messages are the
 * same as in Apps Script, so the page works exactly as before.
 *
 * How a call works:
 *   1. The page sends  POST { fn: 'getVehicles', args: [token, input] }
 *   2. The Worker reads the needed sheet tabs in ONE Google request
 *   3. Runs the same logic as the old .gs function on that copy
 *   4. Writes all changes back in as few Google requests as possible
 *
 * Settings needed in Cloudflare (Worker -> Settings -> Variables and Secrets):
 *   SHEET_ID        Text    the Google Sheet ID
 *   SA_EMAIL        Text    service account email
 *   SA_PRIVATE_KEY  Secret  private key (or the whole JSON key file)
 *   TOKEN_SECRET    Secret  long random text - signs login sessions
 *   ALLOWED_ORIGIN  Text    https://candb-otto.github.io
 *
 * Always paste this COMPLETE file into the Cloudflare editor, then Deploy.
 */

/* =====================================================================
 * CONFIG (same as Config.gs)
 * ===================================================================== */

var CONFIG = {

  APP_NAME: 'Otto Transport System',

  SHEETS: {
    USERS: 'Users',
    VEHICLES: 'Vehicles',
    DRIVERS: 'Drivers',
    GV_REQUESTS: 'GV_Requests',
    ALLOCATIONS: 'Allocations',
    STATUS_MASTER: 'Status_Master',
    DEPARTMENT_MASTER: 'Department_Master',
    LOCATION_MASTER: 'Location_Master',
    NOTIFICATIONS: 'Notifications'
  },

  // ID formats follow the existing sheet: U00001, V00001, D00001,
  // REQ-2026-00001, AL-2026-00001
  ID: {
    USERS:       { sheet: 'Users',       column: 'UserID',       prefix: 'U',    pad: 5, useYear: false },
    VEHICLES:    { sheet: 'Vehicles',    column: 'VehicleID',    prefix: 'V',    pad: 5, useYear: false },
    DRIVERS:     { sheet: 'Drivers',     column: 'DriverID',     prefix: 'D',    pad: 5, useYear: false },
    GV_REQUESTS: { sheet: 'GV_Requests', column: 'RequestID',    prefix: 'REQ-', pad: 5, useYear: true },
    ALLOCATIONS: { sheet: 'Allocations', column: 'AllocationID', prefix: 'AL-',  pad: 5, useYear: true },
    DEPARTMENTS: { sheet: 'Department_Master', column: 'DepartmentID', prefix: 'DEPT', pad: 3, useYear: false },
    LOCATIONS:   { sheet: 'Location_Master',   column: 'LocationID',   prefix: 'LOC',  pad: 3, useYear: false },
    NOTIFICATIONS: { sheet: 'Notifications', column: 'NotificationID', prefix: 'NOTI-', pad: 5, useYear: true }
  },

  ROLES: {
    SUPER_ADMIN: 'Super_Admin',
    ADMIN: 'Admin',
    GV_USER: 'GV_User',
    FD_USER: 'FD_User',
    DRIVER: 'Driver'
  },

  STATUS: {
    USER: { ACTIVE: 'Active', INACTIVE: 'Inactive' },
    REQUEST: {
      PENDING: 'Pending',
      APPROVED: 'Approved',
      ALLOCATED: 'Allocated',
      REACHED: 'Reached',
      LOADING: 'Loading',
      ON_TRIP: 'On Trip',
      COMPLETED: 'Completed',
      CANCELLED: 'Cancelled',
      REJECTED: 'Rejected'
    },
    ALLOCATION: {
      ALLOCATED: 'Allocated',
      REACHED: 'Reached',
      LOADING: 'Loading',
      ON_TRIP: 'On Trip',
      COMPLETED: 'Completed',
      CANCELLED: 'Cancelled'
    },
    VEHICLE: {
      AVAILABLE: 'Available',
      ALLOCATED: 'Allocated',
      ON_TRIP: 'On Trip',
      MAINTENANCE: 'Maintenance',
      INACTIVE: 'Inactive'
    },
    DRIVER: {
      AVAILABLE: 'Available',
      ALLOCATED: 'Allocated',
      ON_TRIP: 'On Trip',
      LEAVE: 'Leave',
      INACTIVE: 'Inactive'
    }
  },

  // Login sessions: 6 hours, same as before.
  SESSION: {
    TTL_SECONDS: 21600,
    MAX_FAILED_LOGINS: 5,
    LOCK_SECONDS: 600
  },

  MENU: {
    SUPER_ADMIN: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'managementReport', label: 'Management Report' },
      { id: 'gvRequests', label: 'GV Requests' },
      { id: 'allocations', label: 'Allocations' },
      { id: 'vehicles', label: 'Vehicles' },
      { id: 'drivers', label: 'Drivers' },
      { id: 'users', label: 'Users' },
      { id: 'departments', label: 'Departments' },
      { id: 'locations', label: 'Locations' },
      { id: 'reports', label: 'Reports' }
    ],
    DRIVER: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'allocations', label: 'My Trips' }
    ],
    ADMIN: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'gvRequests', label: 'GV Requests' },
      { id: 'allocations', label: 'Allocations' },
      { id: 'vehicles', label: 'Vehicles' },
      { id: 'drivers', label: 'Drivers' },
      { id: 'users', label: 'Users' },
      { id: 'departments', label: 'Departments' },
      { id: 'locations', label: 'Locations' },
      { id: 'reports', label: 'Reports' }
    ],
    GV_USER: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'newRequest', label: 'New GV Request' },
      { id: 'myRequests', label: 'My Requests' }
    ],
    FD_USER: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'pendingRequests', label: 'Pending Requests' },
      { id: 'allocations', label: 'Allocations' },
      { id: 'vehicles', label: 'Vehicles' },
      { id: 'drivers', label: 'Drivers' },
      { id: 'locations', label: 'Locations' },
      { id: 'reports', label: 'Reports' }
    ]
  },

  DEFAULT_TRIP_HOURS: 4,

  // The only vehicle types that can be chosen on the Vehicles form.
  VEHICLE_TYPES: ['Goods Vehicle', 'Car', 'Bus'],

  LOADING_REQUIRED_VEHICLE_TYPE: 'Goods Vehicle',

  DATE_FORMAT: {
    DATE: 'dd/MM/yyyy',
    TIMESTAMP: 'dd/MM/yyyy HH:mm:ss'
  }
};

// Columns that hold dates/times. Google returns real date cells as serial
// numbers; these are turned into the same text Apps Script used to show.
var DATE_COLUMNS = {
  CreatedAt: 1, UpdatedAt: 1, RequestDateTime: 1, RequiredDate: 1, RequiredTime: 1,
  AllocationDateTime: 1, PlannedStartDateTime: 1, ReachedDateTime: 1,
  LoadingStartDateTime: 1, LoadingEndDateTime: 1, ActualStartDateTime: 1, ActualEndDateTime: 1,
  LicenseExpiry: 1, ActiveFrom: 1
};

// India Standard Time (UTC+5:30, no daylight saving) - same as the old script time zone.
var IST_OFFSET_MS = 330 * 60 * 1000;

var SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets/';
var TOKEN_URL = 'https://oauth2.googleapis.com/token';
var SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

/* =====================================================================
 * ENTRY POINT
 * ===================================================================== */

export default {
  async fetch(request, env, ctx) {
    var origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, origin) });
    }

    try {
      var missing = ['SHEET_ID', 'SA_EMAIL', 'SA_PRIVATE_KEY', 'TOKEN_SECRET'].filter(function (k) {
        return !env[k] || !String(env[k]).trim();
      });
      if (missing.length) {
        return respond({ success: false, ok: false, message: 'Missing Cloudflare settings: ' + missing.join(', '), error: 'Missing Cloudflare settings: ' + missing.join(', ') }, env, origin);
      }

      // Connection test in a browser: /?action=ping
      if (request.method === 'GET') {
        var url = new URL(request.url);
        var action = url.searchParams.get('action') || '';
        if (action === 'ping') return respond(await handlePing(env), env, origin);
        return respond({ ok: true, app: 'Otto Transport System API', hint: 'Add ?action=ping to test the sheet connection' }, env, origin);
      }

      // The app's calls: POST { fn, args }
      var text = await request.text();
      var body;
      try { body = text ? JSON.parse(text) : {}; } catch (e) { return respond(fail_('Bad request.'), env, origin); }

      var fnName = String(body.fn || '');
      var args = Array.isArray(body.args) ? body.args : [];
      if (!Object.prototype.hasOwnProperty.call(PUBLIC_FUNCTIONS, fnName)) {
        return respond(fail_('Unknown action: ' + fnName), env, origin);
      }

      var result = WRITE_FUNCTIONS[fnName]
        ? await serializeWrites(function () { return runAction(env, fnName, args); })
        : await runAction(env, fnName, args);

      return respond(result, env, origin);
    } catch (err) {
      console.error(err && err.stack ? err.stack : err);
      return respond(fail_(err && err.message ? err.message : String(err)), env, origin);
    }
  }
};

// Functions the page is allowed to call (same names as the old .gs functions).
var PUBLIC_FUNCTIONS = {
  login: login,
  getCurrentUser: getCurrentUser,
  logout: logout,
  getDashboard: getDashboard,
  getUsers: getUsers,
  createUser: createUser,
  updateUser: updateUser,
  setUserPassword: setUserPassword,
  getVehicles: getVehicles,
  createVehicle: createVehicle,
  updateVehicle: updateVehicle,
  getDrivers: getDrivers,
  createDriver: createDriver,
  updateDriver: updateDriver,
  getDepartments: getDepartments,
  createDepartment: createDepartment,
  updateDepartment: updateDepartment,
  getLocations: getLocations,
  createLocation: createLocation,
  updateLocation: updateLocation,
  getGvRequestFormOptions: getGvRequestFormOptions,
  createGvRequest: createGvRequest,
  getMyGvRequests: getMyGvRequests,
  getGvRequests: getGvRequests,
  rejectGvRequest: rejectGvRequest,
  cancelGvRequest: cancelGvRequest,
  getAdminGvRequestOptions: getAdminGvRequestOptions,
  adminCreateGvRequest: adminCreateGvRequest,
  updateGvRequest: updateGvRequest,
  changeMyPassword: changeMyPassword,
  getAllocations: getAllocations,
  getAllocationOptions: getAllocationOptions,
  createAllocation: createAllocation,
  markVehicleReached: markVehicleReached,
  startLoading: startLoading,
  endLoading: endLoading,
  startTrip: startTrip,
  endTrip: endTrip,
  getRequestTimeline: getRequestTimeline,
  getMyNotifications: getMyNotifications,
  markNotificationRead: markNotificationRead,
  markAllNotificationsRead: markAllNotificationsRead,
  getReportsData: getReportsData,
  getManagementReport: getManagementReport,
  exportReportsExcel: exportReportsExcel
};

// Functions that change the sheet (they used withLock_ in Apps Script).
// They run one at a time so two saves cannot step on each other.
var WRITE_FUNCTIONS = {
  createUser: 1, updateUser: 1, setUserPassword: 1,
  createVehicle: 1, updateVehicle: 1,
  createDriver: 1, updateDriver: 1,
  createDepartment: 1, updateDepartment: 1,
  createLocation: 1, updateLocation: 1,
  createGvRequest: 1, rejectGvRequest: 1, cancelGvRequest: 1,
  adminCreateGvRequest: 1, updateGvRequest: 1, changeMyPassword: 1,
  createAllocation: 1, markVehicleReached: 1, startLoading: 1, endLoading: 1, startTrip: 1, endTrip: 1,
  markNotificationRead: 1, markAllNotificationsRead: 1
};

// Which tabs to read first for each call. Anything missing is read
// automatically on demand, so this list only saves time.
var DEFAULT_TABS = ['Users', 'Vehicles', 'Drivers', 'GV_Requests', 'Allocations', 'Department_Master', 'Location_Master'];
var TAB_HINTS = {
  login: ['Users'],
  getCurrentUser: [],
  logout: [],
  getMyNotifications: ['Notifications'],
  markNotificationRead: ['Notifications'],
  markAllNotificationsRead: ['Notifications'],
  getUsers: ['Users', 'Department_Master'],
  createUser: ['Users', 'Department_Master'],
  updateUser: ['Users', 'Department_Master'],
  setUserPassword: ['Users'],
  getVehicles: ['Vehicles', 'Location_Master'],
  createVehicle: ['Vehicles', 'Location_Master'],
  updateVehicle: ['Vehicles', 'Location_Master'],
  getDrivers: ['Drivers'],
  createDriver: ['Drivers'],
  updateDriver: ['Drivers'],
  getDepartments: ['Department_Master'],
  createDepartment: ['Department_Master'],
  updateDepartment: ['Department_Master'],
  getLocations: ['Location_Master'],
  createLocation: ['Location_Master'],
  updateLocation: ['Location_Master'],
  getGvRequestFormOptions: ['Location_Master', 'Vehicles', 'Department_Master'],
  createGvRequest: ['GV_Requests', 'Users', 'Notifications'],
  rejectGvRequest: ['GV_Requests', 'Notifications'],
  getAdminGvRequestOptions: ['Location_Master', 'Vehicles', 'Users', 'Department_Master'],
  adminCreateGvRequest: ['GV_Requests', 'Users', 'Notifications'],
  updateGvRequest: ['GV_Requests', 'Users', 'Notifications'],
  changeMyPassword: ['Users'],
  cancelGvRequest: ['GV_Requests', 'Notifications'],
  createAllocation: DEFAULT_TABS.concat(['Notifications']),
  markVehicleReached: ['Allocations', 'GV_Requests', 'Notifications', 'Drivers'],
  startLoading: ['Allocations', 'GV_Requests', 'Vehicles'],
  endLoading: ['Allocations', 'GV_Requests', 'Users', 'Notifications'],
  startTrip: ['Allocations', 'GV_Requests', 'Vehicles', 'Drivers'],
  endTrip: ['Allocations', 'GV_Requests', 'Vehicles', 'Drivers', 'Notifications']
};

/* =====================================================================
 * RUNTIME - sheet copy, buffered writes, one-at-a-time saves
 * ===================================================================== */

var DB = null;          // the current call's sheet copy (only used while code runs without pausing)
var loginFails = {};    // failed login counts (best effort, per Cloudflare instance)
var writeChain = Promise.resolve();

function serializeWrites(task) {
  var run = writeChain.then(task, task);
  writeChain = run.catch(function () {});
  return run;
}

function missingTabError_(tab) {
  var e = new Error('Tab not loaded: ' + tab);
  e.isMissingTab = true;
  e.tab = tab;
  return e;
}

/**
 * Reads the tabs, runs the old .gs logic, then saves the changes.
 * If the logic needs a tab that was not read yet, it is read and the
 * logic is run again from a clean copy (nothing has been saved yet).
 */
async function runAction(env, fnName, args) {
  var fn = PUBLIC_FUNCTIONS[fnName];
  var raw = {};
  var tabs = TAB_HINTS[fnName] || DEFAULT_TABS;
  if (tabs.length) Object.assign(raw, await fetchTabs(env, tabs));

  for (var attempt = 0; attempt < 6; attempt++) {
    DB = { env: env, tables: buildTables_(raw), appends: {}, appendOrder: [], updates: [], generated: [], tokenSecret: env.TOKEN_SECRET };
    var result, db;
    try {
      result = fn.apply(null, args);
      db = DB;
    } catch (e) {
      DB = null;
      if (e && e.isMissingTab && !raw[e.tab]) {
        Object.assign(raw, await fetchTabs(env, [e.tab]));
        continue;
      }
      throw e;
    }
    DB = null;

    if (result && result.success && (db.updates.length || db.appendOrder.length)) {
      result = await flushWrites_(env, db, result);
    }
    return result;
  }
  throw new Error('Could not load the sheet tabs needed for ' + fnName + '.');
}

// Turns raw Google values into { headers, rows, lastRow } per tab, like readTable_ did.
function buildTables_(raw) {
  var tables = {};
  Object.keys(raw).forEach(function (name) {
    var values = raw[name] || [];
    var headers = values.length ? values[0].map(function (h) { return String(h === undefined || h === null ? '' : h).trim(); }) : [];
    var rows = [];
    for (var i = 1; i < values.length; i++) {
      var line = values[i] || [];
      var isEmpty = line.every(function (cell) { return cell === '' || cell === null || cell === undefined; });
      if (isEmpty) continue;
      var obj = { _row: i + 1 };
      for (var c = 0; c < headers.length; c++) {
        if (headers[c] !== '') obj[headers[c]] = normalizeCell_(headers[c], line[c]);
      }
      rows.push(obj);
    }
    tables[name] = { headers: headers, rows: rows, lastRow: values.length };
  });
  return tables;
}

function normalizeCell_(header, value) {
  if (value === undefined || value === null) return '';
  if (DATE_COLUMNS[header] && typeof value === 'number') return serialToText_(value);
  return value;
}

/**
 * Google Sheets date serial number -> text, exactly like normalizeValue_:
 * time-only cells -> "hh:mm a", dates with a time -> "dd/MM/yyyy HH:mm:ss",
 * plain dates -> "dd/MM/yyyy".
 */
function serialToText_(serial) {
  var ms = Math.round((serial - 25569) * 86400) * 1000;
  var d = new Date(ms);
  if (serial >= 0 && serial < 1) return formatDate_(d, 'hh:mm a');
  var hasTime = d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0;
  return formatDate_(d, hasTime ? CONFIG.DATE_FORMAT.TIMESTAMP : CONFIG.DATE_FORMAT.DATE);
}

function tableFor_(sheetName) {
  if (!DB) throw new Error('Internal error: no sheet data.');
  var t = DB.tables[sheetName];
  if (!t) throw missingTabError_(sheetName);
  return t;
}

/* ---------- Saving: appends + cell updates + duplicate-ID check ---------- */

async function flushWrites_(env, db, result) {
  // 1. New rows (one append call per tab; Google places each block safely)
  var appended = [];
  for (var i = 0; i < db.appendOrder.length; i++) {
    var sheet = db.appendOrder[i];
    var rows = db.appends[sheet];
    var startRow = await sheetsAppend_(env, sheet, rows);
    rows.forEach(function (values, k) {
      appended.push({ sheet: sheet, row: startRow ? startRow + k : null, values: values });
    });
  }

  // 2. Changed cells on existing rows (one call)
  if (db.updates.length) {
    await sheetsBatchUpdate_(env, db.updates.map(function (u) { return { range: u.range, values: [[u.value]] }; }));
  }

  // 3. Make sure no other save took the same new ID at the same moment
  var renames = await fixDuplicateIds_(env, db, appended);
  if (renames.length) {
    var json = JSON.stringify(result);
    renames.forEach(function (r) { json = json.split(r.from).join(r.to); });
    result = JSON.parse(json);
  }
  return result;
}

async function fixDuplicateIds_(env, db, appended) {
  var checks = db.generated.filter(function (g) { return g.key !== 'NOTIFICATIONS'; });
  if (!checks.length || !appended.length) return [];

  var sheetsToRead = [];
  checks.forEach(function (g) { if (sheetsToRead.indexOf(g.sheet) < 0) sheetsToRead.push(g.sheet); });
  var ranges = sheetsToRead.map(function (s) {
    var col = colLetter_(db.tables[s].headers.indexOf(CONFIG.ID[keyForSheet_(s)].column));
    return "'" + s + "'!" + col + ':' + col;
  });
  var columns = await sheetsBatchGet_(env, ranges);

  var renames = [];
  checks.forEach(function (g) {
    var colValues = (columns[sheetsToRead.indexOf(g.sheet)] || []).map(function (r) { return String(r && r[0] !== undefined ? r[0] : '').trim(); });
    var idIdx = db.tables[g.sheet].headers.indexOf(g.column);
    var mine = appended.filter(function (a) { return a.sheet === g.sheet && String(a.values[idIdx]) === g.id; })[0];
    if (!mine || !mine.row) return;
    var takenEarlier = colValues.some(function (v, i) { return v === g.id && (i + 1) < mine.row; });
    if (!takenEarlier) return;

    var newId = nextIdFromValues_(CONFIG.ID[g.key], colValues.concat(renames.map(function (r) { return r.to; })));
    renames.push({ from: g.id, to: newId });
  });
  if (!renames.length) return [];

  // Rewrite every cell this save added that mentions the old ID
  var fixes = [];
  appended.forEach(function (a) {
    if (!a.row) return;
    a.values.forEach(function (v, c) {
      if (typeof v !== 'string') return;
      var nv = v;
      renames.forEach(function (r) { nv = nv.split(r.from).join(r.to); });
      if (nv !== v) fixes.push({ range: "'" + a.sheet + "'!" + colLetter_(c) + a.row, values: [[nv]] });
    });
  });
  if (fixes.length) await sheetsBatchUpdate_(env, fixes);
  return renames;
}

function keyForSheet_(sheetName) {
  var keys = Object.keys(CONFIG.ID);
  for (var i = 0; i < keys.length; i++) if (CONFIG.ID[keys[i]].sheet === sheetName) return keys[i];
  return null;
}

function colLetter_(index) {
  var n = index + 1, s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/* =====================================================================
 * UTILS (same as Utils.gs)
 * ===================================================================== */

function ok_(message, data) {
  return { success: true, message: message || 'Operation completed successfully', data: data === undefined ? null : data };
}

function fail_(message) {
  return { success: false, message: message || 'Something went wrong' };
}

function handle_(fn) {
  try {
    return fn();
  } catch (err) {
    if (err && err.isMissingTab) throw err;
    console.error(err && err.stack ? err.stack : err);
    return fail_(err && err.message ? err.message : String(err));
  }
}

/**
 * Reads a whole tab (from this call's copy).
 * Returns { headers: [...], rows: [ {Column: value, ..., _row: sheetRowNumber} ] }
 */
function readTable_(sheetName) {
  var t = tableFor_(sheetName);
  return { headers: t.headers, rows: t.rows.slice() };
}

// A value as it should be sent to Google (typed in like a person would).
function toCell_(value, forceText) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean' || typeof value === 'number') return forceText ? "'" + String(value) : value;
  var s = String(value);
  if (forceText && s !== '') return "'" + s;
  if (s.charAt(0) === '=') return "'" + s; // never let typed text become a formula
  return s;
}

/**
 * Adds one full row. obj keys must match the sheet's own header names;
 * anything missing is written as blank. textColumns: headers that must stay
 * plain text (e.g. "02:00 PM").
 */
function appendRow_(sheetName, obj, textColumns) {
  var t = tableFor_(sheetName);
  var text = textColumns || [];
  var values = t.headers.map(function (h) {
    var v = h === '' ? '' : obj[h];
    return toCell_(v, text.indexOf(h) >= 0);
  });

  if (!DB.appends[sheetName]) { DB.appends[sheetName] = []; DB.appendOrder.push(sheetName); }
  DB.appends[sheetName].push(values);

  // Keep this call's copy up to date, so later reads (and new IDs) see the row
  t.lastRow += 1;
  var rowObj = { _row: t.lastRow };
  t.headers.forEach(function (h) { if (h !== '') rowObj[h] = obj[h] === undefined || obj[h] === null ? '' : obj[h]; });
  t.rows.push(rowObj);
  return t.lastRow;
}

/**
 * Updates only the given fields of an existing row. Only the changed cells
 * are written, so nothing else on the row can be overwritten.
 */
function updateRow_(sheetName, rowNumber, changes, textColumns) {
  var t = tableFor_(sheetName);
  var text = textColumns || [];
  Object.keys(changes).forEach(function (k) {
    var idx = t.headers.indexOf(k);
    if (idx < 0) return;
    DB.updates.push({ range: "'" + sheetName + "'!" + colLetter_(idx) + rowNumber, value: toCell_(changes[k], text.indexOf(k) >= 0) });
  });
  for (var i = 0; i < t.rows.length; i++) {
    if (t.rows[i]._row === rowNumber) {
      Object.keys(changes).forEach(function (k) {
        if (t.headers.indexOf(k) >= 0) t.rows[i][k] = changes[k] === undefined || changes[k] === null ? '' : changes[k];
      });
      break;
    }
  }
}

// Saves already happen one at a time (see WRITE_FUNCTIONS), so this just runs fn.
function withLock_(fn) {
  return fn();
}

function to24to12_(hhmm) {
  var m = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return hhmm;
  var h = parseInt(m[1], 10);
  var minutes = m[2];
  var suffix = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12;
  if (h12 === 0) h12 = 12;
  var hh = h12 < 10 ? '0' + h12 : String(h12);
  return hh + ':' + minutes + ' ' + suffix;
}

function to12to24_(hhmma) {
  var m = String(hhmma || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  var h = parseInt(m[1], 10);
  var minutes = m[2];
  var suffix = m[3].toUpperCase();
  if (suffix === 'PM' && h !== 12) h += 12;
  if (suffix === 'AM' && h === 12) h = 0;
  var hh = h < 10 ? '0' + h : String(h);
  return hh + ':' + minutes;
}

/* ---------- Dates and times (always India time) ----------
 * Inside this file a "Date" holds India wall-clock time in its UTC fields,
 * so 14:00 in Chennai is stored as 14:00 UTC. That keeps every comparison
 * and every formatted value in India time, like the old script time zone.
 */

function nowIst_() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

function formatDate_(date, pattern) {
  var d = date instanceof Date ? date : new Date(date);
  var Y = d.getUTCFullYear(), M = d.getUTCMonth() + 1, D = d.getUTCDate();
  var H = d.getUTCHours(), mi = d.getUTCMinutes(), s = d.getUTCSeconds();
  var h12 = H % 12 === 0 ? 12 : H % 12;
  return pattern.replace(/yyyy|MM|dd|HH|hh|mm|ss|a/g, function (t) {
    switch (t) {
      case 'yyyy': return String(Y);
      case 'MM': return pad_(M, 2);
      case 'dd': return pad_(D, 2);
      case 'HH': return pad_(H, 2);
      case 'hh': return pad_(h12, 2);
      case 'mm': return pad_(mi, 2);
      case 'ss': return pad_(s, 2);
      case 'a': return H < 12 ? 'AM' : 'PM';
    }
    return t;
  });
}

function nowString_() {
  return formatDate_(nowIst_(), CONFIG.DATE_FORMAT.TIMESTAMP);
}

function todayString_() {
  return formatDate_(nowIst_(), CONFIG.DATE_FORMAT.DATE);
}

function parseTimestamp_(value) {
  var m = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] || 0)));
}

/**
 * A date-time typed in the page (e.g. "2026-10-05T14:00" from a date-time
 * box) -> India wall-clock Date. Returns an invalid Date if not understood.
 */
function parseInputDateTime_(raw) {
  var s = String(raw || '').trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0)));
  var fromSheet = parseTimestamp_(s);
  if (fromSheet) return fromSheet;
  var d = new Date(s);
  if (isNaN(d.getTime())) return d;
  // Has its own time zone (e.g. ...Z): convert to India time
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(d.getTime() + IST_OFFSET_MS);
  return d;
}

function isoToDisplayDate_(iso) {
  var m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? (m[3] + '/' + m[2] + '/' + m[1]) : '';
}

function formatDuration_(ms) {
  if (typeof ms !== 'number' || isNaN(ms) || ms <= 0) return '-';

  var totalMinutes = Math.round(ms / 60000);
  var days = Math.floor(totalMinutes / 1440);
  var hours = Math.floor((totalMinutes % 1440) / 60);
  var minutes = totalMinutes % 60;

  if (days > 0) {
    return days + 'd' + (hours > 0 ? ' ' + hours + 'h' : '');
  }
  if (hours > 0) {
    return hours + 'h' + (minutes > 0 ? ' ' + minutes + 'm' : '');
  }
  return minutes + 'm';
}

/* ---------- ID generation ---------- */

function pad_(number, length) {
  var s = String(number);
  while (s.length < length) s = '0' + s;
  return s;
}

function nextIdFromValues_(cfg, values) {
  var year = formatDate_(nowIst_(), 'yyyy');
  var yearPrefix = cfg.prefix + year + '-';
  var max = 0;
  values.forEach(function (v) {
    var id = String(v === undefined || v === null ? '' : v).trim();
    if (id === '') return;
    if (cfg.useYear && id.indexOf(yearPrefix) !== 0) return;
    var m = id.match(/(\d+)$/);
    if (m) {
      var n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  });
  return (cfg.useYear ? yearPrefix : cfg.prefix) + pad_(max + 1, cfg.pad);
}

/**
 * Builds the next ID for a table, e.g. generateId_('USERS') -> U00004.
 * It reads the existing IDs, takes the highest number, and adds 1.
 */
function generateId_(entityKey) {
  var cfg = CONFIG.ID[entityKey];
  if (!cfg) throw new Error('Unknown ID type: ' + entityKey);

  var t = tableFor_(cfg.sheet);
  if (t.headers.indexOf(cfg.column) < 0) throw new Error('Column not found: ' + cfg.column + ' in ' + cfg.sheet);

  var id = nextIdFromValues_(cfg, t.rows.map(function (r) { return r[cfg.column]; }));
  DB.generated.push({ key: entityKey, id: id, sheet: cfg.sheet, column: cfg.column });
  return id;
}

/* =====================================================================
 * AUTH (same as Auth.gs; sessions are signed tokens instead of CacheService)
 * ===================================================================== */

function hashPassword_(plain) {
  return toHex_(sha256_(utf8_(String(plain))));
}

function findUserByLogin_(rows, identifier) {
  var id = String(identifier).trim().toLowerCase();
  if (id === '') return null;

  for (var i = 0; i < rows.length; i++) {
    var email = String(rows[i].Email || '').trim().toLowerCase();
    var code = String(rows[i].EmployeeCode || '').trim().toLowerCase();
    if ((email !== '' && email === id) || (code !== '' && code === id)) {
      return rows[i];
    }
  }
  return null;
}

function getMenuForRole_(role) {
  var keys = Object.keys(CONFIG.ROLES);
  for (var i = 0; i < keys.length; i++) {
    if (CONFIG.ROLES[keys[i]] === role) {
      return CONFIG.MENU[keys[i]] || [];
    }
  }
  return [];
}

function isValidRole_(role) {
  return Object.keys(CONFIG.ROLES).some(function (k) {
    return CONFIG.ROLES[k] === role;
  });
}

/* ---------- Session tokens ----------
 * token = base64url(JSON {u: user, exp}) + "." + HMAC-SHA256 signature.
 * Only the Worker knows TOKEN_SECRET, so the page cannot change its role.
 */

function createSessionToken_(sessionUser) {
  var payload = b64urlEncode_(utf8_(JSON.stringify({ u: sessionUser, exp: Date.now() + CONFIG.SESSION.TTL_SECONDS * 1000 })));
  return payload + '.' + toHex_(hmacSha256_(utf8_(DB.tokenSecret), utf8_(payload)));
}

function validateSession_(token) {
  var invalid = 'User session is invalid or expired. Please log in again.';
  if (!token || typeof token !== 'string') throw new Error(invalid);
  var parts = token.split('.');
  if (parts.length !== 2) throw new Error(invalid);

  var expected = toHex_(hmacSha256_(utf8_(DB.tokenSecret), utf8_(parts[0])));
  if (!safeEqual_(expected, parts[1])) throw new Error(invalid);

  var data;
  try { data = JSON.parse(fromUtf8_(b64urlDecode_(parts[0]))); } catch (e) { throw new Error(invalid); }
  if (!data || !data.u || !data.exp || Date.now() > data.exp) throw new Error(invalid);
  return data.u;
}

function safeEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Super_Admin can do everything an Admin can do (and more, e.g. the
// Management Report), so wherever Admin is allowed, Super_Admin is too.
function isAdminTier_(role) {
  return role === CONFIG.ROLES.ADMIN || role === CONFIG.ROLES.SUPER_ADMIN;
}

function requireRole_(user, allowedRoles) {
  var allowed = allowedRoles.indexOf(user.role) >= 0 ||
    (user.role === CONFIG.ROLES.SUPER_ADMIN && allowedRoles.indexOf(CONFIG.ROLES.ADMIN) >= 0);
  if (!allowed) {
    throw new Error('Access denied. You do not have permission for this action.');
  }
}

/**
 * The Drivers-sheet rows linked to a logged-in Driver user: the user's
 * EmployeeCode in the Users sheet must equal the driver's EmployeeCode in
 * the Drivers sheet.
 */
function driverIdsForUser_(user) {
  var code = String(user.employeeCode || '').trim().toLowerCase();
  if (!code) return [];
  return readTable_(CONFIG.SHEETS.DRIVERS).rows
    .filter(function (d) { return String(d.EmployeeCode || '').trim().toLowerCase() === code; })
    .map(function (d) { return String(d.DriverID).trim(); });
}

var DRIVER_NOT_LINKED_MSG_ = 'Your login is not linked to a driver record. Ask the Admin to put your Employee Code in the Drivers sheet (EmployeeCode column).';

// A Driver may only act on their own allocations. Returns an error text, or '' when fine.
function driverOwnershipError_(actor, alloc) {
  if (actor.role !== CONFIG.ROLES.DRIVER) return '';
  var ids = driverIdsForUser_(actor);
  if (!ids.length) return DRIVER_NOT_LINKED_MSG_;
  if (ids.indexOf(String(alloc.DriverID).trim()) < 0) return 'You can only update your own trips.';
  return '';
}

function secure_(token, allowedRoles, fn) {
  return handle_(function () {
    var user = validateSession_(token);
    if (allowedRoles && allowedRoles.length) {
      requireRole_(user, allowedRoles);
    }
    return fn(user);
  });
}

function login(identifier, password) {
  return handle_(function () {
    identifier = String(identifier || '').trim().substring(0, 100);
    password = String(password || '');

    if (identifier === '' || password === '') {
      return fail_('Enter your Email or Employee Code, and your password.');
    }

    var failKey = identifier.toLowerCase();
    var entry = loginFails[failKey];
    if (entry && Date.now() > entry.until) { delete loginFails[failKey]; entry = null; }
    var fails = entry ? entry.count : 0;
    if (fails >= CONFIG.SESSION.MAX_FAILED_LOGINS) {
      return fail_('Too many failed attempts. Try again in 10 minutes.');
    }

    var table = readTable_(CONFIG.SHEETS.USERS);
    var user = findUserByLogin_(table.rows, identifier);

    var storedHash = user ? String(user.PasswordHash || '').trim().toLowerCase() : '';
    if (!user || storedHash === '' || storedHash !== hashPassword_(password)) {
      loginFails[failKey] = { count: fails + 1, until: Date.now() + CONFIG.SESSION.LOCK_SECONDS * 1000 };
      return fail_('Invalid login or password.');
    }
    delete loginFails[failKey];

    if (String(user.Status).trim().toLowerCase() !== CONFIG.STATUS.USER.ACTIVE.toLowerCase()) {
      return fail_('This account is not active. Contact the administrator.');
    }
    if (!isValidRole_(user.Role)) {
      return fail_('This account has no valid role. Contact the administrator.');
    }

    var sessionUser = {
      userId: user.UserID,
      employeeCode: String(user.EmployeeCode),
      name: user.Name,
      email: user.Email || '',
      role: user.Role,
      department: user.Department || ''
    };

    return ok_('Login successful', {
      token: createSessionToken_(sessionUser),
      user: sessionUser,
      menu: getMenuForRole_(sessionUser.role)
    });
  });
}

function getCurrentUser(token) {
  return secure_(token, null, function (user) {
    return ok_('Session is valid', { user: user, menu: getMenuForRole_(user.role) });
  });
}

// The page forgets the token; a signed token simply expires after 6 hours.
function logout(token) {
  return handle_(function () {
    return ok_('Logged out', null);
  });
}

/* =====================================================================
 * DASHBOARD (same as Dashboard.gs)
 * ===================================================================== */

function statusIs_(row, value) {
  return String(row.Status || '').trim().toLowerCase() === String(value).trim().toLowerCase();
}

function statusIn_(row, values) {
  return values.some(function (v) { return statusIs_(row, v); });
}

function countWhere_(rows, predicate) {
  var n = 0;
  for (var i = 0; i < rows.length; i++) {
    if (predicate(rows[i])) n++;
  }
  return n;
}

function toIsoDate_(value) {
  if (value === null || value === undefined || value === '') return '';

  if (Object.prototype.toString.call(value) === '[object Date]') {
    return formatDate_(value, 'yyyy-MM-dd');
  }

  var s = String(value).trim();
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];

  var dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return dmy[3] + '-' + pad_(dmy[2], 2) + '-' + pad_(dmy[1], 2);

  return '';
}

function getDashboard(token) {
  return secure_(token, null, function (user) {
    var data = (user.role === CONFIG.ROLES.GV_USER)
      ? buildUserDashboard_(user)
      : (user.role === CONFIG.ROLES.DRIVER)
        ? buildDriverDashboard_(user)
        : buildFleetDashboard_();
    data.generatedAt = nowString_();
    return ok_('Dashboard loaded', data);
  });
}

function buildFleetDashboard_() {
  var S = CONFIG.STATUS;
  var requests = readTable_(CONFIG.SHEETS.GV_REQUESTS).rows;
  var allocations = readTable_(CONFIG.SHEETS.ALLOCATIONS).rows;
  var vehicles = readTable_(CONFIG.SHEETS.VEHICLES).rows;
  var drivers = readTable_(CONFIG.SHEETS.DRIVERS).rows;

  var today = formatDate_(nowIst_(), 'yyyy-MM-dd');

  var pendingRequests = countWhere_(requests, function (r) {
    return statusIs_(r, S.REQUEST.PENDING);
  });

  var activeAllocations = countWhere_(allocations, function (a) {
    return statusIn_(a, [S.ALLOCATION.ALLOCATED, S.ALLOCATION.IN_PROGRESS]);
  });

  var availableVehicles = countWhere_(vehicles, function (v) {
    return statusIs_(v, S.VEHICLE.AVAILABLE);
  });

  var activeDrivers = countWhere_(drivers, function (d) {
    var status = String(d.Status || '').trim();
    return status !== '' && !statusIn_(d, [S.DRIVER.LEAVE, S.DRIVER.INACTIVE]);
  });

  var todaysTrips = countWhere_(allocations, function (a) {
    return !statusIs_(a, S.ALLOCATION.CANCELLED) &&
      toIsoDate_(a.PlannedStartDateTime) === today;
  });

  return {
    scope: 'fleet',
    primary: [
      { label: 'Pending Requests', value: pendingRequests, hint: 'Waiting for the Fleet Department', attention: true },
      { label: 'Active Allocations', value: activeAllocations, hint: 'Allocated or In Progress' },
      { label: 'Available Vehicles', value: availableVehicles, hint: 'Ready to allocate' },
      { label: 'Active Drivers', value: activeDrivers, hint: 'Not on Leave or Inactive' }
    ],
    secondaryTitle: 'Fleet at a glance',
    secondary: [
      { label: 'Total Vehicles', value: vehicles.length },
      { label: 'Vehicles On Trip', value: countWhere_(vehicles, function (v) { return statusIs_(v, S.VEHICLE.ON_TRIP); }) },
      { label: 'Maintenance Vehicles', value: countWhere_(vehicles, function (v) { return statusIs_(v, S.VEHICLE.MAINTENANCE); }) },
      { label: 'Total Drivers', value: drivers.length },
      { label: 'Drivers On Trip', value: countWhere_(drivers, function (d) { return statusIs_(d, S.DRIVER.ON_TRIP); }) },
      { label: "Today's Trips", value: todaysTrips },
      { label: 'Completed Trips', value: countWhere_(allocations, function (a) { return statusIs_(a, S.ALLOCATION.COMPLETED); }) }
    ]
  };
}

function buildDriverDashboard_(user) {
  var S = CONFIG.STATUS.ALLOCATION;
  var ids = driverIdsForUser_(user);
  var mine = readTable_(CONFIG.SHEETS.ALLOCATIONS).rows.filter(function (a) {
    return ids.indexOf(String(a.DriverID).trim()) >= 0;
  });
  var today = formatDate_(nowIst_(), 'yyyy-MM-dd');
  return {
    scope: 'driver',
    primary: [
      { label: 'To Reach', value: countWhere_(mine, function (a) { return statusIs_(a, S.ALLOCATED); }), hint: 'Allocated - not yet reached', attention: true },
      { label: 'Reached / Loading', value: countWhere_(mine, function (a) { return statusIn_(a, [S.REACHED, S.LOADING]); }), hint: 'At the pickup point' },
      { label: 'On Trip', value: countWhere_(mine, function (a) { return statusIs_(a, S.ON_TRIP); }), hint: 'Trip in progress' },
      { label: 'Completed', value: countWhere_(mine, function (a) { return statusIs_(a, S.COMPLETED); }), hint: 'Trips finished' }
    ],
    secondaryTitle: 'Your trips at a glance',
    secondary: ids.length ? [
      { label: 'Total Trips', value: mine.length },
      { label: "Today's Trips", value: countWhere_(mine, function (a) { return !statusIs_(a, S.CANCELLED) && toIsoDate_(a.PlannedStartDateTime) === today; }) },
      { label: 'Cancelled', value: countWhere_(mine, function (a) { return statusIs_(a, S.CANCELLED); }) }
    ] : [
      { label: 'Not linked', value: 'Ask Admin to link your Employee Code in the Drivers sheet' }
    ]
  };
}

function buildUserDashboard_(user) {
  var S = CONFIG.STATUS;
  var all = readTable_(CONFIG.SHEETS.GV_REQUESTS).rows;

  var mine = all.filter(function (r) {
    return String(r.RequestedBy || '').trim() === String(user.userId).trim();
  });

  return {
    scope: 'user',
    primary: [
      { label: 'Pending', value: countWhere_(mine, function (r) { return statusIs_(r, S.REQUEST.PENDING); }), hint: 'Waiting for the Fleet Department', attention: true },
      { label: 'Allocated', value: countWhere_(mine, function (r) { return statusIs_(r, S.REQUEST.ALLOCATED); }), hint: 'Vehicle and driver assigned' },
      { label: 'In Progress', value: countWhere_(mine, function (r) { return statusIs_(r, S.REQUEST.IN_PROGRESS); }), hint: 'Trip has started' },
      { label: 'Completed', value: countWhere_(mine, function (r) { return statusIs_(r, S.REQUEST.COMPLETED); }), hint: 'Trip finished' }
    ],
    secondaryTitle: 'Your requests at a glance',
    secondary: [
      { label: 'Total Requests', value: mine.length },
      { label: 'Approved', value: countWhere_(mine, function (r) { return statusIs_(r, S.REQUEST.APPROVED); }) },
      { label: 'Cancelled', value: countWhere_(mine, function (r) { return statusIs_(r, S.REQUEST.CANCELLED); }) },
      { label: 'Rejected', value: countWhere_(mine, function (r) { return statusIs_(r, S.REQUEST.REJECTED); }) }
    ]
  };
}

/* =====================================================================
 * USERS (same as Users.gs)
 * ===================================================================== */

function rolesList_() {
  return Object.keys(CONFIG.ROLES).map(function (k) { return CONFIG.ROLES[k]; });
}

function findUserRow_(rows, userId) {
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].UserID).trim() === String(userId).trim()) return rows[i];
  }
  return null;
}

function toUserView_(r, deptMap) {
  return {
    userId: r.UserID,
    employeeCode: r.EmployeeCode,
    name: r.Name,
    email: r.Email || '',
    mobile: r.Mobile || '',
    role: r.Role,
    departmentId: r.Department || '',
    department: (deptMap && deptMap[r.Department]) || r.Department || '',
    status: r.Status,
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt
  };
  // PasswordHash is never sent to the page.
}

function getUsers(token) {
  return secure_(token, [CONFIG.ROLES.ADMIN], function (actor) {
    var deptMap = buildDepartmentNameMap_();
    var rows = readTable_(CONFIG.SHEETS.USERS).rows;
    var departments = readTable_(CONFIG.SHEETS.DEPARTMENT_MASTER).rows.map(function (d) {
      return { id: d.DepartmentID, name: d.DepartmentName, isActive: isActiveFlag_(d.IsActive) };
    });
    return ok_('Users loaded', {
      users: rows.map(function (r) { return toUserView_(r, deptMap); }),
      roles: rolesList_().filter(function (r) { return actor.role === CONFIG.ROLES.SUPER_ADMIN || r !== CONFIG.ROLES.SUPER_ADMIN; }),
      departments: departments
    });
  });
}

function createUser(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN], function (adminUser) {
    return withLock_(function () {
      var employeeCode = String((input && input.employeeCode) || '').trim();
      var name = String((input && input.name) || '').trim();
      var email = String((input && input.email) || '').trim();
      var mobile = String((input && input.mobile) || '').trim();
      var role = String((input && input.role) || '').trim();
      var departmentId = String((input && input.departmentId) || '').trim();
      var password = String((input && input.password) || '');

      var missing = [];
      if (!employeeCode) missing.push('Employee Code');
      if (!name) missing.push('Name');
      if (!role) missing.push('Role');
      if (password.length < 6) missing.push('Password (at least 6 characters)');
      if (missing.length) return fail_('Missing or invalid: ' + missing.join(', '));

      if (mobile && mobile.replace(/[^0-9]/g, '').length < 7) {
        return fail_('Mobile number looks too short.');
      }
      if (!isValidRole_(role)) {
        return fail_('Role must be one of: ' + rolesList_().join(', '));
      }
      if (role === CONFIG.ROLES.SUPER_ADMIN && adminUser.role !== CONFIG.ROLES.SUPER_ADMIN) {
        return fail_('Only a Super Admin can create a Super Admin user.');
      }
      if (departmentId) {
        var deptRows = readTable_(CONFIG.SHEETS.DEPARTMENT_MASTER).rows;
        if (!findDepartmentRow_(deptRows, departmentId)) {
          return fail_('That department was not found. Pick one from the list.');
        }
      }

      var table = readTable_(CONFIG.SHEETS.USERS);
      var codeLower = employeeCode.toLowerCase();
      var emailLower = email.toLowerCase();
      var duplicate = table.rows.some(function (r) {
        var rowCode = String(r.EmployeeCode || '').trim().toLowerCase();
        var rowEmail = String(r.Email || '').trim().toLowerCase();
        return rowCode === codeLower || (emailLower !== '' && rowEmail === emailLower);
      });
      if (duplicate) return fail_('That Employee Code or Email is already used by another user.');

      var userId = generateId_('USERS');
      var now = nowString_();
      appendRow_(CONFIG.SHEETS.USERS, {
        UserID: userId,
        EmployeeCode: employeeCode,
        Name: name,
        Email: email,
        Mobile: mobile,
        PasswordHash: hashPassword_(password),
        Role: role,
        Department: departmentId,
        Status: CONFIG.STATUS.USER.ACTIVE,
        CreatedAt: now,
        UpdatedAt: now,
        UpdatedBy: adminUser.userId
      }, ['PasswordHash']);

      return ok_('User created', { userId: userId });
    });
  });
}

function updateUser(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN], function (adminUser) {
    return withLock_(function () {
      var userId = String((input && input.userId) || '').trim();
      if (!userId) return fail_('Missing user id.');

      var table = readTable_(CONFIG.SHEETS.USERS);
      var target = findUserRow_(table.rows, userId);
      if (!target) return fail_('User not found.');
      if ((target.Role === CONFIG.ROLES.SUPER_ADMIN || String((input && input.role) || '').trim() === CONFIG.ROLES.SUPER_ADMIN) &&
          adminUser.role !== CONFIG.ROLES.SUPER_ADMIN) {
        return fail_('Only a Super Admin can change a Super Admin user.');
      }

      var name = String((input && input.name) || '').trim();
      var email = String((input && input.email) || '').trim();
      var mobile = String((input && input.mobile) || '').trim();
      var role = String((input && input.role) || '').trim();
      var departmentId = String((input && input.departmentId) || '').trim();
      var status = String((input && input.status) || '').trim();

      if (!name) return fail_('Name is required.');
      if (mobile && mobile.replace(/[^0-9]/g, '').length < 7) {
        return fail_('Mobile number looks too short.');
      }
      if (!isValidRole_(role)) {
        return fail_('Role must be one of: ' + rolesList_().join(', '));
      }
      var validStatuses = [CONFIG.STATUS.USER.ACTIVE, CONFIG.STATUS.USER.INACTIVE];
      if (validStatuses.indexOf(status) < 0) {
        return fail_('Status must be one of: ' + validStatuses.join(', '));
      }
      if (departmentId) {
        var deptRows = readTable_(CONFIG.SHEETS.DEPARTMENT_MASTER).rows;
        if (!findDepartmentRow_(deptRows, departmentId)) {
          return fail_('That department was not found. Pick one from the list.');
        }
      }

      var emailLower = email.toLowerCase();
      var duplicate = table.rows.some(function (r) {
        if (String(r.UserID).trim() === userId) return false;
        var rowEmail = String(r.Email || '').trim().toLowerCase();
        return emailLower !== '' && rowEmail === emailLower;
      });
      if (duplicate) return fail_('That Email is already used by another user.');

      if (adminUser.userId === userId && role !== adminUser.role) {
        return fail_('You cannot change your own role.');
      }
      if (adminUser.userId === userId && status !== CONFIG.STATUS.USER.ACTIVE) {
        return fail_('You cannot deactivate your own account.');
      }

      updateRow_(CONFIG.SHEETS.USERS, target._row, {
        Name: name,
        Email: email,
        Mobile: mobile,
        Role: role,
        Department: departmentId,
        Status: status,
        UpdatedAt: nowString_(),
        UpdatedBy: adminUser.userId
      });

      return ok_('User updated', null);
    });
  });
}

function setUserPassword(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN], function (adminUser) {
    return withLock_(function () {
      var userId = String((input && input.userId) || '').trim();
      var password = String((input && input.password) || '');
      if (!userId) return fail_('Missing user id.');
      if (password.length < 6) return fail_('Password must be at least 6 characters.');

      var table = readTable_(CONFIG.SHEETS.USERS);
      var target = findUserRow_(table.rows, userId);
      if (!target) return fail_('User not found.');
      if (target.Role === CONFIG.ROLES.SUPER_ADMIN && adminUser.role !== CONFIG.ROLES.SUPER_ADMIN) {
        return fail_('Only a Super Admin can reset a Super Admin password.');
      }

      updateRow_(CONFIG.SHEETS.USERS, target._row, {
        PasswordHash: hashPassword_(password),
        UpdatedAt: nowString_(),
        UpdatedBy: adminUser.userId
      }, ['PasswordHash']);

      return ok_('Password updated', null);
    });
  });
}

/**
 * Any logged-in user changes their own password: current password must be
 * right, the new one at least 6 characters and typed the same twice.
 */
function changeMyPassword(token, input) {
  return secure_(token, null, function (user) {
    return withLock_(function () {
      var currentPassword = String((input && input.currentPassword) || '');
      var newPassword = String((input && input.newPassword) || '');
      var confirmPassword = String((input && input.confirmPassword) || '');

      if (!currentPassword || !newPassword || !confirmPassword) {
        return fail_('Fill in all three password boxes.');
      }
      if (newPassword.length < 6) return fail_('New password must be at least 6 characters.');
      if (newPassword !== confirmPassword) return fail_('New password and Confirm password do not match.');
      if (newPassword === currentPassword) return fail_('New password must be different from the current one.');

      var table = readTable_(CONFIG.SHEETS.USERS);
      var target = findUserRow_(table.rows, user.userId);
      if (!target) return fail_('Your account was not found.');

      var storedHash = String(target.PasswordHash || '').trim().toLowerCase();
      if (!storedHash || storedHash !== hashPassword_(currentPassword)) {
        return fail_('Current password is not correct.');
      }

      updateRow_(CONFIG.SHEETS.USERS, target._row, {
        PasswordHash: hashPassword_(newPassword),
        UpdatedAt: nowString_(),
        UpdatedBy: user.userId
      }, ['PasswordHash']);

      return ok_('Password changed', null);
    });
  });
}

/* =====================================================================
 * VEHICLES (same as Vehicles.gs)
 * ===================================================================== */

function vehicleStatusList_() {
  return Object.keys(CONFIG.STATUS.VEHICLE).map(function (k) { return CONFIG.STATUS.VEHICLE[k]; });
}

function findVehicleRow_(rows, vehicleId) {
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].VehicleID).trim() === String(vehicleId).trim()) return rows[i];
  }
  return null;
}

function toVehicleView_(r) {
  return {
    vehicleId: r.VehicleID,
    vehicleNo: r.VehicleNo,
    type: r.Type,
    subType: r.SubType || '',
    capacity: r.Capacity,
    currentLocation: r.CurrentLocation || '',
    status: r.Status,
    activeFrom: r.ActiveFrom || '',
    remarks: r.Remarks || '',
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt
  };
}

function getVehicles(token) {
  return secure_(token, [CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER], function () {
    var rows = readTable_(CONFIG.SHEETS.VEHICLES).rows;
    var locations = readTable_(CONFIG.SHEETS.LOCATION_MASTER).rows
      .filter(function (r) { return isActiveFlag_(r.IsActive) && String(r.LocationName || '').trim() !== ''; })
      .map(function (r) { return String(r.LocationName).trim(); });
    return ok_('Vehicles loaded', {
      vehicles: rows.map(toVehicleView_),
      statuses: vehicleStatusList_(),
      types: CONFIG.VEHICLE_TYPES,
      locations: locations
    });
  });
}

/**
 * Matches a typed value against a fixed list, ignoring capitals.
 * Returns the list's own spelling, or '' if it is not in the list.
 */
function pickFromList_(value, list) {
  var v = String(value || '').trim().toLowerCase();
  for (var i = 0; i < list.length; i++) {
    if (String(list[i]).trim().toLowerCase() === v) return String(list[i]).trim();
  }
  return '';
}

function readVehicleInput_(input, table, ignoreVehicleId) {
  var vehicleNo = String((input && input.vehicleNo) || '').trim();
  var type = String((input && input.type) || '').trim();
  var subType = String((input && input.subType) || '').trim();
  var capacityRaw = String((input && input.capacity) || '').trim();
  var currentLocation = String((input && input.currentLocation) || '').trim();
  var status = String((input && input.status) || '').trim();
  var activeFrom = String((input && input.activeFrom) || '').trim();
  var remarks = String((input && input.remarks) || '').trim();

  var missing = [];
  if (!vehicleNo) missing.push('Vehicle No');
  if (!type) missing.push('Type');
  if (!capacityRaw) missing.push('Capacity');
  if (missing.length) return { error: 'Missing: ' + missing.join(', ') };

  var capacity = Number(capacityRaw);
  if (!isFinite(capacity) || capacity <= 0 || Math.floor(capacity) !== capacity) {
    return { error: 'Capacity must be a whole number greater than 0.' };
  }

  // An existing vehicle may keep an older Type / Location it already has.
  var existing = ignoreVehicleId ? findVehicleRow_(table.rows, ignoreVehicleId) : null;

  var typeOk = pickFromList_(type, CONFIG.VEHICLE_TYPES);
  if (typeOk) {
    type = typeOk;
  } else if (!(existing && String(existing.Type || '').trim() === type)) {
    return { error: 'Type must be one of: ' + CONFIG.VEHICLE_TYPES.join(', ') };
  }

  if (currentLocation) {
    var activeLocations = readTable_(CONFIG.SHEETS.LOCATION_MASTER).rows
      .filter(function (r) { return isActiveFlag_(r.IsActive); })
      .map(function (r) { return String(r.LocationName || '').trim(); });
    var locOk = pickFromList_(currentLocation, activeLocations);
    if (locOk) {
      currentLocation = locOk;
    } else if (!(existing && String(existing.CurrentLocation || '').trim() === currentLocation)) {
      return { error: 'Pick the Current Location from the list (Location Master).' };
    }
  }

  if (vehicleStatusList_().indexOf(status) < 0) {
    return { error: 'Status must be one of: ' + vehicleStatusList_().join(', ') };
  }

  var noLower = vehicleNo.toLowerCase();
  var duplicate = table.rows.some(function (r) {
    if (ignoreVehicleId && String(r.VehicleID).trim() === ignoreVehicleId) return false;
    return String(r.VehicleNo || '').trim().toLowerCase() === noLower;
  });
  if (duplicate) return { error: 'That Vehicle No is already used by another vehicle.' };

  return {
    values: {
      VehicleNo: vehicleNo,
      Type: type,
      SubType: subType,
      Capacity: capacity,
      CurrentLocation: currentLocation,
      Status: status,
      ActiveFrom: activeFrom ? isoToDisplayDate_(activeFrom) : '',
      Remarks: remarks
    }
  };
}

function createVehicle(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER], function (actorUser) {
    return withLock_(function () {
      var table = readTable_(CONFIG.SHEETS.VEHICLES);
      // A new vehicle always starts as Available, whatever the page sends.
      var newInput = Object.assign({}, input || {}, { status: CONFIG.STATUS.VEHICLE.AVAILABLE });
      var parsed = readVehicleInput_(newInput, table, null);
      if (parsed.error) return fail_(parsed.error);

      var vehicleId = generateId_('VEHICLES');
      var now = nowString_();
      var row = parsed.values;
      row.VehicleID = vehicleId;
      row.CreatedAt = now;
      row.UpdatedAt = now;
      row.UpdatedBy = actorUser.userId;

      appendRow_(CONFIG.SHEETS.VEHICLES, row);
      return ok_('Vehicle created', { vehicleId: vehicleId });
    });
  });
}

function updateVehicle(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER], function (actorUser) {
    return withLock_(function () {
      var vehicleId = String((input && input.vehicleId) || '').trim();
      if (!vehicleId) return fail_('Missing vehicle id.');

      var table = readTable_(CONFIG.SHEETS.VEHICLES);
      var target = findVehicleRow_(table.rows, vehicleId);
      if (!target) return fail_('Vehicle not found.');

      var parsed = readVehicleInput_(input, table, vehicleId);
      if (parsed.error) return fail_(parsed.error);

      var changes = parsed.values;
      changes.UpdatedAt = nowString_();
      changes.UpdatedBy = actorUser.userId;
      updateRow_(CONFIG.SHEETS.VEHICLES, target._row, changes);

      return ok_('Vehicle updated', null);
    });
  });
}

/* =====================================================================
 * DRIVERS (same as Drivers.gs)
 * ===================================================================== */

function driverStatusList_() {
  return Object.keys(CONFIG.STATUS.DRIVER).map(function (k) { return CONFIG.STATUS.DRIVER[k]; });
}

function findDriverRow_(rows, driverId) {
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].DriverID).trim() === String(driverId).trim()) return rows[i];
  }
  return null;
}

function toDriverView_(r) {
  return {
    driverId: r.DriverID,
    employeeCode: r.EmployeeCode || '',
    driverName: r.DriverName,
    mobile: r.Mobile,
    licenseNo: r.LicenseNo,
    licenseExpiry: r.LicenseExpiry || '',
    status: r.Status,
    remarks: r.Remarks || '',
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt
  };
}

function getDrivers(token) {
  return secure_(token, [CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER], function () {
    var rows = readTable_(CONFIG.SHEETS.DRIVERS).rows;
    return ok_('Drivers loaded', {
      drivers: rows.map(toDriverView_),
      statuses: driverStatusList_()
    });
  });
}

function readDriverInput_(input, table, ignoreDriverId) {
  var employeeCode = String((input && input.employeeCode) || '').trim();
  var driverName = String((input && input.driverName) || '').trim();
  var mobile = String((input && input.mobile) || '').trim();
  var licenseNo = String((input && input.licenseNo) || '').trim();
  var licenseExpiry = String((input && input.licenseExpiry) || '').trim();
  var status = String((input && input.status) || '').trim();
  var remarks = String((input && input.remarks) || '').trim();

  var missing = [];
  if (!driverName) missing.push('Driver Name');
  if (!mobile) missing.push('Mobile');
  if (!licenseNo) missing.push('License No');
  if (!licenseExpiry) missing.push('License Expiry');
  if (missing.length) return { error: 'Missing: ' + missing.join(', ') };

  if (mobile.replace(/[^0-9]/g, '').length < 7) {
    return { error: 'Mobile number looks too short.' };
  }
  if (driverStatusList_().indexOf(status) < 0) {
    return { error: 'Status must be one of: ' + driverStatusList_().join(', ') };
  }

  var licenseLower = licenseNo.toLowerCase();
  var duplicateLicense = table.rows.some(function (r) {
    if (ignoreDriverId && String(r.DriverID).trim() === ignoreDriverId) return false;
    return String(r.LicenseNo || '').trim().toLowerCase() === licenseLower;
  });
  if (duplicateLicense) return { error: 'That License No is already used by another driver.' };

  if (employeeCode) {
    var codeLower = employeeCode.toLowerCase();
    var duplicateCode = table.rows.some(function (r) {
      if (ignoreDriverId && String(r.DriverID).trim() === ignoreDriverId) return false;
      var rowCode = String(r.EmployeeCode || '').trim().toLowerCase();
      return rowCode !== '' && rowCode === codeLower;
    });
    if (duplicateCode) return { error: 'That Employee Code is already used by another driver.' };
  }

  return {
    values: {
      EmployeeCode: employeeCode,
      DriverName: driverName,
      Mobile: mobile,
      LicenseNo: licenseNo,
      LicenseExpiry: isoToDisplayDate_(licenseExpiry) || licenseExpiry,
      Status: status,
      Remarks: remarks
    }
  };
}

function createDriver(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER], function (actorUser) {
    return withLock_(function () {
      var table = readTable_(CONFIG.SHEETS.DRIVERS);
      var parsed = readDriverInput_(input, table, null);
      if (parsed.error) return fail_(parsed.error);

      var driverId = generateId_('DRIVERS');
      var now = nowString_();
      var row = parsed.values;
      row.DriverID = driverId;
      row.CreatedAt = now;
      row.UpdatedAt = now;
      row.UpdatedBy = actorUser.userId;

      appendRow_(CONFIG.SHEETS.DRIVERS, row);
      return ok_('Driver created', { driverId: driverId });
    });
  });
}

function updateDriver(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER], function (actorUser) {
    return withLock_(function () {
      var driverId = String((input && input.driverId) || '').trim();
      if (!driverId) return fail_('Missing driver id.');

      var table = readTable_(CONFIG.SHEETS.DRIVERS);
      var target = findDriverRow_(table.rows, driverId);
      if (!target) return fail_('Driver not found.');

      var parsed = readDriverInput_(input, table, driverId);
      if (parsed.error) return fail_(parsed.error);

      var changes = parsed.values;
      changes.UpdatedAt = nowString_();
      changes.UpdatedBy = actorUser.userId;
      updateRow_(CONFIG.SHEETS.DRIVERS, target._row, changes);

      return ok_('Driver updated', null);
    });
  });
}

/* =====================================================================
 * MASTERS - Departments and Locations (same as Masters.gs)
 * ===================================================================== */

function findDepartmentRow_(rows, departmentId) {
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].DepartmentID).trim() === String(departmentId).trim()) return rows[i];
  }
  return null;
}

function findLocationRow_(rows, locationId) {
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].LocationID).trim() === String(locationId).trim()) return rows[i];
  }
  return null;
}

function buildDepartmentNameMap_() {
  var rows = readTable_(CONFIG.SHEETS.DEPARTMENT_MASTER).rows;
  var map = {};
  rows.forEach(function (r) { map[r.DepartmentID] = r.DepartmentName; });
  return map;
}

function toDepartmentView_(r) {
  return {
    departmentId: r.DepartmentID,
    departmentName: r.DepartmentName,
    isActive: isActiveFlag_(r.IsActive),
    remarks: r.Remarks || '',
    createdAt: r.CreatedAt || '',
    createdBy: r.CreatedBy || '',
    updatedAt: r.UpdatedAt || '',
    updatedBy: r.UpdatedBy || ''
  };
}

function toLocationView_(r) {
  return {
    locationId: r.LocationID,
    locationName: r.LocationName,
    locationCode: r.LocationCode || '',
    locationType: r.LocationType || '',
    address: r.Address || '',
    isActive: isActiveFlag_(r.IsActive),
    remarks: r.Remarks || '',
    createdAt: r.CreatedAt || '',
    createdBy: r.CreatedBy || '',
    updatedAt: r.UpdatedAt || '',
    updatedBy: r.UpdatedBy || ''
  };
}

function getDepartments(token) {
  return secure_(token, [CONFIG.ROLES.ADMIN], function () {
    var rows = readTable_(CONFIG.SHEETS.DEPARTMENT_MASTER).rows;
    return ok_('Departments loaded', { departments: rows.map(toDepartmentView_) });
  });
}

function readDepartmentInput_(input, table, ignoreDepartmentId) {
  var name = String((input && input.departmentName) || '').trim();
  var remarks = String((input && input.remarks) || '').trim();
  var isActive = (input && input.isActive !== undefined) ? !!input.isActive : true;

  if (!name) return { error: 'Department Name is required.' };

  var nameLower = name.toLowerCase();
  var duplicate = table.rows.some(function (r) {
    if (ignoreDepartmentId && String(r.DepartmentID).trim() === ignoreDepartmentId) return false;
    return String(r.DepartmentName || '').trim().toLowerCase() === nameLower;
  });
  if (duplicate) return { error: 'That Department Name already exists.' };

  return { values: { DepartmentName: name, Remarks: remarks, IsActive: isActive } };
}

function createDepartment(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN], function (adminUser) {
    return withLock_(function () {
      var table = readTable_(CONFIG.SHEETS.DEPARTMENT_MASTER);
      var parsed = readDepartmentInput_(input, table, null);
      if (parsed.error) return fail_(parsed.error);

      var departmentId = generateId_('DEPARTMENTS');
      var now = nowString_();
      var row = parsed.values;
      row.DepartmentID = departmentId;
      row.CreatedAt = now;
      row.CreatedBy = adminUser.userId;
      row.UpdatedAt = now;
      row.UpdatedBy = adminUser.userId;

      appendRow_(CONFIG.SHEETS.DEPARTMENT_MASTER, row);
      return ok_('Department created', { departmentId: departmentId });
    });
  });
}

function updateDepartment(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN], function (adminUser) {
    return withLock_(function () {
      var departmentId = String((input && input.departmentId) || '').trim();
      if (!departmentId) return fail_('Missing department id.');

      var table = readTable_(CONFIG.SHEETS.DEPARTMENT_MASTER);
      var target = findDepartmentRow_(table.rows, departmentId);
      if (!target) return fail_('Department not found.');

      var parsed = readDepartmentInput_(input, table, departmentId);
      if (parsed.error) return fail_(parsed.error);

      var changes = parsed.values;
      changes.UpdatedAt = nowString_();
      changes.UpdatedBy = adminUser.userId;
      updateRow_(CONFIG.SHEETS.DEPARTMENT_MASTER, target._row, changes);

      return ok_('Department updated', null);
    });
  });
}

function getLocations(token) {
  return secure_(token, [CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER], function () {
    var rows = readTable_(CONFIG.SHEETS.LOCATION_MASTER).rows;
    return ok_('Locations loaded', { locations: rows.map(toLocationView_) });
  });
}

function readLocationInput_(input, table, ignoreLocationId) {
  var name = String((input && input.locationName) || '').trim();
  var code = String((input && input.locationCode) || '').trim();
  var type = String((input && input.locationType) || '').trim();
  var address = String((input && input.address) || '').trim();
  var remarks = String((input && input.remarks) || '').trim();
  var isActive = (input && input.isActive !== undefined) ? !!input.isActive : true;

  if (!name) return { error: 'Location Name is required.' };

  var nameLower = name.toLowerCase();
  var duplicateName = table.rows.some(function (r) {
    if (ignoreLocationId && String(r.LocationID).trim() === ignoreLocationId) return false;
    return String(r.LocationName || '').trim().toLowerCase() === nameLower;
  });
  if (duplicateName) return { error: 'That Location Name already exists.' };

  if (code) {
    var codeLower = code.toLowerCase();
    var duplicateCode = table.rows.some(function (r) {
      if (ignoreLocationId && String(r.LocationID).trim() === ignoreLocationId) return false;
      var rowCode = String(r.LocationCode || '').trim().toLowerCase();
      return rowCode !== '' && rowCode === codeLower;
    });
    if (duplicateCode) return { error: 'That Location Code is already used by another location.' };
  }

  return {
    values: {
      LocationName: name,
      LocationCode: code,
      LocationType: type,
      Address: address,
      Remarks: remarks,
      IsActive: isActive
    }
  };
}

function createLocation(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER], function (adminUser) {
    return withLock_(function () {
      var table = readTable_(CONFIG.SHEETS.LOCATION_MASTER);
      var parsed = readLocationInput_(input, table, null);
      if (parsed.error) return fail_(parsed.error);

      var locationId = generateId_('LOCATIONS');
      var now = nowString_();
      var row = parsed.values;
      row.LocationID = locationId;
      row.CreatedAt = now;
      row.CreatedBy = adminUser.userId;
      row.UpdatedAt = now;
      row.UpdatedBy = adminUser.userId;

      appendRow_(CONFIG.SHEETS.LOCATION_MASTER, row);
      return ok_('Location created', { locationId: locationId });
    });
  });
}

function updateLocation(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER], function (adminUser) {
    return withLock_(function () {
      var locationId = String((input && input.locationId) || '').trim();
      if (!locationId) return fail_('Missing location id.');

      var table = readTable_(CONFIG.SHEETS.LOCATION_MASTER);
      var target = findLocationRow_(table.rows, locationId);
      if (!target) return fail_('Location not found.');

      var parsed = readLocationInput_(input, table, locationId);
      if (parsed.error) return fail_(parsed.error);

      var changes = parsed.values;
      changes.UpdatedAt = nowString_();
      changes.UpdatedBy = adminUser.userId;
      updateRow_(CONFIG.SHEETS.LOCATION_MASTER, target._row, changes);

      return ok_('Location updated', null);
    });
  });
}

/* =====================================================================
 * GV REQUESTS (same as GvRequests.gs)
 * ===================================================================== */

function requestStatusList_() {
  return Object.keys(CONFIG.STATUS.REQUEST).map(function (k) { return CONFIG.STATUS.REQUEST[k]; });
}

function findRequestRow_(rows, requestId) {
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].RequestID).trim() === String(requestId).trim()) return rows[i];
  }
  return null;
}

function isActiveFlag_(value) {
  var s = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  return s === '' || s === 'true' || s === 'yes' || s === '1';
}

function buildUserNameMap_() {
  var rows = readTable_(CONFIG.SHEETS.USERS).rows;
  var map = {};
  rows.forEach(function (r) { map[r.UserID] = r.Name; });
  return map;
}

function buildUserMobileMap_() {
  var rows = readTable_(CONFIG.SHEETS.USERS).rows;
  var map = {};
  rows.forEach(function (r) { map[r.UserID] = r.Mobile || ''; });
  return map;
}

function buildLocationNameMap_() {
  var rows = readTable_(CONFIG.SHEETS.LOCATION_MASTER).rows;
  var map = {};
  rows.forEach(function (r) { map[r.LocationID] = r.LocationName; });
  return map;
}

function toRequestView_(r, userMap, locMap, deptMap, mobileMap) {
  return {
    requestId: r.RequestID,
    requestDateTime: r.RequestDateTime,
    requestedById: r.RequestedBy,
    requestedByName: userMap[r.RequestedBy] || r.RequestedBy,
    requestedByMobile: (mobileMap && mobileMap[r.RequestedBy]) || '',
    departmentId: r.DepartmentID || '',
    departmentName: (deptMap && deptMap[r.DepartmentID]) || r.DepartmentID || '',
    requiredDate: r.RequiredDate,
    requiredTime: r.RequiredTime,
    fromLocationId: r.FromLocationID,
    fromLocationName: locMap[r.FromLocationID] || r.FromLocationID,
    toLocationId: r.ToLocationID,
    toLocationName: locMap[r.ToLocationID] || r.ToLocationID,
    purpose: r.Purpose,
    goodsDescription: r.GoodsDescription || '',
    requiredType: r.RequiredType || '',
    requiredSubType: r.RequiredSubType || '',
    requiredCapacity: r.RequiredCapacity || '',
    priority: r.Priority || '',
    remarks: r.Remarks || '',
    rejectReason: r.RejectReason || '',
    status: r.Status,
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt,
    updatedBy: r.UpdatedBy || '',
    updatedByName: (r.UpdatedBy && userMap[r.UpdatedBy]) || r.UpdatedBy || ''
  };
}

function getGvRequestFormOptions(token) {
  return secure_(token, [CONFIG.ROLES.GV_USER], function (user) {
    var locations = readTable_(CONFIG.SHEETS.LOCATION_MASTER).rows
      .filter(function (r) { return isActiveFlag_(r.IsActive); })
      .map(function (r) { return { id: r.LocationID, name: r.LocationName }; });

    var seen = {};
    var vehicleTypes = [];
    readTable_(CONFIG.SHEETS.VEHICLES).rows.forEach(function (v) {
      var t = String(v.Type || '').trim();
      if (t && !seen[t]) { seen[t] = true; vehicleTypes.push(t); }
    });

    var departmentName = user.department ? (buildDepartmentNameMap_()[user.department] || user.department) : '';

    return ok_('Options loaded', {
      locations: locations,
      department: departmentName,
      priorities: ['Normal', 'Urgent'],
      vehicleTypes: vehicleTypes
    });
  });
}

/**
 * Reads and checks the GV Request form fields (shared by the GV_User form and
 * the Admin add/edit form). Returns { values } or { error }.
 * keepDateIso: on edit, the request's current Required Date may stay even if
 * it is now in the past.
 */
function readGvRequestInput_(input, keepDateIso) {
  var purpose = String((input && input.purpose) || '').trim();
  var fromLocationId = String((input && input.fromLocationId) || '').trim();
  var toLocationId = String((input && input.toLocationId) || '').trim();
  var requiredDate = String((input && input.requiredDate) || '').trim();
  var requiredTime = String((input && input.requiredTime) || '').trim();
  var requiredType = String((input && input.requiredType) || '').trim();
  var requiredSubType = String((input && input.requiredSubType) || '').trim();
  var requiredCapacityRaw = String((input && input.requiredCapacity) || '').trim();
  var priority = String((input && input.priority) || 'Normal').trim();
  var goodsDescription = String((input && input.goodsDescription) || '').trim();
  var remarks = String((input && input.remarks) || '').trim();

  var missing = [];
  if (!purpose) missing.push('Purpose');
  if (!fromLocationId) missing.push('From Location');
  if (!toLocationId) missing.push('To Location');
  if (!requiredDate) missing.push('Required Date');
  if (!requiredTime) missing.push('Required Time');
  if (!requiredType) missing.push('Vehicle Type');
  if (!requiredCapacityRaw) missing.push('Passenger / Load Count');
  if (missing.length) return { error: 'Missing: ' + missing.join(', ') };

  if (fromLocationId === toLocationId) {
    return { error: 'From Location and To Location cannot be the same.' };
  }

  var capacity = Number(requiredCapacityRaw);
  if (!isFinite(capacity) || capacity <= 0 || Math.floor(capacity) !== capacity) {
    return { error: 'Passenger / Load Count must be a whole number greater than 0.' };
  }

  var todayIso = formatDate_(nowIst_(), 'yyyy-MM-dd');
  if (requiredDate < todayIso && requiredDate !== keepDateIso) {
    return { error: 'Required Date cannot be in the past.' };
  }

  return {
    values: {
      RequiredDate: isoToDisplayDate_(requiredDate) || requiredDate,
      // Stored as "02:00 PM" rather than 24-hour, and kept as plain text.
      RequiredTime: to24to12_(requiredTime),
      FromLocationID: fromLocationId,
      ToLocationID: toLocationId,
      Purpose: purpose,
      GoodsDescription: goodsDescription,
      RequiredType: requiredType,
      RequiredSubType: requiredSubType,
      RequiredCapacity: capacity,
      Priority: priority,
      Remarks: remarks
    }
  };
}

function createGvRequest(token, input) {
  return secure_(token, [CONFIG.ROLES.GV_USER], function (user) {
    return withLock_(function () {
      var parsed = readGvRequestInput_(input, null);
      if (parsed.error) return fail_(parsed.error);

      var requestId = generateId_('GV_REQUESTS');
      var now = nowString_();
      var row = parsed.values;
      row.RequestID = requestId;
      row.RequestDateTime = now;
      row.RequestedBy = user.userId;
      row.DepartmentID = user.department || '';
      row.Status = CONFIG.STATUS.REQUEST.PENDING;
      row.CreatedAt = now;
      row.UpdatedAt = now;
      row.UpdatedBy = user.userId;
      appendRow_(CONFIG.SHEETS.GV_REQUESTS, row, ['RequiredTime']);

      notifyUsers_(activeUserIdsByRoles_([CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER]), 'Request Raised',
        'New GV Request ' + requestId + ' raised by ' + user.name + ' - ' + row.Purpose, requestId, '');

      return ok_('Request submitted', { requestId: requestId });
    });
  });
}

// ---------- Admin: add / edit a GV Request ----------

function activeGvUsers_() {
  return readTable_(CONFIG.SHEETS.USERS).rows.filter(function (u) {
    return u.Role === CONFIG.ROLES.GV_USER && u.Status === CONFIG.STATUS.USER.ACTIVE;
  });
}

/**
 * Everything the Admin request form needs: active locations, vehicle types,
 * priorities, and the active GV users a request can be raised for.
 */
function getAdminGvRequestOptions(token) {
  return secure_(token, [CONFIG.ROLES.ADMIN], function () {
    var locations = readTable_(CONFIG.SHEETS.LOCATION_MASTER).rows
      .filter(function (r) { return isActiveFlag_(r.IsActive); })
      .map(function (r) { return { id: r.LocationID, name: r.LocationName }; });

    var seen = {};
    var vehicleTypes = [];
    readTable_(CONFIG.SHEETS.VEHICLES).rows.forEach(function (v) {
      var t = String(v.Type || '').trim();
      if (t && !seen[t]) { seen[t] = true; vehicleTypes.push(t); }
    });

    var deptMap = buildDepartmentNameMap_();
    var requesters = activeGvUsers_().map(function (u) {
      var dept = deptMap[u.Department] || u.Department || '';
      return { id: u.UserID, label: u.Name + ' (' + u.EmployeeCode + ')' + (dept ? ' - ' + dept : '') };
    });

    return ok_('Options loaded', {
      locations: locations,
      vehicleTypes: vehicleTypes,
      priorities: ['Normal', 'Urgent'],
      requesters: requesters
    });
  });
}

/**
 * Admin raises a request on behalf of a GV user. The request belongs to that
 * user (it shows in their My Requests) and uses their department.
 */
function adminCreateGvRequest(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN], function (adminUser) {
    return withLock_(function () {
      var requestedBy = String((input && input.requestedBy) || '').trim();
      if (!requestedBy) return fail_('Missing: Requested By');
      var requester = findUserRow_(activeGvUsers_(), requestedBy);
      if (!requester) return fail_('Requested By must be an active GV user.');

      var parsed = readGvRequestInput_(input, null);
      if (parsed.error) return fail_(parsed.error);

      var requestId = generateId_('GV_REQUESTS');
      var now = nowString_();
      var row = parsed.values;
      row.RequestID = requestId;
      row.RequestDateTime = now;
      row.RequestedBy = requester.UserID;
      row.DepartmentID = requester.Department || '';
      row.Status = CONFIG.STATUS.REQUEST.PENDING;
      row.CreatedAt = now;
      row.UpdatedAt = now;
      row.UpdatedBy = adminUser.userId;
      appendRow_(CONFIG.SHEETS.GV_REQUESTS, row, ['RequiredTime']);

      var fleet = activeUserIdsByRoles_([CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER])
        .filter(function (id) { return String(id) !== String(adminUser.userId); });
      notifyUsers_(fleet, 'Request Raised',
        'New GV Request ' + requestId + ' raised by ' + adminUser.name + ' for ' + requester.Name + ' - ' + row.Purpose, requestId, '');
      notifyUsers_([requester.UserID], 'Request Raised',
        'GV Request ' + requestId + ' was raised for you by ' + adminUser.name + ' - ' + row.Purpose, requestId, '');

      return ok_('Request submitted', { requestId: requestId });
    });
  });
}

/**
 * Admin edits a request's details. Only while it is Pending (or Approved),
 * i.e. before a vehicle is allocated. Requested By cannot be changed.
 */
function updateGvRequest(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN], function (adminUser) {
    return withLock_(function () {
      var requestId = String((input && input.requestId) || '').trim();
      if (!requestId) return fail_('Missing request id.');

      var table = readTable_(CONFIG.SHEETS.GV_REQUESTS);
      var target = findRequestRow_(table.rows, requestId);
      if (!target) return fail_('Request not found.');

      var editableStatuses = [CONFIG.STATUS.REQUEST.PENDING, CONFIG.STATUS.REQUEST.APPROVED];
      if (editableStatuses.indexOf(target.Status) < 0) {
        return fail_('This request is ' + target.Status + ' and can no longer be edited.');
      }

      var parsed = readGvRequestInput_(input, toIsoDate_(target.RequiredDate));
      if (parsed.error) return fail_(parsed.error);

      var changes = parsed.values;
      changes.UpdatedAt = nowString_();
      changes.UpdatedBy = adminUser.userId;
      updateRow_(CONFIG.SHEETS.GV_REQUESTS, target._row, changes, ['RequiredTime']);

      if (String(target.RequestedBy) !== String(adminUser.userId)) {
        notifyUsers_([target.RequestedBy], 'Request Updated',
          'Your request ' + requestId + ' was updated by ' + adminUser.name + '.', requestId, '');
      }

      return ok_('Request updated', null);
    });
  });
}

function getMyGvRequests(token) {
  return secure_(token, [CONFIG.ROLES.GV_USER], function (user) {
    var userMap = buildUserNameMap_();
    var locMap = buildLocationNameMap_();
    var deptMap = buildDepartmentNameMap_();
    var mobileMap = buildUserMobileMap_();
    var allocMap = buildActiveAllocationMap_();
    var rows = readTable_(CONFIG.SHEETS.GV_REQUESTS).rows
      .filter(function (r) { return String(r.RequestedBy).trim() === String(user.userId).trim(); })
      .sort(function (a, b) { return b._row - a._row; });

    var cancellableStatuses = [CONFIG.STATUS.REQUEST.PENDING, CONFIG.STATUS.REQUEST.APPROVED];

    var list = rows.map(function (r) {
      var v = toRequestView_(r, userMap, locMap, deptMap, mobileMap);
      v.cancellable = cancellableStatuses.indexOf(r.Status) >= 0;

      var alloc = allocMap[r.RequestID] || null;
      v.allocationId = alloc ? alloc.allocationId : '';
      v.vehicleNo = alloc ? alloc.vehicleNo : '';
      v.driverName = alloc ? alloc.driverName : '';
      v.driverMobile = alloc ? alloc.driverMobile : '';
      v.reachedDateTime = alloc ? alloc.reachedDateTime : '';
      v.loadingStartDateTime = alloc ? alloc.loadingStartDateTime : '';
      v.loadingEndDateTime = alloc ? alloc.loadingEndDateTime : '';
      v.actualStartDateTime = alloc ? alloc.actualStartDateTime : '';
      v.actualEndDateTime = alloc ? alloc.actualEndDateTime : '';
      v.canStartLoading = alloc ? alloc.canStartLoading : false;
      v.canEndLoading = alloc ? alloc.canEndLoading : false;
      return v;
    });

    return ok_('Requests loaded', { requests: list });
  });
}

function getGvRequests(token) {
  return secure_(token, [CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER], function () {
    var userMap = buildUserNameMap_();
    var locMap = buildLocationNameMap_();
    var deptMap = buildDepartmentNameMap_();
    var mobileMap = buildUserMobileMap_();
    var rows = readTable_(CONFIG.SHEETS.GV_REQUESTS).rows
      .sort(function (a, b) { return b._row - a._row; });

    var closedStatuses = [CONFIG.STATUS.REQUEST.COMPLETED, CONFIG.STATUS.REQUEST.CANCELLED, CONFIG.STATUS.REQUEST.REJECTED];
    var allocatableStatuses = [CONFIG.STATUS.REQUEST.PENDING, CONFIG.STATUS.REQUEST.APPROVED];

    var list = rows.map(function (r) {
      var v = toRequestView_(r, userMap, locMap, deptMap, mobileMap);
      v.reviewable = r.Status === CONFIG.STATUS.REQUEST.PENDING;
      v.cancellable = closedStatuses.indexOf(r.Status) < 0;
      v.allocatable = allocatableStatuses.indexOf(r.Status) >= 0;
      v.editable = allocatableStatuses.indexOf(r.Status) >= 0;
      return v;
    });

    return ok_('Requests loaded', { requests: list });
  });
}

function rejectGvRequest(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER], function (actorUser) {
    return withLock_(function () {
      var requestId = String((input && input.requestId) || '').trim();
      var reason = String((input && input.reason) || '').trim();
      if (!requestId) return fail_('Missing request id.');
      if (!reason) return fail_('A reason is required to reject a request.');

      var table = readTable_(CONFIG.SHEETS.GV_REQUESTS);
      var target = findRequestRow_(table.rows, requestId);
      if (!target) return fail_('Request not found.');
      if (target.Status !== CONFIG.STATUS.REQUEST.PENDING) {
        return fail_('Only a Pending request can be rejected.');
      }

      updateRow_(CONFIG.SHEETS.GV_REQUESTS, target._row, {
        Status: CONFIG.STATUS.REQUEST.REJECTED,
        RejectReason: reason,
        UpdatedAt: nowString_(),
        UpdatedBy: actorUser.userId
      });

      notifyUsers_([target.RequestedBy], 'Request Rejected',
        'Your request ' + requestId + ' was rejected: ' + reason, requestId, '');

      return ok_('Request rejected', null);
    });
  });
}

function cancelGvRequest(token, input) {
  return secure_(token, null, function (user) {
    return withLock_(function () {
      var requestId = String((input && input.requestId) || '').trim();
      if (!requestId) return fail_('Missing request id.');

      var table = readTable_(CONFIG.SHEETS.GV_REQUESTS);
      var target = findRequestRow_(table.rows, requestId);
      if (!target) return fail_('Request not found.');

      var closedStatuses = [CONFIG.STATUS.REQUEST.COMPLETED, CONFIG.STATUS.REQUEST.CANCELLED, CONFIG.STATUS.REQUEST.REJECTED];
      if (closedStatuses.indexOf(target.Status) >= 0) {
        return fail_('This request is already ' + target.Status + ' and cannot be cancelled.');
      }

      if (user.role === CONFIG.ROLES.GV_USER) {
        if (String(target.RequestedBy).trim() !== String(user.userId).trim()) {
          return fail_('You can only cancel your own requests.');
        }
        var ownCancellable = [CONFIG.STATUS.REQUEST.PENDING, CONFIG.STATUS.REQUEST.APPROVED];
        if (ownCancellable.indexOf(target.Status) < 0) {
          return fail_('This request can no longer be cancelled once it is allocated.');
        }
      } else if (!isAdminTier_(user.role) && user.role !== CONFIG.ROLES.FD_USER) {
        return fail_('Access denied.');
      }

      updateRow_(CONFIG.SHEETS.GV_REQUESTS, target._row, {
        Status: CONFIG.STATUS.REQUEST.CANCELLED,
        UpdatedAt: nowString_(),
        UpdatedBy: user.userId
      });

      if (String(user.userId).trim() !== String(target.RequestedBy).trim()) {
        notifyUsers_([target.RequestedBy], 'Request Cancelled',
          'Your request ' + requestId + ' was cancelled.', requestId, '');
      }

      return ok_('Request cancelled', null);
    });
  });
}

/* =====================================================================
 * ALLOCATIONS (same as Allocations.gs)
 * ===================================================================== */

function findAllocationRow_(rows, allocationId) {
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].AllocationID).trim() === String(allocationId).trim()) return rows[i];
  }
  return null;
}

function buildVehicleNoMap_() {
  var rows = readTable_(CONFIG.SHEETS.VEHICLES).rows;
  var map = {};
  rows.forEach(function (r) { map[r.VehicleID] = r.VehicleNo; });
  return map;
}

function buildVehicleTypeMap_() {
  var rows = readTable_(CONFIG.SHEETS.VEHICLES).rows;
  var map = {};
  rows.forEach(function (r) { map[r.VehicleID] = r.Type; });
  return map;
}

function isGoodsVehicleType_(type) {
  return String(type || '').trim().toLowerCase() === CONFIG.LOADING_REQUIRED_VEHICLE_TYPE.toLowerCase();
}

function buildDriverNameMap_() {
  var rows = readTable_(CONFIG.SHEETS.DRIVERS).rows;
  var map = {};
  rows.forEach(function (r) { map[r.DriverID] = r.DriverName; });
  return map;
}

function buildDriverMobileMap_() {
  var rows = readTable_(CONFIG.SHEETS.DRIVERS).rows;
  var map = {};
  rows.forEach(function (r) { map[r.DriverID] = r.Mobile || ''; });
  return map;
}

function buildRequestSummaryMap_() {
  var locMap = buildLocationNameMap_();
  var userMap = buildUserNameMap_();
  var mobileMap = buildUserMobileMap_();
  var deptMap = buildDepartmentNameMap_();
  var rows = readTable_(CONFIG.SHEETS.GV_REQUESTS).rows;
  var map = {};
  rows.forEach(function (r) {
    var fromName = locMap[r.FromLocationID] || r.FromLocationID;
    var toName = locMap[r.ToLocationID] || r.ToLocationID;
    map[r.RequestID] = {
      purpose: r.Purpose,
      route: fromName + ' → ' + toName,
      fromLocationName: fromName,
      toLocationName: toName,
      requestedById: r.RequestedBy,
      requestedByName: userMap[r.RequestedBy] || r.RequestedBy,
      requestedByMobile: mobileMap[r.RequestedBy] || '',
      departmentId: r.DepartmentID || '',
      departmentName: deptMap[r.DepartmentID] || r.DepartmentID || '',
      requestDateTime: r.RequestDateTime,
      requiredDate: r.RequiredDate,
      requiredTime: r.RequiredTime
    };
  });
  return map;
}

function toAllocationView_(r, userMap, vehicleMap, driverMap, requestMap, vehicleTypeMap, driverMobileMap) {
  var summary = requestMap[r.RequestID] || { purpose: '', route: '', fromLocationName: '', toLocationName: '', requestedByName: '', requestedByMobile: '', requestDateTime: '' };
  var flags = computeAllocationFlags_(r, vehicleTypeMap);
  return {
    allocationId: r.AllocationID,
    requestId: r.RequestID,
    requestPurpose: summary.purpose,
    requestRoute: summary.route,
    requestFromLocationName: summary.fromLocationName,
    requestToLocationName: summary.toLocationName,
    requestedByName: summary.requestedByName,
    requestedByMobile: summary.requestedByMobile || '',
    requestDepartmentName: summary.departmentName || '',
    requestDateTime: summary.requestDateTime,
    vehicleId: r.VehicleID,
    vehicleNo: vehicleMap[r.VehicleID] || r.VehicleID,
    vehicleType: vehicleTypeMap[r.VehicleID] || '',
    driverId: r.DriverID,
    driverName: driverMap[r.DriverID] || r.DriverID,
    driverMobile: (driverMobileMap && driverMobileMap[r.DriverID]) || '',
    allocatedById: r.AllocatedBy,
    allocatedByName: userMap[r.AllocatedBy] || r.AllocatedBy,
    allocationDateTime: r.AllocationDateTime,
    plannedStartDateTime: r.PlannedStartDateTime,
    reachedDateTime: r.ReachedDateTime || '',
    loadingStartDateTime: r.LoadingStartDateTime || '',
    loadingEndDateTime: r.LoadingEndDateTime || '',
    actualStartDateTime: r.ActualStartDateTime || '',
    actualEndDateTime: r.ActualEndDateTime || '',
    status: r.Status,
    remarks: r.Remarks || '',
    createdAt: r.CreatedAt,
    updatedAt: r.UpdatedAt,
    updatedBy: r.UpdatedBy || '',
    updatedByName: (r.UpdatedBy && userMap[r.UpdatedBy]) || r.UpdatedBy || '',
    canMarkReached: flags.canMarkReached,
    canStartTrip: flags.canStartTrip,
    canEndTrip: flags.canEndTrip
  };
}

function computeAllocationFlags_(r, vehicleTypeMap) {
  if (!r) {
    return { canMarkReached: false, canStartLoading: false, canEndLoading: false, canStartTrip: false, canEndTrip: false };
  }
  var S = CONFIG.STATUS.ALLOCATION;
  var isGoods = isGoodsVehicleType_(vehicleTypeMap[r.VehicleID]);

  return {
    canMarkReached: r.Status === S.ALLOCATED,
    canStartLoading: isGoods && r.Status === S.REACHED,
    canEndLoading: isGoods && r.Status === S.LOADING && !r.LoadingEndDateTime,
    canStartTrip: isGoods
      ? (r.Status === S.LOADING && !!r.LoadingEndDateTime)
      : (r.Status === S.REACHED),
    canEndTrip: r.Status === S.ON_TRIP
  };
}

function buildActiveAllocationMap_() {
  var rows = readTable_(CONFIG.SHEETS.ALLOCATIONS).rows;
  var vehicleTypeMap = buildVehicleTypeMap_();
  var driverMap = buildDriverNameMap_();
  var driverMobileMap = buildDriverMobileMap_();
  var vehicleMap = buildVehicleNoMap_();
  var map = {};

  rows.forEach(function (r) {
    if (r.Status === CONFIG.STATUS.ALLOCATION.CANCELLED) return;
    var existing = map[r.RequestID];
    if (existing && existing._row > r._row) return;

    var flags = computeAllocationFlags_(r, vehicleTypeMap);
    map[r.RequestID] = {
      _row: r._row,
      allocationId: r.AllocationID,
      vehicleNo: vehicleMap[r.VehicleID] || r.VehicleID,
      vehicleType: vehicleTypeMap[r.VehicleID] || '',
      driverName: driverMap[r.DriverID] || r.DriverID,
      driverMobile: driverMobileMap[r.DriverID] || '',
      status: r.Status,
      reachedDateTime: r.ReachedDateTime || '',
      loadingStartDateTime: r.LoadingStartDateTime || '',
      loadingEndDateTime: r.LoadingEndDateTime || '',
      actualStartDateTime: r.ActualStartDateTime || '',
      actualEndDateTime: r.ActualEndDateTime || '',
      canStartLoading: flags.canStartLoading,
      canEndLoading: flags.canEndLoading
    };
  });

  return map;
}

function getAllocations(token) {
  return secure_(token, [CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER, CONFIG.ROLES.DRIVER], function (actor) {
    var myDriverIds = null;
    if (actor.role === CONFIG.ROLES.DRIVER) {
      myDriverIds = driverIdsForUser_(actor);
      if (!myDriverIds.length) return fail_(DRIVER_NOT_LINKED_MSG_);
    }
    var userMap = buildUserNameMap_();
    var vehicleMap = buildVehicleNoMap_();
    var vehicleTypeMap = buildVehicleTypeMap_();
    var driverMap = buildDriverNameMap_();
    var driverMobileMap = buildDriverMobileMap_();
    var requestMap = buildRequestSummaryMap_();

    var rows = readTable_(CONFIG.SHEETS.ALLOCATIONS).rows
      .filter(function (r) { return !myDriverIds || myDriverIds.indexOf(String(r.DriverID).trim()) >= 0; })
      .sort(function (a, b) { return b._row - a._row; })
      .map(function (r) { return toAllocationView_(r, userMap, vehicleMap, driverMap, requestMap, vehicleTypeMap, driverMobileMap); });

    return ok_('Allocations loaded', { allocations: rows });
  });
}

function getAllocationOptions(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER], function () {
    var requiredType = String((input && input.requiredType) || '').trim().toLowerCase();

    var vehicles = readTable_(CONFIG.SHEETS.VEHICLES).rows
      .filter(function (v) { return v.Status === CONFIG.STATUS.VEHICLE.AVAILABLE; })
      .filter(function (v) { return !requiredType || String(v.Type || '').trim().toLowerCase() === requiredType; })
      .map(function (v) {
        return { id: v.VehicleID, label: v.VehicleNo + ' – ' + v.Type + (v.SubType ? ' / ' + v.SubType : '') + ' (capacity ' + v.Capacity + ')' };
      });

    var drivers = readTable_(CONFIG.SHEETS.DRIVERS).rows
      .filter(function (d) { return d.Status === CONFIG.STATUS.DRIVER.AVAILABLE; })
      .map(function (d) { return { id: d.DriverID, label: d.DriverName + ' (' + d.Mobile + ')' }; });

    return ok_('Options loaded', { vehicles: vehicles, drivers: drivers });
  });
}

function createAllocation(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER], function (actorUser) {
    return withLock_(function () {
      var requestId = String((input && input.requestId) || '').trim();
      var vehicleId = String((input && input.vehicleId) || '').trim();
      var driverId = String((input && input.driverId) || '').trim();
      var plannedStartRaw = String((input && input.plannedStartDateTime) || '').trim();
      var remarks = String((input && input.remarks) || '').trim();

      var missing = [];
      if (!requestId) missing.push('Request');
      if (!vehicleId) missing.push('Vehicle');
      if (!driverId) missing.push('Driver');
      if (!plannedStartRaw) missing.push('Planned Start');
      if (missing.length) return fail_('Missing: ' + missing.join(', '));

      var plannedStart = parseInputDateTime_(plannedStartRaw);
      if (isNaN(plannedStart.getTime())) return fail_('Planned Start is not a valid date and time.');

      var requestTable = readTable_(CONFIG.SHEETS.GV_REQUESTS);
      var request = findRequestRow_(requestTable.rows, requestId);
      if (!request) return fail_('Request not found.');
      var allocatableStatuses = [CONFIG.STATUS.REQUEST.PENDING, CONFIG.STATUS.REQUEST.APPROVED];
      if (allocatableStatuses.indexOf(request.Status) < 0) {
        return fail_('This request is ' + request.Status + ' and cannot be allocated.');
      }

      var vehicleTable = readTable_(CONFIG.SHEETS.VEHICLES);
      var vehicle = findVehicleRow_(vehicleTable.rows, vehicleId);
      if (!vehicle) return fail_('Vehicle not found.');
      if (vehicle.Status !== CONFIG.STATUS.VEHICLE.AVAILABLE) {
        return fail_('That vehicle is no longer Available.');
      }

      var driverTable = readTable_(CONFIG.SHEETS.DRIVERS);
      var driver = findDriverRow_(driverTable.rows, driverId);
      if (!driver) return fail_('Driver not found.');
      if (driver.Status !== CONFIG.STATUS.DRIVER.AVAILABLE) {
        return fail_('That driver is no longer Available.');
      }

      var windowMs = CONFIG.DEFAULT_TRIP_HOURS * 3600000;
      var newStart = plannedStart.getTime();
      var newEnd = newStart + windowMs;

      var activeAllocations = readTable_(CONFIG.SHEETS.ALLOCATIONS).rows.filter(function (a) {
        return a.Status !== CONFIG.STATUS.ALLOCATION.CANCELLED;
      });

      for (var i = 0; i < activeAllocations.length; i++) {
        var a = activeAllocations[i];
        var otherStart = parseTimestamp_(a.PlannedStartDateTime);
        if (!otherStart) continue;
        var otherStartMs = otherStart.getTime();
        var otherEndMs = otherStartMs + windowMs;
        var overlaps = newStart < otherEndMs && otherStartMs < newEnd;
        if (!overlaps) continue;

        if (String(a.VehicleID).trim() === vehicleId) {
          return fail_('That vehicle already has an overlapping allocation (' + a.AllocationID + ').');
        }
        if (String(a.DriverID).trim() === driverId) {
          return fail_('That driver already has an overlapping allocation (' + a.AllocationID + ').');
        }
      }

      var allocationId = generateId_('ALLOCATIONS');
      var now = nowString_();
      var plannedStartDisplay = formatDate_(plannedStart, CONFIG.DATE_FORMAT.TIMESTAMP);

      appendRow_(CONFIG.SHEETS.ALLOCATIONS, {
        AllocationID: allocationId,
        RequestID: requestId,
        VehicleID: vehicleId,
        DriverID: driverId,
        AllocatedBy: actorUser.userId,
        AllocationDateTime: now,
        PlannedStartDateTime: plannedStartDisplay,
        ActualStartDateTime: '',
        ActualEndDateTime: '',
        Status: CONFIG.STATUS.ALLOCATION.ALLOCATED,
        Remarks: remarks,
        CreatedAt: now,
        UpdatedAt: now,
        UpdatedBy: actorUser.userId
      });

      updateRow_(CONFIG.SHEETS.GV_REQUESTS, request._row, {
        Status: CONFIG.STATUS.REQUEST.ALLOCATED,
        UpdatedAt: now,
        UpdatedBy: actorUser.userId
      });
      updateRow_(CONFIG.SHEETS.VEHICLES, vehicle._row, {
        Status: CONFIG.STATUS.VEHICLE.ALLOCATED,
        UpdatedAt: now,
        UpdatedBy: actorUser.userId
      });
      updateRow_(CONFIG.SHEETS.DRIVERS, driver._row, {
        Status: CONFIG.STATUS.DRIVER.ALLOCATED,
        UpdatedAt: now,
        UpdatedBy: actorUser.userId
      });

      notifyUsers_([request.RequestedBy], 'Request Allocated',
        'Your request ' + requestId + ' has been allocated - Vehicle ' + vehicle.VehicleNo + ', Driver ' + driver.DriverName + '.',
        requestId, allocationId);

      return ok_('Allocation created', { allocationId: allocationId });
    });
  });
}

function loadAllocationForAction_(allocationId) {
  var allocTable = readTable_(CONFIG.SHEETS.ALLOCATIONS);
  var alloc = findAllocationRow_(allocTable.rows, allocationId);
  if (!alloc) return { error: 'Allocation not found.' };

  var requestTable = readTable_(CONFIG.SHEETS.GV_REQUESTS);
  var request = findRequestRow_(requestTable.rows, alloc.RequestID);
  if (!request) return { error: 'The request for this allocation was not found.' };

  return { alloc: alloc, request: request };
}

function syncRequestStatus_(request, status, actorUserId) {
  updateRow_(CONFIG.SHEETS.GV_REQUESTS, request._row, {
    Status: status,
    UpdatedAt: nowString_(),
    UpdatedBy: actorUserId
  });
}

function markVehicleReached(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER, CONFIG.ROLES.DRIVER], function (actorUser) {
    return withLock_(function () {
      var allocationId = String((input && input.allocationId) || '').trim();
      if (!allocationId) return fail_('Missing allocation id.');

      var loaded = loadAllocationForAction_(allocationId);
      if (loaded.error) return fail_(loaded.error);
      var alloc = loaded.alloc, request = loaded.request;
      var ownErr = driverOwnershipError_(actorUser, alloc);
      if (ownErr) return fail_(ownErr);

      if (alloc.Status !== CONFIG.STATUS.ALLOCATION.ALLOCATED) {
        return fail_('Only an Allocated trip can be marked as Reached.');
      }

      var now = nowString_();
      updateRow_(CONFIG.SHEETS.ALLOCATIONS, alloc._row, {
        Status: CONFIG.STATUS.ALLOCATION.REACHED,
        ReachedDateTime: now,
        UpdatedAt: now,
        UpdatedBy: actorUser.userId
      });
      syncRequestStatus_(request, CONFIG.STATUS.REQUEST.REACHED, actorUser.userId);

      notifyUsers_([request.RequestedBy], 'Vehicle Reached',
        'The vehicle for your request ' + request.RequestID + ' has reached.', request.RequestID, alloc.AllocationID);

      return ok_('Marked as Reached', null);
    });
  });
}

function startLoading(token, input) {
  return secure_(token, [CONFIG.ROLES.GV_USER], function (user) {
    return withLock_(function () {
      var allocationId = String((input && input.allocationId) || '').trim();
      if (!allocationId) return fail_('Missing allocation id.');

      var loaded = loadAllocationForAction_(allocationId);
      if (loaded.error) return fail_(loaded.error);
      var alloc = loaded.alloc, request = loaded.request;

      if (String(request.RequestedBy).trim() !== String(user.userId).trim()) {
        return fail_('You can only manage loading for your own requests.');
      }

      var vehicleType = buildVehicleTypeMap_()[alloc.VehicleID];
      if (!isGoodsVehicleType_(vehicleType)) {
        return fail_('Loading only applies to a Goods Vehicle.');
      }
      if (alloc.Status !== CONFIG.STATUS.ALLOCATION.REACHED) {
        return fail_('The vehicle must have reached the point before loading can start.');
      }

      var now = nowString_();
      updateRow_(CONFIG.SHEETS.ALLOCATIONS, alloc._row, {
        Status: CONFIG.STATUS.ALLOCATION.LOADING,
        LoadingStartDateTime: now,
        UpdatedAt: now,
        UpdatedBy: user.userId
      });
      syncRequestStatus_(request, CONFIG.STATUS.REQUEST.LOADING, user.userId);

      return ok_('Loading started', null);
    });
  });
}

function endLoading(token, input) {
  return secure_(token, [CONFIG.ROLES.GV_USER], function (user) {
    return withLock_(function () {
      var allocationId = String((input && input.allocationId) || '').trim();
      if (!allocationId) return fail_('Missing allocation id.');

      var loaded = loadAllocationForAction_(allocationId);
      if (loaded.error) return fail_(loaded.error);
      var alloc = loaded.alloc, request = loaded.request;

      if (String(request.RequestedBy).trim() !== String(user.userId).trim()) {
        return fail_('You can only manage loading for your own requests.');
      }
      if (alloc.Status !== CONFIG.STATUS.ALLOCATION.LOADING) {
        return fail_('Loading has not been started for this trip.');
      }
      if (alloc.LoadingEndDateTime) {
        return fail_('Loading has already been marked as ended.');
      }

      var now = nowString_();
      updateRow_(CONFIG.SHEETS.ALLOCATIONS, alloc._row, {
        LoadingEndDateTime: now,
        UpdatedAt: now,
        UpdatedBy: user.userId
      });

      notifyUsers_(activeUserIdsByRoles_([CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER]), 'Loading Completed',
        'Loading completed for request ' + request.RequestID + ' - ready for trip start.', request.RequestID, alloc.AllocationID);

      return ok_('Loading ended', null);
    });
  });
}

function startTrip(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER, CONFIG.ROLES.DRIVER], function (actorUser) {
    return withLock_(function () {
      var allocationId = String((input && input.allocationId) || '').trim();
      if (!allocationId) return fail_('Missing allocation id.');

      var loaded = loadAllocationForAction_(allocationId);
      if (loaded.error) return fail_(loaded.error);
      var alloc = loaded.alloc, request = loaded.request;
      var ownErr = driverOwnershipError_(actorUser, alloc);
      if (ownErr) return fail_(ownErr);

      var vehicleType = buildVehicleTypeMap_()[alloc.VehicleID];
      if (isGoodsVehicleType_(vehicleType)) {
        if (alloc.Status !== CONFIG.STATUS.ALLOCATION.LOADING || !alloc.LoadingEndDateTime) {
          return fail_('Loading must be completed before the trip can start.');
        }
      } else if (alloc.Status !== CONFIG.STATUS.ALLOCATION.REACHED) {
        return fail_('The vehicle must have reached the point before the trip can start.');
      }

      var now = nowString_();
      updateRow_(CONFIG.SHEETS.ALLOCATIONS, alloc._row, {
        Status: CONFIG.STATUS.ALLOCATION.ON_TRIP,
        ActualStartDateTime: now,
        UpdatedAt: now,
        UpdatedBy: actorUser.userId
      });
      syncRequestStatus_(request, CONFIG.STATUS.REQUEST.ON_TRIP, actorUser.userId);

      var vehicleTable = readTable_(CONFIG.SHEETS.VEHICLES);
      var vehicle = findVehicleRow_(vehicleTable.rows, alloc.VehicleID);
      if (vehicle) {
        updateRow_(CONFIG.SHEETS.VEHICLES, vehicle._row, { Status: CONFIG.STATUS.VEHICLE.ON_TRIP, UpdatedAt: now, UpdatedBy: actorUser.userId });
      }
      var driverTable = readTable_(CONFIG.SHEETS.DRIVERS);
      var driver = findDriverRow_(driverTable.rows, alloc.DriverID);
      if (driver) {
        updateRow_(CONFIG.SHEETS.DRIVERS, driver._row, { Status: CONFIG.STATUS.DRIVER.ON_TRIP, UpdatedAt: now, UpdatedBy: actorUser.userId });
      }

      return ok_('Trip started', null);
    });
  });
}

function endTrip(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER, CONFIG.ROLES.DRIVER], function (actorUser) {
    return withLock_(function () {
      var allocationId = String((input && input.allocationId) || '').trim();
      if (!allocationId) return fail_('Missing allocation id.');

      var loaded = loadAllocationForAction_(allocationId);
      if (loaded.error) return fail_(loaded.error);
      var alloc = loaded.alloc, request = loaded.request;
      var ownErr = driverOwnershipError_(actorUser, alloc);
      if (ownErr) return fail_(ownErr);

      if (alloc.Status !== CONFIG.STATUS.ALLOCATION.ON_TRIP) {
        return fail_('Only a trip that is On Trip can be ended.');
      }

      var now = nowString_();
      updateRow_(CONFIG.SHEETS.ALLOCATIONS, alloc._row, {
        Status: CONFIG.STATUS.ALLOCATION.COMPLETED,
        ActualEndDateTime: now,
        UpdatedAt: now,
        UpdatedBy: actorUser.userId
      });
      syncRequestStatus_(request, CONFIG.STATUS.REQUEST.COMPLETED, actorUser.userId);

      var vehicleTable = readTable_(CONFIG.SHEETS.VEHICLES);
      var vehicle = findVehicleRow_(vehicleTable.rows, alloc.VehicleID);
      if (vehicle) {
        updateRow_(CONFIG.SHEETS.VEHICLES, vehicle._row, { Status: CONFIG.STATUS.VEHICLE.AVAILABLE, UpdatedAt: now, UpdatedBy: actorUser.userId });
      }
      var driverTable = readTable_(CONFIG.SHEETS.DRIVERS);
      var driver = findDriverRow_(driverTable.rows, alloc.DriverID);
      if (driver) {
        updateRow_(CONFIG.SHEETS.DRIVERS, driver._row, { Status: CONFIG.STATUS.DRIVER.AVAILABLE, UpdatedAt: now, UpdatedBy: actorUser.userId });
      }

      notifyUsers_([request.RequestedBy], 'Trip Completed',
        'The trip for your request ' + request.RequestID + ' has been completed.', request.RequestID, alloc.AllocationID);

      return ok_('Trip completed', null);
    });
  });
}

function planVsActualGap_(fromMs, toMs) {
  if (fromMs === null || toMs === null || fromMs === undefined || toMs === undefined) return null;
  var diff = toMs - fromMs;
  if (Math.abs(diff) < 60000) return { ms: diff, label: 'On time' };
  return { ms: diff, label: formatDuration_(Math.abs(diff)) + (diff > 0 ? ' late' : ' early') };
}

function getRequestTimeline(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER, CONFIG.ROLES.GV_USER, CONFIG.ROLES.DRIVER], function (user) {
    var requestId = String((input && input.requestId) || '').trim();
    if (!requestId) return fail_('Missing request id.');

    var requestTable = readTable_(CONFIG.SHEETS.GV_REQUESTS);
    var request = findRequestRow_(requestTable.rows, requestId);
    if (!request) return fail_('Request not found.');

    if (user.role === CONFIG.ROLES.GV_USER && String(request.RequestedBy).trim() !== String(user.userId).trim()) {
      return fail_('You can only view the timeline for your own requests.');
    }

    var allocRows = readTable_(CONFIG.SHEETS.ALLOCATIONS).rows.filter(function (a) {
      return String(a.RequestID).trim() === requestId;
    });
    if (user.role === CONFIG.ROLES.DRIVER) {
      var myIds = driverIdsForUser_(user);
      if (!myIds.length) return fail_(DRIVER_NOT_LINKED_MSG_);
      var mine = allocRows.some(function (a) { return myIds.indexOf(String(a.DriverID).trim()) >= 0; });
      if (!mine) return fail_('You can only view the timeline for your own trips.');
    }
    var alloc = null;
    allocRows.forEach(function (a) {
      if (a.Status === CONFIG.STATUS.ALLOCATION.CANCELLED) {
        if (!alloc) alloc = a;
        return;
      }
      if (!alloc || alloc.Status === CONFIG.STATUS.ALLOCATION.CANCELLED || alloc._row < a._row) alloc = a;
    });

    var vehicleTypeMap = buildVehicleTypeMap_();
    var vehicleMap = buildVehicleNoMap_();
    var driverMap = buildDriverNameMap_();
    var isGoods = alloc ? isGoodsVehicleType_(vehicleTypeMap[alloc.VehicleID]) : false;

    var stageDefs = [
      { key: 'raised', label: 'Request Raised', value: request.RequestDateTime },
      { key: 'allocated', label: 'Allocated', value: alloc ? alloc.AllocationDateTime : '' },
      { key: 'reached', label: 'Vehicle Reached', value: alloc ? alloc.ReachedDateTime : '' }
    ];
    if (isGoods) {
      stageDefs.push({ key: 'loadingStart', label: 'Loading Started', value: alloc ? alloc.LoadingStartDateTime : '' });
      stageDefs.push({ key: 'loadingEnd', label: 'Loading Ended', value: alloc ? alloc.LoadingEndDateTime : '' });
    }
    stageDefs.push({ key: 'tripStart', label: 'Trip Started', value: alloc ? alloc.ActualStartDateTime : '' });
    stageDefs.push({ key: 'tripEnd', label: 'Trip Completed', value: alloc ? alloc.ActualEndDateTime : '' });

    var stages = [];
    stageDefs.forEach(function (def) {
      var date = parseTimestamp_(def.value);
      if (!date) return;
      stages.push({ key: def.key, label: def.label, timestamp: def.value, ms: date.getTime() });
    });

    var firstMs = stages.length ? stages[0].ms : 0;
    var lastMs = stages.length ? stages[stages.length - 1].ms : 0;
    var totalMs = lastMs - firstMs;

    var result = stages.map(function (s, i) {
      var gapMs = i === 0 ? 0 : s.ms - stages[i - 1].ms;
      return {
        key: s.key,
        label: s.label,
        timestamp: s.timestamp,
        gapFromPrevious: i === 0 ? '-' : formatDuration_(gapMs),
        gapFromPreviousMs: i === 0 ? 0 : gapMs,
        offsetMs: s.ms - firstMs
      };
    });

    var isCancelled = alloc && alloc.Status === CONFIG.STATUS.ALLOCATION.CANCELLED;
    var isComplete = result.length > 0 && result[result.length - 1].key === 'tripEnd';

    var requiredTime24 = to12to24_(request.RequiredTime);
    var requiredDate = requiredTime24 ? parseTimestamp_(request.RequiredDate + ' ' + requiredTime24 + ':00') : null;
    var requiredMs = requiredDate ? requiredDate.getTime() : null;
    var requiredDisplay = (request.RequiredDate && request.RequiredTime) ? (request.RequiredDate + ' ' + request.RequiredTime) : '';

    var plannedDate = alloc ? parseTimestamp_(alloc.PlannedStartDateTime) : null;
    var plannedMs = plannedDate ? plannedDate.getTime() : null;

    var reachedDate = alloc ? parseTimestamp_(alloc.ReachedDateTime) : null;
    var reachedMs = reachedDate ? reachedDate.getTime() : null;

    var planVsActual = {
      requiredDateTime: requiredDisplay,
      plannedStartDateTime: alloc ? (alloc.PlannedStartDateTime || '') : '',
      reachedDateTime: alloc ? (alloc.ReachedDateTime || '') : '',
      requiredToPlanned: planVsActualGap_(requiredMs, plannedMs),
      plannedToReached: planVsActualGap_(plannedMs, reachedMs)
    };

    return ok_('Timeline loaded', {
      requestId: requestId,
      purpose: request.Purpose,
      status: request.Status,
      allocationId: alloc ? alloc.AllocationID : '',
      vehicleNo: alloc ? (vehicleMap[alloc.VehicleID] || alloc.VehicleID) : '',
      vehicleType: alloc ? (vehicleTypeMap[alloc.VehicleID] || '') : '',
      driverName: alloc ? (driverMap[alloc.DriverID] || alloc.DriverID) : '',
      isCancelled: !!isCancelled,
      isComplete: isComplete,
      planVsActual: planVsActual,
      totalDuration: result.length > 1 ? formatDuration_(totalMs) : '-',
      totalDurationMs: totalMs,
      stages: result
    });
  });
}

/* =====================================================================
 * NOTIFICATIONS (same as Notifications.gs)
 * ===================================================================== */

function activeUserIdsByRoles_(roles) {
  var rows = readTable_(CONFIG.SHEETS.USERS).rows;
  return rows
    .filter(function (u) { return roles.indexOf(u.Role) >= 0 && u.Status === CONFIG.STATUS.USER.ACTIVE; })
    .map(function (u) { return u.UserID; });
}

function notifyUsers_(userIds, type, message, requestId, allocationId) {
  var now = nowString_();
  (userIds || []).forEach(function (userId) {
    if (!userId) return;
    appendRow_(CONFIG.SHEETS.NOTIFICATIONS, {
      NotificationID: generateId_('NOTIFICATIONS'),
      UserID: userId,
      Type: type,
      Message: message,
      RequestID: requestId || '',
      AllocationID: allocationId || '',
      IsRead: 'No',
      CreatedAt: now
    });
  });
}

function findNotificationRow_(rows, notificationId) {
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].NotificationID).trim() === String(notificationId).trim()) return rows[i];
  }
  return null;
}

function getMyNotifications(token) {
  return secure_(token, null, function (user) {
    var rows = readTable_(CONFIG.SHEETS.NOTIFICATIONS).rows
      .filter(function (n) { return String(n.UserID).trim() === String(user.userId).trim(); })
      .sort(function (a, b) { return b._row - a._row; });

    var unreadCount = rows.filter(function (n) { return n.IsRead !== 'Yes'; }).length;

    var list = rows.slice(0, 30).map(function (n) {
      return {
        notificationId: n.NotificationID,
        type: n.Type,
        message: n.Message,
        requestId: n.RequestID || '',
        allocationId: n.AllocationID || '',
        isRead: n.IsRead === 'Yes',
        createdAt: n.CreatedAt
      };
    });

    return ok_('Notifications loaded', { notifications: list, unreadCount: unreadCount });
  });
}

function markNotificationRead(token, input) {
  return secure_(token, null, function (user) {
    return withLock_(function () {
      var notificationId = String((input && input.notificationId) || '').trim();
      if (!notificationId) return fail_('Missing notification id.');

      var table = readTable_(CONFIG.SHEETS.NOTIFICATIONS);
      var target = findNotificationRow_(table.rows, notificationId);
      if (!target) return fail_('Notification not found.');
      if (String(target.UserID).trim() !== String(user.userId).trim()) {
        return fail_('Access denied.');
      }

      updateRow_(CONFIG.SHEETS.NOTIFICATIONS, target._row, { IsRead: 'Yes' });
      return ok_('Marked as read', null);
    });
  });
}

function markAllNotificationsRead(token) {
  return secure_(token, null, function (user) {
    return withLock_(function () {
      var table = readTable_(CONFIG.SHEETS.NOTIFICATIONS);
      var mine = table.rows.filter(function (n) {
        return String(n.UserID).trim() === String(user.userId).trim() && n.IsRead !== 'Yes';
      });
      mine.forEach(function (n) { updateRow_(CONFIG.SHEETS.NOTIFICATIONS, n._row, { IsRead: 'Yes' }); });
      return ok_('All marked as read', { count: mine.length });
    });
  });
}

/* =====================================================================
 * REPORTS (same as Reports.gs)
 * ===================================================================== */

function buildUtilization_(allocationsInRange, idKey, labelFn) {
  var map = {};
  allocationsInRange.forEach(function (a) {
    var id = a[idKey];
    if (!id) return;
    if (!map[id]) map[id] = { id: id, label: labelFn(id), total: 0, completed: 0, cancelled: 0 };
    map[id].total++;
    if (a.Status === CONFIG.STATUS.ALLOCATION.COMPLETED) map[id].completed++;
    if (a.Status === CONFIG.STATUS.ALLOCATION.CANCELLED) map[id].cancelled++;
  });
  return Object.keys(map)
    .map(function (k) { return map[k]; })
    .sort(function (x, y) { return y.total - x.total; });
}

function getReportsData(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER], function () {
    var fromIso = String((input && input.fromDate) || '').trim();
    var toIso = String((input && input.toDate) || '').trim();

    var userMap = buildUserNameMap_();
    var locMap = buildLocationNameMap_();
    var deptMap = buildDepartmentNameMap_();
    var vehicleMap = buildVehicleNoMap_();
    var vehicleTypeMap = buildVehicleTypeMap_();
    var driverMap = buildDriverNameMap_();

    var requestsInRange = readTable_(CONFIG.SHEETS.GV_REQUESTS).rows.filter(function (r) {
      var iso = toIsoDate_(r.RequiredDate);
      if (fromIso && (!iso || iso < fromIso)) return false;
      if (toIso && (!iso || iso > toIso)) return false;
      return true;
    });

    var statusCounts = {};
    requestStatusList_().forEach(function (s) { statusCounts[s] = 0; });
    requestsInRange.forEach(function (r) {
      statusCounts[r.Status] = (statusCounts[r.Status] || 0) + 1;
    });
    var requestsByStatus = Object.keys(statusCounts).map(function (s) {
      return { status: s, count: statusCounts[s] };
    });

    var requestsList = requestsInRange
      .sort(function (a, b) { return b._row - a._row; })
      .map(function (r) { return toRequestView_(r, userMap, locMap, deptMap); });

    var allocationsInRange = readTable_(CONFIG.SHEETS.ALLOCATIONS).rows.filter(function (a) {
      var iso = toIsoDate_(a.PlannedStartDateTime);
      if (fromIso && (!iso || iso < fromIso)) return false;
      if (toIso && (!iso || iso > toIso)) return false;
      return true;
    });

    var vehicleUtilization = buildUtilization_(allocationsInRange, 'VehicleID', function (id) {
      var no = vehicleMap[id] || id;
      var type = vehicleTypeMap[id];
      return type ? no + ' (' + type + ')' : no;
    });
    var driverUtilization = buildUtilization_(allocationsInRange, 'DriverID', function (id) {
      return driverMap[id] || id;
    });

    var summary = {
      totalRequests: requestsInRange.length,
      pending: statusCounts[CONFIG.STATUS.REQUEST.PENDING] || 0,
      completed: statusCounts[CONFIG.STATUS.REQUEST.COMPLETED] || 0,
      cancelled: statusCounts[CONFIG.STATUS.REQUEST.CANCELLED] || 0,
      rejected: statusCounts[CONFIG.STATUS.REQUEST.REJECTED] || 0,
      totalAllocations: allocationsInRange.length
    };

    return ok_('Report loaded', {
      summary: summary,
      requestsByStatus: requestsByStatus,
      vehicleUtilization: vehicleUtilization,
      driverUtilization: driverUtilization,
      requests: requestsList
    });
  });
}

/* =====================================================================
 * MANAGEMENT REPORT (Super_Admin only)
 * Requests are counted in the period in which they were RAISED
 * (RequestDateTime). Everything else (allocation, loading, trip, process
 * times) follows those same requests, so each report line adds up.
 * ===================================================================== */

var MONTH_NAMES_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isoAddDays_(iso, n) {
  var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  return formatDate_(d, 'yyyy-MM-dd');
}

function isoDaysBetween_(fromIso, toIso) {
  var a = String(fromIso).split('-'), b = String(toIso).split('-');
  var da = Date.UTC(Number(a[0]), Number(a[1]) - 1, Number(a[2]));
  var db = Date.UTC(Number(b[0]), Number(b[1]) - 1, Number(b[2]));
  return Math.round((db - da) / 86400000);
}

function isoNice_(iso) {
  var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? (m[3] + '-' + MONTH_NAMES_[Number(m[2]) - 1] + '-' + m[1]) : String(iso);
}

function periodLabel_(fromIso, toIso) {
  return fromIso === toIso ? isoNice_(fromIso) : isoNice_(fromIso) + ' to ' + isoNice_(toIso);
}

function requiredMsOf_(r) {
  var t24 = to12to24_(r.RequiredTime);
  var d = t24 ? parseTimestamp_(String(r.RequiredDate) + ' ' + t24 + ':00') : null;
  return d ? d.getTime() : null;
}

function msOf_(value) {
  var d = parseTimestamp_(value);
  return d ? d.getTime() : null;
}

// Latest non-cancelled allocation of each request.
function latestAllocationByRequest_(allocRows) {
  var map = {};
  allocRows.forEach(function (a) {
    if (a.Status === CONFIG.STATUS.ALLOCATION.CANCELLED) return;
    var id = String(a.RequestID).trim();
    if (!map[id] || map[id]._row < a._row) map[id] = a;
  });
  return map;
}

function avgMs_(list) {
  if (!list.length) return { ms: null, n: 0 };
  var sum = 0;
  list.forEach(function (v) { sum += v; });
  return { ms: Math.round(sum / list.length), n: list.length };
}

function processMetrics_(reqs, allocByReq) {
  var b = { requestToAllocation: [], loading: [], trip: [],
            requiredToPlanned: [], plannedToReached: [], reachedToLoadStart: [], loadEndToTripStart: [] };
  var late = 0;
  // Durations can never be negative (a negative value means a mistyped time), so they are skipped;
  // the plan-vs-actual gaps are signed on purpose (+ later, - earlier).
  function add(list, from, to, signed) {
    if (from === null || to === null) return;
    if (!signed && to - from < 0) return;
    list.push(to - from);
  }

  reqs.forEach(function (r) {
    var a = allocByReq[String(r.RequestID).trim()];
    if (!a) return;
    var raised = msOf_(r.RequestDateTime), allocated = msOf_(a.AllocationDateTime);
    var required = requiredMsOf_(r), planned = msOf_(a.PlannedStartDateTime), reached = msOf_(a.ReachedDateTime);
    var ls = msOf_(a.LoadingStartDateTime), le = msOf_(a.LoadingEndDateTime);
    var ts = msOf_(a.ActualStartDateTime), te = msOf_(a.ActualEndDateTime);

    add(b.requestToAllocation, raised, allocated);
    add(b.loading, ls, le);
    add(b.trip, ts, te);
    add(b.requiredToPlanned, required, planned, true);
    add(b.plannedToReached, planned, reached, true);
    if (planned !== null && reached !== null && reached - planned > 60000) late++;
    add(b.reachedToLoadStart, reached, ls);
    add(b.loadEndToTripStart, le, ts);
  });

  return {
    process: {
      requestToAllocation: avgMs_(b.requestToAllocation),
      loading: avgMs_(b.loading),
      trip: avgMs_(b.trip)
    },
    gaps: {
      requiredToPlanned: avgMs_(b.requiredToPlanned),
      plannedToReached: avgMs_(b.plannedToReached),
      reachedToLoadStart: avgMs_(b.reachedToLoadStart),
      loadEndToTripStart: avgMs_(b.loadEndToTripStart)
    },
    lateArrivals: late
  };
}

function requestCounts_(reqs, allocByReq) {
  var S = CONFIG.STATUS.REQUEST;
  var c = { total: reqs.length, allocated: 0, pending: 0, completed: 0, cancelled: 0, rejected: 0 };
  reqs.forEach(function (r) {
    if (allocByReq[String(r.RequestID).trim()]) c.allocated++;
    if (r.Status === S.PENDING) c.pending++;
    else if (r.Status === S.COMPLETED) c.completed++;
    else if (r.Status === S.CANCELLED) c.cancelled++;
    else if (r.Status === S.REJECTED) c.rejected++;
  });
  return c;
}

function topCounts_(allocs, idKey, labelOf) {
  var map = {};
  allocs.forEach(function (a) {
    var id = String(a[idKey] || '').trim();
    if (!id) return;
    map[id] = (map[id] || 0) + 1;
  });
  return Object.keys(map)
    .map(function (id) { return { id: id, label: labelOf(id), count: map[id] }; })
    .sort(function (x, y) { return y.count - x.count; })
    .slice(0, 10);
}

function pctChange_(cur, prev) {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

var GAP_LABELS_ = {
  requiredToPlanned: 'Required time to Planned time',
  plannedToReached: 'Planned time to Actual reached time',
  reachedToLoadStart: 'Reached time to Loading start',
  loadEndToTripStart: 'Loading end to Trip start'
};

function mgmtInsights_(c) {
  var cur = c.cur, prev = c.prev, out = [];
  var scope = c.deptName ? ' in ' + c.deptName : '';
  if (cur.total === 0) {
    return ['No requests were raised' + scope + ' in this period.'];
  }

  var chg = pctChange_(cur.total, prev.total);
  out.push(cur.total + (cur.total === 1 ? ' request was' : ' requests were') + ' raised' + scope + ' - ' +
    (chg === null
      ? (prev.total === 0 ? 'none in the previous period to compare with.' : 'no change.')
      : (chg === 0 ? 'same as the previous period (' + prev.total + ').'
        : (chg > 0 ? 'up ' : 'down ') + Math.abs(chg) + '% from ' + prev.total + ' in the previous period.')));

  var rate = Math.round((cur.completed / cur.total) * 100);
  out.push('Completion rate is ' + rate + '% (' + cur.completed + ' of ' + cur.total + '). ' +
    (cur.pending > 0 ? cur.pending + ' (' + Math.round((cur.pending / cur.total) * 100) + '%) still waiting for allocation.' : 'No requests are waiting for allocation.'));

  if (c.groups.length > 0) {
    var top = c.groups[0];
    out.push((c.groupBy === 'user' ? 'Highest requester: ' : 'Busiest department: ') + top.label + ' with ' + top.total +
      ' requests (' + Math.round((top.total / cur.total) * 100) + '% of all).');
  }

  var p = c.process.process.requestToAllocation;
  if (p.n) {
    var slowest = null;
    c.groups.forEach(function (g) {
      var v = g.process.requestToAllocation;
      if (v.n && (!slowest || v.ms > slowest.ms)) slowest = { label: g.label, ms: v.ms };
    });
    out.push('A vehicle is allocated on average ' + formatDuration_(p.ms) + ' after the request is raised' +
      (slowest && c.groups.length > 1 ? '; slowest: ' + slowest.label + ' (' + formatDuration_(slowest.ms) + ').' : '.'));
  }

  var pr = c.process.gaps.plannedToReached;
  if (pr.n) {
    if (pr.ms > 60000) {
      out.push('Vehicles reach on average ' + formatDuration_(pr.ms) + ' later than planned; ' + c.process.lateArrivals + ' of ' + pr.n + (pr.n === 1 ? ' arrival was late.' : ' arrivals were late.'));
    } else if (pr.ms < -60000) {
      out.push('Vehicles reach on average ' + formatDuration_(-pr.ms) + ' earlier than planned; ' + c.process.lateArrivals + ' of ' + pr.n + (pr.n === 1 ? ' arrival was late.' : ' arrivals were late.'));
    } else {
      out.push('Vehicles reach on time on average; ' + c.process.lateArrivals + ' of ' + pr.n + (pr.n === 1 ? ' arrival was late.' : ' arrivals were late.'));
    }
  }

  var biggest = null;
  Object.keys(c.process.gaps).forEach(function (k) {
    var g = c.process.gaps[k];
    if (g.n && (!biggest || Math.abs(g.ms) > Math.abs(biggest.ms))) biggest = { key: k, ms: g.ms };
  });
  if (biggest && Math.abs(biggest.ms) >= 60000) {
    out.push('Largest process gap: ' + GAP_LABELS_[biggest.key] + ', averaging ' + (biggest.ms < 0 ? '-' : '') + formatDuration_(Math.abs(biggest.ms)) + '.');
  }

  if (c.vehicleTrips.length && c.driverTrips.length) {
    var totalTrips = 0;
    c.vehicleTrips.forEach(function (v) { totalTrips += v.count; });
    var tv = c.vehicleTrips[0], td = c.driverTrips[0];
    out.push('Most used vehicle: ' + tv.label + ' (' + tv.count + (tv.count === 1 ? ' trip' : ' trips') + '); busiest driver: ' + td.label + ' (' + td.count + (td.count === 1 ? ' trip' : ' trips') + ').');
  }

  var lost = cur.cancelled + cur.rejected;
  out.push(lost > 0
    ? lost + ' request' + (lost === 1 ? ' was' : 's were') + ' cancelled or rejected (' + Math.round((lost / cur.total) * 100) + '% of all requests).'
    : 'No requests were cancelled or rejected.');

  return out.slice(0, 8);
}

function getManagementReport(token, input) {
  return secure_(token, [CONFIG.ROLES.SUPER_ADMIN], function () {
    var today = formatDate_(nowIst_(), 'yyyy-MM-dd');
    var fromIso = String((input && input.fromDate) || '').trim() || today;
    var toIso = String((input && input.toDate) || '').trim() || fromIso;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromIso) || !/^\d{4}-\d{2}-\d{2}$/.test(toIso)) return fail_('Dates must look like 2026-10-13.');
    if (fromIso > toIso) return fail_('From date cannot be after To date.');
    var days = isoDaysBetween_(fromIso, toIso) + 1;
    if (days > 366) return fail_('Please choose a period of one year or less.');

    var prevTo = isoAddDays_(fromIso, -1);
    var prevFrom = isoAddDays_(fromIso, -days);

    var deptId = String((input && input.departmentId) || '').trim();
    var deptMap = buildDepartmentNameMap_();
    var userMap = buildUserNameMap_();
    var vehicleMap = buildVehicleNoMap_();
    var driverMap = buildDriverNameMap_();

    var allRequests = readTable_(CONFIG.SHEETS.GV_REQUESTS).rows.filter(function (r) {
      return !deptId || String(r.DepartmentID || '').trim() === deptId;
    });
    function inRange(r, a, b) {
      var iso = toIsoDate_(r.RequestDateTime);
      return iso !== '' && iso >= a && iso <= b;
    }
    var curReqs = allRequests.filter(function (r) { return inRange(r, fromIso, toIso); });
    var prevReqs = allRequests.filter(function (r) { return inRange(r, prevFrom, prevTo); });

    var allocRows = readTable_(CONFIG.SHEETS.ALLOCATIONS).rows;
    var allocByReq = latestAllocationByRequest_(allocRows);

    var cur = requestCounts_(curReqs, allocByReq);
    var prev = requestCounts_(prevReqs, allocByReq);
    var overall = processMetrics_(curReqs, allocByReq);

    // Department rows (or user rows when one department is chosen)
    var groupBy = deptId ? 'user' : 'department';
    var buckets = {};
    curReqs.forEach(function (r) {
      var key = groupBy === 'user' ? String(r.RequestedBy || '').trim() : String(r.DepartmentID || '').trim();
      if (!buckets[key]) {
        var label = groupBy === 'user' ? (userMap[r.RequestedBy] || r.RequestedBy || '(Unknown)') : (deptMap[r.DepartmentID] || r.DepartmentID || '(No department)');
        buckets[key] = { key: key, label: label, reqs: [] };
      }
      buckets[key].reqs.push(r);
    });
    var groups = Object.keys(buckets).map(function (k) {
      var g = buckets[k];
      var counts = requestCounts_(g.reqs, allocByReq);
      var pm = processMetrics_(g.reqs, allocByReq);
      return { key: g.key, label: g.label, total: counts.total, allocated: counts.allocated, pending: counts.pending,
               completed: counts.completed, cancelled: counts.cancelled, rejected: counts.rejected,
               process: pm.process, gaps: pm.gaps };
    }).sort(function (x, y) { return y.total - x.total || (x.label > y.label ? 1 : -1); });

    // Trips by vehicle / driver: allocations of the requests in this period (cancelled ones excluded)
    var reqIds = {};
    curReqs.forEach(function (r) { reqIds[String(r.RequestID).trim()] = true; });
    var tripAllocs = allocRows.filter(function (a) {
      return a.Status !== CONFIG.STATUS.ALLOCATION.CANCELLED && reqIds[String(a.RequestID).trim()];
    });
    var vehicleTrips = topCounts_(tripAllocs, 'VehicleID', function (id) { return vehicleMap[id] || id; });
    var driverTrips = topCounts_(tripAllocs, 'DriverID', function (id) { return driverMap[id] || id; });

    var deptName = deptId ? (deptMap[deptId] || deptId) : '';
    var insights = mgmtInsights_({
      cur: cur, prev: prev, groups: groups, groupBy: groupBy, process: overall,
      vehicleTrips: vehicleTrips, driverTrips: driverTrips, deptName: deptName
    });

    return ok_('Management report loaded', {
      period: { from: fromIso, to: toIso, label: periodLabel_(fromIso, toIso), days: days },
      previous: { from: prevFrom, to: prevTo, label: periodLabel_(prevFrom, prevTo) },
      department: deptId ? { id: deptId, name: deptName } : null,
      groupBy: groupBy,
      stats: { current: cur, previous: prev },
      process: overall.process,
      gaps: overall.gaps,
      lateArrivals: overall.lateArrivals,
      groups: groups,
      vehicleTrips: vehicleTrips,
      driverTrips: driverTrips,
      insights: insights,
      generatedAt: nowString_()
    });
  });
}

/* =====================================================================
 * EXPORTS (same as Exports.gs; the .zip is built here instead of Utilities.zip)
 * ===================================================================== */

var EXPORT_MIME_ZIP = 'application/zip';

function csvField_(value) {
  var s = value === undefined || value === null ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow_(cells) {
  return cells.map(csvField_).join(',');
}

function buildCsvString_(headers, rows) {
  var lines = [];
  if (headers && headers.length) lines.push(csvRow_(headers));
  (rows || []).forEach(function (r) { lines.push(csvRow_(r)); });
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function buildCsvZipExport_(fileNameBase, sheets) {
  var files = sheets.map(function (sheetDef) {
    var csv = buildCsvString_(sheetDef.headers, sheetDef.rows);
    var safeName = String(sheetDef.name || 'Sheet').replace(/[^a-zA-Z0-9 _-]/g, '').substring(0, 60);
    return { name: safeName + '.csv', data: utf8_(csv) };
  });

  var zipBytes = buildZip_(files, nowIst_());
  var fileName = fileNameBase + '_' + formatDate_(nowIst_(), 'yyyyMMdd_HHmmss') + '.zip';
  return { fileName: fileName, mimeType: EXPORT_MIME_ZIP, base64: b64Encode_(zipBytes) };
}

function exportReportsExcel(token, input) {
  return secure_(token, [CONFIG.ROLES.ADMIN, CONFIG.ROLES.FD_USER], function () {
    var reportResult = getReportsData(token, input);
    if (!reportResult.success) return reportResult;
    var d = reportResult.data;

    var summarySheet = {
      name: 'Summary',
      headers: ['Metric', 'Value'],
      rows: [
        ['Total Requests', d.summary.totalRequests],
        ['Pending', d.summary.pending],
        ['Completed', d.summary.completed],
        ['Cancelled', d.summary.cancelled],
        ['Rejected', d.summary.rejected],
        ['Total Allocations', d.summary.totalAllocations]
      ]
    };

    var statusSheet = {
      name: 'Requests by Status',
      headers: ['Status', 'Count'],
      rows: d.requestsByStatus.map(function (s) { return [s.status, s.count]; })
    };

    var vehicleSheet = {
      name: 'Vehicle Utilization',
      headers: ['Vehicle', 'Total Trips', 'Completed', 'Cancelled'],
      rows: d.vehicleUtilization.map(function (v) { return [v.label, v.total, v.completed, v.cancelled]; })
    };

    var driverSheet = {
      name: 'Driver Utilization',
      headers: ['Driver', 'Total Trips', 'Completed', 'Cancelled'],
      rows: d.driverUtilization.map(function (v) { return [v.label, v.total, v.completed, v.cancelled]; })
    };

    var requestsSheet = {
      name: 'Requests',
      headers: ['Request ID', 'Requested On', 'Requested By', 'Department', 'Required Date',
        'Required Time', 'From', 'To', 'Purpose', 'Status'],
      rows: d.requests.map(function (v) {
        return [v.requestId, v.requestDateTime, v.requestedByName, v.departmentName, v.requiredDate,
          v.requiredTime, v.fromLocationName, v.toLocationName, v.purpose, v.status];
      })
    };

    var file = buildCsvZipExport_('Reports', [summarySheet, statusSheet, vehicleSheet, driverSheet, requestsSheet]);
    return ok_('Export ready', file);
  });
}

/* ---------- Minimal .zip writer (files stored without compression) ---------- */

var CRC_TABLE = (function () {
  var t = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32_(bytes) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function buildZip_(files, when) {
  var dosTime = (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | Math.floor(when.getUTCSeconds() / 2);
  var dosDate = ((when.getUTCFullYear() - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate();

  var locals = [], centrals = [], offset = 0;
  files.forEach(function (f) {
    var name = utf8_(f.name), data = f.data, crc = crc32_(data);

    var lh = new Uint8Array(30 + name.length);
    var v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true);
    v.setUint16(8, 0, true); v.setUint16(10, dosTime, true); v.setUint16(12, dosDate, true);
    v.setUint32(14, crc, true); v.setUint32(18, data.length, true); v.setUint32(22, data.length, true);
    v.setUint16(26, name.length, true); v.setUint16(28, 0, true);
    lh.set(name, 30);
    locals.push(lh, data);

    var ch = new Uint8Array(46 + name.length);
    var w = new DataView(ch.buffer);
    w.setUint32(0, 0x02014b50, true); w.setUint16(4, 20, true); w.setUint16(6, 20, true);
    w.setUint16(8, 0x0800, true); w.setUint16(10, 0, true); w.setUint16(12, dosTime, true);
    w.setUint16(14, dosDate, true); w.setUint32(16, crc, true); w.setUint32(20, data.length, true);
    w.setUint32(24, data.length, true); w.setUint16(28, name.length, true);
    w.setUint32(42, offset, true);
    ch.set(name, 46);
    centrals.push(ch);

    offset += lh.length + data.length;
  });

  var centralSize = centrals.reduce(function (s, c) { return s + c.length; }, 0);
  var end = new Uint8Array(22);
  var e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);

  var parts = locals.concat(centrals, [end]);
  var total = parts.reduce(function (s, p) { return s + p.length; }, 0);
  var out = new Uint8Array(total), pos = 0;
  parts.forEach(function (p) { out.set(p, pos); pos += p.length; });
  return out;
}

/* =====================================================================
 * GOOGLE SHEETS API + SIGN-IN
 * ===================================================================== */

async function handlePing(env) {
  var fields = 'properties.title,sheets.properties.title';
  var data = await sheetsFetch_(env, env.SHEET_ID + '?fields=' + encodeURIComponent(fields), { method: 'GET' });
  return {
    ok: true,
    sheet: 'connected',
    spreadsheet: data.properties ? data.properties.title : '',
    tabs: (data.sheets || []).map(function (s) { return s.properties.title; }),
    checkedAt: nowString_()
  };
}

// Reads whole tabs in ONE request; date cells come back as serial numbers.
async function fetchTabs(env, tabNames) {
  var ranges = tabNames.map(function (n) { return "'" + n + "'"; });
  var valueRanges = await sheetsBatchGet_(env, ranges);
  var out = {};
  tabNames.forEach(function (n, i) { out[n] = valueRanges[i] || []; });
  return out;
}

async function sheetsBatchGet_(env, ranges) {
  var qs = ranges.map(function (r) { return 'ranges=' + encodeURIComponent(r); }).join('&');
  var data = await sheetsFetch_(env, env.SHEET_ID + '/values:batchGet?' + qs +
    '&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER', { method: 'GET' });
  return (data.valueRanges || []).map(function (vr) { return vr.values || []; });
}

// Appends rows to a tab; returns the first row number Google used.
async function sheetsAppend_(env, sheetName, rows) {
  var range = encodeURIComponent("'" + sheetName + "'!A1");
  var data = await sheetsFetch_(env, env.SHEET_ID + '/values/' + range +
    ':append?valueInputOption=USER_ENTERED&insertDataOption=OVERWRITE&includeValuesInResponse=false', {
    method: 'POST',
    body: JSON.stringify({ values: rows })
  });
  var updated = data.updates && data.updates.updatedRange ? data.updates.updatedRange : '';
  var m = updated.match(/!\$?[A-Z]+\$?(\d+)/);
  return m ? Number(m[1]) : null;
}

async function sheetsBatchUpdate_(env, data) {
  return sheetsFetch_(env, env.SHEET_ID + '/values:batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: data })
  });
}

// Calls the Sheets API with the service account; retries on 429/5xx.
async function sheetsFetch_(env, path, options) {
  var token = await getAccessToken_(env);
  var lastError = '';
  for (var attempt = 0; attempt < 4; attempt++) {
    var res = await fetch(SHEETS_API + path, {
      method: options.method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: options.body
    });
    if (res.ok) return res.json();

    var text = await res.text();
    lastError = describeGoogleError_(res.status, text);
    if (res.status === 429 || res.status >= 500) {
      await sleep_(600 * Math.pow(2, attempt));
      continue;
    }
    break;
  }
  throw new Error(lastError);
}

function describeGoogleError_(status, text) {
  var msg = text;
  try { msg = JSON.parse(text).error.message; } catch (e) { /* keep raw text */ }
  if (status === 403) return 'Google refused access (403): ' + msg + ' - check the sheet is shared with SA_EMAIL as Editor.';
  if (status === 404) return 'Sheet not found (404): ' + msg + ' - check SHEET_ID.';
  if (status === 429) return 'The system is busy right now (Google limit). Please try again in a minute.';
  return 'Google Sheets error ' + status + ': ' + msg;
}

var cachedToken = null;
var cachedTokenExpiry = 0;

async function getAccessToken_(env) {
  var now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < cachedTokenExpiry - 60) return cachedToken;

  var header = { alg: 'RS256', typ: 'JWT' };
  var claims = { iss: env.SA_EMAIL.trim(), scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 };
  var unsigned = b64urlEncode_(utf8_(JSON.stringify(header))) + '.' + b64urlEncode_(utf8_(JSON.stringify(claims)));
  var key = await importPrivateKey_(env.SA_PRIVATE_KEY);
  var signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8_(unsigned));
  var jwt = unsigned + '.' + b64urlEncode_(new Uint8Array(signature));

  var res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt
  });
  var data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error('Google sign-in failed: ' + (data.error_description || data.error || res.status) + ' - check SA_EMAIL and SA_PRIVATE_KEY.');
  }
  cachedToken = data.access_token;
  cachedTokenExpiry = now + (data.expires_in || 3600);
  return cachedToken;
}

// Accepts the whole JSON key file, the "private_key" line, or just the key.
async function importPrivateKey_(raw) {
  var text = String(raw).trim();
  if (text.charAt(0) === '{') {
    try { text = JSON.parse(text).private_key || text; } catch (e) { /* fall through */ }
  }
  text = text.replace(/\\r/g, '').replace(/\\n/g, '\n');

  var begin = text.indexOf('-----BEGIN PRIVATE KEY-----');
  var end = text.indexOf('-----END PRIVATE KEY-----');
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error('Invalid PKCS8 input: SA_PRIVATE_KEY must contain both "-----BEGIN PRIVATE KEY-----" and "-----END PRIVATE KEY-----" ' +
      '(found BEGIN: ' + (begin !== -1) + ', END: ' + (end !== -1) + ', length: ' + text.length + ' characters).');
  }
  var b64 = text.slice(begin + 27, end).replace(/[^A-Za-z0-9+/=]/g, '');
  var der;
  try {
    der = Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); });
  } catch (e) {
    throw new Error('Invalid PKCS8 input: the key text between BEGIN and END is damaged (' + b64.length + ' characters) - copy it again from the JSON file.');
  }
  try {
    return await crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch (e) {
    throw new Error('Invalid PKCS8 input: the key is incomplete (' + b64.length + ' characters, a Google key is about 1,600) - copy the whole private_key value again.');
  }
}

/* =====================================================================
 * SMALL HELPERS - CORS, encoding, SHA-256, HMAC
 * ===================================================================== */

function corsHeaders(env, origin) {
  var allowed = String(env.ALLOWED_ORIGIN || '').trim().replace(/\/$/, '');
  var headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  if (allowed && origin === allowed) headers['Access-Control-Allow-Origin'] = allowed;
  return headers;
}

function respond(obj, env, origin) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, corsHeaders(env, origin))
  });
}

function sleep_(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

function utf8_(str) {
  return new TextEncoder().encode(str);
}

function fromUtf8_(bytes) {
  return new TextDecoder().decode(bytes);
}

function toHex_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return s;
}

function b64Encode_(bytes) {
  var bin = '';
  var CHUNK = 0x8000;
  for (var i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function b64urlEncode_(bytes) {
  return b64Encode_(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode_(str) {
  var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); });
}

// SHA-256 (plain JavaScript, so it can run without pausing)
var SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function sha256_(bytes) {
  var len = bytes.length;
  var withOne = len + 1;
  var total = Math.ceil((withOne + 8) / 64) * 64;
  var buf = new Uint8Array(total);
  buf.set(bytes);
  buf[len] = 0x80;
  var bitLen = len * 8;
  var view = new DataView(buf.buffer);
  view.setUint32(total - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(total - 4, bitLen >>> 0, false);

  var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  var w = new Uint32Array(64);

  for (var off = 0; off < total; off += 64) {
    for (var i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (i = 16; i < 64; i++) {
      var x = w[i - 15], y = w[i - 2];
      var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (i = 0; i < 64; i++) {
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      var ch = (e & f) ^ (~e & g);
      var t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  var out = new Uint8Array(32);
  var ov = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach(function (v, k) { ov.setUint32(k * 4, v, false); });
  return out;
}

function hmacSha256_(keyBytes, msgBytes) {
  var key = keyBytes.length > 64 ? sha256_(keyBytes) : keyBytes;
  var k = new Uint8Array(64);
  k.set(key);
  var inner = new Uint8Array(64 + msgBytes.length);
  var outer = new Uint8Array(64 + 32);
  for (var i = 0; i < 64; i++) { inner[i] = k[i] ^ 0x36; outer[i] = k[i] ^ 0x5c; }
  inner.set(msgBytes, 64);
  outer.set(sha256_(inner), 64);
  return sha256_(outer);
}