export function escapeCsvField(value: string): string {
  // Spreadsheet apps may ignore whitespace and control prefixes before formula markers.
  const inert = /^[\s\u0000-\u001f\u007f-\u009f\uFEFF]*[=+\-@]/u.test(value)
    ? `'${value}`
    : value;
  return /[",\r\n]/.test(inert) ? `"${inert.replace(/"/g, '""')}"` : inert;
}
