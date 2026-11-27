// Generates the 14 fixtures in test-cases/all-ops (ts, rust, md, excel, word, ppt, pdf sources).
// Each pair holds exactly one add, one del, one mod and one unambiguous move.
// Run: node scripts/all-ops-gen.cjs   (then build the PDFs with scripts/make-pdf.py, see all-ops-check.mjs header)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRequire } = require("module");

const req = createRequire("/Users/lanchi/.workbuddy/binaries/node/workspace/package.json");
const ExcelJS = req("exceljs");
const JSZip = req("jszip");

const OUT = path.resolve(__dirname, "../test-cases/all-ops");
const TXT = os.tmpdir();
fs.mkdirSync(OUT, { recursive: true });

const write = (name, body) => fs.writeFileSync(path.join(OUT, name), body);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// ---- text formats ----
const TS_BEFORE = `export function parsePrice(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

export function formatPrice(value: number): string {
  return value.toFixed(2);
}

export function applyTax(value: number): number {
  return value * 1.06;
}

export function legacyRound(value: number): number {
  return Math.round(value);
}
`;
const TS_AFTER = `export function formatPrice(value: number): string {
  return value.toFixed(2);
}

export function applyTax(value: number): number {
  return value * 1.13;
}

export function parsePrice(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

export function roundHalfUp(value: number): number {
  return Math.round(value * 100) / 100;
}
`;
const RS_BEFORE = `pub fn parse_qty(raw: &str) -> u32 {
    raw.trim().parse().unwrap_or(0)
}

pub fn line_total(qty: u32, unit: u32) -> u32 {
    qty * unit
}

pub fn discount_rate() -> u32 {
    5
}

pub fn legacy_label(qty: u32) -> String {
    format!("x{}", qty)
}
`;
const RS_AFTER = `pub fn line_total(qty: u32, unit: u32) -> u32 {
    qty * unit
}

pub fn discount_rate() -> u32 {
    7
}

pub fn parse_qty(raw: &str) -> u32 {
    raw.trim().parse().unwrap_or(0)
}

pub fn grand_total(lines: &[u32]) -> u32 {
    lines.iter().sum()
}
`;
const MD_BEFORE = `# 采购条款

## 付款方式

买方在收到发票后 30 日内付款。

## 交付期限

卖方应于订单确认后 14 日内交付。

## 质保

质保期为 12 个月。

## 违约责任

逾期付款的，每日按未付金额的 0.05% 支付违约金。
`;
const MD_AFTER = `# 采购条款

## 交付期限

卖方应于订单确认后 14 日内交付。

## 质保

质保期为 24 个月。

## 付款方式

买方在收到发票后 30 日内付款。

## 保密义务

双方对在合作中获知的对方信息负有保密义务，期限为三年。
`;
write("ts.before.ts", TS_BEFORE);
write("ts.after.ts", TS_AFTER);
write("rust.before.rs", RS_BEFORE);
write("rust.after.rs", RS_AFTER);
write("md.before.md", MD_BEFORE);
write("md.after.md", MD_AFTER);

// ---- pdf source text (the PDF is built from these by make-pdf.py) ----
fs.writeFileSync(path.join(TXT, "all-ops-pdf-before.txt"), ["合作范围：双方共同开发法律科技产品。", "保密义务：任何一方不得泄露对方信息，期限三年。", "费用分担：研发费用由双方各承担五成。", "知识产权：合作成果归双方共有。", "终止条款：任一方提前三十日书面通知可终止。"].join("\n") + "\n");
fs.writeFileSync(path.join(TXT, "all-ops-pdf-after.txt"), ["知识产权：合作成果归双方共有。", "合作范围：双方共同开发法律科技产品。", "费用分担：研发费用由双方按六四分担。", "终止条款：任一方提前三十日书面通知可终止。", "争议解决：提交深圳国际仲裁院仲裁。"].join("\n") + "\n");

// ---- excel ----
async function makeExcel(file, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Items");
  ws.addRow(["编号", "名称", "数量", "单价"]);
  ws.getRow(1).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  await wb.xlsx.writeFile(file);
}

// ---- word ----
async function makeDocx(file, paras) {
  const body = paras.map((p, i) => {
    const style = i === 0 ? '<w:pPr><w:pStyle w:val="Title"/></w:pPr>' : "";
    return `<w:p>${style}<w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`;
  }).join("");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", XML_HEAD + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + "</w:body></w:document>");
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));
}

