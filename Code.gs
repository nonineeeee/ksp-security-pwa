/**
 * 高雄軟體園區保全勤務定點簽到系統
 * 全新重建版 Code.gs
 * Version: fresh-v1
 *
 * 唯一正式排班來源：
 *   匯入排班表
 *
 * 本版完全不使用：
 *   月排班表
 *   舊排班產生器
 *   舊 Roster API
 */

const KSP = {
  VERSION: 'fresh-v1.14.16',
  TZ: 'Asia/Taipei',

  SHEETS: {
    SETTINGS: '系統設定',
    STAFF: '人員資料',
    ROSTER: '匯入排班表',
    CHECKPOINTS: '巡查點',
    LOG: '簽到紀錄',
    INCIDENTS: '異常事件',
    CORRECTIONS: '補登申請',
    HOLIDAYS: '假日設定',
    SPECIAL_EXEMPT: '特殊免打卡',
    SUBSTITUTIONS: '代班設定'
  },

  PROP_SS_ID: 'KSP_SECURITY_SPREADSHEET_ID',
  PROP_INCIDENT_FOLDER_ID: 'KSP_SECURITY_INCIDENT_FOLDER_ID',

  DEFAULTS: {
    CENTER_LAT: 22.604668,
    CENTER_LNG: 120.299884,
    CLOCK_RADIUS_M: 350,
    DUPLICATE_MINUTES: 10,
    DAY_START: '06:00',
    DAY_END: '18:00',
    NIGHT_START: '18:00',
    NIGHT_END: '06:00'
  }
};


/* =========================================================
 * 1. 初次設定
 * ========================================================= */

function setupSystem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    throw new Error(
      '請從「高雄軟體園區保全勤務簽到系統_正式資料庫」Google 試算表內，開啟「擴充功能 → Apps Script」後再執行 setupSystem()。'
    );
  }

  ensureSpecialExemptSheet_(
    ss
  );

  ensureSubstitutionSheet_(
    ss
  );

  const required = [
    KSP.SHEETS.SETTINGS,
    KSP.SHEETS.STAFF,
    KSP.SHEETS.ROSTER,
    KSP.SHEETS.CHECKPOINTS,
    KSP.SHEETS.LOG,
    KSP.SHEETS.INCIDENTS,
    KSP.SHEETS.HOLIDAYS,
    KSP.SHEETS.SPECIAL_EXEMPT,
    KSP.SHEETS.SUBSTITUTIONS
  ];

  const missing = required.filter(
    name => !ss.getSheetByName(name)
  );

  if (missing.length) {
    throw new Error(
      '缺少必要工作表：' +
      missing.join('、')
    );
  }

  PropertiesService
    .getScriptProperties()
    .setProperty(
      KSP.PROP_SS_ID,
      ss.getId()
    );

  // 日期欄位以台灣時區為唯一基準，避免日期跨日偏移。
  ss.setSpreadsheetTimeZone(
    KSP.TZ
  );

  ensureIncidentFolder_();

  const rosterSheet =
    ss.getSheetByName(
      KSP.SHEETS.ROSTER
    );

  const result = {
    ok: true,
    version: KSP.VERSION,
    spreadsheetName: ss.getName(),
    spreadsheetId: ss.getId(),
    rosterSource: KSP.SHEETS.ROSTER,
    rosterRows:
      Math.max(
        0,
        rosterSheet.getLastRow() - 1
      ),
    message:
      '全新保全勤務系統初始化完成。'
  };

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}


function testSystemConnection() {
  const ss = getSpreadsheet_();

  ensureSpecialExemptSheet_(
    ss
  );

  ensureSubstitutionSheet_(
    ss
  );

  const names = [
    KSP.SHEETS.SETTINGS,
    KSP.SHEETS.STAFF,
    KSP.SHEETS.ROSTER,
    KSP.SHEETS.CHECKPOINTS,
    KSP.SHEETS.LOG,
    KSP.SHEETS.INCIDENTS,
    KSP.SHEETS.HOLIDAYS,
    KSP.SHEETS.SPECIAL_EXEMPT,
    KSP.SHEETS.SUBSTITUTIONS
  ];

  const sheets = {};

  names.forEach(
    name => {
      sheets[name] =
        ss.getSheetByName(name)
          ? 'OK'
          : '找不到';
    }
  );

  const roster =
    ss.getSheetByName(
      KSP.SHEETS.ROSTER
    );

  const result = {
    ok:
      Object.values(
        sheets
      ).every(
        x => x === 'OK'
      ),
    version: KSP.VERSION,
    spreadsheetName: ss.getName(),
    rosterSource: KSP.SHEETS.ROSTER,
    rosterRows:
      roster
        ? Math.max(
            0,
            roster.getLastRow() - 1
          )
        : 0,
    sheets: sheets
  };

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}


/* =========================================================
 * 2. Web App 入口
 * ========================================================= */


/**
 * fresh-v1.13 一次性巡查點更新。
 *
 * 新巡查點：
 * P01 公園崗哨
 * P02 智科大樓
 * P03 鴻海大樓北側
 * P04 A棟大樓後方
 * P05 C棟大樓後方
 *
 * GPS C/D 欄刻意清空，避免沿用舊巡查點座標。
 * 請更新後至現場重新量測 GPS。
 */
function migratePatrolPointsV113() {
  const sh =
    sheet_(
      KSP.SHEETS.CHECKPOINTS
    );

  const rows = [
    ['P01','公園崗哨','','',100,'P01','啟用'],
    ['P02','智科大樓','','',100,'P02','啟用'],
    ['P03','鴻海大樓北側','','',100,'P03','啟用'],
    ['P04','A棟大樓後方','','',100,'P04','啟用'],
    ['P05','C棟大樓後方','','',100,'P05','啟用']
  ];

  const lastRow =
    sh.getLastRow();

  if (lastRow >= 2) {
    sh.getRange(
      2,
      1,
      lastRow - 1,
      Math.max(
        7,
        sh.getLastColumn()
      )
    ).clearContent();
  }

  sh.getRange(
    2,
    1,
    rows.length,
    rows[0].length
  ).setValues(
    rows
  );

  return {
    ok: true,
    version: KSP.VERSION,
    message:
      '5 個巡查點已更新。GPS 座標目前為空白，請至現場重新設定。',
    points:
      rows.map(
        r => ({
          checkpointId: r[0],
          name: r[1],
          radius: r[4],
          qr: r[5],
          status: r[6]
        })
      )
  };
}



/* =========================================================
 * fresh-v1.14.10｜單次 API 執行快取
 * 同一個 Apps Script request 內，班表、代班、人員資料只讀一次。
 * ========================================================= */
let _KSP_REQ_CACHE = {
  rawRoster: null,
  substitutions: null,
  activeStaff: null,
  specialRows: null
};

function resetRequestCache_() {
  _KSP_REQ_CACHE = {
    rawRoster: null,
    substitutions: null,
    activeStaff: null,
    specialRows: null
  };
}

function doGet(e) {
  resetRequestCache_();
  const params =
    (e && e.parameter)
      ? e.parameter
      : {};

  const action =
    String(
      params.action || ''
    ).trim();

  if (action) {
    try {
      const payload =
        params.payload
          ? JSON.parse(
              params.payload
            )
          : params;

      return jsonOutput_(
        route_(
          action,
          payload
        )
      );

    } catch (err) {
      return jsonOutput_({
        ok: false,
        message:
          errorMessage_(
            err
          )
      });
    }
  }

  return jsonOutput_({
    ok: true,
    service:
      'KSP Security Fresh API',
    version:
      KSP.VERSION,
    rosterSource:
      KSP.SHEETS.ROSTER,
    time:
      formatDateTime_(
        new Date()
      )
  });
}


function doPost(e) {
  resetRequestCache_();
  const p =
    (e && e.parameter)
      ? e.parameter
      : {};

  const action =
    String(
      p.action || ''
    ).trim();

  const requestId =
    String(
      p.requestId || ''
    );

  let payload = {};

  try {
    payload =
      p.payload
        ? JSON.parse(
            p.payload
          )
        : {};
  } catch (err) {
    payload = {};
  }

  let response;

  try {
    response =
      route_(
        action,
        payload
      );
  } catch (err) {
    response = {
      ok: false,
      message:
        errorMessage_(
          err
        )
    };
  }

  // GitHub Pages / PWA 使用 hidden iframe 呼叫。
  // 回傳 postMessage，避免跨網域 fetch / CORS 問題。
  const html =
    '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<script>' +
    '(function(){' +
    'var msg=' +
    JSON.stringify({
      source: 'ksp-api',
      requestId: requestId,
      response: response
    }).replace(
      /</g,
      '\\u003c'
    ) +
    ';' +
    'try{window.parent.postMessage(msg,"*");}catch(e){}' +
    'try{window.top.postMessage(msg,"*");}catch(e){}' +
    '})();' +
    '</script></body></html>';

  return HtmlService
    .createHtmlOutput(
      html
    )
    .setXFrameOptionsMode(
      HtmlService
        .XFrameOptionsMode
        .ALLOWALL
    );
}


function route_(action, p) {
  switch (action) {

    case 'ping':
      return {
        ok: true,
        service:
          'KSP Security Fresh API',
        version:
          KSP.VERSION,
        rosterSource:
          KSP.SHEETS.ROSTER,
        time:
          formatDateTime_(
            new Date()
          )
      };

    case 'postEcho':
      return {
        ok: true,
        version:
          KSP.VERSION,
        echo:
          String(
            p.echo || ''
          ),
        time:
          formatDateTime_(
            new Date()
          )
      };

    case 'login':
      return login_(
        p.personId,
        p.password
      );

    case 'resumeLogin':
      return resumeLogin_(
        p.personId,
        p.sessionToken
      );

    case 'duty':
      return getDutyStatus_(
        p.personId
      );

    case 'todayRecords':
      return todayRecords_(
        p.personId
      );

    case 'dutyRecords':
      return dutyRecords_(
        p.personId
      );

    case 'dutyProgress':
      return dutyProgress_(
        p.personId
      );

    case 'dashboard':
      return dashboard_(
        p.personId
      );

    case 'clockIn':
      return clockIn_(
        p
      );

    case 'clockOut':
      return clockOut_(
        p
      );

    case 'patrol':
      return patrol_(
        p
      );

    // 舊版／快取中的前端可能仍送出 manualPatrol。
    // 與一般 patrol 使用完全相同的 QR + GPS + 班次 + 防重複驗證。
    case 'manualPatrol':
      return patrol_(
        p
      );

    // 指定時間登錄先前漏掉的巡查紀錄。
    // 巡查時間由使用者選擇，但 GPS 必須以「送出當下」的位置驗證巡查點。
    case 'patrolBackfill':
      return patrolBackfill_(
        p
      );

    case 'checkpoint':
      return checkpointByQr_(
        p.qr
      );

    case 'checkpointList':
      return checkpointList_();

    case 'specialExemptStatus':
      return specialExemptStatus_(
        p.personId,
        p.dutyDate
      );

    case 'specialExemptSet':
      return specialExemptSet_(
        p
      );

    case 'specialExemptCancel':
      return specialExemptCancel_(
        p
      );

    case 'substituteOptions':
      return substituteOptions_(
        p
      );

    case 'substituteSet':
      return substituteSet_(
        p
      );

    case 'substituteCancel':
      return substituteCancel_(
        p
      );

    case 'incident':
      return incident_(
        p
      );
case 'importRoster':
      return importRoster_(
        p
      );

    case 'importRosterStatus':
      return importRosterStatus_(
        p.year,
        p.month
      );

    case 'holidayList':
      return holidayList_(
        p.year,
        p.month
      );

    case 'holidaySave':
      return holidaySave_(
        p
      );

    case 'monthlyReportData':
      return monthlyReportData_(
        p
      );

    default:
      return {
        ok: false,
        message:
          '未知 API 動作：' +
          String(
            action || ''
          )
      };
  }
}


/* =========================================================
 * 3. 登入與人員
 * ========================================================= */

/* =========================================================
 * fresh-v1.14.14｜每日一次登入
 * 手機只保存 24 小時 session token，不保存明碼密碼。
 * ========================================================= */

function getSessionSecret_() {
  const props =
    PropertiesService
      .getScriptProperties();

  let secret =
    props.getProperty(
      'KSP_SESSION_SECRET'
    );

  if (!secret) {
    secret =
      Utilities.getUuid() +
      Utilities.getUuid();

    props.setProperty(
      'KSP_SESSION_SECRET',
      secret
    );
  }

  return secret;
}


function createDailySessionToken_(personId) {
  personId =
    normalizeId_(
      personId
    );

  const expiresAt =
    Date.now() +
    24 * 60 * 60 * 1000;

  const payload =
    personId +
    '|' +
    String(expiresAt);

  const body =
    Utilities.base64EncodeWebSafe(
      payload,
      Utilities.Charset.UTF_8
    );

  const signature =
    Utilities.base64EncodeWebSafe(
      Utilities.computeHmacSha256Signature(
        payload,
        getSessionSecret_()
      )
    );

  return {
    token:
      body +
      '.' +
      signature,
    expiresAt:
      expiresAt
  };
}


function verifyDailySession_(
  personId,
  token
) {
  personId =
    normalizeId_(
      personId
    );

  token =
    String(
      token || ''
    ).trim();

  if (
    !personId ||
    !token
  ) {
    return {
      ok: false,
      message:
        '登入憑證無效。'
    };
  }

  const parts =
    token.split('.');

  if (parts.length !== 2) {
    return {
      ok: false,
      message:
        '登入憑證格式不正確。'
    };
  }

  let payload = '';

  try {
    payload =
      Utilities
        .newBlob(
          Utilities.base64DecodeWebSafe(
            parts[0]
          )
        )
        .getDataAsString(
          'UTF-8'
        );
  } catch (err) {
    return {
      ok: false,
      message:
        '登入憑證無法解析。'
    };
  }

  const data =
    payload.split('|');

  if (data.length !== 2) {
    return {
      ok: false,
      message:
        '登入憑證內容不正確。'
    };
  }

  const tokenPersonId =
    normalizeId_(
      data[0]
    );

  const expiresAt =
    Number(
      data[1]
    );

  if (
    tokenPersonId !== personId ||
    !isFinite(expiresAt)
  ) {
    return {
      ok: false,
      message:
        '登入憑證與人員資料不符。'
    };
  }

  if (
    Date.now() >= expiresAt
  ) {
    return {
      ok: false,
      expired: true,
      message:
        '登入憑證已逾期，請重新登入。'
    };
  }

  const expected =
    Utilities.base64EncodeWebSafe(
      Utilities.computeHmacSha256Signature(
        payload,
        getSessionSecret_()
      )
    );

  if (expected !== parts[1]) {
    return {
      ok: false,
      message:
        '登入憑證驗證失敗。'
    };
  }

  const staff =
    getStaff_(
      personId
    );

  if (
    !staff ||
    staff.status !== '啟用'
  ) {
    return {
      ok: false,
      message:
        '此帳號目前未啟用。'
    };
  }

  return {
    ok: true,
    staff:
      staff,
    expiresAt:
      expiresAt
  };
}


function buildLoginResponse_(
  staff,
  now,
  session
) {
  const duty =
    findDutyForNow_(
      staff.personId,
      now
    );

  return {
    ok: true,
    person: {
      personId:
        staff.personId,
      name:
        staff.name,
      defaultShift:
        staff.defaultShift
    },
    duty:
      duty,
    patrolExempt:
      getPatrolExemptStatus_(
        now
      ),
    specialExempt:
      duty
        ? specialExemptStatus_(
            staff.personId,
            duty.dutyDate
          )
        : {
            ok: true,
            exempt: false,
            dutyDate: '',
            record: null
          },
    sessionToken:
      session.token,
    sessionExpiresAt:
      session.expiresAt,
    serverTime:
      formatDateTime_(
        now
      )
  };
}


