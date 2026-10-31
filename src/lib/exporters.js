import { csvCell } from "./util.js";
import { REPORT_FONT } from "./report.js";

/* Builds the grade report file in each format. The heavy libraries are imported only when someone exports,
   so they never slow down the normal pages. `assets` = { letterhead, banner, logos, strip }: PNG bytes of the BulSU
   letterhead (full page), its top banner, and the seal/Bagong Pilipinas and accreditation logos cropped from it. */

const MAROON = "990000";
const ZEBRA = "F8F0F0";
const MIME = {
  csv: "text/csv;charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

export async function loadAssets() {
  const get = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Could not load " + url);
    return new Uint8Array(await res.arrayBuffer());
  };
  const [letterhead, banner, logos, strip] = await Promise.all([get("/report/letterhead.png"), get("/report/banner.png"), get("/report/logos.png"), get("/report/strip.png")]);
  return { letterhead, banner, logos, strip };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* Returns { blob, filename } */
export async function makeReportFile(format, report, assets) {
  const filename = report.baseName + "." + format;
  const make = { csv: toCsv, xlsx: toXlsx, docx: toDocx, pdf: toPdf }[format];
  if (!make) throw new Error("Unknown format: " + format);
  const blob = await make(report, assets);
  return { blob, filename };
}

/* ---------------------------------------------------------------- CSV */
function toCsv(report) {
  const lines = [report.detailHead, ...report.detailText].map((r) => r.map(csvCell).join(","));
  // the byte order mark makes Excel read names with accents (Ñ) correctly
  return new Blob(["﻿" + lines.join("\r\n")], { type: MIME.csv });
}

/* ---------------------------------------------------------------- XLSX */
async function toXlsx(report, assets) {
  const ExcelJS = (await import("exceljs/dist/exceljs.min.js")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "BulSU Grade Portal";
  const font = (extra) => ({ name: REPORT_FONT, size: 10, ...extra });
  const thin = { style: "thin", color: { argb: "FFBBBBBB" } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const head = { font: font({ bold: true, color: { argb: "FFFFFFFF" } }), fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + MAROON } }, alignment: { vertical: "middle", horizontal: "center", wrapText: true }, border };

  /* ---- sheet 1: the report */
  const ws = wb.addWorksheet("Grade Report", { views: [{ showGridLines: false }] });
  const n = report.columns.length;
  const widths = report.columns.map((c, i) => (i === 0 ? 14 : i === 1 ? 30 : c.label === "Remarks" ? 12 : c.label === "Final" || c.label === "Eq." ? 9 : 14));
  /* A narrow table (few categories) would not leave room for the logos beside the centred title, so the
     columns are widened evenly until the letterhead fits. */
  const colPx = (w) => Math.round(w * 7 + 5);
  const MIN_PX = 960;
  const short = MIN_PX - widths.reduce((a, w) => a + colPx(w), 0);
  if (short > 0) widths.forEach((w, i) => { widths[i] = w + short / n / 7; });
  ws.columns = widths.map((width) => ({ width }));
  const totalPx = widths.reduce((a, w) => a + colPx(w), 0);
  const px2pt = (px) => Math.round(px * 0.75 * 100) / 100;
  const img = (buf) => wb.addImage({ buffer: typeof Buffer !== "undefined" ? Buffer.from(buf) : buf, extension: "png" });

  /* ---- letterhead: maroon band, centred titles (one merged row each), logos inside the rows */
  let r = 1;
  const row = (height) => { ws.getRow(r).height = height; return r++; };
  const band = row(14);
  ws.mergeCells(band, 1, band, n);
  ws.getCell(band, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + MAROON } };
  const titleTop = r;
  const title = (text, height, extra) => {
    const rr = row(height);
    ws.mergeCells(rr, 1, rr, n);
    const cell = ws.getCell(rr, 1);
    cell.value = text;
    cell.font = font(extra);
    cell.alignment = { horizontal: "center", vertical: "middle" };
  };
  const maroon = { argb: "FF" + MAROON };
  title("Republic of the Philippines", 18, { size: 12, color: maroon });
  title("City of Malolos, Bulacan", 18, { size: 12, color: maroon });
  title("BULACAN STATE UNIVERSITY", 28, { size: 18, bold: true, color: maroon });
  title(report.college, 20, { size: 12, bold: true, color: maroon });
  title(report.title, 24, { size: 14, bold: true, color: { argb: "FF000000" } });
  if (assets.logos) {
    // seal + Bagong Pilipinas, left of the titles; 382x179 source, aspect kept
    ws.addImage(img(assets.logos), { tl: { col: 0.08, row: titleTop - 1 + 0.15 }, ext: { width: 213, height: 100 }, editAs: "oneCell" });
  }
  const stripRow = row(8);
  if (assets.strip) {
    const w = Math.min(totalPx - 24, 1100);
    const h = Math.round((w * 75) / 1189);
    ws.getRow(stripRow).height = px2pt(h + 8);
    // centre it: the anchor is in columns, so work out the column and offset from pixels
    let left = (totalPx - w) / 2;
    let col = 0;
    while (col < n - 1 && left >= colPx(widths[col])) { left -= colPx(widths[col]); col++; }
    ws.addImage(img(assets.strip), { tl: { col: col + left / colPx(widths[col]), row: stripRow - 1 + 0.05 }, ext: { width: w, height: h }, editAs: "oneCell" });
  }
  row(8);

  /* ---- info block: one item per row, bold labels, left aligned */
  const infoRow = (label, value, extra = {}) => {
    const rr = row(extra.height || 16);
    ws.mergeCells(rr, 1, rr, n);
    const cell = ws.getCell(rr, 1);
    cell.value = { richText: [{ text: label + ": ", font: font({ bold: true }) }, { text: String(value), font: font() }] };
    cell.font = font();
    cell.alignment = { horizontal: "left", vertical: extra.vertical || "middle", wrapText: !!extra.wrap };
  };
  for (const [label, value] of report.info) infoRow(label, value);
  if (report.filterNote) infoRow("Filters", report.filterNote, { height: 28, wrap: true, vertical: "top" });
  row(10);

  const headerRow = r;
  report.columns.forEach((c, i) => Object.assign(ws.getCell(r, i + 1), { value: c.label }, head));
  ws.getRow(r).height = 42;
  r++;
  report.rawRows.forEach((row, idx) => {
    row.forEach((v, i) => {
      const cell = ws.getCell(r, i + 1);
      const isStat = report.rowKinds[idx] === "stat";
      cell.value = v;
      cell.font = font({ bold: isStat });
      cell.border = border;
      if (isStat) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
      else if (idx % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + ZEBRA } };
      const col = report.columns[i];
      cell.alignment = { horizontal: col.align, vertical: "middle" };
      if (typeof v === "number") cell.numFmt = "0.00";
    });
    r++;
  });
  r++;
  let lastRow = r - 2;
  if (report.summary) {
    ws.mergeCells(r, 1, r, n);
    ws.getCell(r, 1).value = report.summary;
    ws.getCell(r, 1).font = font({ bold: true });
    lastRow = r;
  }
  ws.views = [{ showGridLines: false, state: "frozen", ySplit: headerRow }];
  ws.pageSetup = {
    paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    printArea: "A1:" + ws.getColumn(n).letter + lastRow,
    printTitlesRow: headerRow + ":" + headerRow,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };

  /* ---- sheet 2: every score */
  const sc = wb.addWorksheet("All scores", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  sc.columns = report.detailHead.map((_, i) => ({ width: i === 0 ? 14 : i === 1 ? 30 : 12 }));
  report.detailHead.forEach((h, i) => Object.assign(sc.getCell(1, i + 1), { value: h }, head));
  sc.getRow(1).height = 42;
  const textCols = report.detailHead.length - 1; // the Remarks column, when the final columns are shown
  const hasFinal = report.detailHead[report.detailHead.length - 1] === "Remarks";
  report.detailRows.forEach((row, idx) => {
    const kind = report.detailKinds[idx];
    row.forEach((v, i) => {
      const cell = sc.getCell(idx + 2, i + 1);
      cell.value = v === "" ? null : v;
      cell.font = font({ bold: kind !== "student" });
      cell.border = border;
      cell.alignment = { horizontal: i < 2 || (hasFinal && i === textCols) ? "left" : "right", vertical: "middle" };
      if (typeof v === "number" && (kind === "stat" || (hasFinal && i >= textCols - 2 && i < textCols))) cell.numFmt = "0.00";
      if (kind !== "student") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    });
  });

  if (report.statsTable) {
    const st = wb.addWorksheet("Statistics", { views: [{ showGridLines: false }] });
    st.columns = report.statsTable.head.map((_, i) => ({ width: [24, 9, 9, 11, 11, 11, 30, 30, 30][i] }));
    st.mergeCells(1, 1, 1, report.statsTable.head.length);
    st.getCell(1, 1).value = report.statsTable.title + " – " + report.info.find(([k]) => k === "Section")[1];
    st.getCell(1, 1).font = font({ bold: true, size: 12, color: { argb: "FF" + MAROON } });
    st.mergeCells(2, 1, 2, report.statsTable.head.length);
    st.getCell(2, 1).value = report.statsTable.note + (report.filterNote ? " Filters: " + report.filterNote : "");
    st.getCell(2, 1).font = font({ size: 9 });
    st.getCell(2, 1).alignment = { wrapText: true, vertical: "top" };
    st.getRow(2).height = 28;
    report.statsTable.head.forEach((h, i) => Object.assign(st.getCell(4, i + 1), { value: h }, head));
    st.getRow(4).height = 30;
    report.statsTable.rawRows.forEach((row, idx) => row.forEach((v, i) => {
      const cell = st.getCell(5 + idx, i + 1);
      cell.value = v;
      cell.font = font();
      cell.border = border;
      cell.alignment = { horizontal: i === 0 || i >= 6 ? "left" : "right", vertical: "middle", wrapText: true };
      if (i >= 3 && i <= 5 && typeof v === "number") cell.numFmt = "0.00";
      if (idx % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + ZEBRA } };
    }));
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: MIME.xlsx });
}

