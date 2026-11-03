/**
 * =========================================================================
 * 🎾 PADEL & TENNIS SCORING MASTER - GOOGLE SHEETS CONNECTOR (APPS SCRIPT)
 * =========================================================================
 * 
 * CARA MENGGUNAKAN:
 * 1. Buat Google Sheet baru di browser Anda (sheet.new).
 * 2. Klik menu "Extensions" (Ekstensi) > "Apps Script".
 * 3. Hapus semua kode default di editor, lalu PASTE SELURUH KODE DI BAWAH INI.
 * 4. Klik tombol "Save" (ikon disket).
 * 5. Klik tombol biru "Deploy" di kanan atas > "New deployment" (Penerapan baru).
 * 6. Klik ikon gear di sebelah kiri > pilih "Web app" (Aplikasi web).
 * 7. Isi:
 *    - Description: Padel Tennis Scoring Webhook
 *    - Execute as: "Me" (email Anda)
 *    - Who has access: "Anyone" (Siapa saja)  <-- PENTING agar app dapat kirim data!
 * 8. Klik "Deploy", izinkan hak akses (Review Permissions > pilih akun > Advanced > Go to Untitled (unsafe) > Allow).
 * 9. Salin "Web app URL" (akhiran /exec) dan tempelkan di aplikasi Padel Tennis Scoring pada menu "Pengaturan" > "Google Sheets".
 * 
 * Selesai! Semua data pertandingan, statistik pemain, dan turnamen akan otomatis tersimpan rapi di Google Sheet ini!
 * =========================================================================
 */

function doPost(e) {
  try {
    var rawData = e.postData.contents;
    var payload = JSON.parse(rawData);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    var type = payload.type;
    
    // 1. Ping / Test Connection
    if (type === "ping") {
      return responseJSON({
        status: "success",
        message: "Koneksi berhasil! Google Sheet siap menerima data dari aplikasi.",
        timestamp: new Date()
      });
    }
    
    // 2. Single Match Result
    if (type === "match") {
      appendMatchRow(ss, payload.data);
      return responseJSON({ status: "success", message: "Pertandingan berhasil disimpan ke Sheet!" });
    }
    
    // 3. Tournament
    if (type === "tournament") {
      appendTournamentRow(ss, payload.data);
      return responseJSON({ status: "success", message: "Turnamen berhasil disimpan ke Sheet!" });
    }
    
    // 4. Bulk Sync (Semua Data: Pertandingan, Pemain, Turnamen)
    if (type === "bulk_sync") {
      if (payload.matches && payload.matches.length > 0) {
        syncAllMatches(ss, payload.matches);
      }
      if (payload.players && payload.players.length > 0) {
        syncAllPlayers(ss, payload.players);
      }
      if (payload.tournaments && payload.tournaments.length > 0) {
        syncAllTournaments(ss, payload.tournaments);
      }
      return responseJSON({ 
        status: "success", 
        message: "Bulk sync berhasil! Data Pertandingan, Pemain & Turnamen telah diperbarui." 
      });
    }
    
    return responseJSON({ status: "ignored", message: "Tipe payload tidak dikenali" });
    
  } catch (err) {
    return responseJSON({ status: "error", message: err.toString() });
  }
}

function doGet(e) {
  return ContentService.createTextOutput("Padel Tennis Scoring Webhook Aktif! Gunakan POST request untuk mengirim data.");
}

function responseJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// --- HELPER UNTUK SHEET PERTANDINGAN ---
function getOrCreateSheet(ss, sheetName, headers, headerColor) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground(headerColor || "#1b4d3e");
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");
    headerRange.setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function appendMatchRow(ss, m) {
  var headers = ["ID", "Waktu / Tanggal", "Turnamen", "Olahraga", "Mode", "Tim A", "Tim B", "Skor Set", "Pemenang", "Status Menang", "Format Match", "Aturan 40-40", "Durasi (Mnt)"];
  var sheet = getOrCreateSheet(ss, "Pertandingan", headers, "#15803d");
  
  var scoreStr = "";
  if (m.sets_history && m.sets_history.length > 0) {
    scoreStr = m.sets_history.map(function(s) { return (s.team_a || 0) + "-" + (s.team_b || 0); }).join(", ");
  }
  
  var winnerName = m.winner === "team_a" ? m.team_a_name : (m.winner === "team_b" ? m.team_b_name : "Seri / Batal");
  var winReason = m.win_reason || "Selesai Normal";
  var gamesCount = (m.rules && m.rules.games_per_set) ? m.rules.games_per_set : 6;
  var setsWin = (m.rules && m.rules.sets_to_win) ? ("Best of " + (m.rules.sets_to_win * 2 - 1) + " (" + gamesCount + " Games)") : ("6 Games");
  var pointRule = (m.rules && m.rules.golden_point) ? "Golden Point (No-Ad)" : "Deuce / Advantage";
  var modeLabel = m.mode === "doubles" ? "Ganda (Doubles 2v2)" : "Tunggal (Singles 1v1)";
  
  sheet.appendRow([
    m.id || "",
    m.date || Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd HH:mm:ss"),
    m.tournament_name || "-",
    m.sport || "Tennis",
    modeLabel,
    m.team_a_name || "Tim A",
    m.team_b_name || "Tim B",
    scoreStr,
    winnerName,
    winReason,
    setsWin,
    pointRule,
    m.duration_minutes || 0
  ]);
  
  autoResizeSheet(sheet, headers.length);
}