function resumeLogin_(
  personId,
  sessionToken
) {
  const verified =
    verifyDailySession_(
      personId,
      sessionToken
    );

  if (!verified.ok) {
    return verified;
  }

  return buildLoginResponse_(
    verified.staff,
    new Date(),
    {
      token:
        sessionToken,
      expiresAt:
        verified.expiresAt
    }
  );
}


function login_(personId, password) {
  personId =
    normalizeId_(
      personId
    );

  password =
    String(
      password || ''
    ).trim();

  if (!personId) {
    return fail_(
      '請輸入人員編號。'
    );
  }

  if (!password) {
    return fail_(
      '請輸入密碼。'
    );
  }

  const staff =
    getStaff_(
      personId
    );

  if (!staff) {
    return fail_(
      '查無此人員編號。'
    );
  }

  if (staff.status !== '啟用') {
    return fail_(
      '此帳號目前未啟用。'
    );
  }

  if (
    String(
      staff.password || ''
    ) !== password
  ) {
    return fail_(
      '密碼不正確。'
    );
  }

  const now =
    new Date();

  const session =
    createDailySessionToken_(
      staff.personId
    );

  return buildLoginResponse_(
    staff,
    now,
    session
  );
}

function getStaff_(personId) {
  const sh =
    sheet_(
      KSP.SHEETS.STAFF
    );

  const lastRow =
    sh.getLastRow();

  if (lastRow < 2) {
    return null;
  }

  const rows =
    sh.getRange(
      2,
      1,
      lastRow - 1,
      6
    ).getDisplayValues();

  for (const r of rows) {
    if (
      normalizeId_(
        r[0]
      ) === personId
    ) {
      return {
        personId:
          normalizeId_(
            r[0]
          ),
        name:
          String(
            r[1] || ''
          ).trim(),
        phone:
          String(
            r[2] || ''
          ).trim(),
        defaultShift:
          String(
            r[3] || ''
          ).trim(),
        password:
          String(
            r[4] || ''
          ),
        status:
          String(
            r[5] || ''
          ).trim()
      };
    }
  }

  return null;
}


function staffMaps_() {
  const sh =
    sheet_(
      KSP.SHEETS.STAFF
    );

  const lastRow =
    sh.getLastRow();

  const rows =
    lastRow >= 2
      ? sh.getRange(
          2,
          1,
          lastRow - 1,
          6
        ).getDisplayValues()
      : [];

  const byId = {};
  const byName = {};

  rows.forEach(
    r => {
      const id =
        normalizeId_(
          r[0]
        );

      const name =
        String(
          r[1] || ''
        ).trim();

      const status =
        String(
          r[5] || ''
        ).trim();

      if (
        !id ||
        !name ||
        status !== '啟用'
      ) {
        return;
      }

      const item = {
        personId: id,
        name: name
      };

      byId[id] =
        item;

      if (!byName[name]) {
        byName[name] = [];
      }

      byName[name]
        .push(
          item
        );
    }
  );

  return {
    byId: byId,
    byName: byName
  };
}


/* =========================================================
 * 4. 唯一排班來源：匯入排班表
 * ========================================================= */


/* =========================================================
 * 代班設定：班表保留、上下班簽到停用
 * ========================================================= */

function ensureSubstitutionSheet_(
  ss
) {
  ss =
    ss ||
    getSpreadsheet_();

  let sh =
    ss.getSheetByName(
      KSP.SHEETS.SUBSTITUTIONS
    );

  if (!sh) {
    sh =
      ss.insertSheet(
        KSP.SHEETS.SUBSTITUTIONS
      );
  }

  const headers = [[
    '代班編號',
    '勤務日期',
    '班別',
    '原排班人員編號',
    '原排班姓名',
    '代班人員編號',
    '代班姓名',
    '原因',
    '說明',
    '設定時間',
    '設定者編號',
    '設定者姓名',
    '狀態',
    '取消時間',
    '取消者編號',
    '取消者姓名'
  ]];

  if (
    sh.getLastRow() === 0
  ) {
    sh.getRange(
      1,
      1,
      1,
      headers[0].length
    ).setValues(
      headers
    );

    sh.setFrozenRows(1);
  }

  return sh;
}


function getActiveStaffList_() {
  if (
    _KSP_REQ_CACHE.activeStaff !==
    null
  ) {
    return _KSP_REQ_CACHE.activeStaff;
  }

  const sh =
    sheet_(
      KSP.SHEETS.STAFF
    );

  const lastRow =
    sh.getLastRow();

  if (lastRow < 2) {
    _KSP_REQ_CACHE.activeStaff = [];
    return [];
  }

  _KSP_REQ_CACHE.activeStaff =
    sh.getRange(
      2,
      1,
      lastRow - 1,
      6
    ).getDisplayValues()
    .map(
      r => ({
        personId:
          normalizeId_(
            r[0]
          ),
        name:
          String(
            r[1] || ''
          ).trim(),
        defaultShift:
          String(
            r[3] || ''
          ).trim(),
        status:
          String(
            r[5] || ''
          ).trim()
      })
    )
    .filter(
      x =>
        x.personId &&
        x.status === '啟用'
    );

  return _KSP_REQ_CACHE.activeStaff;
}

function substituteOptions_(
  p
) {
  const verified =
    verifySpecialExemptPerson_(
      p.personId,
      p.password,
      p.sessionToken
    );

  if (!verified.ok) {
    return verified;
  }

  const dutyDate =
    normalizeDate_(
      p.dutyDate
    ) ||
    formatDate_(
      new Date()
    );

  const rawRoster =
    getRawRosterDuties_()
      .filter(
        d =>
          d.dutyDate ===
          dutyDate
      );

  const active =
    getActiveSubstitutions_(
      dutyDate
    );

  return {
    ok: true,
    dutyDate:
      dutyDate,
    roster:
      rawRoster.map(
        d => {
          const replacement =
            active.find(
              s =>
                s.originalPersonId ===
                  d.personId &&
                s.shift ===
                  d.shift
            );

          return {
            personId:
              d.personId,
            name:
              d.name,
            shift:
              d.shift,
            startTime:
              d.startTime,
            endTime:
              d.endTime,
            replaced:
              !!replacement,
            replacement:
              replacement
                ? {
                    substitutionId:
                      replacement.substitutionId,
                    substitutePersonId:
                      replacement.substitutePersonId,
                    substituteName:
                      replacement.substituteName,
                    reason:
                      replacement.reason,
                    note:
                      replacement.note
                  }
                : null
          };
        }
      ),
    staff:
      getActiveStaffList_(),
    activeSubstitutions:
      active.map(
        s => ({
          substitutionId:
            s.substitutionId,
          dutyDate:
            s.dutyDate,
          shift:
            s.shift,
          originalPersonId:
            s.originalPersonId,
          originalName:
            s.originalName,
          substitutePersonId:
            s.substitutePersonId,
          substituteName:
            s.substituteName,
          reason:
            s.reason,
          note:
            s.note,
          createdAt:
            s.createdAt,
          createdByName:
            s.createdByName
        })
      )
  };
}


function substituteSet_(
  p
) {
  const verified =
    verifySpecialExemptPerson_(
      p.personId,
      p.password,
      p.sessionToken
    );

  if (!verified.ok) {
    return verified;
  }

  const dutyDate =
    normalizeDate_(
      p.dutyDate
    );

  const shift =
    normalizeShift_(
      p.shift
    );

  const originalPersonId =
    normalizeId_(
      p.originalPersonId
    );

  const substitutePersonId =
    normalizeId_(
      p.substitutePersonId
    );

  if (
    !dutyDate ||
    !shift ||
    !originalPersonId ||
    !substitutePersonId
  ) {
    return fail_(
      '請完整選擇勤務日期、原排班人員及代班人員。'
    );
  }

  if (
    originalPersonId ===
    substitutePersonId
  ) {
    return fail_(
      '原排班人員與代班人員不可為同一人。'
    );
  }

  const originalDuty =
    getRawRosterDuties_()
      .find(
        d =>
          d.dutyDate ===
            dutyDate &&
          d.shift ===
            shift &&
          d.personId ===
            originalPersonId
      );

  if (!originalDuty) {
    return fail_(
      '班表中找不到此原排班勤務。'
    );
  }

  const substituteStaff =
    getStaff_(
      substitutePersonId
    );

  if (
    !substituteStaff ||
    substituteStaff.status !==
      '啟用'
  ) {
    return fail_(
      '代班人員資料無效或未啟用。'
    );
  }

  const reason =
    String(
      p.reason || '請假代班'
    ).trim();

  const note =
    String(
      p.note || ''
    )
      .trim()
      .slice(
        0,
        300
      );

  const sh =
    ensureSubstitutionSheet_();

  const now =
    new Date();

  const nowText =
    formatDateTime_(
      now
    );

  // 同一原排班勤務一次只保留一筆啟用中的代班。
  getActiveSubstitutions_(
    dutyDate,
    shift
  )
    .filter(
      s =>
        s.originalPersonId ===
          originalPersonId
    )
    .forEach(
      old => {
        sh.getRange(
          old.row,
          13,
          1,
          4
        ).setValues([[
          '已更換',
          nowText,
          verified.staff.personId,
          verified.staff.name
        ]]);
      }
    );

  const substitutionId =
    'SUB-' +
    Utilities
      .getUuid()
      .slice(
        0,
        8
      )
      .toUpperCase();

  sh.appendRow([
    substitutionId,
    dutyDate,
    shift,
    originalPersonId,
    originalDuty.name,
    substitutePersonId,
    substituteStaff.name,
    reason,
    note,
    nowText,
    verified.staff.personId,
    verified.staff.name,
    '啟用',
    '',
    '',
    ''
  ]);

  _KSP_REQ_CACHE.substitutions = null;

  return {
    ok: true,
    substitutionId:
      substitutionId,
    dutyDate:
      dutyDate,
    shift:
      shift,
    originalPersonId:
      originalPersonId,
    originalName:
      originalDuty.name,
    substitutePersonId:
      substitutePersonId,
    substituteName:
      substituteStaff.name,
    message:
      originalDuty.name +
      ' 已改由 ' +
      substituteStaff.name +
      ' 代班。'
  };
}


function substituteCancel_(
  p
) {
  const verified =
    verifySpecialExemptPerson_(
      p.personId,
      p.password,
      p.sessionToken
    );

  if (!verified.ok) {
    return verified;
  }

  const substitutionId =
    String(
      p.substitutionId || ''
    ).trim();

  if (!substitutionId) {
    return fail_(
      '缺少代班編號。'
    );
  }

  const sh =
    ensureSubstitutionSheet_();

  const records =
    getAllSubstitutionRecords_();

  const target =
    records.find(
      x =>
        x.substitutionId ===
          substitutionId &&
        x.status ===
          '啟用'
    );

  if (!target) {
    return fail_(
      '此代班設定已不存在或已取消。'
    );
  }

  const nowText =
    formatDateTime_(
      new Date()
    );

  sh.getRange(
    target.row,
    13,
    1,
    4
  ).setValues([[
    '已取消',
    nowText,
    verified.staff.personId,
    verified.staff.name
  ]]);

  _KSP_REQ_CACHE.substitutions = null;

  return {
    ok: true,
    substitutionId:
      substitutionId,
    message:
      target.substituteName +
      ' 的代班設定已取消，恢復原班表。'
  };
}



/**
 * 首頁快速資料：
 * 一次回傳勤務、紀錄、巡查進度、特殊狀態，
 * 避免前端為同一畫面連續呼叫 4 次 Apps Script。
 */
function dashboard_(
  personId
) {
  personId =
    normalizeId_(
      personId
    );

  if (!personId) {
    return fail_(
      '缺少人員編號。'
    );
  }

  const now =
    new Date();

  const duty =
    findDutyForNow_(
      personId,
      now
    );

  // 上下班狀態優先獨立取得。
  // 即使巡查進度／特殊勤務讀取失敗，也不能把已簽到判回未簽到。
  const clockStatus =
    getDutyClockStatus_(
      personId,
      duty
    );

  let records = [];
  let progress = null;
  let specialExempt = null;
  const warnings = [];

  try {
    const recordsResult =
      dutyRecords_(
        personId
      );

    records =
      recordsResult &&
      Array.isArray(
        recordsResult.records
      )
        ? recordsResult.records
        : [];
  } catch (err) {
    warnings.push(
      '勤務紀錄讀取失敗：' +
      String(
        err &&
        err.message
          ? err.message
          : err
      )
    );
  }

  // 若提早上班簽到被嚴格 duty window 排除，
  // 將簽到紀錄補入前端本班紀錄，避免狀態不同步。
  if (
    clockStatus.clockInRecord &&
    !records.some(
      x =>
        String(
          x.action || ''
        ) === '上班簽到'
    )
  ) {
    records.unshift(
      clockStatus.clockInRecord
    );
  }

  if (
    clockStatus.clockOutRecord &&
    !records.some(
      x =>
        String(
          x.action || ''
        ) === '下班簽退'
    )
  ) {
    records.push(
      clockStatus.clockOutRecord
    );
  }

  try {
    progress =
      dutyProgress_(
        personId
      );
  } catch (err) {
    warnings.push(
      '巡查進度讀取失敗：' +
      String(
        err &&
        err.message
          ? err.message
          : err
      )
    );
  }

  try {
    specialExempt =
      specialExemptStatus_(
        personId,
        duty
          ? duty.dutyDate
          : ''
      );
  } catch (err) {
    warnings.push(
      '特殊勤務讀取失敗：' +
      String(
        err &&
        err.message
          ? err.message
          : err
      )
    );

    specialExempt = {
      ok: true,
      exempt: false,
      activeNow: false,
      record: null
    };
  }

  return {
    ok: true,
    duty:
      duty || null,
    clockStatus:
      clockStatus,
    records:
      records,
    progress:
      progress,
    specialExempt:
      specialExempt,
    warnings:
      warnings,
    serverTime:
      formatDateTime_(
        now
      )
  };
}

function getDutyStatus_(personId) {
  personId =
    normalizeId_(
      personId
    );

  if (!personId) {
    return fail_(
      '缺少人員編號。'
    );
  }

  const now =
    new Date();

  return {
    ok: true,
    duty:
      findDutyForNow_(
        personId,
        now
      ),
    patrolExempt:
      getPatrolExemptStatus_(
        now
      ),
    specialExempt:
      (function(){
        const d =
          findDutyForNow_(
            personId,
            now
          );

        return d
          ? specialExemptStatus_(
              personId,
              d.dutyDate
            )
          : {
              ok: true,
              exempt: false,
              dutyDate: '',
              record: null
            };
      })(),
    serverTime:
      formatDateTime_(
        now
      )
  };
}


function findDutyForNow_(
  personId,
  now
) {
  const duties =
    getPersonRoster_(
      personId
    );

  if (!duties.length) {
    return null;
  }

  const nowMs =
    now.getTime();

  const active = [];

  duties.forEach(
    duty => {
      const win =
        dutyWindow_(
          duty
        );

      if (
        nowMs >=
          win.start.getTime() &&
        nowMs <=
          win.end.getTime()
      ) {
        active.push({
          duty: duty,
          start:
            win.start.getTime()
        });
      }
    }
  );

  if (active.length) {
    active.sort(
      (a,b) =>
        b.start -
        a.start
    );

    return active[0]
      .duty;
  }

  // 不在勤務時間時，若今天有班仍回傳今天班別。
  const today =
    formatDate_(
      now
    );

  const todayDuty =
    duties.find(
      d =>
        d.dutyDate ===
        today
    );

  return todayDuty || null;
}


