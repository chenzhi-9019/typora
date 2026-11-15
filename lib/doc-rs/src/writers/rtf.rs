//! RTF writer.

use crate::model::{Align, Block, Document, Inline};
use crate::ConvertError;

pub fn write(document: &Document) -> Result<Vec<u8>, ConvertError> {
  let mut out = String::new();
  out.push_str("{\\rtf1\\ansi\\ansicpg1252\\deff0\n");
  out.push_str("{\\fonttbl{\\f0 Calibri;}{\\f1 Consolas;}}\n");
  out.push_str("{\\colortbl;\\red0\\green0\\blue0;\\red90\\green90\\blue90;}\n");
  out.push_str("\\viewkind4\\uc1\n");

  let info = rtf_info(document);
  if !info.is_empty() {
    out.push_str(&info);
    out.push('\n');
  }

  out.push_str(&rtf_blocks(&document.blocks, 0));
  out.push_str("}\n");
  Ok(out.into_bytes())
}

fn rtf_info(document: &Document) -> String {
  let mut fields = String::new();
  for (key, value) in &document.meta {
    let value = value.trim();
    if value.is_empty() {
      continue;
    }
    if key.eq_ignore_ascii_case("title") {
      fields.push_str(&format!("{{\\title {}}}", rtf_text(value)));
    } else if key.eq_ignore_ascii_case("author") {
      fields.push_str(&format!("{{\\author {}}}", rtf_text(value)));
    } else if key.eq_ignore_ascii_case("subject") {
      fields.push_str(&format!("{{\\subject {}}}", rtf_text(value)));
    }
  }
  if fields.is_empty() {
    String::new()
  } else {
    format!("{{\\info{fields}}}")
  }
}

fn rtf_blocks(blocks: &[Block], indent: u32) -> String {
  let mut out = String::new();
  for block in blocks {
    out.push_str(&rtf_block(block, indent));
  }
  out
}

fn rtf_block(block: &Block, indent: u32) -> String {
  match block {
    Block::Paragraph(inlines) => {
      let lead = if indent == 0 {
        String::new()
      } else {
        format!("\\li{indent}")
      };
      format!("\\pard{lead} {}\\par\n", rtf_inline(inlines))
    }
    Block::Heading { level, content } => {
      let size = match (*level).clamp(1, 6) {
        1 => 40,
        2 => 34,
        3 => 30,
        4 => 26,
        5 => 24,
        _ => 22,
      };
      format!(
        "\\pard\\sb240\\sa120\\keepn\\b\\fs{size} {}\\b0\\fs24\\par\n",
        rtf_inline(content)
      )
    }
    Block::CodeBlock { language, text } => {
      let mut out = String::new();
      let mut body = text.trim_end_matches('\n');
      if body.is_empty() {
        body = "";
      }
      if let Some(lang) = language.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
        let lang = lang.to_ascii_lowercase();
        let mut ascii = String::new();
        for ch in lang.chars() {
          if ch.is_ascii_alphanumeric() || ch == '+' || ch == '#' || ch == '-' {
            ascii.push(ch);
          }
        }
        if !ascii.is_empty() {
          out.push_str(&format!(
            "\\pard\\sa60\\i\\cf1 {}\\cf0\\i0\\par\n",
            rtf_text(&ascii)
          ));
        }
      }
      for line in body.split('\n') {
        out.push_str(&format!(
          "\\pard\\li{}\\f1\\fs20 {}\\f0\\fs24\\par\n",
          indent + 360,
          rtf_text(line)
        ));
      }
      out
    }
    Block::Quote(inner) => rtf_blocks(inner, indent + 720),
    Block::List {
      ordered,
      start,
      items,
    } => rtf_list(*ordered, *start, items, indent),
    Block::Table {
      header,
      align,
      rows,
    } => rtf_table(header, align, rows, indent),
    Block::Rule => format!("\\pard{}\\brdrb\\brdrs\\brdrw10\\brsp20 \\par\n", if indent == 0 { String::new() } else { format!("\\li{indent}") }),
    Block::Raw(text) => format!("\\pard {}\\par\n", rtf_text(text)),
  }
}

fn rtf_list(ordered: bool, start: u64, items: &[Vec<Block>], indent: u32) -> String {
  let first = start.max(1);
  let mut out = String::new();
  for (index, item) in items.iter().enumerate() {
    let marker = if ordered {
      format!("{}.", first.saturating_add(index as u64))
    } else {
      "\u{2022}".to_string()
    };
    let level = indent + 360;
    let mut head = String::new();
    let rest: &[Block] = match item.first() {
      Some(Block::Paragraph(inlines)) => {
        head = rtf_inline(inlines);
        &item[1..]
      }
      _ => item.as_slice(),
    };
    out.push_str(&format!(
      "\\pard\\li{level}\\fi-360 {} \\tab {head}\\par\n",
      rtf_text(&marker)
    ));
    for block in rest {
      out.push_str(&rtf_block(block, level));
    }
  }
  out
}

