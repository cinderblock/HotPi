#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

type ParsedRow = {
  raw: string;
  type: 'rx' | 'tx' | 'unknown';
  bytes: number[]; // includes checksum byte at end if present
  dataBytes: number[]; // excludes checksum
  checksum: number | null;
  checksumOk: boolean | null;
};

// Format strings (examples shown; update to match your protocol data sizes)
// Syntax: prefix endianness 'BE' | 'LE' then sequence of pairs: [s|u|f][byteCount]
//  - sN: signed integer of N bytes
//  - uN: unsigned integer of N bytes
//  - fN: float of N bytes (supported: 4, 8). 2-byte float is unsupported and will throw.
// These must sum to the data byte length for each type (excluding checksum byte).
const FORMAT_RX = 'BEu1u2u2u2u2u2u2u2u1';
const FORMAT_TX = 'BEu1u2u2u2';

function hexStringToBytes(raw: string): number[] {
  const buffer = Buffer.from(raw, 'hex');
  if (buffer.length === 0) return [];
  return Array.from(buffer);
}

function xorChecksum(bytes: number[]): number {
  return bytes.reduce((acc, b) => acc ^ b, 0);
}

function parseRawField(raw: string): ParsedRow | null {
  const bytes = hexStringToBytes(raw);
  if (bytes.length === 0) return null;

  // Heuristics based on project protocol:
  // RX packets (19 bytes from device): 1 start + 16 data + 1 checksum + 1 end => we log 16 data + 1 checksum
  // TX packets (10 bytes to device)  : 1 start +  7 data + 1 checksum + 1 end => we log  7 data + 1 checksum
  // The CSV samples have had start and end tokens removed.

  let type: ParsedRow['type'] = 'unknown';
  if (bytes.length === 17) type = 'rx';
  if (bytes.length === 8) type = 'tx';

  const checksum = bytes[bytes.length - 1];
  const checksumOk = xorChecksum(bytes) === 0;
  const dataBytes: number[] = bytes.slice(0, -1);

  return { raw, type, bytes, dataBytes, checksum, checksumOk };
}

type Endianness = 'BE' | 'LE';
type FieldKind = 's' | 'u' | 'f';
type ParsedField = { kind: FieldKind; bytes: number; label: string };
type ParsedFormat = { endian: Endianness; fields: ParsedField[]; totalBytes: number };

function parseFormatString(fmt: string): ParsedFormat {
  if (!fmt || (fmt.slice(0, 2) !== 'BE' && fmt.slice(0, 2) !== 'LE')) {
    throw new Error('Format must start with "BE" or "LE"');
  }
  const endian: Endianness = fmt.slice(0, 2) as Endianness;
  const body = fmt.slice(2);
  const fields: ParsedField[] = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    const kind = ch as FieldKind;
    if (kind !== 's' && kind !== 'u' && kind !== 'f') {
      throw new Error(`Invalid field kind '${ch}' in format '${fmt}'`);
    }
    i++;
    let numStr = '';
    while (i < body.length && /[0-9]/.test(body[i])) {
      numStr += body[i];
      i++;
    }
    if (numStr === '') throw new Error(`Missing byte count after '${kind}' in format '${fmt}'`);
    const byteCount = Number(numStr);
    if (!Number.isInteger(byteCount) || byteCount <= 0) {
      throw new Error(`Invalid byte count '${numStr}' after '${kind}'`);
    }
    if (kind === 'f' && !(byteCount === 4 || byteCount === 8)) {
      throw new Error(`Unsupported float width ${byteCount}. Supported: 4, 8`);
    }
    fields.push({ kind, bytes: byteCount, label: `${kind}${byteCount}` });
  }
  const totalBytes = fields.reduce((acc, f) => acc + f.bytes, 0);
  return { endian, fields, totalBytes };
}

function bytesToHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
}

