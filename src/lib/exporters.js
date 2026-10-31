import { csvCell } from "./util.js";
import { REPORT_FONT } from "./report.js";

/* Builds the grade report file in each format. The heavy libraries are imported only when someone exports,
   so they never slow down the normal pages. `assets` = { letterhead, banner }: PNG bytes of the BulSU
   letterhead (full page) and its top banner. */

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
  const [letterhead, banner] = await Promise.all([get("/report/letterhead.png"), get("/report/banner.png")]);
  return { letterhead, banner };
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
  const lines = [report.detailHead, ...report.detailRows].map((r) => r.map(csvCell).join(","));
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
  ws.columns = report.columns.map((c, i) => ({ width: i === 0 ? 14 : i === 1 ? 30 : c.label === "Remarks" ? 12 : c.label === "Final" || c.label === "Eq." ? 9 : 14 }));
  const BANNER_ROWS = 6;
  for (let r = 1; r <= BANNER_ROWS; r++) ws.getRow(r).height = 23;
  const img = wb.addImage({ buffer: typeof Buffer !== "undefined" ? Buffer.from(assets.banner) : assets.banner, extension: "png" });
  ws.addImage(img, { tl: { col: 0, row: 0 }, ext: { width: 720, height: 183 } });

  let r = BANNER_ROWS + 1;
  const merged = (text, opts) => {
    ws.mergeCells(r, 1, r, n);
    const cell = ws.getCell(r, 1);
    cell.value = text;
    Object.assign(cell, opts);
    r++;
  };
  merged(report.college, { font: font({ bold: true, size: 13, color: { argb: "FF" + MAROON } }), alignment: { horizontal: "center" } });
  merged(report.title, { font: font({ bold: true, size: 14 }), alignment: { horizontal: "center" } });
  r++;
  for (const [label, value] of report.info) {
    ws.mergeCells(r, 1, r, n);
    ws.getCell(r, 1).value = { richText: [{ text: label + ": ", font: font({ bold: true }) }, { text: String(value), font: font() }] };
    r++;
  }
  r++;

  const headerRow = r;
  report.columns.forEach((c, i) => Object.assign(ws.getCell(r, i + 1), { value: c.label }, head));
  ws.getRow(r).height = 42;
  r++;
  report.rawRows.forEach((row, idx) => {
    row.forEach((v, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = v;
      cell.font = font();
      cell.border = border;
      if (idx % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + ZEBRA } };
      const col = report.columns[i];
      cell.alignment = { horizontal: col.align, vertical: "middle" };
      if (typeof v === "number") cell.numFmt = "0.00";
    });
    r++;
  });
  r++;
  ws.mergeCells(r, 1, r, n);
  ws.getCell(r, 1).value = report.summary;
  ws.getCell(r, 1).font = font({ bold: true });
  ws.views = [{ showGridLines: false, state: "frozen", ySplit: headerRow }];
  ws.pageSetup = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };

  /* ---- sheet 2: every score */
  const sc = wb.addWorksheet("All scores", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  sc.columns = report.detailHead.map((_, i) => ({ width: i === 0 ? 14 : i === 1 ? 30 : 12 }));
  report.detailHead.forEach((h, i) => Object.assign(sc.getCell(1, i + 1), { value: h }, head));
  sc.getRow(1).height = 42;
  const body = [report.maxRow, ...report.detailRows];
  body.forEach((row, idx) => {
    row.forEach((v, i) => {
      const cell = sc.getCell(idx + 2, i + 1);
      const isEq = i === row.length - 2;
      cell.value = isEq && v !== "" && v != null ? Number(v) : v === "" ? null : v;
      cell.font = font({ bold: idx === 0 });
      cell.border = border;
      cell.alignment = { horizontal: i < 2 || i === row.length - 1 ? "left" : "right", vertical: "middle" };
      if (typeof cell.value === "number" && (i >= row.length - 3)) cell.numFmt = "0.00";
      if (idx === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    });
  });

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
  const bodyRows = report.rows.map(
    (row, idx) =>
      new d.TableRow({
        cantSplit: true,
        children: row.map((v, i) => cell(v, i, { fill: idx % 2 ? ZEBRA : undefined, align: report.columns[i].align })),
      })
  );
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
          P(T(""), { spacing: { after: 100 } }),
          table,
          P(T(report.summary, { bold: true, size: 18 }), { spacing: { before: 160, after: 360 } }),
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
  const bg = () => doc.addImage(assets.letterhead, "PNG", 0, 0, W, H, "letterhead", "FAST");
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
    willDrawPage: (data) => { if (data.pageNumber > 1) bg(); },
  });

  let endY = doc.lastAutoTable.finalY + 7;
  if (endY > H - 58 - 30) { doc.addPage(); bg(); endY = 58; }
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(0, 0, 0);
  doc.text(report.summary, 15, endY);
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
