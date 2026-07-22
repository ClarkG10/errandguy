import PDFDocument from 'pdfkit';
import type { Prisma } from '@prisma/client';

/**
 * pdfkit renderers that reproduce the DomPDF blade templates
 * (resources/views/pdf/receipt.blade.php and earnings-statement.blade.php)
 * as closely as the built-in AFM fonts allow.
 *
 * NOTE ON CURRENCY: the blade templates print the peso sign (U+20B1) using the
 * DejaVu Sans font. pdfkit ships only the standard 14 AFM fonts (Helvetica…),
 * whose WinAnsi encoding has no U+20B1 glyph, and no TTF is bundled in the repo.
 * To keep every amount guaranteed-renderable and unambiguous we prefix money
 * with "PHP " instead of the ₱ glyph — same meaning, always visible.
 */

type DecimalLike = Prisma.Decimal | number | string | null | undefined;

const COLOR = {
  green: '#16a34a',
  darkGreen: '#15803d',
  text: '#1f2937',
  grey: '#6b7280',
  lightGrey: '#9ca3af',
  border: '#e5e7eb',
  lightGreenBg: '#f0fdf4',
  greenBorder: '#dcfce7',
  paidBg: '#dcfce7',
  paidText: '#15803d',
  otherBg: '#f3f4f6',
  otherText: '#6b7280',
  rowEven: '#f9fafb',
};

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** PHP number_format($v, 2): thousands separators + 2 decimals. */
function money(v: DecimalLike): string {
  const n = Number(v ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  return safe.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Carbon ->format('M j, Y g:i A') in UTC (app timezone). */
function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return '—';
  let h = d.getUTCHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${h}:${min} ${ampm}`;
}

/** Carbon ->format('M j, Y') in UTC. */
function fmtDate(d: Date | null | undefined): string {
  if (!d) return '—';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** ucfirst(str_replace('_', ' ', $s)). */
function ucfirstSpaced(s: string): string {
  const t = String(s ?? '').replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export interface ReceiptPdfData {
  payment: {
    id: string;
    status: string;
    amount: DecimalLike;
    currency: string | null;
    method: string;
    paid_at: Date | null;
    refund_amount: DecimalLike;
    refunded_at: Date | null;
  };
  booking: {
    booking_number: string | null;
    errand_type: string | null;
    pickup_address: string | null;
    dropoff_address: string | null;
    runner_name: string | null;
  };
  generated_at: Date;
}

export interface EarningsLineItem {
  completed_at: Date | null;
  booking_number: string;
  errand_type: string | null;
  runner_payout: DecimalLike;
}

export interface EarningsPdfData {
  runner: { name: string | null; phone: string | null };
  period: string;
  range_start: Date | null;
  range_end: Date | null;
  total_earnings: number;
  total_errands: number;
  avg_per_errand: number;
  line_items: EarningsLineItem[];
  generated_at: Date;
}

/** Brand header block: green logo, grey doc title, 3pt green rule. Returns next y. */
function drawHeader(
  doc: PDFKit.PDFDocument,
  docTitle: string,
  left: number,
  right: number,
): number {
  doc.font('Helvetica-Bold').fontSize(24).fillColor(COLOR.green)
    .text('ErrandGuy', left, doc.page.margins.top);
  doc.font('Helvetica').fontSize(14).fillColor(COLOR.grey)
    .text(docTitle, left, doc.y + 2);
  const y = doc.y + 12;
  doc.lineWidth(3).strokeColor(COLOR.green).moveTo(left, y).lineTo(right, y).stroke();
  return y + 24;
}

/** Centred footer note beneath the given y. */
function drawFooter(
  doc: PDFKit.PDFDocument,
  note: string,
  left: number,
  contentW: number,
  y: number,
): void {
  const top = y + 28;
  doc.lineWidth(1).strokeColor(COLOR.border)
    .moveTo(left, top).lineTo(left + contentW, top).stroke();
  doc.font('Helvetica').fontSize(10).fillColor(COLOR.lightGrey)
    .text(note, left, top + 12, { width: contentW, align: 'center' });
}

export function renderReceiptPdf(doc: PDFKit.PDFDocument, d: ReceiptPdfData): void {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentW = right - left;

  let y = drawHeader(doc, 'Payment Receipt', left, right);

  // Status badge
  const isPaid = ['paid', 'completed', 'succeeded'].includes(d.payment.status);
  const badge = String(d.payment.status).toUpperCase();
  doc.font('Helvetica-Bold').fontSize(10);
  const badgeW = doc.widthOfString(badge) + 20;
  const badgeH = 18;
  doc.roundedRect(left, y, badgeW, badgeH, 9).fill(isPaid ? COLOR.paidBg : COLOR.otherBg);
  doc.fillColor(isPaid ? COLOR.paidText : COLOR.otherText)
    .text(badge, left + 10, y + 5, { lineBreak: false });
  y += badgeH + 20;

  // Amount box
  const boxH = 82;
  doc.rect(left, y, contentW, boxH).fillAndStroke(COLOR.lightGreenBg, COLOR.greenBorder);
  doc.font('Helvetica-Bold').fontSize(30).fillColor(COLOR.darkGreen)
    .text(`PHP ${money(d.payment.amount)}`, left, y + 16, { width: contentW, align: 'center' });
  const label = `${(d.payment.currency ?? 'PHP')}  ·  ${ucfirstSpaced(String(d.payment.method ?? ''))}`;
  doc.font('Helvetica').fontSize(10).fillColor(COLOR.grey)
    .text(label.toUpperCase(), left, y + 56, { width: contentW, align: 'center' });
  y += boxH + 20;

  // Detail rows
  const rows: Array<[string, string]> = [
    ['Receipt ID', d.payment.id],
    ['Booking #', d.booking.booking_number ?? '—'],
    ['Errand Type', d.booking.errand_type ?? '—'],
    ['Pickup', d.booking.pickup_address ?? '—'],
    ['Dropoff', d.booking.dropoff_address ?? '—'],
    ['Runner', d.booking.runner_name ?? '—'],
    ['Paid at', d.payment.paid_at ? fmtDateTime(d.payment.paid_at) : '—'],
  ];
  const hasRefund = d.payment.refund_amount !== null
    && d.payment.refund_amount !== undefined
    && Number(d.payment.refund_amount) !== 0;
  if (hasRefund) {
    let r = `PHP ${money(d.payment.refund_amount)}`;
    if (d.payment.refunded_at) r += ` (${fmtDate(d.payment.refunded_at)})`;
    rows.push(['Refunded', r]);
  }

  const keyW = contentW * 0.4;
  const valX = left + keyW;
  const valW = contentW - keyW;
  const padY = 9;
  for (const [k, v] of rows) {
    doc.font('Helvetica').fontSize(12);
    const kH = doc.heightOfString(k, { width: keyW - 8 });
    doc.font('Helvetica-Bold').fontSize(12);
    const vH = doc.heightOfString(v, { width: valW - 8, align: 'right' });
    const rowH = Math.max(kH, vH) + padY * 2;

    doc.font('Helvetica').fontSize(12).fillColor(COLOR.grey)
      .text(k, left + 4, y + padY, { width: keyW - 8 });
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR.text)
      .text(v, valX + 4, y + padY, { width: valW - 8, align: 'right' });

    const bottom = y + rowH;
    doc.lineWidth(1).strokeColor(COLOR.border)
      .moveTo(left, bottom).lineTo(left + contentW, bottom).stroke();
    y = bottom;
  }

  drawFooter(
    doc,
    `Generated ${fmtDateTime(d.generated_at)}  ·  Thank you for using ErrandGuy.`,
    left,
    contentW,
    y,
  );
}

export function renderEarningsPdf(doc: PDFKit.PDFDocument, d: EarningsPdfData): void {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentW = right - left;

  let y = drawHeader(doc, 'Runner Earnings Statement', left, right);

  // Meta block (label / value / label / value)
  const lab1 = left;
  const val1 = left + 70;
  const lab2 = left + contentW * 0.5;
  const val2 = lab2 + 78;
  const rangeText = `${d.range_start ? fmtDate(d.range_start) : '—'} – ${d.range_end ? fmtDate(d.range_end) : '—'}`;
  const metaLine = (labelA: string, valueA: string, labelB: string, valueB: string): void => {
    doc.font('Helvetica').fontSize(12).fillColor(COLOR.grey).text(labelA, lab1, y, { lineBreak: false });
    doc.font('Helvetica-Bold').fillColor(COLOR.text).text(valueA, val1, y, { width: lab2 - val1 - 8 });
    const afterA = doc.y;
    doc.font('Helvetica').fillColor(COLOR.grey).text(labelB, lab2, y, { lineBreak: false });
    doc.font('Helvetica-Bold').fillColor(COLOR.text).text(valueB, val2, y, { width: right - val2 });
    y = Math.max(afterA, doc.y) + 4;
  };
  metaLine('Runner', d.runner.name ?? '', 'Period', ucfirstSpaced(d.period));
  metaLine('Phone', d.runner.phone ?? '', 'Date range', rangeText);
  y += 16;

  // Summary tiles (3 cells)
  const cellW = contentW / 3;
  const cellH = 62;
  const tiles: Array<[string, string]> = [
    [`PHP ${money(d.total_earnings)}`, 'Total Earnings'],
    [`${d.total_errands}`, 'Errands Completed'],
    [`PHP ${money(d.avg_per_errand)}`, 'Avg / Errand'],
  ];
  tiles.forEach(([val, lbl], i) => {
    const x = left + cellW * i;
    doc.rect(x, y, cellW, cellH).fillAndStroke(COLOR.lightGreenBg, COLOR.greenBorder);
    doc.font('Helvetica-Bold').fontSize(18).fillColor(COLOR.darkGreen)
      .text(val, x, y + 14, { width: cellW, align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor(COLOR.grey)
      .text(lbl.toUpperCase(), x, y + 40, { width: cellW, align: 'center' });
  });
  y += cellH + 24;

  // Items table geometry
  const dateW = contentW * 0.24;
  const bookW = contentW * 0.19;
  const payW = contentW * 0.19;
  const typeW = contentW - dateW - bookW - payW;
  const colDateX = left;
  const colBookX = left + dateW;
  const colTypeX = colBookX + bookW;
  const colPayX = colTypeX + typeW;
  const padX = 10;
  const padY = 7;
  const headerH = 26;
  const bottomLimit = doc.page.height - doc.page.margins.bottom - 60;

  const drawTableHeader = (): void => {
    doc.rect(left, y, contentW, headerH).fill(COLOR.green);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff');
    doc.text('Date', colDateX + padX, y + 8, { width: dateW - padX * 2, lineBreak: false });
    doc.text('Booking #', colBookX + padX, y + 8, { width: bookW - padX * 2, lineBreak: false });
    doc.text('Errand Type', colTypeX + padX, y + 8, { width: typeW - padX * 2, lineBreak: false });
    doc.text('Payout', colPayX + padX, y + 8, { width: payW - padX * 2, align: 'right', lineBreak: false });
    y += headerH;
  };

  drawTableHeader();

  if (d.line_items.length === 0) {
    const rowH = 34;
    doc.font('Helvetica').fontSize(12).fillColor(COLOR.lightGrey)
      .text('No completed errands in this period.', left, y + 10, { width: contentW, align: 'center' });
    doc.lineWidth(1).strokeColor(COLOR.border)
      .moveTo(left, y + rowH).lineTo(left + contentW, y + rowH).stroke();
    y += rowH;
  } else {
    d.line_items.forEach((item, i) => {
      const dateStr = item.completed_at ? fmtDateTime(item.completed_at) : '—';
      const typeStr = item.errand_type ?? '—';
      const payStr = `PHP ${money(item.runner_payout)}`;

      doc.font('Helvetica').fontSize(11);
      const cellH = Math.max(
        doc.heightOfString(dateStr, { width: dateW - padX * 2 }),
        doc.heightOfString(item.booking_number ?? '', { width: bookW - padX * 2 }),
        doc.heightOfString(typeStr, { width: typeW - padX * 2 }),
        doc.heightOfString(payStr, { width: payW - padX * 2, align: 'right' }),
      );
      const rowH = cellH + padY * 2;

      if (y + rowH > bottomLimit) {
        doc.addPage();
        y = doc.page.margins.top;
        drawTableHeader();
      }

      // Zebra shading (blade: tr:nth-child(even))
      if ((i + 1) % 2 === 0) {
        doc.rect(left, y, contentW, rowH).fill(COLOR.rowEven);
      }

      doc.font('Helvetica').fontSize(11).fillColor(COLOR.text);
      doc.text(dateStr, colDateX + padX, y + padY, { width: dateW - padX * 2 });
      doc.text(item.booking_number ?? '', colBookX + padX, y + padY, { width: bookW - padX * 2 });
      doc.text(typeStr, colTypeX + padX, y + padY, { width: typeW - padX * 2 });
      doc.text(payStr, colPayX + padX, y + padY, { width: payW - padX * 2, align: 'right' });

      doc.lineWidth(1).strokeColor(COLOR.border)
        .moveTo(left, y + rowH).lineTo(left + contentW, y + rowH).stroke();
      y += rowH;
    });

    // Totals row
    const totalsH = 30;
    if (y + totalsH > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
      drawTableHeader();
    }
    doc.lineWidth(2).strokeColor(COLOR.green)
      .moveTo(left, y).lineTo(left + contentW, y).stroke();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR.text);
    doc.text(`Total (${d.total_errands} errands)`, colDateX + padX, y + padY + 2, {
      width: colPayX - colDateX - padX * 2,
    });
    doc.text(`PHP ${money(d.total_earnings)}`, colPayX + padX, y + padY + 2, {
      width: payW - padX * 2,
      align: 'right',
    });
    y += totalsH;
  }

  drawFooter(
    doc,
    `Generated ${fmtDateTime(d.generated_at)}  ·  This statement is provided for informational purposes and is not a tax document.`,
    left,
    contentW,
    y,
  );
}

/** Construct a fresh A4 document with blade-matching 36pt margins. */
export function newPdfDocument(): PDFKit.PDFDocument {
  return new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
}
