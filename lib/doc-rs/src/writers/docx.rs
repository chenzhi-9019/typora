//! DOCX writer: a minimal but schema-complete OOXML package.

use std::io::{Cursor, Write};

use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use crate::model::{Align, Block, Document, Inline};
use crate::{ConvertError, TargetFormat};

const XML_DECL: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";
const W_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL_NS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_BASE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

pub fn write(document: &Document) -> Result<Vec<u8>, ConvertError> {
  let mut ctx = Ctx::default();
  let body = docx_blocks(&document.blocks, None, &mut ctx);
  let mut inner = body;
  if inner.is_empty() {
    inner.push_str("<w:p/>");
  }
  let document_xml = format!(
    "{XML_DECL}<w:document{}>{inner}<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/><w:cols w:space=\"708\"/><w:docGrid w:linePitch=\"360\"/></w:sectPr></w:document>",
    document_namespaces()
  );

  let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
  let options = SimpleFileOptions::default();
  for (name, contents) in [
    ("[Content_Types].xml", content_types()),
    ("_rels/.rels", package_rels()),
    ("word/document.xml", document_xml),
    ("word/styles.xml", styles_xml()),
    ("word/numbering.xml", numbering_xml(&ctx.numbering)),
    ("word/_rels/document.xml.rels", document_rels(&ctx.links)),
    ("docProps/core.xml", core_xml(document)),
    ("docProps/app.xml", app_xml()),
  ] {
    zip.start_file(name, options).map_err(zip_error)?;
    zip.write_all(contents.as_bytes())?;
  }
  let bytes = zip.finish().map_err(zip_error)?.into_inner();
  Ok(bytes)
}

fn zip_error(error: zip::result::ZipError) -> ConvertError {
  ConvertError::Write {
    format: TargetFormat::Docx,
    message: error.to_string(),
  }
}

fn document_namespaces() -> &'static str {
  concat!(
    " xmlns:wpc=\"http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas\"",
    " xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\"",
    " xmlns:o=\"urn:schemas-microsoft-com:office:office\"",
    " xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"",
    " xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\"",
    " xmlns:v=\"urn:schemas-microsoft-com:vml\"",
    " xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\"",
    " xmlns:w10=\"urn:schemas-microsoft-com:office:word\"",
    " xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"",
    " xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\"",
    " xmlns:wpg=\"http://schemas.microsoft.com/office/word/2010/wordprocessingGroup\"",
    " xmlns:wpi=\"http://schemas.microsoft.com/office/word/2010/wordprocessingInk\"",
    " xmlns:wne=\"http://schemas.microsoft.com/office/word/2006/wordml\"",
    " xmlns:wps=\"http://schemas.microsoft.com/office/word/2010/wordprocessingShape\"",
    " mc:Ignorable=\"w14 wp14\""
  )
}

/* ---------------------------------------------------------------- context -- */

#[derive(Default)]
struct Ctx {
  numbering: Numbering,
  links: Links,
}

#[derive(Default)]
struct Numbering {
  /// (abstract numbering id, start override) per allocated numId, in order.
  instances: Vec<(u32, Option<u64>)>,
}

impl Numbering {
  fn bullet(&mut self) -> u32 {
    self.instance(0, None)
  }

  fn decimal(&mut self, start: u64) -> u32 {
    let override_start = if start > 1 { Some(start) } else { None };
    self.instance(1, override_start)
  }

  fn instance(&mut self, abstract_id: u32, start: Option<u64>) -> u32 {
    if let Some(index) = self
      .instances
      .iter()
      .position(|(id, from)| *id == abstract_id && *from == start)
    {
      return index as u32 + 1;
    }
    self.instances.push((abstract_id, start));
    self.instances.len() as u32
  }
}

#[derive(Default)]
struct Links {
  targets: Vec<String>,
}

impl Links {
  fn id_for(&mut self, target: &str) -> String {
    let index = match self.targets.iter().position(|url| url == target) {
      Some(index) => index,
      None => {
        self.targets.push(target.to_string());
        self.targets.len() - 1
      }
    };
    format!("rId{}", 100 + index)
  }
}

