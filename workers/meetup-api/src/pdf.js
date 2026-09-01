import {
  SIGNATURES,
  SEAL,
  HELVETICA_WIDTHS,
  HELVETICA_BOLD_WIDTHS
} from "./certificate-assets.js";

const PT_PER_MM = 72 / 25.4;
const PAGE_WIDTH = 297 * PT_PER_MM;
const PAGE_HEIGHT = 210 * PT_PER_MM;
const CQW = PAGE_WIDTH / 100;

const BAND_HEIGHT = PAGE_HEIGHT * 0.21;
const PADDING_X = 7.5 * CQW;
const PADDING_TOP = 3 * CQW;
const PADDING_BOTTOM = 2.4 * CQW;
const LINE_HEIGHT = 1.5;

const TEXT_WIDTH = PAGE_WIDTH - PADDING_X * 2;

const FONT_REGULAR = "F1";
const FONT_BOLD = "F2";
const FONT_MONO = "F3";

const encoder = new TextEncoder();

const CP1252_HIGH = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f]
]);

function toWinAnsi(text) {
  const input = String(text == null ? "" : text);
  const bytes = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e) bytes[i] = code;
    else if (code >= 0xa0 && code <= 0xff) bytes[i] = code;
    else if (CP1252_HIGH.has(code)) bytes[i] = CP1252_HIGH.get(code);
    else bytes[i] = 0x3f;
  }
  return bytes;
}

function widthsFor(font) {
  return font === FONT_BOLD ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
}

function measure(text, font, size, letterSpacing = 0) {
  const bytes = toWinAnsi(text);
  const gaps = Math.max(0, bytes.length - 1) * letterSpacing;

  if (font === FONT_MONO) return (bytes.length * 600 * size) / 1000 + gaps;

  const table = widthsFor(font);
  let total = 0;
  for (const byte of bytes) total += table[byte] || 0;
  return (total * size) / 1000 + gaps;
}