function warnChecksum(row: ParsedRow): void {
  if (row.checksumOk === false) {
    console.warn(`checksum failed for ${row.type.toUpperCase()} line: ${row.raw}`);
  }
}

function decodeFields(
  buffer: Buffer,
  parsed: ParsedFormat
): {
  values: Array<number | string>;
  groupedRaw: string;
} {
  const values: Array<number | string> = [];
  const groups: string[] = [];
  let offset = 0;
  for (const field of parsed.fields) {
    const slice = buffer.subarray(offset, offset + field.bytes);
    if (slice.length !== field.bytes) {
      throw new Error(`Insufficient bytes while decoding field ${field.label}`);
    }
    groups.push(bytesToHex(Array.from(slice)));
    // Decode value
    if (field.kind === 'f') {
      if (field.bytes === 4) {
        values.push(parsed.endian === 'BE' ? slice.readFloatBE(0) : slice.readFloatLE(0));
      } else if (field.bytes === 8) {
        values.push(parsed.endian === 'BE' ? slice.readDoubleBE(0) : slice.readDoubleLE(0));
      } else {
        // Should not happen due to earlier validation
        throw new Error(`Unsupported float width ${field.bytes}`);
      }
    } else if (field.kind === 'u') {
      if (field.bytes <= 6) {
        values.push(parsed.endian === 'BE' ? slice.readUIntBE(0, field.bytes) : slice.readUIntLE(0, field.bytes));
      } else if (field.bytes === 8) {
        const v = parsed.endian === 'BE' ? slice.readBigUInt64BE(0) : slice.readBigUInt64LE(0);
        // Convert to string to avoid precision loss
        values.push(v.toString());
      } else {
        throw new Error(`Unsupported unsigned integer width ${field.bytes}`);
      }
    } else {
      // signed
      if (field.bytes <= 6) {
        values.push(parsed.endian === 'BE' ? slice.readIntBE(0, field.bytes) : slice.readIntLE(0, field.bytes));
      } else if (field.bytes === 8) {
        const v = parsed.endian === 'BE' ? slice.readBigInt64BE(0) : slice.readBigInt64LE(0);
        values.push(v.toString());
      } else {
        throw new Error(`Unsupported signed integer width ${field.bytes}`);
      }
    }
    offset += field.bytes;
  }
  return { values, groupedRaw: groups.join('  ') };
}

function splitCsvLineLoose(line: string): [string, string, string] {
  // Heuristic parser for our 3-column CSV: raw,description,settings
  // The file is not consistently quoted; we take first comma for col1, second for col2, rest for col3
  const firstComma = line.indexOf(',');
  if (firstComma === -1) return [line.trim(), '', ''];
  const secondComma = line.indexOf(',', firstComma + 1);
  if (secondComma === -1) {
    const c1 = line.slice(0, firstComma).trim();
    const c2 = line.slice(firstComma + 1).trim();
    return [c1, c2, ''];
  }
  const c1 = line.slice(0, firstComma).trim();
  const c2 = line.slice(firstComma + 1, secondComma).trim();
  const c3 = line.slice(secondComma + 1).trim();
  return [c1, c2, c3];
}