/* ---------------------------------------------------------------- DOCX */
async function toDocx(report, assets) {
  const d = await import("docx");
  const cm = (x) => Math.round(x * 567);
  const T = (text, o = {}) => new d.TextRun({ text: String(text), font: REPORT_FONT, ...o });
  const P = (children, o = {}) => new d.Paragraph({ children: Array.isArray(children) ? children : [children], ...o });

  // the letterhead sits behind the text, on every page
  const letterhead = new d.ImageRun({
    type: "png",
    data: assets.letterhead,
    transformation: { width: 794, height: 1123 },
    altText: { name: "Letterhead", title: "BulSU letterhead", description: "Bulacan State University letterhead" },
    floating: {
      horizontalPosition: { relative: d.HorizontalPositionRelativeFrom.PAGE, offset: 0 },
      verticalPosition: { relative: d.VerticalPositionRelativeFrom.PAGE, offset: 0 },
      behindDocument: true,
      allowOverlap: true,
      wrap: { type: d.TextWrappingType.NONE },
    },
  });

  const widths = report.columns.map((c) => cm(c.widthCm));
  const total = widths.reduce((a, b) => a + b, 0);
  const line = { style: d.BorderStyle.SINGLE, size: 4, color: "BBBBBB" };
  const borders = { top: line, bottom: line, left: line, right: line };
  const none = { style: d.BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const noBorders = { top: none, bottom: none, left: none, right: none };
  const margins = { top: 40, bottom: 40, left: 60, right: 60 };

  const cell = (text, i, o = {}) =>
    new d.TableCell({
      width: { size: widths[i], type: d.WidthType.DXA },
      margins,
      borders,
      verticalAlign: d.VerticalAlign.CENTER,
      shading: o.fill ? { type: d.ShadingType.CLEAR, fill: o.fill, color: "auto" } : undefined,
      children: [P(T(text, { size: o.size || 15, bold: o.bold, color: o.color }), { alignment: o.align === "right" ? d.AlignmentType.RIGHT : o.align === "center" ? d.AlignmentType.CENTER : d.AlignmentType.LEFT })],
    });

  const headRow = new d.TableRow({
    tableHeader: true,
    cantSplit: true,
    children: report.columns.map((c, i) => cell(c.label, i, { fill: MAROON, color: "FFFFFF", bold: true, size: 13, align: c.align === "right" ? "center" : "left" })),
  });
  const bodyRows = report.rows.map((row, idx) => {
    const stat = report.rowKinds[idx] === "stat";
    return new d.TableRow({
      cantSplit: true,
      children: row.map((v, i) => cell(v, i, { fill: stat ? "EFEFEF" : idx % 2 ? ZEBRA : undefined, bold: stat, align: report.columns[i].align })),
    });
  });
  const table = new d.Table({
    width: { size: total, type: d.WidthType.DXA },
    columnWidths: widths,
    layout: d.TableLayoutType.FIXED,
    rows: [headRow, ...bodyRows],
  });

  const infoRows = [];
  for (let i = 0; i < report.info.length; i += 2) {
    const pair = [report.info[i], report.info[i + 1]];
    const half = Math.round(total / 2);
    infoRows.push(
      new d.TableRow({
        children: pair.map((kv) =>
          new d.TableCell({
            width: { size: half, type: d.WidthType.DXA },
            borders: noBorders,
            margins: { top: 20, bottom: 20, left: 0, right: 60 },
            children: [P(kv ? [T(kv[0] + ": ", { bold: true, size: 18 }), T(kv[1], { size: 18 })] : [T("")])],
          })
        ),
      })
    );
  }
  const infoTable = new d.Table({
    width: { size: total, type: d.WidthType.DXA },
    columnWidths: [Math.round(total / 2), total - Math.round(total / 2)],
    layout: d.TableLayoutType.FIXED,
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    rows: infoRows,
  });

  // the statistics table (highest, lowest, average and who holds them)
  const st = report.statsTable;
  const stWidths = st ? st.widthsCm.map((w) => cm((w / st.widthsCm.reduce((a, b) => a + b, 0)) * (total / 567))) : [];
  const stCell = (text, i, o = {}) =>
    new d.TableCell({
      width: { size: stWidths[i], type: d.WidthType.DXA },
      margins,
      borders,
      verticalAlign: d.VerticalAlign.CENTER,
      shading: o.fill ? { type: d.ShadingType.CLEAR, fill: o.fill, color: "auto" } : undefined,
      children: [P(T(text, { size: o.size || 15, bold: o.bold, color: o.color }), { alignment: i >= 1 && i <= 5 ? d.AlignmentType.RIGHT : d.AlignmentType.LEFT })],
    });
  const statsBlock = st
    ? [
        P(T(st.title, { bold: true, size: 20 }), { spacing: { before: 240, after: 40 }, keepNext: true }),
        P(T(st.note, { size: 15, color: "444444" }), { spacing: { after: 80 }, keepNext: true }),
        new d.Table({
          width: { size: stWidths.reduce((a, b) => a + b, 0), type: d.WidthType.DXA },
          columnWidths: stWidths,
          layout: d.TableLayoutType.FIXED,
          rows: [
            new d.TableRow({ tableHeader: true, cantSplit: true, children: st.head.map((h, i) => stCell(h, i, { fill: MAROON, color: "FFFFFF", bold: true, size: 13 })) }),
            ...st.rows.map((row, idx) => new d.TableRow({ cantSplit: true, children: row.map((v, i) => stCell(v, i, { fill: idx % 2 ? ZEBRA : undefined })) })),
          ],
        }),
      ]
    : [];

  const footer = new d.Footer({
    children: [
      ...report.contact.map((t) => P(T(t, { size: 14, color: "444444" }), { alignment: d.AlignmentType.CENTER, spacing: { after: 0 } })),
      P([T("Page ", { size: 14, color: "444444" }), new d.TextRun({ children: [d.PageNumber.CURRENT], font: REPORT_FONT, size: 14, color: "444444" }), T(" of ", { size: 14, color: "444444" }), new d.TextRun({ children: [d.PageNumber.TOTAL_PAGES], font: REPORT_FONT, size: 14, color: "444444" })], { alignment: d.AlignmentType.CENTER }),
    ],
  });

  const doc = new d.Document({
    creator: "BulSU Grade Portal",
    title: report.title,
    styles: { default: { document: { run: { font: REPORT_FONT, size: 18 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: cm(5.4), bottom: cm(5.5), left: cm(1.5), right: cm(1.5), header: 0, footer: cm(4.5) },
          },
        },
        headers: { default: new d.Header({ children: [P(letterhead)] }) },
        footers: { default: footer },
        children: [
          P(T(report.college, { bold: true, size: 24, color: MAROON }), { alignment: d.AlignmentType.CENTER, spacing: { after: 40 } }),
          P(T(report.title, { bold: true, size: 28 }), { alignment: d.AlignmentType.CENTER, spacing: { after: 160 } }),
          infoTable,
          ...(report.filterNote ? [P([T("Filters: ", { bold: true, size: 16 }), T(report.filterNote, { size: 16 })], { spacing: { before: 60 } })] : []),
          P(T(""), { spacing: { after: 100 } }),
          table,
          ...statsBlock,
          ...(report.summary ? [P(T(report.summary, { bold: true, size: 18 }), { spacing: { before: 160, after: 360 } })] : [P(T(""), { spacing: { after: 200 } })]),
          ...(report.info.find(([k]) => k === "Instructor")
            ? [
                P(T("Prepared by:", { size: 18 }), { spacing: { after: 360 }, keepNext: true }),
                P(T(report.info.find(([k]) => k === "Instructor")[1], { bold: true, size: 18 }), { keepNext: true, spacing: { after: 0 } }),
                P(T("Instructor", { size: 16, color: "444444" })),
              ]
            : []),
        ],
      },
    ],
  });
  return d.Packer.toBlob(doc);
}