#[derive(Clone, Copy, Default)]
struct RunFormat {
  bold: bool,
  italic: bool,
  underline: bool,
  strike: bool,
  code: bool,
  link: bool,
}

/* ------------------------------------------------------------------ blocks -- */

fn docx_blocks(blocks: &[Block], style: Option<&str>, ctx: &mut Ctx) -> String {
  let mut out = String::new();
  for block in blocks {
    out.push_str(&docx_block(block, style, ctx));
  }
  out
}

fn docx_block(block: &Block, style: Option<&str>, ctx: &mut Ctx) -> String {
  match block {
    Block::Paragraph(inlines) => {
      let mut runs = String::new();
      docx_runs(inlines, RunFormat::default(), ctx, &mut runs);
      docx_paragraph(&paragraph_props(style, None), &runs)
    }
    Block::Heading { level, content } => {
      let name = format!("Heading{}", (*level).clamp(1, 6));
      let mut runs = String::new();
      docx_runs(content, RunFormat::default(), ctx, &mut runs);
      docx_paragraph(&paragraph_props(Some(&name), None), &runs)
    }
    Block::CodeBlock { language, text } => {
      let mut out = String::new();
      if let Some(lang) = language.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
        let mut runs = String::new();
        docx_runs(
          &[Inline::Code(lang.to_string())],
          RunFormat {
            code: true,
            ..RunFormat::default()
          },
          ctx,
          &mut runs,
        );
        out.push_str(&docx_paragraph(
          &paragraph_props(Some("CodeBlock"), None),
          &runs,
        ));
      }
      for line in text.trim_end_matches('\n').split('\n') {
        out.push_str(&docx_paragraph(
          &paragraph_props(Some("CodeBlock"), None),
          &docx_run(line, RunFormat::default()),
        ));
      }
      out
    }
    Block::Quote(inner) => docx_blocks(inner, Some("Quote"), ctx),
    Block::List {
      ordered,
      start,
      items,
    } => docx_list(*ordered, *start, items, 0, ctx),
    Block::Table {
      header,
      align,
      rows,
    } => docx_table(header, align, rows, ctx),
    Block::Rule => "<w:p><w:pPr><w:pBdr><w:bottom w:val=\"single\" w:sz=\"6\" w:space=\"1\" w:color=\"auto\"/></w:pBdr></w:pPr></w:p>".to_string(),
    Block::Raw(text) => {
      let mut runs = String::new();
      docx_runs(
        &[Inline::Text(text.clone())],
        RunFormat::default(),
        ctx,
        &mut runs,
      );
      docx_paragraph(&paragraph_props(style, None), &runs)
    }
  }
}

fn docx_list(ordered: bool, start: u64, items: &[Vec<Block>], depth: usize, ctx: &mut Ctx) -> String {
  let num_id = if ordered {
    ctx.numbering.decimal(start.max(1))
  } else {
    ctx.numbering.bullet()
  };
  let mut out = String::new();
  for item in items {
    for block in item {
      match block {
        Block::Paragraph(inlines) => {
          let mut runs = String::new();
          docx_runs(inlines, RunFormat::default(), ctx, &mut runs);
          let props = format!(
            "<w:pStyle w:val=\"ListParagraph\"/><w:numPr><w:ilvl w:val=\"{}\"/><w:numId w:val=\"{num_id}\"/></w:numPr>",
            depth.min(8)
          );
          out.push_str(&docx_paragraph(&props, &runs));
        }
        Block::List {
          ordered: nested_ordered,
          start: nested_start,
          items: nested_items,
        } => {
          out.push_str(&docx_list(
            *nested_ordered,
            *nested_start,
            nested_items,
            (depth + 1).min(8),
            ctx,
          ));
        }
        other => out.push_str(&docx_block(other, Some("ListParagraph"), ctx)),
      }
    }
  }
  out
}