function toCsvValue(value: unknown): string {
  const s = String(value ?? '');
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// CSV formatting handled inline in run() to control column count

// removed unused pad helpers

function fieldDisplayWidth(field: ParsedField): number {
  if (field.kind === 'f') {
    return field.bytes === 4 ? 12 : 20; // float32 ~7 sig figs, float64 ~15
  }
  const widthsByBytesUnsigned: Record<number, number> = { 1: 3, 2: 5, 3: 8, 4: 10, 5: 13, 6: 15, 8: 20 };
  const widthsByBytesSigned: Record<number, number> = { 1: 4, 2: 6, 3: 8, 4: 11, 5: 14, 6: 16, 8: 20 };
  return field.kind === 'u' ? (widthsByBytesUnsigned[field.bytes] ?? 12) : (widthsByBytesSigned[field.bytes] ?? 12);
}

function formatNumeric(value: number | string, width: number): string {
  const s = typeof value === 'number' ? String(value) : value;
  return s.length >= width ? s.slice(0, width) : ' '.repeat(width - s.length) + s;
}

function formatFloat(value: number, width: number, precision: number): string {
  const s = Number.isFinite(value) ? value.toPrecision(precision) : String(value);
  return s.length >= width ? s.slice(0, width) : ' '.repeat(width - s.length) + s;
}

function formatRowToCols(row: ParsedRow, description: string, parsedFmt: ParsedFormat, targetRawWidth: number): string {
  const dataBuf = Buffer.from(row.dataBytes);
  const { values, groupedRaw } = decodeFields(dataBuf, parsedFmt);
  const checksumHex = row.checksum == null ? '' : row.checksum.toString(16).padStart(2, '0');
  const fullRaw = groupedRaw + (checksumHex ? '  ' + checksumHex : '');
  const paddedRaw = fullRaw.padEnd(targetRawWidth, ' ');
  const parts: string[] = [];
  const okPrefix = row.checksumOk === false ? '⚠️ ' : '✔️ ';
  parts.push(okPrefix + paddedRaw);
  parts.push('|');
  parts.push(row.type.toUpperCase());
  parts.push('|');
  // show values without labels, fixed width per field
  for (let i = 0; i < parsedFmt.fields.length; i++) {
    const field = parsedFmt.fields[i];
    const width = fieldDisplayWidth(field);
    const v = values[i];
    if (field.kind === 'f') {
      const prec = field.bytes === 4 ? 7 : 15;
      parts.push(formatFloat(v as number, width, prec));
    } else {
      parts.push(formatNumeric(v as number | string, width));
    }
  }
  if (description) {
    parts.push('|');
    parts.push(description);
  }
  return parts.join(' ');
}

// removed unused header helper

async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const colsMode = argv.includes('--cols');
  const onlyRx = argv.includes('--rx');
  const onlyTx = argv.includes('--tx');
  if (onlyRx && onlyTx) {
    console.error('Use only one of --rx or --tx, not both');
    process.exit(1);
  }
  const args = argv.filter(a => a !== '--cols' && a !== '--rx' && a !== '--tx');
  const inPath = args[0];
  const outPath = args[1];
  if (!inPath) {
    console.error('Usage: bun run src/run/decode.ts [--cols] [--rx|--tx] <input.csv> [output]');
    process.exit(1);
  }

  // Validate formats early against expected data lengths
  const RX_TOTAL_BYTES = 16; // data bytes (excluding checksum)
  const TX_TOTAL_BYTES = 7; // data bytes (excluding checksum)
  const parsedRx = parseFormatString(FORMAT_RX);
  const parsedTx = parseFormatString(FORMAT_TX);
  if (parsedRx.totalBytes !== RX_TOTAL_BYTES) {
    throw new Error(`FORMAT_RX total ${parsedRx.totalBytes} does not match RX data length ${RX_TOTAL_BYTES}`);
  }
  if (parsedTx.totalBytes !== TX_TOTAL_BYTES) {
    throw new Error(`FORMAT_TX total ${parsedTx.totalBytes} does not match TX data length ${TX_TOTAL_BYTES}`);
  }

  // Compute pretty-print raw column target width using RX layout (largest)
  const rxDummy = Buffer.alloc(RX_TOTAL_BYTES); // zero bytes
  const rxRawGroups = decodeFields(rxDummy, parsedRx).groupedRaw + '  ' + '00';
  const targetRawWidth = rxRawGroups.length;

  // Choose header field count based on filter (single type) or max across both
  const activeParsed = onlyRx ? parsedRx : onlyTx ? parsedTx : null;
  const headerFieldCount = activeParsed
    ? activeParsed.fields.length
    : Math.max(parsedRx.fields.length, parsedTx.fields.length);

  const text = await readFile(inPath, 'utf8');
  const lines = text.split(/\r?\n/);

  const output: string[] = [];
  if (!colsMode) {
    const header: string[] = [];
    header.push('raw');
    header.push('type');
    header.push('checksum_ok');
    // Field columns
    for (let i = 0; i < headerFieldCount; i++) {
      const rxLabel = parsedRx.fields[i] ? parsedRx.fields[i].label : undefined;
      const txLabel = parsedTx.fields[i] ? parsedTx.fields[i].label : undefined;
      const chosen = activeParsed
        ? activeParsed.fields[i]
          ? activeParsed.fields[i].label
          : undefined
        : rxLabel || txLabel;
      const label = chosen || `f${i + 1}`;
      header.push(`field${i + 1}_${label}`);
    }
    header.push('description');
    header.push('settings');
    output.push(header.map(toCsvValue).join(','));
  } else {
    // Column header for pretty print mode
    output.push('OK raw | TYPE | values | description');
  }

  // Process lines, skipping header if present
  const startIndex = lines.length && /^\s*raw\s*,/i.test(lines[0]) ? 1 : 0;
  for (let li = startIndex; li < lines.length; li++) {
    const line = lines[li];
    if (!line || /^\s*$/.test(line)) continue;
    const [raw, description, settings] = splitCsvLineLoose(line);
    if (!raw) {
      // Preserve commentary lines without raw? Skip but could include context
      continue;
    }
    const parsed = parseRawField(raw);
    if (!parsed) continue;
    // Filter by type if requested
    if (onlyRx && parsed.type !== 'rx') continue;
    if (onlyTx && parsed.type !== 'tx') continue;
    // Enforce expected total lengths (including checksum)
    const expectedTotal = parsed.type === 'rx' ? RX_TOTAL_BYTES + 1 : parsed.type === 'tx' ? TX_TOTAL_BYTES + 1 : null;
    if (expectedTotal != null && parsed.bytes.length !== expectedTotal) {
      // skip mismatched lines
      continue;
    }
    warnChecksum(parsed);
    const pf = parsed.type === 'rx' ? parsedRx : parsed.type === 'tx' ? parsedTx : null;
    if (!pf) continue;
    if (colsMode) {
      output.push(formatRowToCols(parsed, description, pf, targetRawWidth));
    } else {
      // Ensure value columns count matches headerFieldCount by padding
      const dataBuf = Buffer.from(parsed.dataBytes);
      const decoded = decodeFields(dataBuf, pf).values;
      const padNeeded = headerFieldCount - decoded.length;
      const padded = padNeeded > 0 ? [...decoded, ...Array(padNeeded).fill('')] : decoded;
      // Reuse CSV formatter for raw/type/checksum, then append padded values
      const cols: string[] = [];
      const groupedRaw = decodeFields(dataBuf, pf).groupedRaw;
      const checksumHex = parsed.checksum == null ? '' : parsed.checksum.toString(16).padStart(2, '0');
      const fullRaw = groupedRaw + (checksumHex ? '  ' + checksumHex : '');
      cols.push(fullRaw);
      cols.push(parsed.type);
      cols.push(parsed.checksumOk === null ? '' : String(parsed.checksumOk));
      for (const v of padded) cols.push(typeof v === 'string' || typeof v === 'number' ? String(v) : String(v));
      cols.push(description);
      cols.push(settings);
      output.push(cols.map(toCsvValue).join(','));
    }
  }

  const outText = output.join('\n');
  if (outPath) {
    await writeFile(outPath, outText, 'utf8');
    console.log(`Wrote ${output.length - 1} rows to ${outPath}`);
  } else {
    // Print only data rows, no extra logs
    console.log(outText);
  }
}

run().catch(err => {
  console.error('decode failed:', err);
  process.exit(1);
});