function rawRosterDutyFromRow_(
  r
) {
  const date =
    normalizeDate_(
      r[0]
    );

  if (!date) {
    return null;
  }

  const id =
    normalizeId_(
      r[1]
    );

  if (!id) {
    return null;
  }

  const shift =
    normalizeShift_(
      r[3]
    );

  if (!shift) {
    return null;
  }

  const start =
    timeText_(
      r[4]
    ) ||
    (
      shift === '晚班'
        ? KSP.DEFAULTS.NIGHT_START
        : KSP.DEFAULTS.DAY_START
    );

  const end =
    timeText_(
      r[5]
    ) ||
    (
      shift === '晚班'
        ? KSP.DEFAULTS.NIGHT_END
        : KSP.DEFAULTS.DAY_END
    );

  return {
    dutyDate: date,
    personId: id,
    name:
      String(
        r[2] || ''
      ).trim(),
    shift: shift,
    startTime: start,
    endTime: end,
    crossDay:
      shift === '晚班' ||
      minutesOf_(end) <
      minutesOf_(start),
    source:
      String(
        r[6] || ''
      ).trim(),
    isSubstitute: false,
    substituteForId: '',
    substituteForName: '',
    substitutionId: ''
  };
}


function getRawRosterDuties_() {
  if (
    _KSP_REQ_CACHE.rawRoster !==
    null
  ) {
    return _KSP_REQ_CACHE.rawRoster;
  }

  const sh =
    sheet_(
      KSP.SHEETS.ROSTER
    );

  const lastRow =
    sh.getLastRow();

  if (lastRow < 2) {
    _KSP_REQ_CACHE.rawRoster = [];
    return [];
  }

  _KSP_REQ_CACHE.rawRoster =
    sh.getRange(
      2,
      1,
      lastRow - 1,
      8
    )
    .getValues()
    .map(
      rawRosterDutyFromRow_
    )
    .filter(Boolean);

  return _KSP_REQ_CACHE.rawRoster;
}


function getRawPersonRoster_(
  personId
) {
  personId =
    normalizeId_(
      personId
    );

  return getRawRosterDuties_()
    .filter(
      d =>
        d.personId ===
        personId
    )
    .sort(
      (a,b) =>
        a.dutyDate
          .localeCompare(
            b.dutyDate
          )
    );
}


function getAllSubstitutionRecords_(
  dutyDate,
  shift
) {
  if (
    _KSP_REQ_CACHE.substitutions ===
    null
  ) {
    const sh =
      ensureSubstitutionSheet_();

    const lastRow =
      sh.getLastRow();

    if (lastRow < 2) {
      _KSP_REQ_CACHE.substitutions = [];
    } else {
      const rows =
        sh.getRange(
          2,
          1,
          lastRow - 1,
          16
        ).getDisplayValues();

      _KSP_REQ_CACHE.substitutions =
        rows.map(
          (r,index) => ({
            row:
              index + 2,
            substitutionId:
              String(r[0]||'').trim(),
            dutyDate:
              normalizeDate_(r[1]),
            shift:
              String(r[2]||'').trim(),
            originalPersonId:
              normalizeId_(r[3]),
            originalName:
              String(r[4]||'').trim(),
            substitutePersonId:
              normalizeId_(r[5]),
            substituteName:
              String(r[6]||'').trim(),
            reason:
              String(r[7]||'').trim(),
            note:
              String(r[8]||'').trim(),
            createdAt:
              String(r[9]||'').trim(),
            createdById:
              normalizeId_(r[10]),
            createdByName:
              String(r[11]||'').trim(),
            status:
              String(r[12]||'').trim(),
            cancelledAt:
              String(r[13]||'').trim(),
            cancelledById:
              normalizeId_(r[14]),
            cancelledByName:
              String(r[15]||'').trim()
          })
        );
    }
  }

  dutyDate =
    dutyDate
      ? normalizeDate_(
          dutyDate
        )
      : '';

  shift =
    String(
      shift || ''
    ).trim();

  return _KSP_REQ_CACHE.substitutions
    .filter(
      x =>
        (
          !dutyDate ||
          x.dutyDate === dutyDate
        ) &&
        (
          !shift ||
          x.shift === shift
        )
    );
}

function getActiveSubstitutions_(
  dutyDate,
  shift
) {
  return getAllSubstitutionRecords_(
    dutyDate,
    shift
  ).filter(
    x =>
      x.status === '啟用'
  );
}


function getEffectiveRosterDuties_() {
  const raw =
    getRawRosterDuties_();

  const active =
    getActiveSubstitutions_();

  let effective =
    raw.map(
      d =>
        Object.assign(
          {},
          d
        )
    );

  active.forEach(
    sub => {
      const originalDuty =
        raw.find(
          d =>
            d.dutyDate ===
              sub.dutyDate &&
            d.shift ===
              sub.shift &&
            d.personId ===
              sub.originalPersonId
        );

      if (!originalDuty) {
        return;
      }

      // 原排班人員請假／被替代後，不再取得該筆有效勤務。
      effective =
        effective.filter(
          d =>
            !(
              d.dutyDate ===
                sub.dutyDate &&
              d.shift ===
                sub.shift &&
              d.personId ===
                sub.originalPersonId
            )
        );

      const staff =
        getStaff_(
          sub.substitutePersonId
        );

      const replacement =
        Object.assign(
          {},
          originalDuty,
          {
            personId:
              sub.substitutePersonId,
            name:
              staff
                ? staff.name
                : sub.substituteName,
            source:
              '代班設定',
            isSubstitute:
              true,
            substituteForId:
              sub.originalPersonId,
            substituteForName:
              sub.originalName,
            substitutionId:
              sub.substitutionId
          }
        );

      const sameExists =
        effective.some(
          d =>
            d.dutyDate ===
              replacement.dutyDate &&
            d.shift ===
              replacement.shift &&
            d.personId ===
              replacement.personId &&
            d.startTime ===
              replacement.startTime &&
            d.endTime ===
              replacement.endTime
        );

      if (!sameExists) {
        effective.push(
          replacement
        );
      }
    }
  );

  return effective.sort(
    (a,b) => {
      const byDate =
        a.dutyDate.localeCompare(
          b.dutyDate
        );

      if (byDate) {
        return byDate;
      }

      return String(
        a.startTime
      ).localeCompare(
        String(
          b.startTime
        )
      );
    }
  );
}


function getPersonRoster_(
  personId
) {
  personId =
    normalizeId_(
      personId
    );

  return getEffectiveRosterDuties_()
    .filter(
      d =>
        d.personId ===
        personId
    );
}


/**
 * 共同巡查進度需保留整班歷史：
 * - 原排班人員在代班設定前完成的巡查仍算數。
 * - 代班人員完成的巡查也算數。
 * - 即使後來取消代班，先前已完成的巡查不會消失。
 */
function getShiftRelatedPersonIds_(
  dutyDate,
  shift
) {
  dutyDate =
    normalizeDate_(
      dutyDate
    );

  shift =
    String(
      shift || ''
    ).trim();

  const ids = [];

  getRawRosterDuties_()
    .filter(
      d =>
        d.dutyDate ===
          dutyDate &&
        d.shift ===
          shift
    )
    .forEach(
      d =>
        ids.push(
          d.personId
        )
    );

  getAllSubstitutionRecords_(
    dutyDate,
    shift
  ).forEach(
    s => {
      if (
        s.originalPersonId
      ) {
        ids.push(
          s.originalPersonId
        );
      }

      if (
        s.substitutePersonId
      ) {
        ids.push(
          s.substitutePersonId
        );
      }
    }
  );

  return [
    ...new Set(
      ids.filter(Boolean)
    )
  ];
}

function dutyWindow_(
  duty
) {
  const p =
    duty.dutyDate
      .split('/')
      .map(Number);

  const startParts =
    duty.startTime
      .split(':')
      .map(Number);

  const endParts =
    duty.endTime
      .split(':')
      .map(Number);

  const start =
    new Date(
      p[0],
      p[1] - 1,
      p[2],
      startParts[0],
      startParts[1],
      0,
      0
    );

  const end =
    new Date(
      p[0],
      p[1] - 1,
      p[2],
      endParts[0],
      endParts[1],
      0,
      0
    );

  if (
    duty.crossDay ||
    end.getTime() <=
    start.getTime()
  ) {
    end.setDate(
      end.getDate() + 1
    );
  }

  return {
    start: start,
    end: end
  };
}


/* =========================================================
 * 5. 上班簽到 / 下班簽退
 * ========================================================= */


/**
 * 取得勤務日期的次日文字，供跨日晚班簽退判定。
 */
function nextDutyDateText_(
  dutyDate
) {
  const d =
    parseImportDate_(
      dutyDate
    );

  if (!d) {
    return '';
  }

  d.setDate(
    d.getDate() + 1
  );

  return formatDate_(
    d
  );
}


/**
 * 上下班狀態不再依 dutyRecords_ 的嚴格勤務時段過濾。
 *
 * 原因：
 * 保全可能在正式班別開始前幾分鐘先完成上班簽到。
 * clockAction_ 會成功寫入，但舊版 dutyRecords_ 會把
 * 06:00 前的紀錄排除，導致首頁又判成「尚未上班」。
 *
 * 晚班簽退則可能落在次日，因此下班簽退需接受次日日期。
 */
function findDutyClockAction_(
  personId,
  action,
  duty
) {
  personId =
    normalizeId_(
      personId
    );

  if (
    !personId ||
    !duty
  ) {
    return null;
  }

  const allowedDates = [
    duty.dutyDate
  ];

  if (
    action === '下班簽退' &&
    duty.crossDay
  ) {
    const nextDate =
      nextDutyDateText_(
        duty.dutyDate
      );

    if (nextDate) {
      allowedDates.push(
        nextDate
      );
    }
  }

  const sh =
    sheet_(
      KSP.SHEETS.LOG
    );

  const lastRow =
    sh.getLastRow();

  if (lastRow < 2) {
    return null;
  }

  const rows =
    sh.getRange(
      2,
      1,
      lastRow - 1,
      12
    ).getValues();

  for (
    let i =
      rows.length - 1;
    i >= 0;
    i--
  ) {
    const r =
      rows[i];

    if (
      normalizeId_(
        r[3]
      ) !== personId ||
      String(
        r[5] || ''
      ).trim() !== action
    ) {
      continue;
    }

    const rowDate =
      normalizeDate_(
        r[1]
      );

    if (
      allowedDates.includes(
        rowDate
      )
    ) {
      return {
        recordId:
          String(
            r[0] || ''
          ).trim(),
        date:
          rowDate,
        time:
          timeText_(
            r[2]
          ),
        action:
          action
      };
    }
  }

  return null;
}


function getDutyClockStatus_(
  personId,
  duty
) {
  if (!duty) {
    return {
      clockedIn: false,
      clockedOut: false,
      clockInRecord: null,
      clockOutRecord: null
    };
  }

  const clockInRecord =
    findDutyClockAction_(
      personId,
      '上班簽到',
      duty
    );

  const clockOutRecord =
    findDutyClockAction_(
      personId,
      '下班簽退',
      duty
    );

  return {
    clockedIn:
      !!clockInRecord,
    clockedOut:
      !!clockOutRecord,
    clockInRecord:
      clockInRecord,
    clockOutRecord:
      clockOutRecord
  };
}


function clockIn_(p) {
  return clockAction_(
    p,
    '上班簽到'
  );
}


function clockOut_(p) {
  return clockAction_(
    p,
    '下班簽退'
  );
}


function clockAction_(
  p,
  action
) {
  const personId =
    normalizeId_(
      p.personId
    );

  const staff =
    getStaff_(
      personId
    );

  if (
    !staff ||
    staff.status !== '啟用'
  ) {
    return fail_(
      '人員資料無效。'
    );
  }

  const now =
    new Date();

  const duty =
    findDutyForNow_(
      personId,
      now
    );

  if (!duty) {
    return fail_(
      '目前沒有可執行的勤務班表。'
    );
  }

  const gps =
    validateMainGps_(
      p.lat,
      p.lng
    );

  if (!gps.ok) {
    return gps;
  }

  const same =
    findDutyClockAction_(
      personId,
      action,
      duty
    );

  if (same) {
    return fail_(
      action +
      '已完成，請勿重複操作。'
    );
  }

  const recordId =
    appendLog_({
      when: now,
      personId:
        personId,
      name:
        staff.name,
      action:
        action,
      checkpointId:
        '',
      checkpointName:
        '',
      lat:
        Number(
          p.lat
        ),
      lng:
        Number(
          p.lng
        ),
      distance:
        gps.distance,
      result:
        '通過'
    });

  return {
    ok: true,
    recordId:
      recordId,
    action:
      action,
    duty:
      duty,
    distance:
      gps.distance,
    serverTime:
      formatDateTime_(
        now
      ),
    message:
      action +
      '完成。'
  };
}


/* =========================================================
 * 6. QR 定點巡查
 * ========================================================= */

function checkpointList_() {
  const sh =
    sheet_(
      KSP.SHEETS.CHECKPOINTS
    );

  const lastRow =
    sh.getLastRow();

  if (lastRow < 2) {
    return {
      ok: true,
      checkpoints: []
    };
  }

  const rows =
    sh.getRange(
      2,
      1,
      lastRow - 1,
      7
    ).getValues();

  const checkpoints =
    rows
      .map(
        r => {
          const lat =
            numberOrNull_(
              r[2]
            );

          const lng =
            numberOrNull_(
              r[3]
            );

          return {
            checkpointId:
              String(
                r[0] || ''
              ).trim(),
            name:
              String(
                r[1] || ''
              ).trim(),
            lat:
              lat,
            lng:
              lng,
            radius:
              Number(
                r[4]
              ) || 100,
            qr:
              String(
                r[5] || ''
              ).trim(),
            status:
              String(
                r[6] || ''
              ).trim(),
            gpsConfigured:
              lat !== null &&
              lng !== null
          };
        }
      )
      .filter(
        x =>
          x.checkpointId
      );

  return {
    ok: true,
    checkpoints:
      checkpoints
  };
}


function checkpointByQr_(qr) {
  const cp =
    getCheckpointByQr_(
      qr
    );

  if (!cp) {
    return fail_(
      '無法辨識此巡查點 QR。'
    );
  }

  return {
    ok: true,
    checkpoint: cp
  };
}



function getSharedDutyPersonIds_(
  duty
) {
  if (!duty) {
    return [];
  }

  return getShiftRelatedPersonIds_(
    duty.dutyDate,
    duty.shift
  );
}

function getSharedPatrolSlot_(duty,when) {
  const win=dutyWindow_(duty);
  const SLOT_HOURS=1;
  let cursor=new Date(win.start.getTime());
  while (cursor.getTime()<win.end.getTime()) {
    const slotStart=new Date(cursor.getTime());
    const slotEnd=new Date(Math.min(slotStart.getTime()+SLOT_HOURS*60*60*1000,win.end.getTime()));
    if (when.getTime()>=slotStart.getTime() && when.getTime()<slotEnd.getTime()) {
      return {start:slotStart,end:slotEnd,startTime:Utilities.formatDate(slotStart,KSP.TZ,'HH:mm'),endTime:Utilities.formatDate(slotEnd,KSP.TZ,'HH:mm')};
    }
    cursor=slotEnd;
  }
  return null;
}

function findSharedPointPatrol_(duty,checkpointId,slot) {
  if (!duty || !checkpointId || !slot) return null;
  const personIds=getSharedDutyPersonIds_(duty);
  if (!personIds.length) return null;
  const sh=sheet_(KSP.SHEETS.LOG);
  const lastRow=sh.getLastRow();
  if (lastRow < 2) return null;
  const rows=sh.getRange(2,1,lastRow-1,12).getValues();
  for (const r of rows) {
    const personId=normalizeId_(r[3]);
    if (!personIds.includes(personId)) continue;
    const action=String(r[5]||'').trim();
    if (action!=='定點巡查' && action!=='定點巡查指定時間登錄') continue;
    const cpId=String(r[6]||'').trim().toUpperCase();
    if (cpId!==checkpointId) continue;
    const dt=dateTimeFromText_(normalizeDate_(r[1]),timeText_(r[2]));
    if (!dt) continue;
    if (dt.getTime()<slot.start.getTime() || dt.getTime()>=slot.end.getTime()) continue;
    return {personId,name:String(r[4]||'').trim(),time:timeText_(r[2]),checkpointId:cpId,checkpointName:String(r[7]||'').trim()};
  }
  return null;
}