/* ---------------------------------------------------------------- PDF */
async function toPdf(report, assets) {
  const doc = await buildPdfDoc(report, assets);
  return new Blob([doc.output("arraybuffer")], { type: MIME.pdf });
}

export async function buildPdfDoc(report, assets) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  // Helvetica is the standard PDF font and matches Arial's letter shapes and widths
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const W = 210, H = 297;
  const drawn = new Set(); // pages that already have the letterhead
  const bg = () => {
    const page = doc.internal.getCurrentPageInfo().pageNumber;
    if (drawn.has(page)) return;
    drawn.add(page);
    doc.addImage(assets.letterhead, "PNG", 0, 0, W, H, "letterhead", "FAST");
  };
  const rgb = (hex) => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  doc.setProperties({ title: report.title, creator: "BulSU Grade Portal" });
  doc.setFont("helvetica", "bold");

  bg();
  doc.setFontSize(12).setTextColor(...rgb(MAROON));
  doc.text(report.college, W / 2, 59, { align: "center" });
  doc.setFontSize(14).setTextColor(0, 0, 0);
  doc.text(report.title, W / 2, 66, { align: "center" });

  doc.setFontSize(9);
  let y = 74;
  for (let i = 0; i < report.info.length; i += 2) {
    [report.info[i], report.info[i + 1]].forEach((kv, k) => {
      if (!kv) return;
      const x = 15 + k * 90;
      const label = kv[0] + ":";
      doc.setFont("helvetica", "bold");
      const labelW = doc.getTextWidth(label + " ");
      doc.text(label, x, y);
      doc.setFont("helvetica", "normal").text(doc.splitTextToSize(String(kv[1]), 88 - labelW)[0], x + labelW, y);
    });
    y += 5;
  }

  if (report.filterNote) {
    doc.setFont("helvetica", "bold").setFontSize(8);
    const lw = doc.getTextWidth("Filters: ");
    doc.text("Filters:", 15, y);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(report.filterNote, W - 30 - lw);
    doc.text(lines, 15 + lw, y);
    y += 4 * lines.length;
  }

  const avail = W - 30;
  const sumCm = report.columns.reduce((a, c) => a + c.widthCm, 0);
  autoTable(doc, {
    startY: y + 3,
    margin: { top: 54, bottom: 58, left: 15, right: 15 },
    head: [report.columns.map((c) => c.label)],
    body: report.rows,
    theme: "grid",
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: 1.3, lineColor: [187, 187, 187], lineWidth: 0.1, textColor: [0, 0, 0], valign: "middle" },
    headStyles: { fillColor: rgb(MAROON), textColor: [255, 255, 255], fontStyle: "bold", fontSize: 6.5, halign: "center", cellPadding: 1 },
    alternateRowStyles: { fillColor: rgb(ZEBRA) },
    columnStyles: Object.fromEntries(report.columns.map((c, i) => [i, { cellWidth: (c.widthCm / sumCm) * avail, halign: c.align }])),
    willDrawPage: () => bg(),
    didParseCell: (data) => {
      if (data.section === "body" && report.rowKinds[data.row.index] === "stat") {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [239, 239, 239];
      }
    },
  });

  let endY = doc.lastAutoTable.finalY + 7;
  const st = report.statsTable;
  if (st) {
    // heading + note, the header row and the rows; start a new page only if they would not fit
    const needed = 7 + 7 + 6.5 * st.rows.length;
    if (endY + needed > H - 58) { doc.addPage(); bg(); endY = 58; }
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(0, 0, 0).text(st.title, 15, endY);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(68, 68, 68).text(st.note, 15, endY + 4.5);
    const stSum = st.widthsCm.reduce((a, b) => a + b, 0);
    autoTable(doc, {
      startY: endY + 7,
      margin: { top: 54, bottom: 58, left: 15, right: 15 },
      head: [st.head],
      body: st.rows,
      theme: "grid",
      styles: { font: "helvetica", fontSize: 7.5, cellPadding: 1.3, lineColor: [187, 187, 187], lineWidth: 0.1, textColor: [0, 0, 0], valign: "middle" },
      headStyles: { fillColor: rgb(MAROON), textColor: [255, 255, 255], fontStyle: "bold", fontSize: 6.5, halign: "center", cellPadding: 1 },
      alternateRowStyles: { fillColor: rgb(ZEBRA) },
      columnStyles: Object.fromEntries(st.widthsCm.map((w, i) => [i, { cellWidth: (w / stSum) * avail, halign: i >= 1 && i <= 5 ? "right" : "left" }])),
      willDrawPage: () => bg(),
    });
    endY = doc.lastAutoTable.finalY + 7;
  }
  if (endY > H - 58 - 30) { doc.addPage(); bg(); endY = 58; }
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(0, 0, 0);
  if (report.summary) doc.text(report.summary, 15, endY);
  const instructor = report.info.find(([k]) => k === "Instructor");
  if (instructor) {
    doc.setFont("helvetica", "normal").text("Prepared by:", 15, endY + 12);
    doc.setFont("helvetica", "bold").text(instructor[1], 15, endY + 24);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(68, 68, 68).text("Instructor", 15, endY + 28);
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(68, 68, 68);
    report.contact.forEach((t, i) => doc.text(t, W / 2, 245 + i * 3.6, { align: "center" }));
    doc.text("Page " + p + " of " + pages, W / 2, 245 + report.contact.length * 3.6, { align: "center" });
  }
  return doc;
}