fn docx_table(
  header: &[Vec<Inline>],
  align: &[Align],
  rows: &[Vec<Vec<Inline>>],
  ctx: &mut Ctx,
) -> String {
  let columns = header.len().max(rows.iter().map(Vec::len).max().unwrap_or(0));
  if columns == 0 {
    return String::new();
  }
  let width = 9360 / columns as u32;
  let mut out = String::from(
    "<w:tbl><w:tblPr><w:tblStyle w:val=\"TableGrid\"/><w:tblW w:w=\"0\" w:type=\"auto\"/><w:tblLook w:val=\"04A0\"/></w:tblPr><w:tblGrid>",
  );
  for _ in 0..columns {
    out.push_str(&format!("<w:gridCol w:w=\"{width}\"/>"));
  }
  out.push_str("</w:tblGrid>");

  out.push_str("<w:tr><w:trPr><w:tblHeader/></w:trPr>");
  for index in 0..columns {
    let mut runs = String::new();
    if let Some(cell) = header.get(index) {
      docx_runs(
        cell,
        RunFormat {
          bold: true,
          ..RunFormat::default()
        },
        ctx,
        &mut runs,
      );
    }
    out.push_str(&docx_cell(
      width,
      align.get(index).copied().unwrap_or_default(),
      &runs,
    ));
  }
  out.push_str("</w:tr>");

  for row in rows {
    out.push_str("<w:tr>");
    for index in 0..columns {
      let mut runs = String::new();
      if let Some(cell) = row.get(index) {
        docx_runs(cell, RunFormat::default(), ctx, &mut runs);
      }
      out.push_str(&docx_cell(
        width,
        align.get(index).copied().unwrap_or_default(),
        &runs,
      ));
    }
    out.push_str("</w:tr>");
  }
  out.push_str("</w:tbl><w:p/>");
  out
}

fn docx_cell(width: u32, align: Align, runs: &str) -> String {
  let justification = match align {
    Align::None => String::new(),
    Align::Left => "<w:jc w:val=\"left\"/>".to_string(),
    Align::Center => "<w:jc w:val=\"center\"/>".to_string(),
    Align::Right => "<w:jc w:val=\"right\"/>".to_string(),
  };
  format!(
    "<w:tc><w:tcPr><w:tcW w:w=\"{width}\" w:type=\"dxa\"/></w:tcPr><w:p>{}{runs}</w:p></w:tc>",
    if justification.is_empty() {
      String::new()
    } else {
      format!("<w:pPr>{justification}</w:pPr>")
    }
  )
}

fn paragraph_props(style: Option<&str>, extra: Option<&str>) -> String {
  let mut out = String::new();
  if let Some(style) = style {
    out.push_str(&format!("<w:pStyle w:val=\"{style}\"/>"));
  }
  if let Some(extra) = extra {
    out.push_str(extra);
  }
  out
}

fn docx_paragraph(props: &str, runs: &str) -> String {
  if props.is_empty() {
    format!("<w:p>{runs}</w:p>")
  } else {
    format!("<w:p><w:pPr>{props}</w:pPr>{runs}</w:p>")
  }
}

/* ------------------------------------------------------------------- runs -- */

