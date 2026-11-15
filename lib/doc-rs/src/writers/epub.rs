//! EPUB 3 writer: an OCF container with one XHTML chapter per level-one heading.

use std::io::{Cursor, Write};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::model::{Align, Block, Document, Inline};
use crate::{ConvertError, TargetFormat};

const XML_DECL: &str = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n";
const TIMESTAMP: &str = "2000-01-01T00:00:00Z";

pub fn write(document: &Document) -> Result<Vec<u8>, ConvertError> {
  let chapters = split_chapters(document);
  let title = document_title(document, &chapters);
  let identifier = format!("urn:uuid:{}", uuid(&title));
  let language = meta_value(document, "language").unwrap_or_else(|| "en".to_string());
  let author = meta_value(document, "author").or_else(|| meta_value(document, "creator"));

  let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
  let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
  let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

  zip.start_file("mimetype", stored).map_err(zip_error)?;
  zip.write_all(b"application/epub+zip")?;

  zip.start_file("META-INF/container.xml", deflated).map_err(zip_error)?;
  zip.write_all(container_xml().as_bytes())?;

  zip.start_file("OEBPS/content.opf", deflated).map_err(zip_error)?;
  zip.write_all(
    content_opf(&title, &identifier, &language, author.as_deref(), &chapters).as_bytes(),
  )?;

  zip.start_file("OEBPS/nav.xhtml", deflated).map_err(zip_error)?;
  zip.write_all(nav_xhtml(&chapters, &language).as_bytes())?;

  zip.start_file("OEBPS/style.css", deflated).map_err(zip_error)?;
  zip.write_all(STYLE_CSS.as_bytes())?;

  for chapter in &chapters {
    zip.start_file(format!("OEBPS/{}", chapter.href), deflated)
      .map_err(zip_error)?;
    zip.write_all(chapter_xhtml(chapter, &language).as_bytes())?;
  }

  let bytes = zip.finish().map_err(zip_error)?.into_inner();
  Ok(bytes)
}

fn zip_error(error: zip::result::ZipError) -> ConvertError {
  ConvertError::Write {
    format: TargetFormat::Epub,
    message: error.to_string(),
  }
}

/* ---------------------------------------------------------------- chapters -- */

struct Chapter {
  title: String,
  href: String,
  blocks: Vec<Block>,
}

fn split_chapters(document: &Document) -> Vec<Chapter> {
  let mut groups: Vec<Vec<Block>> = Vec::new();
  let mut current: Vec<Block> = Vec::new();
  for block in &document.blocks {
    if matches!(block, Block::Heading { level: 1, .. }) && !current.is_empty() {
      groups.push(std::mem::take(&mut current));
    }
    current.push(block.clone());
  }
  if !current.is_empty() {
    groups.push(current);
  }
  if groups.is_empty() {
    groups.push(Vec::new());
  }

  let fallback = meta_value(document, "title").unwrap_or_else(|| "Document".to_string());
  groups
    .into_iter()
    .enumerate()
    .map(|(index, blocks)| {
      let heading = blocks.iter().find_map(|block| match block {
        Block::Heading { level: 1, content } => Some(Inline::plain_text(content).trim().to_string()),
        _ => None,
      });
      let title = heading.filter(|title| !title.is_empty()).unwrap_or_else(|| {
        if index == 0 {
          fallback.clone()
        } else {
          format!("Chapter {}", index + 1)
        }
      });
      Chapter {
        title,
        href: format!("chapter{}.xhtml", index + 1),
        blocks,
      }
    })
    .collect()
}

fn document_title(document: &Document, chapters: &[Chapter]) -> String {
  let from_meta = meta_value(document, "title").filter(|title| !title.is_empty());
  match from_meta {
    Some(title) => title,
    None => chapters
      .first()
      .map(|chapter| chapter.title.clone())
      .unwrap_or_else(|| "Untitled".to_string()),
  }
}

