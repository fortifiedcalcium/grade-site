/**
 * Grade Portal PIN mail merge (Google Sheets + Gmail).
 *
 * Sends each student their student number, PIN and the sign-in link from YOUR Gmail account.
 * Setup: see README.md in this folder. Paste this file into Extensions > Apps Script of the sheet that
 * holds the file downloaded from the app (Students & PINs > "Mail merge file").
 *
 * The sheet "Students" needs the columns: Email, Student no., Name, PIN (the app's file also has
 * First name, Section and Link, which the message can use). A "Status" column is added for you.
 * The sheet "Template" holds the subject and the message; {{Column name}} is replaced per student.
 */

var DATA_SHEET = "Students";
var TEMPLATE_SHEET = "Template";
var NEW_SHEET = "New";
var STATUS_HEADER = "Status";
var REQUIRED_HEADERS = ["Email", "Student no.", "Name", "PIN"];
var MAX_RUN_MS = 5 * 60 * 1000; // Apps Script stops a run at 6 minutes; stop early and resume next time

var TEMPLATE_ROWS = [
  ["Subject", "Your grade portal PIN ({{Section}})"],
  ["Sender name", "BulSU CICT Grade Portal"],
  ["Reply-to email", ""],
  ["Email pattern (only used when a row's Email is blank; {id} = student number in lowercase)", ""],
  ["Only send to section (leave blank for everyone)", ""],
  [
    "Message",
    "Hi {{First name}},\n\n" +
      "You can now check your grades online.\n\n" +
      "Website: {{Link}}\n" +
      "Student number: {{Student no.}}\n" +
      "PIN: {{PIN}}\n\n" +
      "Sign in with your student number and this PIN. Your PIN is private: please do not share it with anyone. " +
      "If you lose it, reply to this email and I will issue a new one.\n\n" +
      "Regards,\nYour instructor",
  ],
];

/* ------------------------------------------------------------------ menu */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("PIN Mail Merge")
    .addItem("Send a test email to me", "sendTest")
    .addItem("Send PINs to students", "sendAll")
    .addSeparator()
    .addItem("Add new students from the 'New' tab", "addNewStudents")
    .addItem("Show today's remaining email limit", "showQuota")
    .addItem("Clear all 'Sent' marks", "clearStatus")
    .addItem("Create the Template sheet", "createTemplateSheet")
    .addToUi();
}

function sendAll() {
  runMerge_(false);
}

function sendTest() {
  runMerge_(true);
}

/* Adds the students that are in the "New" tab (a fresh file from the app) but not yet in "Students".
   Existing rows, the emails you typed and the Sent marks are left alone. */
function addNewStudents() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var target = getDataSheet_();
  if (!target) return ui.alert('I cannot find the "' + DATA_SHEET + '" sheet.');
  var source = ss.getSheetByName(NEW_SHEET);
  if (!source) return ui.alert('Import the new file from the app into a tab named "' + NEW_SHEET + '" first, then run this again.');

  var plan = planNewStudents_(target.getDataRange().getValues(), source.getDataRange().getValues());
  if (plan.error) return ui.alert(plan.error);
  var changed = plan.changedPins.length
    ? "\n\n" + plan.changedPins.length + " student(s) already in the sheet have a different PIN in the new file (" + plan.changedPins.slice(0, 5).join(", ") + (plan.changedPins.length > 5 ? ", ..." : "") +
      "). I left their rows alone. To send them the new PIN, change their PIN cell and clear their Status cell."
    : "";
  if (!plan.rows.length) return ui.alert("No new students", "Everyone in the \"" + NEW_SHEET + "\" tab is already in the sheet (" + plan.existing + " student(s))." + changed, ui.ButtonSet.OK);

  var answer = ui.alert("Add new students", "Add " + plan.rows.length + " new student(s) to the bottom of \"" + target.getName() + "\"? " + plan.existing + " are already there." + changed, ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  var firstRow = target.getDataRange().getValues().length + 1;
  target.getRange(firstRow, 1, plan.rows.length, plan.width).setValues(plan.rows);
  SpreadsheetApp.flush();

  var drop = ui.alert("Added " + plan.rows.length + " student(s)", "Fill in their Email cells, then run \"Send PINs to students\".\n\nDelete the \"" + NEW_SHEET + "\" tab now? It holds every student's PIN.", ui.ButtonSet.YES_NO);
  if (drop === ui.Button.YES) ss.deleteSheet(source);
}

function showQuota() {
  SpreadsheetApp.getUi().alert("Emails you can still send today: " + MailApp.getRemainingDailyQuota());
}

function createTemplateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(TEMPLATE_SHEET)) {
    SpreadsheetApp.getUi().alert('The "' + TEMPLATE_SHEET + '" sheet already exists. Edit it there.');
    return;
  }
  createTemplate_(ss);
  SpreadsheetApp.getUi().alert('Created the "' + TEMPLATE_SHEET + '" sheet. Edit the subject and message in column B.');
}

function clearStatus() {
  var ui = SpreadsheetApp.getUi();
  var sheet = getDataSheet_();
  if (!sheet) return ui.alert('I cannot find the "' + DATA_SHEET + '" sheet.');
  var data = sheet.getDataRange().getValues();
  var col = headerIndex_(headerNames_(data[0]), STATUS_HEADER);
  if (col < 0 || data.length < 2) return ui.alert("There are no 'Sent' marks to clear.");
  var answer = ui.alert("Clear all marks?", "Every student would be emailed again the next time you send. Continue?", ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  for (var r = 2; r <= data.length; r++) sheet.getRange(r, col + 1).setValue("");
  ui.alert("Cleared.");
}

/* ------------------------------------------------------------------ the merge */

function runMerge_(testOnly) {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = getDataSheet_();
  if (!sheet) return ui.alert('I cannot find a "' + DATA_SHEET + '" sheet. Import the file from the app into a sheet with that name.');
  var config = readConfig_(ss);
  if (!config) return ui.alert('I created the "' + TEMPLATE_SHEET + '" sheet. Check the subject and message there, then run this again.');

  var data = sheet.getDataRange().getValues();
  var headers = headerNames_(data[0]);
  for (var h = 0; h < REQUIRED_HEADERS.length; h++) {
    if (headerIndex_(headers, REQUIRED_HEADERS[h]) < 0) return ui.alert('The "' + sheet.getName() + '" sheet needs a column called "' + REQUIRED_HEADERS[h] + '".');
  }
  var statusCol = headerIndex_(headers, STATUS_HEADER);
  if (statusCol < 0) {
    statusCol = headers.length;
    headers.push(STATUS_HEADER);
    sheet.getRange(1, statusCol + 1).setValue(STATUS_HEADER);
  }

  // refuse to send anything if the message uses a {{placeholder}} that is not a column
  var unknown = unknownPlaceholders_(config.subject + "\n" + config.body, headers);
  if (unknown.length) return ui.alert("Nothing was sent.", "The message uses {{" + unknown.join("}}, {{") + "}} but there is no column with that name.", ui.ButtonSet.OK);

  var plan = buildPlan_(data, headers, statusCol, config);

  if (testOnly) return sendTestEmail_(ui, config, headers, plan);

  var quota = MailApp.getRemainingDailyQuota();
  if (!plan.ready.length && !plan.skipped.length) return ui.alert("There is nobody left to email: every row is marked Sent.");
  if (!plan.ready.length) {
    markSkipped_(sheet, plan.skipped, statusCol);
    return ui.alert("Nothing to send. " + plan.skipped.length + " row(s) were skipped because the email or the PIN is missing (see the Status column).");
  }
  var message =
    "Send " + plan.ready.length + " email(s) from your Gmail account?\n\n" +
    "Your limit for today: " + quota + " email(s)." +
    (plan.ready.length > quota ? "\nOnly the first " + quota + " will go out today. Run this again tomorrow for the rest; students already marked Sent are skipped." : "") +
    (plan.skipped.length ? "\n\n" + plan.skipped.length + " row(s) have no valid email address or no PIN and will be skipped." : "") +
    (plan.alreadySent ? "\n" + plan.alreadySent + " row(s) were already sent." : "");
  if (ui.alert("Send PINs", message, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  markSkipped_(sheet, plan.skipped, statusCol);
  var started = Date.now(), sent = 0, errors = 0, stoppedBy = "";
  for (var i = 0; i < plan.ready.length; i++) {
    if (quota <= 0) { stoppedBy = "the daily email limit"; break; }
    if (Date.now() - started > MAX_RUN_MS) { stoppedBy = "the time limit of one run"; break; }
    var item = plan.ready[i];
    try {
      deliver_(item.to, config, item.values);
      sheet.getRange(item.row, statusCol + 1).setValue("Sent " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"));
      sent++;
      quota--;
    } catch (err) {
      sheet.getRange(item.row, statusCol + 1).setValue("Error: " + (err && err.message ? err.message : err));
      errors++;
    }
    if ((i + 1) % 10 === 0) SpreadsheetApp.flush();
  }
  SpreadsheetApp.flush();
  var left = plan.ready.length - sent - errors;
  ui.alert(
    "Done",
    "Sent: " + sent + (errors ? "\nErrors: " + errors + " (see the Status column)" : "") +
      (stoppedBy ? "\n\nStopped at " + stoppedBy + ". " + left + " student(s) are still waiting: run this again later." : ""),
    ui.ButtonSet.OK
  );
}

function sendTestEmail_(ui, config, headers, plan) {
  var me = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  var sample = plan.ready[0] || plan.firstAny;
  if (!me) return ui.alert("I could not work out your own email address.");
  if (!sample) return ui.alert("There are no student rows to use as an example.");
  deliver_(me, config, sample.values, "[TEST] ");
  ui.alert("Test sent", "A test email was sent to " + me + " using the row for " + (sample.values["name"] || "the first student") + ". Nothing was marked as Sent.", ui.ButtonSet.OK);
}

/* Works out who gets an email: rows that are not yet Sent, have a valid address (or one built from the pattern). */
function buildPlan_(data, headers, statusCol, config) {
  var plan = { ready: [], skipped: [], alreadySent: 0, firstAny: null };
  var emailCol = headerIndex_(headers, "Email");
  var idCol = headerIndex_(headers, "Student no.");
  var pinCol = headerIndex_(headers, "PIN");
  var secCol = headerIndex_(headers, "Section");
  var only = String(config.section || "").trim().toLowerCase();
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (!String(row[idCol] || "").trim() && !String(row[pinCol] || "").trim()) continue; // blank line
    if (only && secCol >= 0 && String(row[secCol]).trim().toLowerCase() !== only) continue;
    var values = rowValues_(headers, row);
    var item = { row: r + 1, values: values };
    if (!plan.firstAny) plan.firstAny = item;
    if (/^sent/i.test(String(row[statusCol] || ""))) { plan.alreadySent++; continue; }
    var to = emailFor_(row[emailCol], row[idCol], config.pattern);
    if (!to) { item.reason = "no valid email"; plan.skipped.push(item); continue; }
    if (!String(row[pinCol] || "").trim()) { item.reason = "no PIN"; plan.skipped.push(item); continue; }
    item.to = to;
    plan.ready.push(item);
  }
  return plan;
}

function markSkipped_(sheet, skipped, statusCol) {
  for (var i = 0; i < skipped.length; i++) sheet.getRange(skipped[i].row, statusCol + 1).setValue("Skipped: " + skipped[i].reason);
}

function deliver_(to, config, values, subjectPrefix) {
  var subject = (subjectPrefix || "") + renderTemplate_(config.subject, values, false);
  var options = {
    name: config.sender || "Grade Portal",
    htmlBody: buildHtmlBody_(config.body, values),
  };
  if (config.replyTo) options.replyTo = config.replyTo;
  GmailApp.sendEmail(to, subject, renderTemplate_(config.body, values, false), options);
}

/* ------------------------------------------------------------------ sheets */

function getDataSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var named = ss.getSheetByName(DATA_SHEET);
  if (named) return named;
  var all = ss.getSheets();
  for (var i = 0; i < all.length; i++) if (all[i].getName() !== TEMPLATE_SHEET) return all[i];
  return null;
}

function createTemplate_(ss) {
  var sheet = ss.insertSheet(TEMPLATE_SHEET);
  sheet.getRange(1, 1, TEMPLATE_ROWS.length, 2).setValues(TEMPLATE_ROWS);
  try {
    sheet.setColumnWidth(1, 300);
    sheet.setColumnWidth(2, 560);
    sheet.getRange(1, 1, TEMPLATE_ROWS.length, 1).setFontWeight("bold").setWrap(true).setVerticalAlignment("top");
    sheet.getRange(1, 2, TEMPLATE_ROWS.length, 1).setWrap(true).setVerticalAlignment("top");
  } catch (e) { /* formatting is optional */ }
  return sheet;
}

/* null when the Template sheet had to be created (the teacher should look at it first) */
function readConfig_(ss) {
  var sheet = ss.getSheetByName(TEMPLATE_SHEET);
  if (!sheet) { createTemplate_(ss); return null; }
  var cell = function (row) { return String(sheet.getRange(row, 2).getValue() == null ? "" : sheet.getRange(row, 2).getValue()); };
  return {
    subject: cell(1),
    sender: cell(2).trim(),
    replyTo: cell(3).trim(),
    pattern: cell(4).trim(),
    section: cell(5).trim(),
    body: cell(6),
  };
}

/* ------------------------------------------------------------------ pure helpers */

/* Which rows of `sourceData` are not in `targetData` yet (matched by student number), laid out in the
   target's column order. Existing students are never changed; ones whose PIN differs are only reported. */
function planNewStudents_(targetData, sourceData) {
  var tHeaders = headerNames_(targetData[0] || []);
  var sHeaders = headerNames_(sourceData[0] || []);
  var tId = headerIndex_(tHeaders, "Student no.");
  var sId = headerIndex_(sHeaders, "Student no.");
  if (tId < 0) return { error: 'The "Students" sheet needs a column called "Student no."' };
  if (sId < 0) return { error: 'The "' + NEW_SHEET + '" tab needs a column called "Student no." (import the file from the app).' };
  var tPin = headerIndex_(tHeaders, "PIN");
  var sPin = headerIndex_(sHeaders, "PIN");
  var sName = headerIndex_(sHeaders, "Name");

  var have = {};
  for (var r = 1; r < targetData.length; r++) {
    var key = String(targetData[r][tId] == null ? "" : targetData[r][tId]).trim().toLowerCase();
    if (key) have[key] = tPin >= 0 ? String(targetData[r][tPin]).trim() : "";
  }
  var plan = { rows: [], existing: 0, changedPins: [], width: tHeaders.length, error: "" };
  var added = {};
  for (var i = 1; i < sourceData.length; i++) {
    var row = sourceData[i];
    var id = String(row[sId] == null ? "" : row[sId]).trim().toLowerCase();
    if (!id || added[id]) continue;
    if (Object.prototype.hasOwnProperty.call(have, id)) {
      plan.existing++;
      if (tPin >= 0 && sPin >= 0 && String(row[sPin]).trim() !== have[id]) plan.changedPins.push(sName >= 0 && row[sName] ? String(row[sName]) : String(row[sId]));
      continue;
    }
    added[id] = true;
    var out = [];
    for (var c = 0; c < tHeaders.length; c++) {
      var at = headerIndex_(sHeaders, tHeaders[c]);
      out.push(at >= 0 && tHeaders[c].toLowerCase() !== STATUS_HEADER.toLowerCase() && row[at] != null ? row[at] : "");
    }
    plan.rows.push(out);
  }
  return plan;
}

function headerNames_(row) {
  var out = [];
  for (var i = 0; i < row.length; i++) out.push(String(row[i]).trim());
  return out;
}

function headerIndex_(headers, name) {
  var want = String(name).trim().toLowerCase();
  for (var i = 0; i < headers.length; i++) if (String(headers[i]).trim().toLowerCase() === want) return i;
  return -1;
}

/* { "first name": "Juan A.", "pin": "ABC234", ... } keyed by lowercase column name */
function rowValues_(headers, row) {
  var values = {};
  for (var i = 0; i < headers.length; i++) values[String(headers[i]).toLowerCase()] = row[i] == null ? "" : String(row[i]).trim();
  return values;
}

function unknownPlaceholders_(text, headers) {
  var known = {};
  for (var i = 0; i < headers.length; i++) known[String(headers[i]).toLowerCase()] = true;
  var missing = [], seen = {}, re = /\{\{\s*([^{}]+?)\s*\}\}/g, m;
  while ((m = re.exec(text)) !== null) {
    var key = m[1].trim().toLowerCase();
    if (!known[key] && !seen[key]) { seen[key] = true; missing.push(m[1].trim()); }
  }
  return missing;
}

function htmlEscape_(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* asHtml: values are escaped (a name with & or < cannot break the email), and the PIN is shown in bold */
function renderTemplate_(text, values, asHtml) {
  var source = asHtml ? htmlEscape_(text) : String(text);
  return source.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, function (match, name) {
    var key = String(name).trim().toLowerCase();
    var value = Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : "";
    if (!asHtml) return value;
    var safe = htmlEscape_(value);
    return key === "pin" ? '<b style="font-family:Consolas,Menlo,monospace;font-size:16px;letter-spacing:2px;">' + safe + "</b>" : safe;
  });
}

function buildHtmlBody_(body, values) {
  var html = renderTemplate_(body, values, true)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\r?\n/g, "<br>");
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222;">' + html + "</div>";
}

function isValidEmail_(s) {
  var t = String(s == null ? "" : s).trim();
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(t);
}

function emailFor_(email, studentNo, pattern) {
  if (isValidEmail_(email)) return String(email).trim();
  var id = String(studentNo == null ? "" : studentNo).trim().toLowerCase();
  if (pattern && id) {
    var built = String(pattern).replace(/\{id\}/gi, id);
    if (isValidEmail_(built)) return built;
  }
  return "";
}