fn rtf_table(
  header: &[Vec<Inline>],
  align: &[Align],
  rows: &[Vec<Vec<Inline>>],
  indent: u32,
) -> String {
  let columns = header.len().max(rows.iter().map(Vec::len).max().unwrap_or(0));
  if columns == 0 {
    return String::new();
  }
  let total = 9000u32;
  let step = total / columns as u32;
  let mut out = String::new();
  let render_row = |cells: &[Vec<Inline>], out: &mut String| {
    out.push_str("\\trowd\\trgaph108");
    if indent > 0 {
      out.push_str(&format!("\\trleft{indent}"));
    }
    for index in 0..columns {
      out.push_str(&format!("\\cellx{}", step * (index as u32 + 1)));
    }
    out.push('\n');
    for index in 0..columns {
      let text = cells.get(index).map_or_else(String::new, |cell| rtf_inline(cell));
      let layout = match align.get(index).copied().unwrap_or_default() {
        Align::None | Align::Left => "\\ql",
        Align::Center => "\\qc",
        Align::Right => "\\qr",
      };
      out.push_str(&format!("\\pard\\intbl{layout} {text}\\cell "));
    }
    out.push_str("\\row\n");
  };
  render_row(header, &mut out);
  for row in rows {
    render_row(row, &mut out);
  }
  out.push_str("\\pard\\par\n");
  out
}

fn rtf_inline(inlines: &[Inline]) -> String {
  let mut out = String::new();
  for inline in inlines {
    match inline {
      Inline::Text(text) => out.push_str(&rtf_text(text)),
      Inline::Strong(inner) => out.push_str(&format!("{{\\b {}}}", rtf_inline(inner))),
      Inline::Emphasis(inner) => out.push_str(&format!("{{\\i {}}}", rtf_inline(inner))),
      Inline::Strike(inner) => out.push_str(&format!("{{\\strike {}}}", rtf_inline(inner))),
      Inline::Underline(inner) => out.push_str(&format!("{{\\ul {}}}", rtf_inline(inner))),
      Inline::Code(text) => out.push_str(&format!("{{\\f1 {}}}", rtf_text(text))),
      Inline::Math(tex) => out.push_str(&format!("{{\\i {}}}", rtf_text(tex.trim()))),
      Inline::Link { href, content, .. } => {
        let text = rtf_inline(content);
        let text = if text.is_empty() {
          rtf_text(href)
        } else {
          text
        };
        out.push_str(&format!(
          "{{\\field{{\\*\\fldinst HYPERLINK \"{}\"}}{{\\fldrslt {{\\ul {text}}}}}}}",
          rtf_text(href)
        ));
      }
      Inline::Image { src, alt, .. } => {
        let text = if alt.is_empty() { src.as_str() } else { alt.as_str() };
        out.push_str(&format!("{{\\i {}}}", rtf_text(text)));
      }
      Inline::SoftBreak | Inline::HardBreak => out.push_str("\\line "),
      Inline::Raw(text) => out.push_str(&rtf_text(text)),
    }
  }
  out
}

/// Encodes text for the RTF body: ASCII passes through, everything else becomes
/// an RTF unicode escape with a fallback character.
fn rtf_text(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  for ch in text.chars() {
    match ch {
      '\\' => out.push_str("\\\\"),
      '{' => out.push_str("\\{"),
      '}' => out.push_str("\\}"),
      '\n' => out.push_str("\\line "),
      '\t' => out.push_str("\\tab "),
      ch if ch.is_ascii() && !ch.is_ascii_control() => out.push(ch),
      ch if ch.is_control() => {},
      ch => {
        let code = ch as u32;
        if code <= 0xFFFF {
          let signed = i32::try_from(code).unwrap_or(0);
          let signed = if signed > 32767 { signed - 65536 } else { signed };
          out.push_str(&format!("\\u{signed}?"));
        } else {
          let value = code - 0x10000;
          let high = i32::try_from(0xD800 + (value >> 10)).unwrap_or(0) - 65536;
          let low = i32::try_from(0xDC00 + (value & 0x3FF)).unwrap_or(0) - 65536;
          out.push_str(&format!("\\u{high}?\\u{low}?"));
        }
      }
    }
  }
  out
}