fn meta_value(document: &Document, name: &str) -> Option<String> {
  document
    .meta
    .iter()
    .find(|(key, _)| key.eq_ignore_ascii_case(name))
    .map(|(_, value)| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

/* ------------------------------------------------------------------- parts -- */

fn container_xml() -> String {
  format!(
    "{XML_DECL}<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">\n<rootfiles>\n<rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/>\n</rootfiles>\n</container>\n"
  )
}

fn content_opf(
  title: &str,
  identifier: &str,
  language: &str,
  author: Option<&str>,
  chapters: &[Chapter],
) -> String {
  let mut out = format!(
    "{XML_DECL}<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"pub-id\" xml:lang=\"{}\">\n",
    xml_attr(language)
  );
  out.push_str("<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n");
  out.push_str(&format!(
    "<dc:identifier id=\"pub-id\">{}</dc:identifier>\n",
    xml_text(identifier)
  ));
  out.push_str(&format!("<dc:title>{}</dc:title>\n", xml_text(title)));
  out.push_str(&format!(
    "<dc:language>{}</dc:language>\n",
    xml_text(language)
  ));
  if let Some(author) = author {
    out.push_str(&format!("<dc:creator>{}</dc:creator>\n", xml_text(author)));
  }
  out.push_str(&format!(
    "<meta property=\"dcterms:modified\">{TIMESTAMP}</meta>\n"
  ));
  out.push_str("</metadata>\n<manifest>\n");
  out.push_str("<item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>\n");
  out.push_str("<item id=\"style\" href=\"style.css\" media-type=\"text/css\"/>\n");
  for (index, chapter) in chapters.iter().enumerate() {
    out.push_str(&format!(
      "<item id=\"chapter{}\" href=\"{}\" media-type=\"application/xhtml+xml\"/>\n",
      index + 1,
      xml_attr(&chapter.href)
    ));
  }
  out.push_str("</manifest>\n<spine>\n");
  for index in 0..chapters.len() {
    out.push_str(&format!("<itemref idref=\"chapter{}\"/>\n", index + 1));
  }
  out.push_str("</spine>\n</package>\n");
  out
}

fn nav_xhtml(chapters: &[Chapter], language: &str) -> String {
  let mut out = xhtml_head("Contents", language);
  out.push_str("<body>\n<nav epub:type=\"toc\" id=\"toc\">\n<h1>Contents</h1>\n<ol>\n");
  for chapter in chapters {
    out.push_str(&format!(
      "<li><a href=\"{}\">{}</a></li>\n",
      xml_attr(&chapter.href),
      xml_text(&chapter.title)
    ));
  }
  out.push_str("</ol>\n</nav>\n</body>\n</html>\n");
  out
}

fn xhtml_head(title: &str, language: &str) -> String {
  format!(
    "{XML_DECL}<!DOCTYPE html>\n<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"{}\" lang=\"{}\">\n<head>\n<meta charset=\"utf-8\"/>\n<title>{}</title>\n<link rel=\"stylesheet\" type=\"text/css\" href=\"style.css\"/>\n</head>\n",
    xml_attr(language),
    xml_attr(language),
    xml_text(title)
  )
}

fn chapter_xhtml(chapter: &Chapter, language: &str) -> String {
  let mut out = xhtml_head(&chapter.title, language);
  out.push_str("<body>\n");
  for block in &chapter.blocks {
    out.push_str(&xhtml_block(block));
  }
  out.push_str("</body>\n</html>\n");
  out
}

/* --------------------------------------------------------------- documents -- */

fn xhtml_block(block: &Block) -> String {
  match block {
    Block::Paragraph(inlines) => match inlines.as_slice() {
      [Inline::Math(tex)] => format!(
        "<div class=\"md-math-block\" data-math=\"{}\">{}</div>\n",
        xml_attr(tex.trim()),
        xml_text(tex.trim())
      ),
      _ => format!("<p>{}</p>\n", xhtml_inline(inlines)),
    },
    Block::Heading { level, content } => {
      let level = (*level).clamp(1, 6);
      format!("<h{level}>{}</h{level}>\n", xhtml_inline(content))
    }
    Block::CodeBlock { language, text } => {
      let body = xml_text(text.trim_end_matches('\n'));
      match language.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
        Some(lang) => format!(
          "<pre class=\"md-fences\"><code class=\"language-{}\">{body}</code></pre>\n",
          xml_attr(&lang.to_ascii_lowercase())
        ),
        None => format!("<pre class=\"md-fences\"><code>{body}</code></pre>\n"),
      }
    }
    Block::Quote(inner) => {
      let mut out = String::from("<blockquote>\n");
      for block in inner {
        out.push_str(&xhtml_block(block));
      }
      out.push_str("</blockquote>\n");
      out
    }
    Block::List {
      ordered,
      start,
      items,
    } => {
      let mut out = String::new();
      let first = (*start).max(1);
      if *ordered {
        if first == 1 {
          out.push_str("<ol>\n");
        } else {
          out.push_str(&format!("<ol start=\"{first}\">\n"));
        }
      } else {
        out.push_str("<ul>\n");
      }
      for item in items {
        out.push_str("<li>");
        for (index, block) in item.iter().enumerate() {
          if index == 0 {
            if let Block::Paragraph(inlines) = block {
              out.push_str(&xhtml_inline(inlines));
              continue;
            }
          }
          out.push_str(&xhtml_block(block));
        }
        out.push_str("</li>\n");
      }
      out.push_str(if *ordered { "</ol>\n" } else { "</ul>\n" });
      out
    }
    Block::Table {
      header,
      align,
      rows,
    } => {
      let columns = header.len().max(rows.iter().map(Vec::len).max().unwrap_or(0));
      if columns == 0 {
        return String::new();
      }
      let mut out = String::from("<table class=\"md-table\">\n<thead>\n<tr>");
      for index in 0..columns {
        let cell = header.get(index).map_or_else(String::new, |cell| xhtml_inline(cell));
        out.push_str(&format!(
          "<th{}>{cell}</th>",
          xhtml_align(align.get(index).copied().unwrap_or_default())
        ));
      }
      out.push_str("</tr>\n</thead>\n<tbody>\n");
      for row in rows {
        out.push_str("<tr>");
        for index in 0..columns {
          let cell = row.get(index).map_or_else(String::new, |cell| xhtml_inline(cell));
          out.push_str(&format!(
            "<td{}>{cell}</td>",
            xhtml_align(align.get(index).copied().unwrap_or_default())
          ));
        }
        out.push_str("</tr>\n");
      }
      out.push_str("</tbody>\n</table>\n");
      out
    }
    Block::Rule => "<hr/>\n".to_string(),
    Block::Raw(text) => format!("{}\n", xml_text(text)),
  }
}

fn xhtml_align(align: Align) -> String {
  match align {
    Align::None => String::new(),
    Align::Left => " style=\"text-align: left\"".to_string(),
    Align::Center => " style=\"text-align: center\"".to_string(),
    Align::Right => " style=\"text-align: right\"".to_string(),
  }
}

fn xhtml_inline(inlines: &[Inline]) -> String {
  let mut out = String::new();
  for inline in inlines {
    match inline {
      Inline::Text(text) => out.push_str(&xml_text(text)),
      Inline::Strong(inner) => out.push_str(&format!("<strong>{}</strong>", xhtml_inline(inner))),
      Inline::Emphasis(inner) => out.push_str(&format!("<em>{}</em>", xhtml_inline(inner))),
      Inline::Strike(inner) => out.push_str(&format!("<del>{}</del>", xhtml_inline(inner))),
      Inline::Underline(inner) => out.push_str(&format!("<u>{}</u>", xhtml_inline(inner))),
      Inline::Code(text) => out.push_str(&format!("<code>{}</code>", xml_text(text))),
      Inline::Math(tex) => out.push_str(&format!(
        "<span class=\"md-inline-math\" data-math=\"{}\">{}</span>",
        xml_attr(tex.trim()),
        xml_text(tex.trim())
      )),
      Inline::Link {
        href,
        title,
        content,
      } => {
        let inner = xhtml_inline(content);
        let mut attrs = format!(" href=\"{}\"", xml_attr(href));
        if let Some(title) = title {
          attrs.push_str(&format!(" title=\"{}\"", xml_attr(title)));
        }
        if inner.is_empty() {
          out.push_str(&format!("<a{attrs}>{}</a>", xml_text(href)));
        } else {
          out.push_str(&format!("<a{attrs}>{inner}</a>"));
        }
      }
      Inline::Image { src, alt, title } => {
        if src.starts_with("http://") || src.starts_with("https://") {
          let mut attrs = format!(" src=\"{}\" alt=\"{}\"", xml_attr(src), xml_attr(alt));
          if let Some(title) = title {
            attrs.push_str(&format!(" title=\"{}\"", xml_attr(title)));
          }
          out.push_str(&format!("<img{attrs}/>"));
        } else {
          let text = if alt.is_empty() { src.as_str() } else { alt.as_str() };
          out.push_str(&format!(
            "<span class=\"image-alt\">{}</span>",
            xml_text(text)
          ));
        }
      }
      Inline::SoftBreak => out.push('\n'),
      Inline::HardBreak => out.push_str("<br/>"),
      Inline::Raw(text) => out.push_str(&xml_text(text)),
    }
  }
  out
}

/* ------------------------------------------------------------------ assets -- */

const STYLE_CSS: &str = "\
body { font-family: Georgia, serif; line-height: 1.5; margin: 1em; }
h1, h2, h3, h4, h5, h6 { font-family: Helvetica, Arial, sans-serif; line-height: 1.2; }
pre.md-fences { background: #f4f4f4; padding: 0.6em; overflow-x: auto; font-size: 0.85em; }
code { font-family: Consolas, monospace; }
blockquote { margin: 0 0 0 1em; padding-left: 1em; border-left: 3px solid #bfbfbf; color: #595959; }
table.md-table { border-collapse: collapse; margin: 1em 0; }
table.md-table th, table.md-table td { border: 1px solid #bfbfbf; padding: 0.3em 0.6em; }
.md-inline-math, .md-math-block { font-family: Consolas, monospace; }
.md-math-block { text-align: center; margin: 1em 0; }
.image-alt { font-style: italic; }
";

/* ------------------------------------------------------------------ escape -- */

fn xml_text(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  for ch in text.chars() {
    match ch {
      '&' => out.push_str("&amp;"),
      '<' => out.push_str("&lt;"),
      '>' => out.push_str("&gt;"),
      '\t' => out.push(' '),
      ch if ch.is_control() && ch != '\n' => {}
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
      '\n' => out.push_str("&#10;"),
      ch if ch.is_control() => {}
      _ => out.push(ch),
    }
  }
  out
}

/// Stable pseudo-UUID derived from the book title, so the same input always
/// yields the same package.
fn uuid(seed: &str) -> String {
  let mut first = 0xcbf2_9ce4_8422_2325u64;
  for byte in seed.as_bytes() {
    first ^= u64::from(*byte);
    first = first.wrapping_mul(0x0000_0100_0000_01b3);
  }
  let mut second = 0x9e37_79b9_7f4a_7c15u64 ^ first;
  for byte in seed.len().to_le_bytes() {
    second ^= u64::from(byte);
    second = second.wrapping_mul(0x0000_0100_0000_01b3);
  }
  let part3 = 0x4000u16 | (first as u16 & 0x0fff);
  let part4 = 0x8000u16 | ((second >> 48) as u16 & 0x3fff);
  format!(
    "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
    (first >> 32) as u32,
    (first >> 16) as u16,
    part3,
    part4,
    second & 0xffff_ffff_ffff
  )
}