fn docx_runs(inlines: &[Inline], format: RunFormat, ctx: &mut Ctx, out: &mut String) {
  for inline in inlines {
    match inline {
      Inline::Text(text) => out.push_str(&docx_text_runs(text, format)),
      Inline::Strong(inner) => {
        let nested = RunFormat {
          bold: true,
          ..format
        };
        docx_runs(inner, nested, ctx, out);
      }
      Inline::Emphasis(inner) => {
        let nested = RunFormat {
          italic: true,
          ..format
        };
        docx_runs(inner, nested, ctx, out);
      }
      Inline::Strike(inner) => {
        let nested = RunFormat {
          strike: true,
          ..format
        };
        docx_runs(inner, nested, ctx, out);
      }
      Inline::Underline(inner) => {
        let nested = RunFormat {
          underline: true,
          ..format
        };
        docx_runs(inner, nested, ctx, out);
      }
      Inline::Code(text) => {
        let nested = RunFormat {
          code: true,
          ..format
        };
        out.push_str(&docx_text_runs(text, nested));
      }
      Inline::Math(tex) => {
        let nested = RunFormat {
          italic: true,
          ..format
        };
        out.push_str(&docx_text_runs(tex.trim(), nested));
      }
      Inline::Link {
        href,
        title: _,
        content,
      } => {
        let mut inner = String::new();
        let nested = RunFormat {
          link: true,
          ..format
        };
        docx_runs(content, nested, ctx, &mut inner);
        if inner.is_empty() {
          inner = docx_text_runs(href, nested);
        }
        let id = ctx.links.id_for(href);
        out.push_str(&format!(
          "<w:hyperlink r:id=\"{id}\" w:history=\"1\">{inner}</w:hyperlink>"
        ));
      }
      Inline::Image { src, alt, .. } => {
        let text = if alt.is_empty() { src.as_str() } else { alt.as_str() };
        let nested = RunFormat {
          italic: true,
          ..format
        };
        out.push_str(&docx_text_runs(text, nested));
      }
      Inline::SoftBreak => out.push_str("<w:r><w:t xml:space=\"preserve\"> </w:t></w:r>"),
      Inline::HardBreak => out.push_str("<w:r><w:br/></w:r>"),
      Inline::Raw(text) => out.push_str(&docx_text_runs(text, format)),
    }
  }
}

fn docx_text_runs(text: &str, format: RunFormat) -> String {
  if text.is_empty() {
    return String::new();
  }
  let mut out = String::new();
  for (index, line) in text.split('\n').enumerate() {
    if index > 0 {
      out.push_str("<w:r><w:br/></w:r>");
    }
    if !line.is_empty() {
      out.push_str(&docx_run(line, format));
    }
  }
  out
}

fn docx_run(text: &str, format: RunFormat) -> String {
  if text.is_empty() {
    return String::new();
  }
  let mut rpr = String::new();
  if format.link {
    rpr.push_str("<w:rStyle w:val=\"Hyperlink\"/>");
  }
  if format.code {
    rpr.push_str("<w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\" w:cs=\"Consolas\"/>");
  }
  if format.bold {
    rpr.push_str("<w:b/>");
  }
  if format.italic {
    rpr.push_str("<w:i/>");
  }
  if format.strike {
    rpr.push_str("<w:strike/>");
  }
  if format.underline {
    rpr.push_str("<w:u w:val=\"single\"/>");
  }
  let mut out = String::from("<w:r>");
  if !rpr.is_empty() {
    out.push_str(&format!("<w:rPr>{rpr}</w:rPr>"));
  }
  out.push_str(&format!(
    "<w:t xml:space=\"preserve\">{}</w:t></w:r>",
    xml_text(text)
  ));
  out
}

/* ------------------------------------------------------------------- parts -- */

fn content_types() -> String {
  format!(
    "{XML_DECL}<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
<Default Extension=\"xml\" ContentType=\"application/xml\"/>\
<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>\
<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>\
<Override PartName=\"/word/numbering.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml\"/>\
<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>\
<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>\
</Types>"
  )
}

fn package_rels() -> String {
  format!(
    "{XML_DECL}<Relationships xmlns=\"{REL_NS}\">\
<Relationship Id=\"rId1\" Type=\"{REL_BASE}/officeDocument\" Target=\"word/document.xml\"/>\
<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>\
<Relationship Id=\"rId3\" Type=\"{REL_BASE}/extended-properties\" Target=\"docProps/app.xml\"/>\
</Relationships>"
  )
}

fn document_rels(links: &Links) -> String {
  let mut out = format!(
    "{XML_DECL}<Relationships xmlns=\"{REL_NS}\">\
<Relationship Id=\"rId1\" Type=\"{REL_BASE}/styles\" Target=\"styles.xml\"/>\
<Relationship Id=\"rId2\" Type=\"{REL_BASE}/numbering\" Target=\"numbering.xml\"/>"
  );
  for (index, target) in links.targets.iter().enumerate() {
    out.push_str(&format!(
      "<Relationship Id=\"rId{}\" Type=\"{REL_BASE}/hyperlink\" Target=\"{}\" TargetMode=\"External\"/>",
      100 + index,
      xml_attr(target)
    ));
  }
  out.push_str("</Relationships>");
  out
}