function patrol_(p) {
  const personId =
    normalizeId_(
      p.personId
    );

  const staff =
    getStaff_(
      personId
    );

  if (
    !staff ||
    staff.status !== '啟用'
  ) {
    return fail_(
      '人員資料無效。'
    );
  }

  const now =
    new Date();

  const duty =
    findDutyForNow_(
      personId,
      now
    );

  if (!duty) {
    return fail_(
      '目前沒有勤務班表，不能執行巡查。'
    );
  }

  const exempt =
    getPatrolExemptStatus_(
      now
    );

  if (exempt.exempt) {
    return fail_(
      '目前為免巡查時段：' +
      exempt.reason
    );
  }

  const cp =
    getCheckpointByQr_(
      p.qr
    );

  if (!cp) {
    return fail_(
      '巡查點 QR 不正確。'
    );
  }

  const gps =
    validateCheckpointGps_(
      cp,
      p.lat,
      p.lng
    );

  if (!gps.ok) {
    return gps;
  }

  const sharedSlot = getSharedPatrolSlot_(duty,now);
  if (!sharedSlot) return fail_('目前不在有效巡查時段內。');

  const sharedDone = findSharedPointPatrol_(duty,cp.checkpointId,sharedSlot);
  if (sharedDone) {
    return {
      ok:false,
      code:'SHARED_POINT_ALREADY_DONE',
      message:'本時段 '+cp.checkpointId+' 已由 '+(sharedDone.name||sharedDone.personId)+' 於 '+sharedDone.time+' 完成巡查，無須重複打卡。',
      checkpoint:cp,
      sharedSlot:{startTime:sharedSlot.startTime,endTime:sharedSlot.endTime},
      completedBy:{personId:sharedDone.personId,name:sharedDone.name,time:sharedDone.time}
    };
  }

  const recordId =
    appendLog_({
      when: now,
      personId:
        personId,
      name:
        staff.name,
      action:
        '定點巡查',
      checkpointId:
        cp.checkpointId,
      checkpointName:
        cp.name,
      lat:
        Number(
          p.lat
        ),
      lng:
        Number(
          p.lng
        ),
      distance:
        gps.distance,
      result:
        '通過'
    });

  return {
    ok: true,
    recordId:
      recordId,
    checkpoint:
      cp,
    distance:
      gps.distance,
    serverTime:
      formatDateTime_(
        now
      ),
    message:
      cp.name +
      ' 巡查完成。'
  };
}



/**
 * 解析 HTML datetime-local：YYYY-MM-DDTHH:mm
 * 以 Apps Script 專案時區的本地年月日時分建立 Date。
 */
function parseLocalDateTimeInput_(
  value
) {
  const text =
    String(
      value || ''
    ).trim();

  const m =
    text.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
    );

  if (!m) {
    return null;
  }

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);

  const dt =
    new Date(
      y,
      mo - 1,
      d,
      h,
      mi,
      0,
      0
    );

  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d ||
    dt.getHours() !== h ||
    dt.getMinutes() !== mi
  ) {
    return null;
  }

  return dt;
}


/**
 * 指定時間登錄「本班前面未打卡」的巡查。
 *
 * 核心原則：
 * 1. 巡查時間可由保全自行選擇，但必須早於目前伺服器時間。
 * 2. 巡查時間必須落在目前班次的勤務起訖時間內。
 * 3. GPS 使用「送出當下」的手機定位，而且必須位於該巡查點範圍內。
 * 4. 所選時間如果是免巡查時段，不需要也不能指定時間登錄。
 * 5. 同班同一時段同一巡查點若已完成，不重複登錄。
 * 6. 紀錄日期/時間採使用者選的巡查時間；result 欄保留實際送出時間供稽核。
 */
function patrolBackfill_(
  p
) {
  const personId =
    normalizeId_(
      p.personId
    );

  const staff =
    getStaff_(
      personId
    );

  if (
    !staff ||
    staff.status !==
      '啟用'
  ) {
    return fail_(
      '人員資料無效。'
    );
  }

  const now =
    new Date();

  const duty =
    findDutyForNow_(
      personId,
      now
    );

  if (!duty) {
    return fail_(
      '目前查無可指定時間登錄的勤務班表。'
    );
  }

  const selectedWhen =
    parseLocalDateTimeInput_(
      p.backfillDateTime
    );

  if (!selectedWhen) {
    return fail_(
      '請選擇正確的巡查日期與時間。'
    );
  }

  if (
    selectedWhen.getTime() >=
    now.getTime()
  ) {
    return fail_(
      '巡查時間必須早於目前時間。'
    );
  }

  const win =
    dutyWindow_(
      duty
    );

  if (
    selectedWhen.getTime() <
      win.start.getTime() ||
    selectedWhen.getTime() >=
      win.end.getTime()
  ) {
    return fail_(
      '巡查時間必須位於本班勤務時間 ' +
      duty.startTime +
      '～' +
      duty.endTime +
      ' 內。'
    );
  }

  const exempt =
    getPatrolExemptStatus_(
      selectedWhen
    );

  if (exempt.exempt) {
    return fail_(
      '所選巡查時間為免巡查時段，無須登錄：' +
      exempt.reason
    );
  }

  const cp =
    getCheckpointByQr_(
      p.qr
    );

  if (!cp) {
    return fail_(
      '巡查點代碼不正確，請選擇 P01～P05。'
    );
  }

  // GPS 一律使用「現在」的位置驗證，不能使用指定巡查時間的歷史定位。
  const gps =
    validateCheckpointGps_(
      cp,
      p.lat,
      p.lng
    );

  if (!gps.ok) {
    return gps;
  }

  const slot =
    getSharedPatrolSlot_(
      duty,
      selectedWhen
    );

  if (!slot) {
    return fail_(
      '所選巡查時間不在有效巡查時段內。'
    );
  }

  const sharedDone =
    findSharedPointPatrol_(
      duty,
      cp.checkpointId,
      slot
    );

  if (sharedDone) {
    return {
      ok: false,
      code:
        'SHARED_POINT_ALREADY_DONE',
      message:
        '所選時段 ' +
        slot.startTime +
        '–' +
        slot.endTime +
        ' 的 ' +
        cp.checkpointId +
        ' 已由 ' +
        (
          sharedDone.name ||
          sharedDone.personId
        ) +
        ' 於 ' +
        sharedDone.time +
        ' 完成，無須重複登錄。',
      checkpoint:
        cp,
      sharedSlot: {
        startTime:
          slot.startTime,
        endTime:
          slot.endTime
      },
      completedBy: {
        personId:
          sharedDone.personId,
        name:
          sharedDone.name,
        time:
          sharedDone.time
      }
    };
  }

  const submitText =
    formatDateTime_(
      now
    );

  const selectedText =
    formatDateTime_(
      selectedWhen
    );

  const recordId =
    appendLog_({
      when:
        selectedWhen,
      personId:
        personId,
      name:
        staff.name,
      action:
        '定點巡查指定時間登錄',
      checkpointId:
        cp.checkpointId,
      checkpointName:
        cp.name,
      lat:
        Number(
          p.lat
        ),
      lng:
        Number(
          p.lng
        ),
      distance:
        gps.distance,
      result:
        '指定時間登錄通過｜巡查時間 ' +
        selectedText +
        '｜實際送出 ' +
        submitText
    });

  return {
    ok: true,
    backfill: true,
    recordId:
      recordId,
    checkpoint:
      cp,
    distance:
      gps.distance,
    backfillTime:
      selectedText,
    submittedAt:
      submitText,
    sharedSlot: {
      startTime:
        slot.startTime,
      endTime:
        slot.endTime
    },
    message:
      cp.name +
      ' 已登錄巡查時間 ' +
      selectedText +
      '；GPS 現場驗證通過。'
  };
}


function getCheckpointByQr_(
  qr
) {
  qr =
    String(
      qr || ''
    )
      .trim()
      .toUpperCase()
      .replace(
        /\s+/g,
        ''
      )
      .replace(
        /^KSP[-_]?/,
        ''
      );

  if (!qr) {
    return null;
  }

  const sh =
    sheet_(
      KSP.SHEETS.CHECKPOINTS
    );

  const lastRow =
    sh.getLastRow();

  if (lastRow < 2) {
    return null;
  }

  const rows =
    sh.getRange(
      2,
      1,
      lastRow - 1,
      7
    ).getValues();

  for (const r of rows) {
    if (
      String(
        r[6] || ''
      ).trim() !==
      '啟用'
    ) {
      continue;
    }

    const checkpointId =
      String(
        r[0] || ''
      )
        .trim()
        .toUpperCase()
        .replace(
          /^KSP[-_]?/,
          ''
        );

    const code =
      String(
        r[5] || ''
      )
        .trim()
        .toUpperCase()
        .replace(
          /^KSP[-_]?/,
          ''
        );

    // 人工輸入可用 P01～P05；
    // 舊版 KSP-P01 會先正規化為 P01；
    // 同時支援 A欄巡查點編號與 F欄 QR 識別碼。
    if (
      code === qr ||
      checkpointId === qr
    ) {
      return {
        checkpointId:
          String(
            r[0] || ''
          ).trim(),
        name:
          String(
            r[1] || ''
          ).trim(),
        lat:
          numberOrNull_(
            r[2]
          ),
        lng:
          numberOrNull_(
            r[3]
          ),
        radius:
          Number(
            r[4]
          ) || 100,
        qr:
          String(
            r[5] || ''
          ).trim(),
        status:
          String(
            r[6] || ''
          ).trim()
      };
    }
  }

  return null;
}

function dutyProgress_(personId) {
  personId=normalizeId_(personId);
  if (!personId) return fail_('缺少人員編號。');

  const PATROL_INTERVAL_HOURS=1;
  const REQUIRED_POINTS=[
    {id:'P01',name:'公園崗哨'},
    {id:'P02',name:'智科大樓'},
    {id:'P03',name:'鴻海大樓北側'},
    {id:'P04',name:'A棟大樓後方'},
    {id:'P05',name:'C棟大樓後方'}
  ];

  const now=new Date();
  const duty=findDutyForNow_(personId,now);

  if (!duty) {
    return {
      ok:true,
      duty:null,
      sharedDuty:true,
      patrolIntervalHours:PATROL_INTERVAL_HOURS,
      requiredPeriods:0,
      requiredHours:0,
      requiredChecks:0,
      completedChecks:0,
      completedPeriods:0,
      completedHours:0,
      missedChecks:0,
      points:REQUIRED_POINTS,
      sharedPersonIds:[],
      slots:[]
    };
  }

  const sharedPersonIds=getSharedDutyPersonIds_(duty);
  const win=dutyWindow_(duty);
  const patrols=[];
  const logSheet=sheet_(KSP.SHEETS.LOG);
  const lastRow=logSheet.getLastRow();

  if (lastRow>=2) {
    const rows=logSheet.getRange(2,1,lastRow-1,12).getValues();

    rows.forEach(r=>{
      const pid=normalizeId_(r[3]);
      if (!sharedPersonIds.includes(pid)) return;

      const action=String(r[5]||'').trim();
      if (
        action!=='定點巡查' &&
        action!=='定點巡查指定時間登錄'
      ) return;

      const dt=dateTimeFromText_(
        normalizeDate_(r[1]),
        timeText_(r[2])
      );

      if (
        !dt ||
        dt.getTime()<win.start.getTime() ||
        dt.getTime()>=win.end.getTime()
      ) return;

      patrols.push({
        when:dt,
        time:timeText_(r[2]),
        personId:pid,
        personName:String(r[4]||'').trim(),
        checkpointId:String(r[6]||'').trim().toUpperCase(),
        checkpointName:String(r[7]||'').trim()
      });
    });
  }

  const shiftSpecialEntries=
    getShiftSpecialExemptEntries_(
      personId,
      duty.dutyDate
    );

  const shiftSpecialWindows=
    shiftSpecialEntries
      .map(
        entry => ({
          entry:entry,
          win:
            specialExemptWindow_(
              duty,
              entry
            )
        })
      )
      .filter(
        x => !!x.win
      );

  const slots=[];
  let cursor=new Date(win.start.getTime());

  while (cursor.getTime()<win.end.getTime()) {
    const slotStart=new Date(cursor.getTime());
    const slotEnd=new Date(
      Math.min(
        slotStart.getTime()+
          PATROL_INTERVAL_HOURS*60*60*1000,
        win.end.getTime()
      )
    );

    const exemptInfo=
      getPatrolExemptStatus_(
        slotStart
      );

    const specialMatches=
      shiftSpecialWindows.filter(
        x =>
          specialExemptOverlaps_(
            slotStart,
            slotEnd,
            x.win
          )
      );

    const specialHit=
      specialMatches.length
        ? specialMatches[
            specialMatches.length - 1
          ]
        : null;

    const slotPatrols=
      patrols.filter(
        p=>
          p.when.getTime()>=slotStart.getTime() &&
          p.when.getTime()<slotEnd.getTime()
      );

    const pointStatus=
      REQUIRED_POINTS.map(point=>{
        const hit=
          slotPatrols.find(
            p=>
              p.checkpointId===point.id
          );

        return {
          id:point.id,
          name:point.name,
          done:!!hit,
          time:hit?hit.time:'',
          personId:hit?hit.personId:'',
          personName:hit?hit.personName:''
        };
      });

    const completedPoints=
      pointStatus.filter(
        p=>p.done
      ).length;

    let status='future';
    let isExempt=false;
    let exemptReason='';

    if (exemptInfo.exempt) {
      status='exempt';
      isExempt=true;
      exemptReason=
        exemptInfo.reason||'';
    } else if (specialHit) {
      status='special';
      isExempt=true;
      exemptReason=
        '不用打卡｜' +
        (
          specialHit.entry.reason||
          '特殊情形'
        );
    } else if (
      completedPoints===
      REQUIRED_POINTS.length
    ) {
      status='done';
    } else if (
      now.getTime()>=
      slotEnd.getTime()
    ) {
      status='missed';
    } else if (
      now.getTime()>=
        slotStart.getTime() &&
      now.getTime()<
        slotEnd.getTime()
    ) {
      status='current';
    }

    slots.push({
      startDate:formatDate_(slotStart),
      startTime:Utilities.formatDate(slotStart,KSP.TZ,'HH:mm'),
      endDate:formatDate_(slotEnd),
      endTime:Utilities.formatDate(slotEnd,KSP.TZ,'HH:mm'),
      status:status,
      exempt:isExempt,
      exemptReason:exemptReason,
      specialReason:
        specialHit
          ? specialHit.entry.reason
          : '',
      specialTimeLabel:
        specialHit
          ? specialHit.win.label
          : '',
      requiredPoints:
        isExempt
          ? 0
          : REQUIRED_POINTS.length,
      completedPoints:
        isExempt
          ? 0
          : completedPoints,
      optionalCompletedPoints:
        specialHit
          ? completedPoints
          : 0,
      missingPoints:
        isExempt
          ? []
          : pointStatus
              .filter(p=>!p.done)
              .map(p=>p.id),
      points:pointStatus
    });

    cursor=
      new Date(
        slotEnd.getTime()
      );
  }

  const activeSlots=
    slots.filter(
      s=>!s.exempt
    );

  const specialSlots=
    slots.filter(
      s=>s.status==='special'
    );

  const requiredPeriods=
    activeSlots.length;

  const requiredChecks=
    requiredPeriods*
    REQUIRED_POINTS.length;

  const completedChecks=
    activeSlots.reduce(
      (sum,s)=>
        sum+
        Number(
          s.completedPoints||0
        ),
      0
    );

  const optionalCompletedChecks=
    specialSlots.reduce(
      (sum,s)=>
        sum+
        Number(
          s.optionalCompletedPoints||0
        ),
      0
    );

  const completedPeriods=
    activeSlots.filter(
      s=>s.status==='done'
    ).length;

  const missedChecks=
    activeSlots
      .filter(
        s=>s.status==='missed'
      )
      .reduce(
        (sum,s)=>
          sum+
          Math.max(
            0,
            REQUIRED_POINTS.length-
            Number(
              s.completedPoints||0
            )
          ),
        0
      );

  const activeShiftSettings=
    shiftSpecialWindows.filter(
      x =>
        now.getTime()>=
          x.win.start.getTime() &&
        now.getTime()<
          x.win.end.getTime()
    );

  const currentShiftSetting=
    activeShiftSettings.length
      ? activeShiftSettings[
          activeShiftSettings.length - 1
        ]
      : (
          shiftSpecialWindows.length
            ? shiftSpecialWindows[
                shiftSpecialWindows.length - 1
              ]
            : null
        );

  return {
    ok:true,
    duty:duty,
    sharedDuty:true,
    patrolIntervalHours:PATROL_INTERVAL_HOURS,
    requiredPeriods:requiredPeriods,
    requiredHours:requiredPeriods,
    requiredChecks:requiredChecks,
    completedChecks:completedChecks,
    optionalCompletedChecks:optionalCompletedChecks,
    completedPeriods:completedPeriods,
    completedHours:completedPeriods,
    missedChecks:missedChecks,
    exemptHours:
      slots.filter(
        s=>
          s.status==='exempt' ||
          s.status==='special'
      ).length,
    sharedPersonIds:sharedPersonIds,
    specialExempt:
      currentShiftSetting
        ? {
            exempt:true,
            activeNow:
              activeShiftSettings.length>0,
            reason:
              currentShiftSetting.entry.reason,
            note:
              currentShiftSetting.entry.note,
            dutyDate:
              currentShiftSetting.entry.dutyDate,
            startTime:
              currentShiftSetting.entry.startTime||'',
            endTime:
              currentShiftSetting.entry.endTime||'',
            timeLabel:
              currentShiftSetting.win.label,
            wholeShift:
              currentShiftSetting.win.wholeShift,
            entries:
              shiftSpecialWindows.map(
                x => ({
                  exemptionId:
                    x.entry.exemptionId,
                  reason:
                    x.entry.reason,
                  note:
                    x.entry.note,
                  timeLabel:
                    x.win.label
                })
              )
          }
        : {
            exempt:false,
            activeNow:false,
            entries:[]
          },
    points:REQUIRED_POINTS,
    slots:slots,
    rule:{
      sharedDuty:true,
      patrolIntervalHours:PATROL_INTERVAL_HOURS,
      perPeriod:'每小時一個巡查時段；同班任一保全完成 P01、P02、P03、P04、P05 五個 GPS 定點即可。',
      weekdayExempt:[
        '08:00–09:00 交管時間',
        '11:00–13:00 導護時間',
        '17:00–19:00 交管時間'
      ],
      holidayExempt:[
        '12:00–13:00 午休'
      ],
      dayShiftPeriods:[
        '06:00–07:00','07:00–08:00','08:00–09:00','09:00–10:00',
        '10:00–11:00','11:00–12:00','12:00–13:00','13:00–14:00',
        '14:00–15:00','15:00–16:00','16:00–17:00','17:00–18:00'
      ],
      nightShiftPeriods:[
        '18:00–19:00','19:00–20:00','20:00–21:00','21:00–22:00',
        '22:00–23:00','23:00–00:00','00:00–01:00','01:00–02:00',
        '02:00–03:00','03:00–04:00','04:00–05:00','05:00–06:00'
      ]
    }
  };
}

