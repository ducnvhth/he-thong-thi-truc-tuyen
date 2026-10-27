/**
 * HE THONG THI TRUC TUYEN - GOOGLE APPS SCRIPT (SERVER)
 *
 * Tinh nang:
 *  - Chi dinh truc tiep SPREADSHEET_ID de dam bao ket noi chinh xac toi Google Sheet cuoc thi.
 *  - Dang nhap truc tiep bang 3 thong tin: Ho va ten, Don vi, So dien thoai (khong can ma PIN).
 *  - Dinh danh theo So dien thoai: moi so dien thoai chi duoc tham gia 01 lan.
 *  - Ngan hang cau hoi nam o QuestionBank.gs (front-end khong con cau hoi / dap an).
 *  - startSession: tra ve 30 cau ngau nhien (khong kem dap an), luu startTime tren server.
 *  - submit: cham diem hoan toan tren server; thoi gian lam bai = submitTime - startTime (server tinh).
 *  - Bang xep hang: tu dong cong bo khi du so luong thi sinh quy dinh.
 *
 * CACH TRIEN KHAI: xem apps-script/HUONG_DAN.md
 */

const CONFIG = {
  // ID cua trang tinh Google Sheets cuoc thi
  SPREADSHEET_ID: '1YboqDWLjtHjr355fqE5RbXvWkqfn8QDchehS0Il-qHo',
  DURATION_SEC: 15 * 60,     // Thoi gian lam bai (15 phut, phai khop DURATION_MINUTES o front-end)
  GRACE_SEC: 60,             // Do tre cho phep (mang cham) khi nop bai
  QUESTION_COUNT: 30,        // So cau moi de thi
  MIN_FOR_LEADERBOARD: 5,    // So thi sinh toi thieu de mo bang xep hang
  SHEET_SESSIONS: 'PhienThi',
  SHEET_RESULTS: 'KetQua'
};

/* ============================ ENTRY POINTS ============================ */

function doGet(e) {
  const p = (e && e.parameter) || {};
  let result;
  try {
    if (p.action === 'startSession') {
      result = startSession_(p);
    } else {
      result = getLeaderboard_();
    }
  } catch (err) {
    result = { status: 'ERROR', message: 'Lỗi máy chủ: ' + err.message };
  }
  return jsonp_(result, p.callback);
}