fn styles_xml() -> String {
  let mut out = format!("{XML_DECL}<w:styles xmlns:w=\"{W_NS}\">");
  out.push_str("<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii=\"Calibri\" w:eastAsia=\"Calibri\" w:hAnsi=\"Calibri\" w:cs=\"Calibri\"/><w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/><w:lang w:val=\"en-US\"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after=\"160\" w:line=\"259\" w:lineRule=\"auto\"/></w:pPr></w:pPrDefault></w:docDefaults>");
  out.push_str(
    "<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/><w:qFormat/></w:style>",
  );
  let headings = [
    (1, 40, 240),
    (2, 32, 240),
    (3, 28, 200),
    (4, 26, 160),
    (5, 24, 160),
    (6, 22, 160),
  ];
  for (level, size, before) in headings {
    out.push_str(&format!(
      "<w:style w:type=\"paragraph\" w:styleId=\"Heading{level}\"><w:name w:val=\"heading {level}\"/><w:basedOn w:val=\"Normal\"/><w:next w:val=\"Normal\"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before=\"{before}\" w:after=\"120\"/><w:outlineLvl w:val=\"{}\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"{size}\"/><w:szCs w:val=\"{size}\"/></w:rPr></w:style>",
      level - 1
    ));
  }
  out.push_str("<w:style w:type=\"paragraph\" w:styleId=\"ListParagraph\"><w:name w:val=\"List Paragraph\"/><w:basedOn w:val=\"Normal\"/><w:qFormat/><w:pPr><w:ind w:left=\"720\"/><w:contextualSpacing/></w:pPr></w:style>");
  out.push_str("<w:style w:type=\"paragraph\" w:styleId=\"Quote\"><w:name w:val=\"Quote\"/><w:basedOn w:val=\"Normal\"/><w:qFormat/><w:pPr><w:spacing w:before=\"120\" w:after=\"120\"/><w:ind w:left=\"720\"/><w:pBdr><w:left w:val=\"single\" w:sz=\"18\" w:space=\"12\" w:color=\"BFBFBF\"/></w:pBdr></w:pPr><w:rPr><w:i/><w:color w:val=\"595959\"/></w:rPr></w:style>");
  out.push_str("<w:style w:type=\"paragraph\" w:styleId=\"CodeBlock\"><w:name w:val=\"Code Block\"/><w:basedOn w:val=\"Normal\"/><w:pPr><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"F4F4F4\"/><w:ind w:left=\"360\"/></w:pPr><w:rPr><w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\" w:cs=\"Consolas\"/><w:sz w:val=\"18\"/><w:szCs w:val=\"18\"/></w:rPr></w:style>");
  out.push_str("<w:style w:type=\"character\" w:styleId=\"Hyperlink\"><w:name w:val=\"Hyperlink\"/><w:rPr><w:color w:val=\"0563C1\"/><w:u w:val=\"single\"/></w:rPr></w:style>");
  out.push_str("<w:style w:type=\"table\" w:styleId=\"TableGrid\"><w:name w:val=\"Table Grid\"/><w:tblPr><w:tblBorders><w:top w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/><w:left w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/><w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/><w:right w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/><w:insideH w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/><w:insideV w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"auto\"/></w:tblBorders></w:tblPr></w:style>");
  out.push_str("</w:styles>");
  out
}