// ---- pptx ----
const NS_P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const relsXml = (items) => XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + items.map((i) => `<Relationship Id="${i[0]}" Type="${i[1]}" Target="${i[2]}"/>`).join("") + "</Relationships>";
const slideXml = (lines) => {
  const paras = lines.map((t, i) => `<a:p><a:r><a:rPr lang="zh-CN" sz="${i === 0 ? 3200 : 2000}" b="${i === 0 ? 1 : 0}"/><a:t>${esc(t)}</a:t></a:r></a:p>`).join("");
  return XML_HEAD + `<p:sld ${NS_P}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="TextBox 1"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="609600" y="609600"/><a:ext cx="10972800" cy="4572000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
};
const THEME = XML_HEAD + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface="微软雅黑"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="微软雅黑"/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="38100"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';
const MASTER = XML_HEAD + `<p:sldMaster ${NS_P}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
const LAYOUT = XML_HEAD + `<p:sldLayout ${NS_P} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
async function makePptx(file, slides) {
  const zip = new JSZip();
  const slideCt = slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
  zip.file("[Content_Types].xml", XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' + slideCt + "</Types>");
  zip.file("_rels/.rels", relsXml([["rId1", `${REL}/officeDocument`, "ppt/presentation.xml"]]));
  const sldIds = slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 10}"/>`).join("");
  zip.file("ppt/presentation.xml", XML_HEAD + `<p:presentation ${NS_P} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${sldIds}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  const presRels = [["rId1", `${REL}/slideMaster`, "slideMasters/slideMaster1.xml"], ["rId2", `${REL}/theme`, "theme/theme1.xml"]];
  slides.forEach((_, i) => presRels.push([`rId${i + 10}`, `${REL}/slide`, `slides/slide${i + 1}.xml`]));
  zip.file("ppt/_rels/presentation.xml.rels", relsXml(presRels));
  zip.file("ppt/slideMasters/slideMaster1.xml", MASTER);
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", relsXml([["rId1", `${REL}/slideLayout`, "../slideLayouts/slideLayout1.xml"], ["rId2", `${REL}/theme`, "../theme/theme1.xml"]]));
  zip.file("ppt/slideLayouts/slideLayout1.xml", LAYOUT);
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", relsXml([["rId1", `${REL}/slideMaster`, "../slideMasters/slideMaster1.xml"]]));
  zip.file("ppt/theme/theme1.xml", THEME);
  slides.forEach((lines, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, slideXml(lines));
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, relsXml([["rId1", `${REL}/slideLayout`, "../slideLayouts/slideLayout1.xml"]]));
  });
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));
}

(async () => {
  // excel: move A-001 below A-004 (A-002,A-003,A-004 keep order), mod A-003 qty, del A-005, add A-006
  await makeExcel(path.join(OUT, "excel.before.xlsx"), [
    ["A-001", "螺丝", 10, 5],
    ["A-002", "螺母", 20, 6],
    ["A-003", "垫片", 30, 7],
    ["A-004", "铆钉", 40, 8],
    ["A-005", "轴承", 50, 9],
  ]);
  await makeExcel(path.join(OUT, "excel.after.xlsx"), [
    ["A-002", "螺母", 20, 6],
    ["A-003", "垫片", 35, 7],
    ["A-004", "铆钉", 40, 8],
    ["A-001", "螺丝", 10, 5],
    ["A-006", "弹簧", 60, 10],
  ]);

  // word: move 争议 to top, mod 交付 days, del 验收, add 保密
  await makeDocx(path.join(OUT, "word.before.docx"), [
    "采购合同（样例）",
    "标的：甲方向乙方采购办公设备一批。",
    "价款：合同总价为人民币 100,000 元。",
    "交付：乙方应于签约后 30 日内交付。",
    "验收：甲方应在收货后 7 日内完成验收。",
    "争议：双方协商不成，提交北京仲裁委员会仲裁。",
  ]);
  await makeDocx(path.join(OUT, "word.after.docx"), [
    "采购合同（样例）",
    "争议：双方协商不成，提交北京仲裁委员会仲裁。",
    "标的：甲方向乙方采购办公设备一批。",
    "价款：合同总价为人民币 100,000 元。",
    "交付：乙方应于签约后 45 日内交付。",
    "保密：双方对合同内容负有保密义务。",
  ]);

  // ppt: move 团队介绍 to first, mod 营收, del 风险提示, add 退出路径
  await makePptx(path.join(OUT, "ppt.before.pptx"), [
    ["Q3 融资概览", "轮次：B 轮", "目标金额：5000 万元"],
    ["市场分析", "赛道规模：年增长 25%", "竞争格局：三家头部"],
    ["团队介绍", "创始人：15 年行业经验", "核心团队：32 人"],
    ["财务预测", "营收：3 亿元", "毛利率：40%"],
    ["风险提示", "政策风险：监管变化", "执行风险：交付延期"],
  ]);
  await makePptx(path.join(OUT, "ppt.after.pptx"), [
    ["团队介绍", "创始人：15 年行业经验", "核心团队：32 人"],
    ["Q3 融资概览", "轮次：B 轮", "目标金额：5000 万元"],
    ["市场分析", "赛道规模：年增长 25%", "竞争格局：三家头部"],
    ["财务预测", "营收：4 亿元", "毛利率：40%"],
    ["退出路径", "并购：目标三年内", "IPO：目标五年内"],
  ]);
  console.log("generated text, excel, word, ppt; pdf sources in " + TXT);
})().catch((e) => { console.error(e); process.exit(1); });