function dutyRecords_(
  personId
) {
  personId =
    normalizeId_(
      personId
    );

  if (!personId) {
    return fail_(
      '缺少人員編號。'
    );
  }

  const now =
    new Date();

  const duty =
    findDutyForNow_(
      personId,
      now
    );

  if (!duty) {
    return {
      ok: true,
      duty: null,
      records: []
    };
  }

  const win =
    dutyWindow_(
      duty
    );

  const sh =
    sheet_(
      KSP.SHEETS.LOG
    );

  const lastRow =
    sh.getLastRow();

  if (lastRow < 2) {
    return {
      ok: true,
      duty: duty,
      records: []
    };
  }

  const rows =
    sh.getRange(
      2,
      1,
      lastRow - 1,
      12
    ).getValues();

  const records = [];

  rows.forEach(
    r => {
      if (
        normalizeId_(
          r[3]
        ) !==
        personId
      ) {
        return;
      }

      const dateText =
        normalizeDate_(
          r[1]
        );

      const time =
        timeText_(
          r[2]
        );

      const dt =
        dateTimeFromText_(
          dateText,
          time
        );

      if (!dt) {
        return;
      }

      if (
        dt.getTime() <
          win.start.getTime() ||
        dt.getTime() >
          win.end.getTime()
      ) {
        return;
      }

      records.push({
        recordId:
          String(
            r[0] || ''
          ),
        date:
          dateText,
        time:
          time,
        action:
          String(
            r[5] || ''
          ).trim(),
        checkpointId:
          String(
            r[6] || ''
          ).trim(),
        checkpointName:
          String(
            r[7] || ''
          ).trim(),
        result:
          String(
            r[11] || ''
          ).trim()
      });
    }
  );

  records.sort(
    (a,b) => {
      const da =
        dateTimeFromText_(
          a.date,
          a.time
        );

      const db =
        dateTimeFromText_(
          b.date,
          b.time
        );

      return (
        (da ? da.getTime() : 0) -
        (db ? db.getTime() : 0)
      );
    }
  );

  return {
    ok: true,
    duty: duty,
    records: records
  };
}


function todayRecords_(
  personId
) {
  personId =
    normalizeId_(
      personId
    );

  const sh =
    sheet_(
      KSP.SHEETS.LOG
    );

  const lastRow =
    sh.getLastRow();

  if (lastRow < 2) {
    return {
      ok: true,
      records: []
    };
  }

  const today =
    formatDate_(
      new Date()
    );

  const rows =
    sh.getRange(
      2,
      1,
      lastRow - 1,
      12
    ).getValues();

  const records = [];

  rows.forEach(
    r => {
      if (
        normalizeId_(
          r[3]
        ) !==
        personId
      ) {
        return;
      }

      const date =
        normalizeDate_(
          r[1]
        );

      if (date !== today) {
        return;
      }

      records.push({
        recordId:
          String(
            r[0] || ''
          ),
        date:
          date,
        time:
          timeText_(
            r[2]
          ),
        action:
          String(
            r[5] || ''
          ).trim(),
        checkpointId:
          String(
            r[6] || ''
          ).trim(),
        checkpointName:
          String(
            r[7] || ''
          ).trim(),
        result:
          String(
            r[11] || ''
          ).trim()
      });
    }
  );

  return {
    ok: true,
    records: records
  };
}


function appendLog_(item) {
  const sh =
    sheet_(
      KSP.SHEETS.LOG
    );

  const id =
    'LOG-' +
    Utilities
      .getUuid()
      .slice(
        0,
        8
      )
      .toUpperCase();

  const when =
    item.when ||
    new Date();

  sh.appendRow([
    id,
    formatDate_(
      when
    ),
    Utilities.formatDate(
      when,
      KSP.TZ,
      'HH:mm:ss'
    ),
    item.personId || '',
    item.name || '',
    item.action || '',
    item.checkpointId || '',
    item.checkpointName || '',
    item.lat ?? '',
    item.lng ?? '',
    item.distance ?? '',
    item.result || ''
  ]);

  return id;
}


function findTodayAction_(
  personId,
  action,
  dutyDate
) {
  const sh =
    sheet_(
      KSP.SHEETS.LOG
    );

  const lastRow =
    sh.getLastRow();

  if (lastRow < 2) {
    return null;
  }

  const rows =
    sh.getRange(
      2,
      1,
      lastRow - 1,
      12
    ).getValues();

  for (
    let i =
      rows.length - 1;
    i >= 0;
    i--
  ) {
    const r =
      rows[i];

    if (
      normalizeId_(
        r[3]
      ) === personId &&
      String(
        r[5] || ''
      ).trim() ===
        action &&
      normalizeDate_(
        r[1]
      ) ===
        dutyDate
    ) {
      return r;
    }
  }

  return null;
}


function findDuplicatePatrol_(
  personId,
  checkpointId,
  now
) {
  const sh =
    sheet_(
      KSP.SHEETS.LOG
    );

  const lastRow =
    sh.getLastRow();

  if (lastRow < 2) {
    return null;
  }

  const rows =
    sh.getRange(
      2,
      1,
      lastRow - 1,
      12
    ).getValues();

  const settings =
    getSettings_();

  const limitMs =
    settings.duplicateMinutes *
    60 *
    1000;

  for (
    let i =
      rows.length - 1;
    i >= 0;
    i--
  ) {
    const r =
      rows[i];

    if (
      normalizeId_(
        r[3]
      ) !==
      personId ||
      String(
        r[5] || ''
      ).trim() !==
        '定點巡查' ||
      String(
        r[6] || ''
      ).trim() !==
        checkpointId
    ) {
      continue;
    }

    const d =
      normalizeDate_(
        r[1]
      );

    const t =
      timeText_(
        r[2]
      );

    if (!d || !t) {
      continue;
    }

    const dt =
      dateTimeFromText_(
        d,
        t
      );

    if (
      dt &&
      now.getTime() -
      dt.getTime() >= 0 &&
      now.getTime() -
      dt.getTime() <
      limitMs
    ) {
      return r;
    }
  }

  return null;
}


/* =========================================================
 * 8. 異常事件
 * ========================================================= */

function incident_(p) {
  const personId =
    normalizeId_(
      p.personId
    );

  const staff =
    getStaff_(
      personId
    );

  if (
    !staff ||
    staff.status !== '啟用'
  ) {
    return fail_(
      '人員資料無效。'
    );
  }

  const description =
    String(
      p.description || ''
    ).trim();

  if (!description) {
    return fail_(
      '請輸入異常說明。'
    );
  }

  const now =
    new Date();

  let photoUrl = '';

  if (
    p.photoDataUrl
  ) {
    try {
      photoUrl =
        saveIncidentPhoto_(
          p.photoDataUrl,
          personId,
          now
        );
    } catch (err) {
      return fail_(
        '照片儲存失敗：' +
        errorMessage_(
          err
        )
      );
    }
  }

  const eventId =
    'INC-' +
    Utilities
      .getUuid()
      .slice(
        0,
        8
      )
      .toUpperCase();

  const sh =
    sheet_(
      KSP.SHEETS.INCIDENTS
    );

  sh.appendRow([
    eventId,
    formatDateTime_(
      now
    ),
    personId,
    staff.name,
    String(
      p.checkpointName || ''
    ).trim(),
    String(
      p.type || '其他'
    ).trim(),
    description,
    photoUrl,
    '待處理',
    p.lat ?? '',
    p.lng ?? ''
  ]);

  return {
    ok: true,
    eventId:
      eventId,
    photoUrl:
      photoUrl,
    message:
      '異常事件已回報。'
  };
}


function saveIncidentPhoto_(
  dataUrl,
  personId,
  now
) {
  const m =
    String(
      dataUrl || ''
    ).match(
      /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
    );

  if (!m) {
    throw new Error(
      '照片格式不正確。'
    );
  }

  const mime =
    m[1];

  const bytes =
    Utilities
      .base64Decode(
        m[2]
      );

  const ext =
    mime.includes(
      'png'
    )
      ? 'png'
      : 'jpg';

  const name =
    'INC_' +
    personId +
    '_' +
    Utilities.formatDate(
      now,
      KSP.TZ,
      'yyyyMMdd_HHmmss'
    ) +
    '.' +
    ext;

  const folder =
    ensureIncidentFolder_();

  const file =
    folder.createFile(
      Utilities.newBlob(
        bytes,
        mime,
        name
      )
    );

  return file.getUrl();
}


function ensureIncidentFolder_() {
  const props =
    PropertiesService
      .getScriptProperties();

  const currentId =
    props.getProperty(
      KSP.PROP_INCIDENT_FOLDER_ID
    );

  if (currentId) {
    try {
      return DriveApp
        .getFolderById(
          currentId
        );
    } catch (err) {}
  }

  const folder =
    DriveApp.createFolder(
      '高軟保全勤務系統_異常照片'
    );

  props.setProperty(
    KSP.PROP_INCIDENT_FOLDER_ID,
    folder.getId()
  );

  return folder;
}


/* =========================================================
 * 9. 直接巡查時間登錄
 * ========================================================= */


/* =========================================================
 * fresh-v1.14.15｜匯入班表頁面可直接維護特殊假日
 * ========================================================= */

function holidayList_(
  year,
  month
) {
  year =
    Number(
      year
    );

  month =
    Number(
      month
    );

  if (
    !Number.isInteger(
      year
    ) ||
    !Number.isInteger(
      month
    ) ||
    month < 1 ||
    month > 12
  ) {
    return fail_(
      '特殊假日年月不正確。'
    );
  }

  const sh =
    sheet_(
      KSP.SHEETS.HOLIDAYS
    );

  const lastRow =
    sh.getLastRow();

  const holidays = [];

  if (lastRow >= 2) {
    const rows =
      sh.getRange(
        2,
        1,
        lastRow - 1,
        2
      ).getValues();

    rows.forEach(
      r => {
        const dateText =
          normalizeDate_(
            r[0]
          );

        if (!dateText) {
          return;
        }

        const d =
          parseImportDate_(
            dateText
          );

        if (
          !d ||
          d.getFullYear() !==
            year ||
          d.getMonth() + 1 !==
            month
        ) {
          return;
        }

        holidays.push({
          date:
            dateText,
          note:
            String(
              r[1] || ''
            ).trim()
        });
      }
    );
  }

  holidays.sort(
    (a,b) =>
      String(
        a.date
      ).localeCompare(
        String(
          b.date
        )
      )
  );

  return {
    ok: true,
    year:
      year,
    month:
      month,
    count:
      holidays.length,
    holidays:
      holidays,
    message:
      year +
      '年' +
      month +
      '月已設定 ' +
      holidays.length +
      ' 個特殊假日。'
  };
}