fn numbering_xml(numbering: &Numbering) -> String {
  let mut out = format!("{XML_DECL}<w:numbering xmlns:w=\"{W_NS}\">");
  // abstract 0: bullets, abstract 1: decimal
  for (abstract_id, kind) in [(0u32, false), (1u32, true)] {
    out.push_str(&format!(
      "<w:abstractNum w:abstractNumId=\"{abstract_id}\"><w:multiLevelType w:val=\"hybridMultilevel\"/>"
    ));
    for level in 0..9u32 {
      let left = 720 * (level + 1);
      let hanging = 360;
      if kind {
        out.push_str(&format!(
          "<w:lvl w:ilvl=\"{level}\"><w:start w:val=\"1\"/><w:numFmt w:val=\"decimal\"/><w:lvlText w:val=\"%{}. \"/><w:lvlJc w:val=\"left\"/><w:pPr><w:ind w:left=\"{left}\" w:hanging=\"{hanging}\"/></w:pPr></w:lvl>",
          level + 1
        ));
      } else {
        let glyph = match level % 3 {
          0 => "&#8226;",
          1 => "&#9702;",
          _ => "&#9642;",
        };
        out.push_str(&format!(
          "<w:lvl w:ilvl=\"{level}\"><w:start w:val=\"1\"/><w:numFmt w:val=\"bullet\"/><w:lvlText w:val=\"{glyph}\"/><w:lvlJc w:val=\"left\"/><w:pPr><w:ind w:left=\"{left}\" w:hanging=\"{hanging}\"/></w:pPr><w:rPr><w:rFonts w:ascii=\"Calibri\" w:hAnsi=\"Calibri\" w:hint=\"default\"/></w:rPr></w:lvl>"
        ));
      }
    }
    out.push_str("</w:abstractNum>");
  }
  for (index, (abstract_id, start)) in numbering.instances.iter().enumerate() {
    let num_id = index + 1;
    out.push_str(&format!(
      "<w:num w:numId=\"{num_id}\"><w:abstractNumId w:val=\"{abstract_id}\"/>"
    ));
    if let Some(start) = start {
      out.push_str(&format!(
        "<w:lvlOverride w:ilvl=\"0\"><w:startOverride w:val=\"{start}\"/></w:lvlOverride>"
      ));
    }
    out.push_str("</w:num>");
  }
  out.push_str("</w:numbering>");
  out
}

fn core_xml(document: &Document) -> String {
  let meta = |name: &str| {
    document
      .meta
      .iter()
      .find(|(key, _)| key.eq_ignore_ascii_case(name))
      .map(|(_, value)| value.trim().to_string())
  };
  let title = meta("title").unwrap_or_default();
  let author = meta("author").or_else(|| meta("creator")).unwrap_or_default();
  let description = meta("description").or_else(|| meta("abstract")).unwrap_or_default();
  let timestamp = "2000-01-01T00:00:00Z";
  format!(
    "{XML_DECL}<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" xmlns:dcmitype=\"http://purl.org/dc/dcmitype/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\
<dc:title>{}</dc:title><dc:creator>{}</dc:creator><dc:description>{}</dc:description><cp:lastModifiedBy>{}</cp:lastModifiedBy><cp:revision>1</cp:revision>\
<dcterms:created xsi:type=\"dcterms:W3CDTF\">{timestamp}</dcterms:created><dcterms:modified xsi:type=\"dcterms:W3CDTF\">{timestamp}</dcterms:modified>\
</cp:coreProperties>",
    xml_text(&title),
    xml_text(&author),
    xml_text(&description),
    xml_text(&author)
  )
}

fn app_xml() -> String {
  format!(
    "{XML_DECL}<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\" xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\">\
<Application>doc-rs</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company/><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion>\
</Properties>"
  )
}

/* ------------------------------------------------------------------ escape -- */

fn xml_text(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  for ch in text.chars() {
    match ch {
      '&' => out.push_str("&amp;"),
      '<' => out.push_str("&lt;"),
      '>' => out.push_str("&gt;"),
      '\t' | '\n' | '\r' => out.push(' '),
      ch if ch.is_control() => {}
      _ => out.push(ch),
    }
  }
  out
}

fn xml_attr(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  for ch in text.chars() {
    match ch {
      '&' => out.push_str("&amp;"),
      '<' => out.push_str("&lt;"),
      '>' => out.push_str("&gt;"),
      '"' => out.push_str("&quot;"),
      '\'' => out.push_str("&apos;"),
      '\t' | '\n' | '\r' => out.push(' '),
      ch if ch.is_control() => {}
      _ => out.push(ch),
    }
  }
  out
}