function syncAllMatches(ss, matches) {
  var headers = ["ID", "Waktu / Tanggal", "Turnamen", "Olahraga", "Mode", "Tim A", "Tim B", "Skor Set", "Pemenang", "Status Menang", "Format Match", "Aturan 40-40", "Durasi (Mnt)"];
  var sheet = ss.getSheetByName("Pertandingan");
  if (sheet) {
    sheet.clear();
  }
  sheet = getOrCreateSheet(ss, "Pertandingan", headers, "#15803d");
  
  var rows = [];
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];
    var scoreStr = "";
    if (m.sets_history && m.sets_history.length > 0) {
      scoreStr = m.sets_history.map(function(s) { return (s.team_a || 0) + "-" + (s.team_b || 0); }).join(", ");
    }
    var winnerName = m.winner === "team_a" ? m.team_a_name : (m.winner === "team_b" ? m.team_b_name : "-");
    var winReason = m.win_reason || "Selesai Normal";
    var gamesCount = (m.rules && m.rules.games_per_set) ? m.rules.games_per_set : 6;
    var setsWin = (m.rules && m.rules.sets_to_win) ? ("Best of " + (m.rules.sets_to_win * 2 - 1) + " (" + gamesCount + " Games)") : "6 Games";
    var pointRule = (m.rules && m.rules.golden_point) ? "Golden Point (No-Ad)" : "Deuce / Advantage";
    var modeLabel = m.mode === "doubles" ? "Ganda (Doubles 2v2)" : "Tunggal (Singles 1v1)";
    
    rows.push([
      m.id || "",
      m.date || "-",
      m.tournament_name || "-",
      m.sport || "Tennis",
      modeLabel,
      m.team_a_name || "Tim A",
      m.team_b_name || "Tim B",
      scoreStr,
      winnerName,
      winReason,
      setsWin,
      pointRule,
      m.duration_minutes || 0
    ]);
  }
  
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  autoResizeSheet(sheet, headers.length);
}

function syncAllPlayers(ss, players) {
  var headers = ["ID Pemain", "Nama Lengkap", "Panggilan", "Tangan Dominan", "Skill Level", "Main", "Menang", "Kalah", "Win Rate %", "Catatan"];
  var sheet = ss.getSheetByName("Klasemen_Pemain");
  if (sheet) {
    sheet.clear();
  }
  sheet = getOrCreateSheet(ss, "Klasemen_Pemain", headers, "#0369a1");
  
  var rows = [];
  for (var i = 0; i < players.length; i++) {
    var p = players[i];
    var played = p.matches_played || 0;
    var won = p.matches_won || 0;
    var lost = p.matches_lost || 0;
    var rate = played > 0 ? ((won / played) * 100).toFixed(1) + "%" : "0.0%";
    
    rows.push([
      p.id || "",
      p.name || "",
      p.nickname || "-",
      p.handedness || "Kanan",
      p.level || "Intermediate",
      played,
      won,
      lost,
      rate,
      p.notes || ""
    ]);
  }
  
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  autoResizeSheet(sheet, headers.length);
}

function syncAllTournaments(ss, tournaments) {
  var headers = ["ID Turnamen", "Nama Turnamen", "Format", "Kategori", "Jumlah Peserta", "Status", "Juara 🏆", "Tanggal Dibuat"];
  var sheet = ss.getSheetByName("Turnamen");
  if (sheet) {
    sheet.clear();
  }
  sheet = getOrCreateSheet(ss, "Turnamen", headers, "#7e22ce");
  
  var rows = [];
  for (var i = 0; i < tournaments.length; i++) {
    var t = tournaments[i];
    var participantsCount = (t.participants && t.participants.length) || 0;
    rows.push([
      t.id || "",
      t.name || "Turnamen",
      t.format || "Knockout (Bagan Gugur)",
      t.sport || "Tennis",
      participantsCount,
      t.status || "active",
      t.champion_name || "Belum Selesai",
      t.created_at || "-"
    ]);
  }
  
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  autoResizeSheet(sheet, headers.length);
}

function appendTournamentRow(ss, t) {
  var headers = ["ID Turnamen", "Nama Turnamen", "Format", "Kategori", "Jumlah Peserta", "Status", "Juara 🏆", "Tanggal Dibuat"];
  var sheet = getOrCreateSheet(ss, "Turnamen", headers, "#7e22ce");
  sheet.appendRow([
    t.id || "",
    t.name || "Turnamen",
    t.format || "Knockout",
    t.sport || "Tennis",
    (t.participants && t.participants.length) || 0,
    t.status || "active",
    t.champion_name || "-",
    t.created_at || Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd HH:mm:ss")
  ]);
  autoResizeSheet(sheet, headers.length);
}

function autoResizeSheet(sheet, maxCols) {
  for (var c = 1; c <= maxCols; c++) {
    sheet.autoResizeColumn(c);
  }
}