function holidaySave_(
  p
) {
  const year =
    Number(
      p.year
    );

  const month =
    Number(
      p.month
    );

  if (
    !Number.isInteger(
      year
    ) ||
    !Number.isInteger(
      month
    ) ||
    month < 1 ||
    month > 12
  ) {
    return fail_(
      '特殊假日年月不正確。'
    );
  }

  const incoming =
    Array.isArray(
      p.dates
    )
      ? p.dates
      : [];

  const selected = [];
  const selectedMap = {};

  incoming.forEach(
    value => {
      const dateText =
        normalizeDate_(
          value
        );

      if (!dateText) {
        throw new Error(
          '特殊假日日期格式不正確：' +
          String(
            value || ''
          )
        );
      }

      const d =
        parseImportDate_(
          dateText
        );

      if (
        !d ||
        d.getFullYear() !==
          year ||
        d.getMonth() + 1 !==
          month
      ) {
        throw new Error(
          '特殊假日包含其他月份日期：' +
          dateText
        );
      }

      if (
        !selectedMap[
          dateText
        ]
      ) {
        selectedMap[
          dateText
        ] = true;

        selected.push(
          dateText
        );
      }
    }
  );

  selected.sort();

  const sh =
    sheet_(
      KSP.SHEETS.HOLIDAYS
    );

  const lastRow =
    sh.getLastRow();

  const existing =
    lastRow >= 2
      ? sh.getRange(
          2,
          1,
          lastRow - 1,
          2
        ).getValues()
      : [];

  const noteMap = {};
  const keep = [];

  existing.forEach(
    r => {
      const dateText =
        normalizeDate_(
          r[0]
        );

      if (!dateText) {
        return;
      }

      const d =
        parseImportDate_(
          dateText
        );

      if (!d) {
        return;
      }

      if (
        d.getFullYear() ===
          year &&
        d.getMonth() + 1 ===
          month
      ) {
        noteMap[
          dateText
        ] =
          String(
            r[1] || ''
          ).trim();

        return;
      }

      keep.push([
        dateText,
        String(
          r[1] || ''
        ).trim()
      ]);
    }
  );

  const monthRows =
    selected.map(
      dateText => [
        dateText,
        noteMap[
          dateText
        ] ||
        '特殊假日'
      ]
    );

  const all =
    keep.concat(
      monthRows
    );

  all.sort(
    (a,b) =>
      String(
        a[0]
      ).localeCompare(
        String(
          b[0]
        )
      )
  );

  if (lastRow >= 2) {
    sh.getRange(
      2,
      1,
      lastRow - 1,
      2
    ).clearContent();
  }

  if (all.length) {
    sh.getRange(
      2,
      1,
      all.length,
      2
    ).setValues(
      all
    );

    sh.getRange(
      2,
      1,
      all.length,
      1
    ).setNumberFormat(
      '@'
    );
  }

  return {
    ok: true,
    year:
      year,
    month:
      month,
    count:
      selected.length,
    holidays:
      monthRows.map(
        r => ({
          date:
            r[0],
          note:
            r[1]
        })
      ),
    message:
      year +
      '年' +
      month +
      '月特殊假日已更新，共 ' +
      selected.length +
      ' 天。'
  };
}



/* =========================================================
 * fresh-v1.14.16｜月報表資料
 * 供前端產生：
 * 1. 上下班簽到月報
 * 2. 白班／晚班巡查點簽到月報
 * ========================================================= */
function monthlyReportData_(p) {
  const personId = normalizeId_(p.personId);
  const session = verifyDailySession_(personId, p.sessionToken);

  if (!session.ok) {
    return session;
  }

  const year = Number(p.year);
  const month = Number(p.month);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return fail_('月報表年月不正確。');
  }

  const logs = [];
  const logSh = sheet_(KSP.SHEETS.LOG);
  const lastRow = logSh.getLastRow();

  if (lastRow >= 2) {
    const rows = logSh.getRange(2, 1, lastRow - 1, 12).getValues();

    rows.forEach(r => {
      const dateText = normalizeDate_(r[1]);
      const timeText = timeText_(r[2]);
      const d = parseImportDate_(dateText);

      if (!d) return;

      const actualYear = d.getFullYear();
      const actualMonth = d.getMonth() + 1;

      // 一般紀錄取所選月份；另外保留次月1日 00:00–05:59 的巡查，
      // 讓所選月份最後一天的晚班可完整呈現到次日06:00。
      let include = actualYear === year && actualMonth === month;

      if (!include) {
        const next = new Date(year, month, 1);
        const nextDateText = formatDate_(next);
        const action = String(r[5] || '').trim();
        const hour = Number(String(timeText || '00:00').split(':')[0] || 0);

        if (
          dateText === nextDateText &&
          hour < 6 &&
          (action === '定點巡查' || action === '定點巡查指定時間登錄')
        ) {
          include = true;
        }
      }

      if (!include) return;

      logs.push({
        recordId: String(r[0] || '').trim(),
        date: dateText,
        time: timeText,
        personId: normalizeId_(r[3]),
        name: String(r[4] || '').trim(),
        action: String(r[5] || '').trim(),
        checkpointId: String(r[6] || '').trim().toUpperCase(),
        checkpointName: String(r[7] || '').trim(),
        result: String(r[11] || '').trim()
      });
    });
  }

  const holidays = [];
  const holidaySh = sheet_(KSP.SHEETS.HOLIDAYS);
  const holidayLastRow = holidaySh.getLastRow();

  if (holidayLastRow >= 2) {
    holidaySh.getRange(2, 1, holidayLastRow - 1, 2).getValues().forEach(r => {
      const dateText = normalizeDate_(r[0]);
      const d = parseImportDate_(dateText);
      if (
        d &&
        d.getFullYear() === year &&
        d.getMonth() + 1 === month
      ) {
        holidays.push({
          date: dateText,
          note: String(r[1] || '').trim()
        });
      }
    });
  }

  const specialExempt = [];
  try {
    const spSh = getSpreadsheet_().getSheetByName(KSP.SHEETS.SPECIAL_EXEMPT);
    const spLastRow = spSh ? spSh.getLastRow() : 0;

    if (spSh && spLastRow >= 2) {
      spSh.getRange(2, 1, spLastRow - 1, Math.min(15, spSh.getLastColumn()))
        .getDisplayValues()
        .forEach(r => {
          const dateText = normalizeDate_(r[1]);
          const d = parseImportDate_(dateText);
          const status = String(r[7] || '').trim();
          const scopeRaw = String(r[12] || '').trim().toUpperCase();
          const scope = scopeRaw === 'PERSONAL' ? 'PERSONAL' : 'SHIFT';

          if (
            !d ||
            d.getFullYear() !== year ||
            d.getMonth() + 1 !== month ||
            status !== '啟用' ||
            scope !== 'SHIFT'
          ) {
            return;
          }

          const setterId = normalizeId_(r[2]);
          const duty = getDutyForPersonDate_(setterId, dateText);

          specialExempt.push({
            date: dateText,
            shift: duty ? duty.shift : '',
            reason: String(r[4] || '').trim(),
            note: String(r[5] || '').trim(),
            startTime: timeText_(r[10]),
            endTime: timeText_(r[11])
          });
        });
    }
  } catch (err) {
    // 月報表仍可生成；特殊不強制資料讀取失敗時不阻斷。
  }

  return {
    ok: true,
    year: year,
    month: month,
    records: logs,
    holidays: holidays,
    specialExempt: specialExempt,
    generatedAt: formatDateTime_(new Date()),
    message:
      year + '年' + month + '月月報表資料已讀取，共 ' +
      logs.length + ' 筆紀錄。'
  };
}

function importRoster_(p) {
  const year =
    Number(
      p.year
    );

  const month =
    Number(
      p.month
    );

  const rows =
    Array.isArray(
      p.rows
    )
      ? p.rows
      : [];

  if (
    !Number.isInteger(
      year
    ) ||
    !Number.isInteger(
      month
    ) ||
    month < 1 ||
    month > 12
  ) {
    return fail_(
      '匯入年月不正確。'
    );
  }

  if (!rows.length) {
    return fail_(
      '沒有可匯入的班表資料。'
    );
  }

  const staff =
    staffMaps_();

  const normalized = [];
  const seen = {};
  const dayCounts = {};

  rows.forEach(
    item => {
      const d =
        parseImportDate_(
          item.date
        );

      if (!d) {
        return;
      }

      if (
        d.getFullYear() !==
          year ||
        d.getMonth() + 1 !==
          month
      ) {
        throw new Error(
          '班表包含其他月份日期：' +
          formatDate_(
            d
          )
        );
      }

      let personId =
        normalizeId_(
          item.personId
        );

      const name =
        String(
          item.name || ''
        ).trim();

      if (
        personId &&
        !staff.byId[
          personId
        ]
      ) {
        throw new Error(
          '查無人員編號：' +
          personId
        );
      }

      if (!personId) {
        const matches =
          staff.byName[
            name
          ] || [];

        if (
          matches.length !== 1
        ) {
          throw new Error(
            '無法唯一比對人員：' +
            name
          );
        }

        personId =
          matches[0]
            .personId;
      }

      const shift =
        normalizeShift_(
          item.shift
        );

      if (!shift) {
        return;
      }

      const dateText =
        formatDate_(
          d
        );

      const key =
        dateText +
        '|' +
        personId;

      if (seen[key]) {
        throw new Error(
          '同一人同一天重複排班：' +
          dateText +
          ' ' +
          personId
        );
      }

      seen[key] = true;

      dayCounts[
        dateText
      ] =
        (dayCounts[
          dateText
        ] || 0) + 1;

      if (
        dayCounts[
          dateText
        ] > 5
      ) {
        throw new Error(
          dateText +
          ' 超過每日最多 5 人。'
        );
      }

      normalized.push([
        dateText,
        personId,
        staff.byId[
          personId
        ].name,
        shift,
        shift ===
          '晚班'
          ? KSP.DEFAULTS.NIGHT_START
          : KSP.DEFAULTS.DAY_START,
        shift ===
          '晚班'
          ? KSP.DEFAULTS.NIGHT_END
          : KSP.DEFAULTS.DAY_END,
        String(
          p.source ||
          'PWA匯入'
        ),
        new Date()
      ]);
    }
  );

  if (!normalized.length) {
    return fail_(
      '沒有辨識到有效班次。'
    );
  }

  const sh =
    sheet_(
      KSP.SHEETS.ROSTER
    );

  const existing =
    sh.getLastRow() >= 2
      ? sh.getRange(
          2,
          1,
          sh.getLastRow() - 1,
          8
        ).getValues()
      : [];

  const replaceMonth =
    p.replaceMonth !== false;

  const keep =
    replaceMonth
      ? existing.filter(
          r => {
            const d =
              parseImportDate_(
                r[0]
              );

            return !(
              d &&
              d.getFullYear() ===
                year &&
              d.getMonth() + 1 ===
                month
            );
          }
        )
      : existing;

  const all =
    keep.concat(
      normalized
    );

  all.sort(
    (a,b) => {
      const da =
        parseImportDate_(
          a[0]
        );

      const db =
        parseImportDate_(
          b[0]
        );

      return (
        da.getTime() -
        db.getTime() ||
        String(
          a[1]
        ).localeCompare(
          String(
            b[1]
          )
        )
      );
    }
  );

  if (
    sh.getLastRow() >= 2
  ) {
    sh.getRange(
      2,
      1,
      sh.getLastRow() - 1,
      8
    ).clearContent();
  }

  if (all.length) {
    sh.getRange(
      2,
      1,
      all.length,
      8
    ).setValues(
      all
    );

    sh.getRange(
      2,
      1,
      all.length,
      1
    ).setNumberFormat(
      '@'
    );

    sh.getRange(
      2,
      8,
      all.length,
      1
    ).setNumberFormat(
      'yyyy/mm/dd hh:mm:ss'
    );
  }

  const warnings = [];

  const daysInMonth =
    new Date(
      year,
      month,
      0
    ).getDate();

  for (
    let day = 1;
    day <= daysInMonth;
    day++
  ) {
    const key =
      formatDate_(
        new Date(
          year,
          month - 1,
          day
        )
      );

    const count =
      dayCounts[
        key
      ] || 0;

    if (count < 3) {
      warnings.push(
        key +
        '：' +
        count +
        '人'
      );
    }
  }

  return {
    ok: true,
    imported:
      normalized.length,
    lowStaffDays:
      warnings,
    message:
      '班表匯入完成，共 ' +
      normalized.length +
      ' 筆勤務。',
    warning:
      warnings.length
        ? '有 ' +
          warnings.length +
          ' 天少於3人，請確認。'
        : ''
  };
}


function importRosterStatus_(
  year,
  month
) {
  year =
    Number(
      year
    );

  month =
    Number(
      month
    );

  const sh =
    sheet_(
      KSP.SHEETS.ROSTER
    );

  const lastRow =
    sh.getLastRow();

  if (lastRow < 2) {
    return {
      ok: true,
      count: 0,
      message:
        '目前沒有班表資料。'
    };
  }

  const rows =
    sh.getRange(
      2,
      1,
      lastRow - 1,
      8
    ).getValues();

  let count = 0;

  rows.forEach(
    r => {
      const d =
        parseImportDate_(
          r[0]
        );

      if (
        d &&
        d.getFullYear() ===
          year &&
        d.getMonth() + 1 ===
          month
      ) {
        count++;
      }
    }
  );

  return {
    ok: true,
    count: count,
    message:
      year +
      '年' +
      month +
      '月共有 ' +
      count +
      ' 筆勤務資料。'
  };
}



/* =========================================================
 * 10A. 一次性修正：115年9月 PDF 匯入日期整批早一天
 * ========================================================= */

/**
 * 只在「目前 115年9月 PDF 匯入資料確定全部早一天」時執行一次。
 *
 * 會修正：
 * 2026/08/31 → 2026/09/01
 * ...
 * 2026/09/29 → 2026/09/30
 *
 * 僅處理匯入來源包含「PDF」或「9月」的資料。
 * 修正後日期以 yyyy/MM/dd 文字儲存，不再受時區影響。
 */
function repair115SeptemberPdfDateShift() {
  const sh =
    sheet_(
      KSP.SHEETS.ROSTER
    );

  const lastRow =
    sh.getLastRow();

  if (lastRow < 2) {
    return {
      ok: true,
      repaired: 0,
      message:
        '目前沒有排班資料。'
    };
  }

  const rows =
    sh.getRange(
      2,
      1,
      lastRow - 1,
      8
    ).getValues();

  let repaired = 0;

  rows.forEach(
    (r, index) => {
      const source =
        String(
          r[6] || ''
        );

      if (
        !source.includes('PDF') &&
        !source.includes('9月') &&
        !source.includes('九月')
      ) {
        return;
      }

      const dateText =
        normalizeDate_(
          r[0]
        );

      if (!dateText) {
        return;
      }

      const d =
        parseImportDate_(
          dateText
        );

      if (!d) {
        return;
      }

      // 錯誤資料的範圍：8/31 到 9/29
      const start =
        new Date(
          2026,
          7,
          31
        );

      const end =
        new Date(
          2026,
          8,
          29
        );

      if (
        d.getTime() <
          start.getTime() ||
        d.getTime() >
          end.getTime()
      ) {
        return;
      }

      d.setDate(
        d.getDate() + 1
      );

      sh.getRange(
        index + 2,
        1
      ).setValue(
        formatDate_(
          d
        )
      );

      repaired++;
    }
  );

  if (repaired) {
    sh.getRange(
      2,
      1,
      Math.max(
        1,
        sh.getLastRow() - 1
      ),
      1
    ).setNumberFormat(
      '@'
    );
  }

  const result = {
    ok: true,
    repaired:
      repaired,
    version:
      KSP.VERSION,
    message:
      repaired
        ? '已修正 ' +
          repaired +
          ' 筆 115年9月 PDF 班表日期。'
        : '沒有找到符合條件的錯位資料。'
  };

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}



/* =========================================================
 * 10B. 特殊情況巡查不強制
 * ========================================================= */

function ensureSpecialExemptSheet_(
  ssOpt
) {
  const ss =
    ssOpt ||
    getSpreadsheet_();

  let sh =
    ss.getSheetByName(
      KSP.SHEETS.SPECIAL_EXEMPT
    );

  if (!sh) {
    sh =
      ss.insertSheet(
        KSP.SHEETS.SPECIAL_EXEMPT
      );
  }

  const headers = [[
    '免巡查ID',
    '勤務日期',
    '設定者編號',
    '設定者姓名',
    '特殊情形',
    '說明',
    '設定時間',
    '狀態',
    '取消時間',
    '設定來源',
    '不強制開始',
    '不強制結束',
    '適用範圍',
    '適用人員編號',
    '適用人員姓名'
  ]];

  sh.getRange(
    1,
    1,
    1,
    headers[0].length
  ).setValues(
    headers
  );

  sh.setFrozenRows(1);

  sh.getRange(
    1,
    1,
    1,
    headers[0].length
  )
    .setFontWeight('bold')
    .setBackground('#123B5D')
    .setFontColor('#FFFFFF');

  sh.getRange('B:B')
    .setNumberFormat('@');

  sh.getRange('K:O')
    .setNumberFormat('@');

  return sh;
}