function doPost(e) {
  let result;
  try {
    const payload = JSON.parse(e.postData.contents);
    result = submitExam_(payload);
  } catch (err) {
    result = { status: 'ERROR', message: 'Lỗi máy chủ: ' + err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonp_(obj, callback) {
  const json = JSON.stringify(obj);
  if (callback && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/* ============================ SHEET HELPERS ============================ */

/**
 * Lay doi tuong Spreadsheet:
 * Uu tien mo bang SPREADSHEET_ID da cau hinh, neu khong duoc thi dung getActiveSpreadsheet().
 */
function getSpreadsheet_() {
  if (CONFIG.SPREADSHEET_ID) {
    try {
      return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    } catch (e) {
      console.warn('Khong the openById: ' + e.message + ', su dung getActiveSpreadsheet');
    }
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(name, headers) {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function sessionsSheet_() {
  return getSheet_(CONFIG.SHEET_SESSIONS, ['Token', 'Số điện thoại', 'Họ và tên', 'Đơn vị', 'StartTime(ms)', 'DeThi(JSON)', 'Trạng thái']);
}

function resultsSheet_() {
  return getSheet_(CONFIG.SHEET_RESULTS,
    ['Thời điểm nộp', 'Số điện thoại', 'Họ và tên', 'Đơn vị', 'Điểm', 'Tổng số câu', 'Thời gian làm (giây)', 'Dự đoán', 'Số lần rời màn hình', 'Ghi chú', 'Telemetry']);
}

function norm_(v) { return String(v === null || v === undefined ? '' : v).trim(); }
function normPhone_(v) { return norm_(v).replace(/[\s.-]/g, ''); }

/** Tim phien thi theo So dien thoai hoac Token. */
function findSession_(phone, token) {
  const sh = sessionsSheet_();
  const last = sh.getLastRow();
  if (last < 2) return null;
  const rows = sh.getRange(2, 1, last - 1, 7).getValues();
  const targetToken = norm_(token);
  const targetPhone = normPhone_(phone);
  const targetPhoneNoZero = targetPhone.replace(/^0+/, '');

  // 1. Uu tien tim theo Token (UUID khong bao gio sai sot)
  if (targetToken) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (norm_(rows[i][0]) === targetToken) {
        return parseSessionRow_(rows[i], i + 2);
      }
    }
  }

  // 2. Tim theo So dien thoai (ho tro ca truong hop co/khong co so 0 dau do Sheet tu dong format)
  if (targetPhone) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const cellPhone = normPhone_(rows[i][1]);
      if (cellPhone === targetPhone || (targetPhoneNoZero && cellPhone.replace(/^0+/, '') === targetPhoneNoZero)) {
        return parseSessionRow_(rows[i], i + 2);
      }
    }
  }
  return null;
}

function parseSessionRow_(r, rowIdx) {
  return {
    row: rowIdx,
    token: norm_(r[0]),
    phone: norm_(r[1]),
    name: norm_(r[2]),
    unit: norm_(r[3]),
    startTime: Number(r[4]),
    deThi: JSON.parse(r[5]),
    status: norm_(r[6])
  };
}

/** Kiem tra so dien thoai da co ket qua nop bai chua. */
function hasResult_(phone) {
  const sh = resultsSheet_();
  const last = sh.getLastRow();
  if (last < 2) return false;
  const phones = sh.getRange(2, 2, last - 1, 1).getValues();
  const targetPhone = normPhone_(phone);
  const targetNoZero = targetPhone.replace(/^0+/, '');
  return phones.some(function (r) {
    const cellPhone = normPhone_(r[0]);
    return cellPhone === targetPhone || (targetNoZero && cellPhone.replace(/^0+/, '') === targetNoZero);
  });
}

/* ============================ DE THI ============================ */

function shuffle_(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function bankMap_() {
  const m = {};
  QUESTION_BANK.forEach(function (q) { m[q.id] = q; });
  return m;
}

/** Tao de moi: [{id, o:[thu tu goc cua cac lua chon sau khi tron]}] */
function buildExam_() {
  const take = Math.min(CONFIG.QUESTION_COUNT, QUESTION_BANK.length);
  return shuffle_(QUESTION_BANK).slice(0, take).map(function (q) {
    const idx = q.options.map(function (_, i) { return i; });
    return { id: q.id, o: shuffle_(idx) };
  });
}

/** Chuyen de thi thanh du lieu gui cho client (KHONG co dap an). */
function toClientQuestions_(deThi) {
  const map = bankMap_();
  return deThi.map(function (item) {
    const q = map[item.id];
    return {
      id: q.id,
      question: q.question,
      options: item.o.map(function (origIdx) { return { text: q.options[origIdx], originalIndex: origIdx }; })
    };
  });
}

/* ============================ BAT DAU THI ============================ */

function startSession_(p) {
  const phone = normPhone_(p.phone || p.userId);
  const fullName = norm_(p.fullName);
  const unit = norm_(p.unit);

  if (!phone || !fullName || !unit) {
    return { status: 'ERROR', message: 'Vui lòng nhập đầy đủ Họ và tên, Đơn vị và Số điện thoại.' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (hasResult_(phone)) {
      return { status: 'ALREADY_TAKEN' };
    }

    const now = Date.now();
    const existing = findSession_(phone);

    if (existing) {
      if (existing.status === 'DONE') return { status: 'ALREADY_TAKEN' };
      const elapsed = now - existing.startTime;
      if (elapsed > (CONFIG.DURATION_SEC + CONFIG.GRACE_SEC) * 1000) {
        // Da het gio ma khong nop bai -> chot 0 diem
        saveResult_(existing, 0, existing.deThi.length, CONFIG.DURATION_SEC, 0, 0, 'HẾT GIỜ - KHÔNG NỘP BÀI', []);
        return { status: 'ALREADY_TAKEN' };
      }
      // Dang thi do (mat mang / tai lai trang) -> cho tiep tuc, GIU NGUYEN de va startTime
      return {
        status: 'ELIGIBLE',
        resumed: true,
        token: existing.token,
        startTime: existing.startTime,
        serverNow: now,
        durationSec: CONFIG.DURATION_SEC,
        fullName: existing.name,
        unit: existing.unit,
        phone: existing.phone,
        questions: toClientQuestions_(existing.deThi)
      };
    }

    const deThi = buildExam_();
    const token = Utilities.getUuid();
    sessionsSheet_().appendRow([token, phone, fullName, unit, now, JSON.stringify(deThi), 'DOING']);
    return {
      status: 'ELIGIBLE',
      token: token,
      startTime: now,
      serverNow: now,
      durationSec: CONFIG.DURATION_SEC,
      fullName: fullName,
      unit: unit,
      phone: phone,
      questions: toClientQuestions_(deThi)
    };
  } finally {
    lock.releaseLock();
  }
}

/* ============================ NOP BAI & CHAM DIEM ============================ */

function saveResult_(session, score, total, timeSpent, prediction, violations, note, telemetry) {
  const tele = JSON.stringify(telemetry || []);
  resultsSheet_().appendRow([
    new Date(), session.phone, session.name, session.unit, score, total, timeSpent,
    Number(prediction) || 0, Number(violations) || 0, note || '',
    tele.length > 45000 ? tele.substring(0, 45000) + '...' : tele
  ]);
  sessionsSheet_().getRange(session.row, 7).setValue('DONE');
}

function submitExam_(p) {
  const phone = normPhone_(p.phone || p.userId);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const session = findSession_(phone, p.token);
    if (!session || session.token !== norm_(p.token)) {
      return { status: 'ERROR', message: 'Phiên làm bài không hợp lệ hoặc đã hết hạn.' };
    }
    if (session.status === 'DONE' || hasResult_(phone)) {
      return { status: 'ALREADY_TAKEN' };
    }

    // Thoi gian do SERVER tinh (submitTime - session.startTime)
    const elapsedMs = Date.now() - session.startTime;
    const late = elapsedMs > (CONFIG.DURATION_SEC + CONFIG.GRACE_SEC) * 1000;
    const timeSpent = Math.max(1, Math.min(CONFIG.DURATION_SEC, Math.round(elapsedMs / 1000)));

    // Cham diem tren server
    const map = bankMap_();
    const inExam = {};
    session.deThi.forEach(function (it) { inExam[it.id] = true; });
    const answered = {};
    (Array.isArray(p.answers) ? p.answers : []).forEach(function (a) {
      const id = Number(a && a.id);
      const sel = Number(a && a.selectedIndex);
      if (inExam[id] && !(id in answered) && sel >= 0 && sel <= 3) answered[id] = sel;
    });
    let score = 0;
    Object.keys(answered).forEach(function (id) {
      if (map[id] && map[id].correct === answered[id]) score++;
    });

    let note = '';
    if (late) { score = 0; note = 'NỘP TRỄ ' + Math.round(elapsedMs / 1000 - CONFIG.DURATION_SEC) + 's - KHÔNG TÍNH ĐIỂM'; }

    saveResult_(session, score, session.deThi.length, timeSpent, p.prediction, p.violationCount, note, p.telemetry);
    return { status: 'OK', score: score, totalQuestions: session.deThi.length, timeSpent: timeSpent };
  } finally {
    lock.releaseLock();
  }
}

/* ============================ BANG XEP HANG ============================ */

function getLeaderboard_() {
  const sh = resultsSheet_();
  const last = sh.getLastRow();
  const rows = last < 2 ? [] : sh.getRange(2, 1, last - 1, 8).getValues();
  const completed = rows.length;

  if (completed < CONFIG.MIN_FOR_LEADERBOARD) {
    return { isUnlocked: false, completedCount: completed, requiredCount: CONFIG.MIN_FOR_LEADERBOARD, data: [] };
  }

  const data = rows.map(function (r) {
    return {
      phone: norm_(r[1]),
      fullName: norm_(r[2]),
      unit: norm_(r[3]),
      score: Number(r[4]),
      totalQuestions: Number(r[5]),
      timeSpent: Number(r[6]),
      prediction: Number(r[7])
    };
  }).sort(function (a, b) {
    return b.score - a.score || a.timeSpent - b.timeSpent;
  });

  return { isUnlocked: true, completedCount: completed, requiredCount: CONFIG.MIN_FOR_LEADERBOARD, data: data };
}

/* ============================ TIEN ICH CHO BAN TO CHUC ============================ */

/** Chay 1 lan de khoi tao cac sheet: PhienThi, KetQua. */
function setupSheets() {
  const pSh = sessionsSheet_();
  pSh.getRange(1, 1, 1, 7).setValues([['Token', 'Số điện thoại', 'Họ và tên', 'Đơn vị', 'Thời điểm bắt đầu (ms)', 'Đề thi (JSON)', 'Trạng thái']]).setFontWeight('bold');
  pSh.getRange('B:B').setNumberFormat('@');

  const rSh = resultsSheet_();
  rSh.getRange(1, 1, 1, 11).setValues([['Thời điểm nộp', 'Số điện thoại', 'Họ và tên', 'Đơn vị', 'Điểm số', 'Tổng số câu', 'Thời gian làm (giây)', 'Dự đoán', 'Số lần rời màn hình', 'Ghi chú', 'Telemetry']]).setFontWeight('bold');
  rSh.getRange('B:B').setNumberFormat('@');
  Logger.log('Đã cập nhật đúng tiêu đề các cột cho PhienThi và KetQua.');
  return 'Đã cập nhật đúng tiêu đề các cột cho PhienThi và KetQua.';
}

/** Dat lai phien thi cua 1 thi sinh (cho thi lai bang SĐT): xoa dong trong PhienThi va KetQua. */
function resetCandidate(phone) {
  const p = normPhone_(phone);
  [[CONFIG.SHEET_SESSIONS, 2], [CONFIG.SHEET_RESULTS, 2]].forEach(function (cfg) {
    const sh = getSpreadsheet_().getSheetByName(cfg[0]);
    if (!sh || sh.getLastRow() < 2) return;
    const vals = sh.getRange(2, cfg[1], sh.getLastRow() - 1, 1).getValues();
    for (let i = vals.length - 1; i >= 0; i--) {
      if (normPhone_(vals[i][0]) === p) sh.deleteRow(i + 2);
    }
  });
  Logger.log('Đã xóa dữ liệu thi của SĐT: ' + phone);
  return 'Đã xóa dữ liệu thi của SĐT: ' + phone;
}
