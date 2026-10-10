function csvError(message: string): never {
  throw new Error(message);
}
export function parseCsv(content: string) {
  if (new TextEncoder().encode(content).byteLength > 1024 * 1024)
    csvError("CSV 文件不能超过 1 MB");
  const rows: string[][] = [],
    row: string[] = [];
  let cell = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i]!;
    if (quoted) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
      continue;
    }
    if (c === '"') {
      if (cell || closed) csvError("CSV 引号格式无效");
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
      closed = false;
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && content[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.length)) rows.push(row.splice(0));
      else row.length = 0;
      cell = "";
      closed = false;
    } else {
      if (closed) csvError("引号后只能是分隔符");
      cell += c;
    }
  }
  if (quoted) csvError("CSV 引号未结束");
  row.push(cell);
  if (row.some((v) => v.length)) rows.push(row);
  if (rows.length > 101) csvError("每次最多导入 100 条账单");
  return rows;
}