function getDutyForPersonDate_(
  personId,
  dutyDate
) {
  personId =
    normalizeId_(
      personId
    );

  dutyDate =
    normalizeDate_(
      dutyDate
    );

  if (
    !personId ||
    !dutyDate
  ) {
    return null;
  }

  const duties =
    getPersonRoster_(
      personId
    );

  return duties.find(
    d =>
      d.dutyDate ===
      dutyDate
  ) || null;
}


/**
 * 取得與指定人員「同勤務日、同班別」的所有啟用中特殊巡查設定。
 * v1.14 起，特殊巡查不強制採班次共同制。
 */
function getSharedSpecialExemptEntries_(
  personId,
  dutyDate
) {
  personId =
    normalizeId_(
      personId
    );

  dutyDate =
    normalizeDate_(
      dutyDate
    );

  if (
    !personId ||
    !dutyDate
  ) {
    return [];
  }

  const targetDuty =
    getDutyForPersonDate_(
      personId,
      dutyDate
    );

  if (!targetDuty) {
    return [];
  }

  const sharedPersonIds =
    getSharedDutyPersonIds_(
      targetDuty
    );

  if (!sharedPersonIds.length) {
    return [];
  }

  if (
    _KSP_REQ_CACHE.specialRows ===
    null
  ) {
    const sh =
      ensureSpecialExemptSheet_();

    const lastRow =
      sh.getLastRow();

    _KSP_REQ_CACHE.specialRows =
      lastRow < 2
        ? []
        : sh.getRange(
            2,
            1,
            lastRow - 1,
            15
          )
          .getDisplayValues()
          .map(
            (r,index) => ({
              row:
                index + 2,
              raw:
                r
            })
          );
  }

  const found = [];

  _KSP_REQ_CACHE.specialRows
    .forEach(
      item => {
        const r =
          item.raw;

        const setterId =
          normalizeId_(
            r[2]
          );

        if (
          normalizeDate_(
            r[1]
          ) !== dutyDate ||
          !sharedPersonIds.includes(
            setterId
          ) ||
          String(
            r[7] || ''
          ).trim() !==
            '啟用'
        ) {
          return;
        }

        const scopeRaw =
          String(
            r[12] || ''
          )
          .trim()
          .toUpperCase();

        // 舊資料沒有 M 欄，維持舊版「整班」語意。
        const scope =
          scopeRaw === 'PERSONAL'
            ? 'PERSONAL'
            : 'SHIFT';

        const targetPersonIds =
          String(
            r[13] || ''
          )
          .split(',')
          .map(
            x =>
              normalizeId_(
                x
              )
          )
          .filter(Boolean);

        const targetPersonNames =
          String(
            r[14] || ''
          )
          .split(',')
          .map(
            x =>
              String(
                x || ''
              ).trim()
          )
          .filter(Boolean);

        found.push({
          row:
            item.row,
          exemptionId:
            String(
              r[0] || ''
            ).trim(),
          dutyDate:
            dutyDate,
          shift:
            targetDuty.shift,
          personId:
            setterId,
          name:
            String(
              r[3] || ''
            ).trim(),
          reason:
            String(
              r[4] || ''
            ).trim(),
          note:
            String(
              r[5] || ''
            ).trim(),
          createdAt:
            String(
              r[6] || ''
            ).trim(),
          status:
            '啟用',
          startTime:
            timeText_(
              r[10]
            ),
          endTime:
            timeText_(
              r[11]
            ),
          scope:
            scope,
          targetPersonIds:
            targetPersonIds,
          targetPersonNames:
            targetPersonNames,
          shared:
            scope === 'SHIFT'
        });
      }
    );

  return found;
}

function getSpecialExemptEntry_(
  personId,
  dutyDate
) {
  const entries =
    getSharedSpecialExemptEntries_(
      personId,
      dutyDate
    )
    .filter(
      x =>
        x.scope === 'SHIFT'
    );

  return entries.length
    ? entries[
        entries.length - 1
      ]
    : null;
}


function getShiftSpecialExemptEntries_(
  personId,
  dutyDate
) {
  return getSharedSpecialExemptEntries_(
    personId,
    dutyDate
  ).filter(
    x =>
      x.scope === 'SHIFT'
  );
}


function getPersonalSupportEntries_(
  personId,
  dutyDate,
  targetPersonId
) {
  targetPersonId =
    normalizeId_(
      targetPersonId ||
      personId
    );

  return getSharedSpecialExemptEntries_(
    personId,
    dutyDate
  ).filter(
    x =>
      x.scope === 'PERSONAL' &&
      x.targetPersonIds.includes(
        targetPersonId
      )
  );
}


function getSpecialEligiblePeople_(
  duty
) {
  if (!duty) {
    return [];
  }

  const seen = {};
  const out = [];

  getEffectiveRosterDuties_()
    .filter(
      d =>
        d.dutyDate ===
          duty.dutyDate &&
        d.shift ===
          duty.shift
    )
    .forEach(
      d => {
        if (
          !d.personId ||
          seen[d.personId]
        ) {
          return;
        }

        seen[d.personId] = true;

        out.push({
          personId:
            d.personId,
          name:
            d.name ||
            (
              getStaff_(
                d.personId
              ) || {}
            ).name ||
            d.personId,
          shift:
            d.shift,
          isSubstitute:
            !!d.isSubstitute
        });
      }
    );

  return out;
}


function specialEntryPublic_(
  duty,
  entry,
  now
) {
  const win =
    specialExemptWindow_(
      duty,
      entry
    );

  if (!win) {
    return null;
  }

  const activeNow =
    !!(
      now &&
      now.getTime() >=
        win.start.getTime() &&
      now.getTime() <
        win.end.getTime()
    );

  return {
    exemptionId:
      entry.exemptionId,
    dutyDate:
      entry.dutyDate,
    shift:
      duty.shift,
    personId:
      entry.personId,
    name:
      entry.name,
    reason:
      entry.reason,
    note:
      entry.note,
    createdAt:
      entry.createdAt,
    startTime:
      entry.startTime || '',
    endTime:
      entry.endTime || '',
    wholeShift:
      win.wholeShift,
    timeLabel:
      win.label,
    activeNow:
      activeNow,
    status:
      entry.status,
    scope:
      entry.scope,
    targetPersonIds:
      entry.targetPersonIds || [],
    targetPersonNames:
      entry.targetPersonNames || [],
    shared:
      entry.scope === 'SHIFT'
  };
}


function specialExemptWindow_(
  duty,
  entry
) {
  if (
    !duty ||
    !entry
  ) {
    return null;
  }

  const dutyWin =
    dutyWindow_(
      duty
    );

  const startText =
    timeText_(
      entry.startTime
    );

  const endText =
    timeText_(
      entry.endTime
    );

  if (
    !startText &&
    !endText
  ) {
    return {
      start:
        new Date(
          dutyWin.start.getTime()
        ),
      end:
        new Date(
          dutyWin.end.getTime()
        ),
      startTime:
        duty.startTime,
      endTime:
        duty.endTime,
      wholeShift:
        true,
      label:
        '整班 ' +
        duty.startTime +
        '–' +
        duty.endTime
    };
  }

  if (
    !startText ||
    !endText
  ) {
    return null;
  }

  const makePoint =
    function(hhmm) {
      const p =
        hhmm
          .split(':')
          .map(Number);

      const d =
        new Date(
          dutyWin.start.getTime()
        );

      d.setHours(
        p[0],
        p[1],
        0,
        0
      );

      // 晚班跨日的 00:00～06:00 要落在次日。
      if (
        d.getTime() <
        dutyWin.start.getTime()
      ) {
        d.setDate(
          d.getDate() + 1
        );
      }

      return d;
    };

  const start =
    makePoint(
      startText
    );

  let end =
    makePoint(
      endText
    );

  if (
    end.getTime() <=
    start.getTime()
  ) {
    end =
      new Date(
        end.getTime()
      );

    end.setDate(
      end.getDate() + 1
    );
  }

  if (
    start.getTime() <
      dutyWin.start.getTime() ||
    end.getTime() >
      dutyWin.end.getTime() ||
    start.getTime() >=
      end.getTime()
  ) {
    return null;
  }

  return {
    start:
      start,
    end:
      end,
    startTime:
      startText,
    endTime:
      endText,
    wholeShift:
      false,
    label:
      startText +
      '–' +
      endText
  };
}


function specialExemptOverlaps_(
  slotStart,
  slotEnd,
  specialWindow
) {
  if (
    !specialWindow ||
    !slotStart ||
    !slotEnd
  ) {
    return false;
  }

  return (
    slotStart.getTime() <
      specialWindow.end.getTime() &&
    slotEnd.getTime() >
      specialWindow.start.getTime()
  );
}


function specialExemptStatus_(
  personId,
  dutyDate
) {
  personId =
    normalizeId_(
      personId
    );

  if (!personId) {
    return fail_(
      '缺少人員編號。'
    );
  }

  const staff =
    getStaff_(
      personId
    );

  if (!staff) {
    return fail_(
      '查無人員資料。'
    );
  }

  const now =
    new Date();

  let dateText =
    normalizeDate_(
      dutyDate
    );

  if (!dateText) {
    const activeDuty =
      findDutyForNow_(
        personId,
        now
      );

    dateText =
      activeDuty
        ? activeDuty.dutyDate
        : formatDate_(
            now
          );
  }

  const duty =
    getDutyForPersonDate_(
      personId,
      dateText
    );

  if (!duty) {
    return {
      ok: true,
      exempt: false,
      activeNow: false,
      shared: false,
      dutyDate:
        dateText,
      shift: '',
      dutyStartTime: '',
      dutyEndTime: '',
      record: null,
      shiftEntries: [],
      personalSupport: {
        exempt: false,
        activeNow: false,
        entries: []
      },
      allEntries: [],
      roster: []
    };
  }

  const allEntries =
    getSharedSpecialExemptEntries_(
      personId,
      dateText
    );

  const shiftEntries =
    allEntries
      .filter(
        x =>
          x.scope === 'SHIFT'
      )
      .map(
        x =>
          specialEntryPublic_(
            duty,
            x,
            now
          )
      )
      .filter(Boolean);

  const personalEntries =
    allEntries
      .filter(
        x =>
          x.scope === 'PERSONAL' &&
          x.targetPersonIds.includes(
            personId
          )
      )
      .map(
        x =>
          specialEntryPublic_(
            duty,
            x,
            now
          )
      )
      .filter(Boolean);

  const publicAll =
    allEntries
      .map(
        x =>
          specialEntryPublic_(
            duty,
            x,
            now
          )
      )
      .filter(Boolean);

  const activeShift =
    shiftEntries.filter(
      x =>
        x.activeNow
    );

  const activePersonal =
    personalEntries.filter(
      x =>
        x.activeNow
    );

  const latestShift =
    shiftEntries.length
      ? shiftEntries[
          shiftEntries.length - 1
        ]
      : null;

  return {
    ok: true,
    exempt:
      shiftEntries.length > 0,
    activeNow:
      activeShift.length > 0,
    shared:
      shiftEntries.length > 0,
    dutyDate:
      dateText,
    shift:
      duty.shift,
    dutyStartTime:
      duty.startTime,
    dutyEndTime:
      duty.endTime,
    record:
      latestShift,
    shiftEntries:
      shiftEntries,
    personalSupport: {
      exempt:
        personalEntries.length > 0,
      activeNow:
        activePersonal.length > 0,
      entries:
        personalEntries,
      current:
        activePersonal.length
          ? activePersonal[
              activePersonal.length - 1
            ]
          : (
              personalEntries.length
                ? personalEntries[
                    personalEntries.length - 1
                  ]
                : null
            )
    },
    allEntries:
      publicAll,
    roster:
      getSpecialEligiblePeople_(
        duty
      )
  };
}

function verifySpecialExemptPerson_(
  personId,
  password,
  sessionToken
) {
  personId =
    normalizeId_(
      personId
    );

  const staff =
    getStaff_(
      personId
    );

  if (
    !staff ||
    staff.status !== '啟用'
  ) {
    return {
      ok: false,
      message:
        '人員資料無效。'
    };
  }

  const token =
    String(
      sessionToken || ''
    ).trim();

  if (token) {
    const verifiedSession =
      verifyDailySession_(
        personId,
        token
      );

    if (verifiedSession.ok) {
      return {
        ok: true,
        staff:
          staff,
        authMode:
          'session'
      };
    }
  }

  if (
    String(
      staff.password || ''
    ) !==
    String(
      password || ''
    ).trim()
  ) {
    return {
      ok: false,
      message:
        '登入驗證已失效，請重新登入後再操作。'
    };
  }

  return {
    ok: true,
    staff:
      staff,
    authMode:
      'password'
  };
}

function specialExemptSet_(
  p
) {
  const personId =
    normalizeId_(
      p.personId
    );

  const verified =
    verifySpecialExemptPerson_(
      personId,
      p.password,
      p.sessionToken
    );

  if (!verified.ok) {
    return verified;
  }

  const dutyDate =
    normalizeDate_(
      p.dutyDate
    );

  if (!dutyDate) {
    return fail_(
      '請選擇勤務日期。'
    );
  }

  const duty =
    getDutyForPersonDate_(
      personId,
      dutyDate
    );

  if (!duty) {
    return fail_(
      '該日期沒有勤務班表，無法設定。'
    );
  }

  const now =
    new Date();

  const activeDuty =
    findDutyForNow_(
      personId,
      now
    );

  const selected =
    parseImportDate_(
      dutyDate
    );

  const today =
    parseImportDate_(
      formatDate_(
        now
      )
    );

  if (
    selected &&
    today &&
    selected.getTime() <
      today.getTime() &&
    (
      !activeDuty ||
      activeDuty.dutyDate !==
        dutyDate
    )
  ) {
    return fail_(
      '不可新增已結束勤務日的特殊設定。'
    );
  }

  const allowedReasons = [
    '颱風天',
    '風雨過大',
    '活動支援',
    '災害應變',
    '臨時勤務調整',
    '其他'
  ];

  const reason =
    String(
      p.reason || ''
    ).trim();

  if (
    !allowedReasons.includes(
      reason
    )
  ) {
    return fail_(
      '請選擇特殊情形。'
    );
  }

  const note =
    String(
      p.note || ''
    )
      .trim()
      .slice(
        0,
        300
      );

  if (
    reason === '其他' &&
    !note
  ) {
    return fail_(
      '選擇「其他」時，請填寫說明。'
    );
  }

  const startTime =
    timeText_(
      p.startTime
    );

  const endTime =
    timeText_(
      p.endTime
    );

  if (
    (
      startTime &&
      !endTime
    ) ||
    (
      !startTime &&
      endTime
    )
  ) {
    return fail_(
      '調整時段時，請同時設定開始與結束時間。'
    );
  }

  const timeWindow =
    specialExemptWindow_(
      duty,
      {
        startTime:
          startTime,
        endTime:
          endTime
      }
    );

  if (!timeWindow) {
    return fail_(
      '設定時段必須位於本班勤務時間 ' +
      duty.startTime +
      '–' +
      duty.endTime +
      ' 內。'
    );
  }

  // 舊版快取沒有 scope 時，維持舊版整班設定；
  // 新版 UI 明確傳 PERSONAL / SHIFT。
  const scopeRaw =
    String(
      p.scope || ''
    )
    .trim()
    .toUpperCase();

  const scope =
    scopeRaw === 'PERSONAL'
      ? 'PERSONAL'
      : 'SHIFT';

  let targetPersonIds = [];
  let targetPersonNames = [];

  if (
    scope === 'PERSONAL'
  ) {
    const incoming =
      Array.isArray(
        p.targetPersonIds
      )
        ? p.targetPersonIds
        : String(
            p.targetPersonIds || ''
          ).split(',');

    targetPersonIds =
      [
        ...new Set(
          incoming
            .map(
              x =>
                normalizeId_(
                  x
                )
            )
            .filter(Boolean)
        )
      ];

    if (!targetPersonIds.length) {
      return fail_(
        '請至少選擇一位支援人員。'
      );
    }

    const eligible =
      getSpecialEligiblePeople_(
        duty
      );

    const eligibleMap = {};

    eligible.forEach(
      x => {
        eligibleMap[
          x.personId
        ] =
          x.name;
      }
    );

    const invalid =
      targetPersonIds.filter(
        id =>
          !eligibleMap[id]
      );

    if (invalid.length) {
      return fail_(
        '選擇的人員不屬於本班有效勤務：' +
        invalid.join('、')
      );
    }

    targetPersonNames =
      targetPersonIds.map(
        id =>
          eligibleMap[id] ||
          id
      );
  }

  const sh =
    ensureSpecialExemptSheet_();

  const exemptionId =
    'EX-' +
    dutyDate.replace(
      /\//g,
      ''
    ) +
    '-' +
    Utilities.formatDate(
      now,
      KSP.TZ,
      'HHmmss'
    ) +
    '-' +
    Math.floor(
      Math.random() * 90 + 10
    );

  const nowText =
    formatDateTime_(
      now
    );

  sh.appendRow([
    exemptionId,
    dutyDate,
    personId,
    verified.staff.name,
    reason,
    note,
    nowText,
    '啟用',
    '',
    scope === 'PERSONAL'
      ? 'PWA指定人員支援'
      : 'PWA整班巡查不強制',
    startTime,
    endTime,
    scope,
    targetPersonIds.join(','),
    targetPersonNames.join(',')
  ]);

  sh.getRange(
    sh.getLastRow(),
    2
  ).setNumberFormat('@');

  _KSP_REQ_CACHE.specialRows =
    null;

  const scopeText =
    scope === 'PERSONAL'
      ? (
          '指定人員：' +
          targetPersonNames.join('、')
        )
      : '整班巡查不強制';

  return {
    ok: true,
    exemptionId:
      exemptionId,
    scope:
      scope,
    dutyDate:
      dutyDate,
    shift:
      duty.shift,
    reason:
      reason,
    note:
      note,
    startTime:
      startTime,
    endTime:
      endTime,
    timeLabel:
      timeWindow.label,
    wholeShift:
      timeWindow.wholeShift,
    targetPersonIds:
      targetPersonIds,
    targetPersonNames:
      targetPersonNames,
    setBy:
      verified.staff.name,
    message:
      dutyDate +
      ' ' +
      duty.shift +
      '｜' +
      timeWindow.label +
      '｜' +
      scopeText +
      '｜' +
      reason
  };
}