function pdfString(text) {
  const bytes = toWinAnsi(text);
  let out = "";
  for (const byte of bytes) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 0x20 || byte > 0x7e) out += `\\${byte.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(byte);
  }
  return `(${out})`;
}

function wrapText(text, font, size, maxWidth) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = [];

  for (const word of words) {
    const candidate = current.concat(word);
    if (current.length > 0 && measure(candidate.join(" "), font, size) > maxWidth) {
      lines.push(current);
      current = [word];
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) lines.push(current);
  return lines;
}

class Content {
  constructor() {
    this.parts = [];
  }

  push(line) {
    this.parts.push(line);
  }

  text(value, {font, size, x, y, color = "1 1 1", letterSpacing = 0, wordSpacing = 0}) {
    this.push("BT");
    this.push(`${color} rg`);
    this.push(`/${font} ${size.toFixed(2)} Tf`);
    if (letterSpacing) this.push(`${letterSpacing.toFixed(3)} Tc`);
    if (wordSpacing) this.push(`${wordSpacing.toFixed(3)} Tw`);
    this.push(`1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`);
    this.push(`${pdfString(value)} Tj`);
    if (letterSpacing) this.push("0 Tc");
    if (wordSpacing) this.push("0 Tw");
    this.push("ET");
  }

  toString() {
    return this.parts.join("\n");
  }
}

function deflateFromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function assemble(objects) {
  const chunks = [];
  let offset = 0;

  const pushBytes = (bytes) => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  const pushText = (text) => pushBytes(encoder.encode(text));

  pushText("%PDF-1.4\n");
  pushBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const offsets = [];
  objects.forEach((object, index) => {
    offsets[index] = offset;
    pushText(`${index + 1} 0 obj\n${object.dict}\n`);
    if (object.stream) {
      pushText("stream\n");
      pushBytes(object.stream);
      pushText("\nendstream\n");
    }
    pushText("endobj\n");
  });

  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const value of offsets) xref += `${String(value).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\n`;
  xref += `startxref\n${xrefOffset}\n%%EOF\n`;
  pushText(xref);

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const file = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    file.set(chunk, cursor);
    cursor += chunk.length;
  }
  return file;
}

function layoutBlocks(certificate) {
  const blocks = [];

  blocks.push({
    kind: "line",
    value: "CERTIFICADO DE PARTICIPAÇÃO",
    font: FONT_BOLD,
    size: 3.1 * CQW,
    letterSpacing: 0.07 * 3.1 * CQW,
    align: "center",
    marginBottom: 2.8 * CQW
  });

  const paragraphSize = 1.72 * CQW;
  const paragraph = (value, marginBottom) => ({
    kind: "paragraph",
    lines: wrapText(value, FONT_REGULAR, paragraphSize, TEXT_WIDTH),
    font: FONT_REGULAR,
    size: paragraphSize,
    marginBottom
  });

  blocks.push(
    paragraph(
      "O Hack in Brasil, iniciativa dedicada à promoção do conhecimento, ao desenvolvimento " +
        "técnico e ao fortalecimento da comunidade na área de segurança da informação, certifica que",
      0
    )
  );

  blocks.push({
    kind: "line",
    value: certificate.participantName,
    font: FONT_BOLD,
    size: 2.3 * CQW,
    align: "center",
    marginTop: 1.6 * CQW,
    marginBottom: 2 * CQW
  });

  blocks.push(paragraph(certificate.participationSentence, 1.4 * CQW));
  blocks.push(
    paragraph(
      "Durante o evento, teve acesso a discussões relevantes, abordagens práticas e troca de " +
        "experiências entre profissionais da área, contribuindo para o aprimoramento de conhecimentos, " +
        "atualização técnica e ampliação da compreensão sobre o cenário atual de segurança.",
      1.4 * CQW
    )
  );
  blocks.push(
    paragraph(
      "Sua participação contribuiu para o fortalecimento das interações, para a construção " +
        "coletiva do conhecimento e para o desenvolvimento contínuo da comunidade.",
      0
    )
  );

  blocks.push({
    kind: "line",
    value: certificate.issuedSentence,
    font: FONT_REGULAR,
    size: 1.5 * CQW,
    align: "right",
    marginTop: 1.2 * CQW
  });

  blocks.push({
    kind: "line",
    value: "www.hackinbrasil.com.br",
    font: FONT_MONO,
    size: 1.35 * CQW,
    align: "center",
    marginTop: 1.4 * CQW
  });

  blocks.push({
    kind: "line",
    value: `Certificado nº ${certificate.code} · confira em hackinbrasil.com.br/certificado/`,
    font: FONT_MONO,
    size: 1.05 * CQW,
    align: "center",
    color: "0.82 0.82 0.82",
    marginTop: 0.5 * CQW
  });

  return blocks;
}

function measureBlocks(blocks) {
  let height = 0;
  for (const block of blocks) {
    height += block.marginTop || 0;
    height +=
      block.kind === "paragraph"
        ? block.lines.length * block.size * LINE_HEIGHT
        : block.size * LINE_HEIGHT;
    height += block.marginBottom || 0;
  }
  return height;
}

function drawBlocks(content, blocks, topY) {
  let cursor = topY;

  for (const block of blocks) {
    cursor -= block.marginTop || 0;
    const color = block.color || "1 1 1";

    if (block.kind === "paragraph") {
      block.lines.forEach((words, index) => {
        const isLast = index === block.lines.length - 1;
        const value = words.join(" ");
        const natural = measure(value, block.font, block.size);
        const spaces = words.length - 1;
        const wordSpacing = !isLast && spaces > 0 ? (TEXT_WIDTH - natural) / spaces : 0;

        cursor -= block.size * LINE_HEIGHT;
        content.text(value, {
          font: block.font,
          size: block.size,
          x: PADDING_X,
          y: cursor + block.size * 0.32,
          color,
          wordSpacing
        });
      });
    } else {
      const width = measure(block.value, block.font, block.size, block.letterSpacing || 0);
      let x = PADDING_X;
      if (block.align === "center") x = (PAGE_WIDTH - width) / 2;
      if (block.align === "right") x = PAGE_WIDTH - PADDING_X - width;

      cursor -= block.size * LINE_HEIGHT;
      content.text(block.value, {
        font: block.font,
        size: block.size,
        x,
        y: cursor + block.size * 0.32,
        color,
        letterSpacing: block.letterSpacing || 0
      });
    }

    cursor -= block.marginBottom || 0;
  }
}

export function buildCertificatePdf(certificate) {
  const content = new Content();

  content.push("q");
  content.push(`0 ${BAND_HEIGHT.toFixed(2)} ${PAGE_WIDTH.toFixed(2)} ${(PAGE_HEIGHT - BAND_HEIGHT).toFixed(2)} re W n`);
  content.push("/Sh0 sh");
  content.push("Q");

  content.push("q");
  content.push("0.894 0.894 0.894 rg");
  content.push(`0 0 ${PAGE_WIDTH.toFixed(2)} ${BAND_HEIGHT.toFixed(2)} re f`);
  content.push("Q");

  content.push("q");
  content.push("0.1 0.1 0.1 rg");
  content.push(`${PAGE_WIDTH.toFixed(2)} 0 0 ${BAND_HEIGHT.toFixed(2)} 0 0 cm`);
  content.push("/ImSig Do");
  content.push("Q");

  const sealWidth = 10 * CQW;
  const sealHeight = (sealWidth * SEAL.height) / SEAL.width;
  const sealX = (PAGE_WIDTH - sealWidth) / 2;
  const sealY = (BAND_HEIGHT - sealHeight) / 2;
  content.push("q");
  content.push(
    `${sealWidth.toFixed(2)} 0 0 ${sealHeight.toFixed(2)} ${sealX.toFixed(2)} ${sealY.toFixed(2)} cm`
  );
  content.push("/ImSeal Do");
  content.push("Q");

  const blocks = layoutBlocks(certificate);
  const available = PAGE_HEIGHT - BAND_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const used = measureBlocks(blocks);
  const topY = PAGE_HEIGHT - PADDING_TOP - Math.max(0, (available - used) / 2);
  drawBlocks(content, blocks, topY);

  const contentBytes = encoder.encode(content.toString());

  const objects = [];

  objects.push({dict: "<< /Type /Catalog /Pages 2 0 R >>"});
  objects.push({dict: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"});
  objects.push({
    dict:
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}] ` +
      `/Resources << /Font << /${FONT_REGULAR} 5 0 R /${FONT_BOLD} 6 0 R /${FONT_MONO} 7 0 R >> ` +
      "/XObject << /ImSig 8 0 R /ImSeal 9 0 R >> /Shading << /Sh0 10 0 R >> >> /Contents 4 0 R >>"
  });
  objects.push({dict: `<< /Length ${contentBytes.length} >>`, stream: contentBytes});
  objects.push({
    dict: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
  });
  objects.push({
    dict: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
  });
  objects.push({
    dict: "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"
  });

  const signatureBytes = deflateFromBase64(SIGNATURES.deflate);
  objects.push({
    dict:
      `<< /Type /XObject /Subtype /Image /Width ${SIGNATURES.width} /Height ${SIGNATURES.height} ` +
      `/ImageMask true /Decode [1 0] /BitsPerComponent 1 /Filter /FlateDecode /Length ${signatureBytes.length} >>`,
    stream: signatureBytes
  });

  const sealBytes = deflateFromBase64(SEAL.deflate);
  objects.push({
    dict:
      `<< /Type /XObject /Subtype /Image /Width ${SEAL.width} /Height ${SEAL.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${sealBytes.length} >>`,
    stream: sealBytes
  });

  objects.push({
    dict:
      "<< /ShadingType 2 /ColorSpace /DeviceRGB " +
      `/Coords [0 ${PAGE_HEIGHT.toFixed(2)} ${PAGE_WIDTH.toFixed(2)} ${BAND_HEIGHT.toFixed(2)}] ` +
      "/Function 11 0 R /Extend [true true] >>"
  });

  objects.push({
    dict:
      "<< /FunctionType 3 /Domain [0 1] /Functions [12 0 R 13 0 R] /Bounds [0.46] /Encode [0 1 0 1] >>"
  });
  objects.push({
    dict:
      "<< /FunctionType 2 /Domain [0 1] /C0 [0.4902 0.4471 0.1608] /C1 [0.4196 0.3804 0.1412] /N 1 >>"
  });
  objects.push({
    dict:
      "<< /FunctionType 2 /Domain [0 1] /C0 [0.4196 0.3804 0.1412] /C1 [0.3412 0.3059 0.1137] /N 1 >>"
  });

  objects.push({
    dict: `<< /Producer (Hack in Brasil) /Title ${pdfString(`Certificado ${certificate.code}`)} >>`
  });

  return assemble(objects);
}

export function bytesToBase64Pdf(bytes) {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(binary);
}