function specialExemptCancel_(
  p
) {
  const personId =
    normalizeId_(
      p.personId
    );

  const verified =
    verifySpecialExemptPerson_(
      personId,
      p.password,
      p.sessionToken
    );

  if (!verified.ok) {
    return verified;
  }

  const dutyDate =
    normalizeDate_(
      p.dutyDate
    );

  if (!dutyDate) {
    return fail_(
      '請選擇勤務日期。'
    );
  }

  const duty =
    getDutyForPersonDate_(
      personId,
      dutyDate
    );

  if (!duty) {
    return fail_(
      '該日期沒有勤務班表。'
    );
  }

  const entries =
    getSharedSpecialExemptEntries_(
      personId,
      dutyDate
    );

  if (!entries.length) {
    return fail_(
      '目前沒有啟用中的特殊設定。'
    );
  }

  const exemptionId =
    String(
      p.exemptionId || ''
    ).trim();

  let target = null;

  if (exemptionId) {
    target =
      entries.find(
        x =>
          x.exemptionId ===
            exemptionId
      ) || null;
  } else if (
    entries.length === 1
  ) {
    // 相容舊前端：只有一筆時仍可取消。
    target =
      entries[0];
  } else {
    return fail_(
      '目前有多筆特殊設定，請指定要取消的設定。'
    );
  }

  if (!target) {
    return fail_(
      '找不到要取消的設定，可能已被其他人取消。'
    );
  }

  const sh =
    ensureSpecialExemptSheet_();

  const cancelTime =
    formatDateTime_(
      new Date()
    );

  sh.getRange(
    target.row,
    8,
    1,
    3
  ).setValues([[
    '已取消',
    cancelTime,
    'PWA取消｜' +
      verified.staff.name
  ]]);

  _KSP_REQ_CACHE.specialRows =
    null;

  const targetText =
    target.scope === 'PERSONAL'
      ? (
          '指定人員支援（' +
          (
            target.targetPersonNames.join('、') ||
            target.targetPersonIds.join('、')
          ) +
          '）'
        )
      : '整班巡查不強制';

  return {
    ok: true,
    exemptionId:
      target.exemptionId,
    scope:
      target.scope,
    dutyDate:
      dutyDate,
    shift:
      duty.shift,
    cancelledBy:
      verified.staff.name,
    message:
      targetText +
      ' 已取消。'
  };
}

function validateMainGps_(
  lat,
  lng
) {
  const settings =
    getSettings_();

  return validateGps_(
    lat,
    lng,
    settings.centerLat,
    settings.centerLng,
    settings.clockRadius
  );
}


function validateCheckpointGps_(
  cp,
  lat,
  lng
) {
  // 第16步起：定點巡查必須使用各巡查點自己的 GPS。
  // 不再退回園區總中心 350 公尺，避免人在其他棟仍可掃碼通過。
  if (
    cp.lat === null ||
    cp.lng === null
  ) {
    return fail_(
      cp.checkpointId +
      ' 尚未設定專屬 GPS 座標，請先完成巡查點定位設定。'
    );
  }

  return validateGps_(
    lat,
    lng,
    cp.lat,
    cp.lng,
    cp.radius
  );
}


function validateGps_(
  lat,
  lng,
  targetLat,
  targetLng,
  radius
) {
  lat =
    Number(
      lat
    );

  lng =
    Number(
      lng
    );

  if (
    !isFinite(lat) ||
    !isFinite(lng)
  ) {
    return fail_(
      '無法取得有效 GPS 位置。'
    );
  }

  const distance =
    Math.round(
      distanceMeters_(
        lat,
        lng,
        Number(
          targetLat
        ),
        Number(
          targetLng
        )
      )
    );

  if (
    distance >
    Number(
      radius
    )
  ) {
    return {
      ok: false,
      message:
        '目前距離勤務範圍約 ' +
        distance +
        ' 公尺，超過允許範圍 ' +
        radius +
        ' 公尺。',
      distance:
        distance
    };
  }

  return {
    ok: true,
    distance:
      distance
  };
}


function getPatrolExemptStatus_(
  now
) {
  const dateText =
    formatDate_(
      now
    );

  const holiday =
    isHoliday_(
      dateText
    );

  const day =
    Number(
      Utilities.formatDate(
        now,
        KSP.TZ,
        'u'
      )
    );

  const weekend =
    day === 6 ||
    day === 7;

  const isHoliday =
    holiday ||
    weekend;

  const m =
    Number(
      Utilities.formatDate(
        now,
        KSP.TZ,
        'H'
      )
    ) *
    60 +
    Number(
      Utilities.formatDate(
        now,
        KSP.TZ,
        'm'
      )
    );

  const windows =
    isHoliday
      ? [
          {
            start:
              12 * 60,
            end:
              13 * 60,
            reason:
              '假日用餐時段 12:00–13:00'
          }
        ]
      : [
          {
            start:
              8 * 60,
            end:
              9 * 60,
            reason:
              '平日交管時間 08:00–09:00'
          },
          {
            start:
              11 * 60,
            end:
              13 * 60,
            reason:
              '平日導護時間 11:00–13:00'
          },
          {
            start:
              17 * 60,
            end:
              19 * 60,
            reason:
              '平日交管時間 17:00–19:00'
          }
        ];

  const hit =
    windows.find(
      w =>
        m >= w.start &&
        m < w.end
    );

  return {
    exempt:
      !!hit,
    reason:
      hit
        ? hit.reason
        : '',
    dayType:
      isHoliday
        ? '假日'
        : '平日'
  };
}


function isHoliday_(
  dateText
) {
  const sh =
    sheet_(
      KSP.SHEETS.HOLIDAYS
    );

  const lastRow =
    sh.getLastRow();

  if (lastRow < 2) {
    return false;
  }

  const rows =
    sh.getRange(
      2,
      1,
      lastRow - 1,
      2
    ).getValues();

  return rows.some(
    r =>
      normalizeDate_(
        r[0]
      ) === dateText
  );
}


/* =========================================================
 * 12. 系統設定
 * ========================================================= */

function getSettings_() {
  const out = {
    centerLat:
      KSP.DEFAULTS.CENTER_LAT,
    centerLng:
      KSP.DEFAULTS.CENTER_LNG,
    clockRadius:
      KSP.DEFAULTS.CLOCK_RADIUS_M,
    duplicateMinutes:
      KSP.DEFAULTS.DUPLICATE_MINUTES
  };

  try {
    const sh =
      sheet_(
        KSP.SHEETS.SETTINGS
      );

    const lastRow =
      sh.getLastRow();

    if (lastRow < 2) {
      return out;
    }

    const rows =
      sh.getRange(
        1,
        1,
        lastRow,
        Math.min(
          4,
          sh.getLastColumn()
        )
      ).getValues();

    rows.forEach(
      r => {
        const key =
          String(
            r[0] || ''
          ).trim();

        const value =
          r[1];

        if (
          key ===
          '打卡中心緯度'
        ) {
          out.centerLat =
            Number(
              value
            ) ||
            out.centerLat;
        }

        if (
          key ===
          '打卡中心經度'
        ) {
          out.centerLng =
            Number(
              value
            ) ||
            out.centerLng;
        }

        if (
          key ===
          '打卡允許半徑'
        ) {
          out.clockRadius =
            Number(
              value
            ) ||
            out.clockRadius;
        }

        if (
          key ===
          '重複巡查阻擋'
        ) {
          out.duplicateMinutes =
            Number(
              value
            ) ||
            out.duplicateMinutes;
        }
      }
    );

  } catch (err) {}

  return out;
}


/* =========================================================
 * 13. 共用工具
 * ========================================================= */

function getSpreadsheet_() {
  const props =
    PropertiesService
      .getScriptProperties();

  const id =
    props.getProperty(
      KSP.PROP_SS_ID
    );

  if (id) {
    return SpreadsheetApp
      .openById(
        id
      );
  }

  const active =
    SpreadsheetApp
      .getActiveSpreadsheet();

  if (active) {
    return active;
  }

  throw new Error(
    '尚未設定 Google Sheet。請先執行 setupSystem()。'
  );
}


function sheet_(name) {
  const sh =
    getSpreadsheet_()
      .getSheetByName(
        name
      );

  if (!sh) {
    throw new Error(
      '找不到工作表：' +
      name
    );
  }

  return sh;
}


function jsonOutput_(
  obj
) {
  return ContentService
    .createTextOutput(
      JSON.stringify(
        obj
      )
    )
    .setMimeType(
      ContentService
        .MimeType
        .JSON
    );
}


function fail_(
  message
) {
  return {
    ok: false,
    message:
      String(
        message || '操作失敗'
      )
  };
}


function errorMessage_(
  err
) {
  return String(
    err &&
    err.message
      ? err.message
      : err
  );
}


function normalizeId_(
  value
) {
  return String(
    value || ''
  )
    .trim()
    .toUpperCase();
}


function normalizeShift_(
  value
) {
  const s =
    String(
      value || ''
    )
      .trim()
      .toUpperCase();

  if (
    [
      'A',
      '白',
      '白班',
      'DAY'
    ].includes(
      s
    )
  ) {
    return '白班';
  }

  if (
    [
      'B',
      '晚',
      '晚班',
      'NIGHT'
    ].includes(
      s
    )
  ) {
    return '晚班';
  }

  return '';
}


function normalizeDate_(
  value
) {
  if (
    value instanceof Date &&
    !isNaN(
      value.getTime()
    )
  ) {
    return formatDate_(
      value
    );
  }

  const s =
    String(
      value || ''
    )
      .trim()
      .replace(
        /-/g,
        '/'
      );

  const m =
    s.match(
      /^(\d{2,4})\/(\d{1,2})\/(\d{1,2})$/
    );

  if (!m) {
    return '';
  }

  let year =
    Number(
      m[1]
    );

  if (year < 1911) {
    year += 1911;
  }

  const d =
    new Date(
      year,
      Number(
        m[2]
      ) - 1,
      Number(
        m[3]
      )
    );

  return formatDate_(
    d
  );
}


function parseImportDate_(
  value
) {
  if (
    value instanceof Date &&
    !isNaN(
      value.getTime()
    )
  ) {
    return new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate()
    );
  }

  const dateText =
    normalizeDate_(
      value
    );

  if (!dateText) {
    return null;
  }

  const p =
    dateText
      .split('/')
      .map(Number);

  return new Date(
    p[0],
    p[1] - 1,
    p[2]
  );
}


function formatDate_(
  date
) {
  return Utilities
    .formatDate(
      date,
      KSP.TZ,
      'yyyy/MM/dd'
    );
}


function formatDateTime_(
  date
) {
  return Utilities
    .formatDate(
      date,
      KSP.TZ,
      'yyyy/MM/dd HH:mm:ss'
    );
}


function timeText_(
  value
) {
  if (
    value instanceof Date &&
    !isNaN(
      value.getTime()
    )
  ) {
    return Utilities
      .formatDate(
        value,
        KSP.TZ,
        'HH:mm'
      );
  }

  const s =
    String(
      value || ''
    ).trim();

  const m =
    s.match(
      /(\d{1,2}):(\d{2})/
    );

  if (!m) {
    return '';
  }

  return (
    String(
      Number(
        m[1]
      )
    )
      .padStart(
        2,
        '0'
      ) +
    ':' +
    m[2]
  );
}


function minutesOf_(
  hhmm
) {
  const t =
    timeText_(
      hhmm
    );

  if (!t) {
    return 0;
  }

  const p =
    t
      .split(':')
      .map(Number);

  return (
    p[0] *
    60 +
    p[1]
  );
}


function dateTimeFromText_(
  dateText,
  timeText
) {
  const d =
    normalizeDate_(
      dateText
    );

  const t =
    timeText_(
      timeText
    );

  if (
    !d ||
    !t
  ) {
    return null;
  }

  const dp =
    d
      .split('/')
      .map(Number);

  const tp =
    t
      .split(':')
      .map(Number);

  return new Date(
    dp[0],
    dp[1] - 1,
    dp[2],
    tp[0],
    tp[1],
    0,
    0
  );
}


function numberOrNull_(
  value
) {
  if (
    value === '' ||
    value === null ||
    typeof value === 'undefined'
  ) {
    return null;
  }

  const n =
    Number(
      value
    );

  return isFinite(n)
    ? n
    : null;
}


function distanceMeters_(
  lat1,
  lng1,
  lat2,
  lng2
) {
  const R =
    6371000;

  const toRad =
    x =>
      x *
      Math.PI /
      180;

  const dLat =
    toRad(
      lat2 - lat1
    );

  const dLng =
    toRad(
      lng2 - lng1
    );

  const a =
    Math.sin(
      dLat / 2
    ) ** 2 +
    Math.cos(
      toRad(
        lat1
      )
    ) *
    Math.cos(
      toRad(
        lat2
      )
    ) *
    Math.sin(
      dLng / 2
    ) ** 2;

  return (
    2 *
    R *
    Math.atan2(
      Math.sqrt(
        a
      ),
      Math.sqrt(
        1 - a
      )
    )
  );
}
