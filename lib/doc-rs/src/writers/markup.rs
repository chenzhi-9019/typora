//! Org, reStructuredText, Textile, MediaWiki, OPML and LaTeX writers.

use crate::model::{Align, Block, Document, Inline};

fn finished(mut text: String) -> String {
  if !text.is_empty() && !text.ends_with('\n') {
    text.push('\n');
  }
  text
}

fn join_blocks(blocks: &[Block], render: fn(&Block) -> String) -> String {
  let rendered: Vec<String> = blocks
    .iter()
    .map(render)
    .filter(|text| !text.is_empty())
    .collect();
  rendered.join("\n\n")
}

/// Prefixes the first line with `first` and the rest with `rest`.
fn prefix_lines(text: &str, first: &str, rest: &str) -> String {
  let mut out = String::new();
  for (index, line) in text.split('\n').enumerate() {
    if index > 0 {
      out.push('\n');
    }
    if line.is_empty() {
      continue;
    }
    out.push_str(if index == 0 { first } else { rest });
    out.push_str(line);
  }
  out
}

fn indent_lines(text: &str, indent: &str) -> String {
  prefix_lines(text, indent, indent)
}

/* -------------------------------------------------------------------- org -- */

pub fn org(document: &Document) -> String {
  let mut out = String::new();
  for (key, value) in &document.meta {
    out.push_str("#+");
    out.push_str(&key.trim().to_ascii_uppercase());
    out.push_str(": ");
    out.push_str(value.trim());
    out.push('\n');
  }
  if !out.is_empty() {
    out.push('\n');
  }
  out.push_str(&join_blocks(&document.blocks, org_block));
  finished(out)
}

fn org_blocks(blocks: &[Block]) -> String {
  join_blocks(blocks, org_block)
}

fn org_block(block: &Block) -> String {
  match block {
    Block::Paragraph(inlines) => org_inline(inlines),
    Block::Heading { level, content } => {
      let level = usize::from((*level).clamp(1, 6));
      let title = org_inline(content);
      if title.is_empty() {
        "*".repeat(level)
      } else {
        format!("{} {title}", "*".repeat(level))
      }
    }
    Block::CodeBlock { language, text } => {
      let lang = language.as_deref().unwrap_or("").trim();
      let mut out = String::from("#+BEGIN_SRC");
      if !lang.is_empty() {
        out.push(' ');
        out.push_str(lang);
      }
      out.push('\n');
      out.push_str(text.trim_end_matches('\n'));
      out.push_str("\n#+END_SRC");
      out
    }
    Block::Quote(inner) => {
      let body = org_blocks(inner);
      if body.is_empty() {
        String::new()
      } else {
        format!("#+BEGIN_QUOTE\n{body}\n#+END_QUOTE")
      }
    }
    Block::List {
      ordered,
      start,
      items,
    } => org_list(*ordered, *start, items),
    Block::Table { header, rows, .. } => org_table(header, rows),
    Block::Rule => "-----".to_string(),
    Block::Raw(text) => text.clone(),
  }
}

fn org_inline(inlines: &[Inline]) -> String {
  let mut out = String::new();
  for inline in inlines {
    match inline {
      Inline::Text(text) => out.push_str(text),
      Inline::Strong(inner) => out.push_str(&format!("*{}*", org_inline(inner))),
      Inline::Emphasis(inner) => out.push_str(&format!("/{}/", org_inline(inner))),
      Inline::Strike(inner) => out.push_str(&format!("+{}+", org_inline(inner))),
      Inline::Underline(inner) => out.push_str(&format!("_{}_", org_inline(inner))),
      Inline::Code(text) => out.push_str(&format!("={text}=")),
      Inline::Math(tex) => out.push_str(&format!("${}$", tex.trim())),
      Inline::Link {
        href, content, ..
      } => {
        let text = org_inline(content);
        if text.is_empty() || text == *href {
          out.push_str(&format!("[[{href}]]"));
        } else {
          out.push_str(&format!("[[{href}][{text}]]"));
        }
      }
      Inline::Image { src, alt, .. } => {
        if alt.is_empty() {
          out.push_str(&format!("[[{src}]]"));
        } else {
          out.push_str(&format!("[[{src}][{alt}]]"));
        }
      }
      Inline::SoftBreak => out.push('\n'),
      Inline::HardBreak => out.push_str("\\\\\n"),
      Inline::Raw(text) => out.push_str(text),
    }
  }
  out
}

fn org_list(ordered: bool, start: u64, items: &[Vec<Block>]) -> String {
  let first = start.max(1);
  let mut out = String::new();
  for (index, item) in items.iter().enumerate() {
    if index > 0 {
      out.push('\n');
    }
    let marker = if ordered {
      format!("{}. ", first.saturating_add(index as u64))
    } else {
      "- ".to_string()
    };
    let indent = " ".repeat(marker.chars().count());
    out.push_str(&prefix_lines(&org_item(item), &marker, &indent));
  }
  out
}

fn org_item(blocks: &[Block]) -> String {
  let mut out = String::new();
  let mut writable = false;
  for block in blocks {
    let rendered = org_block(block);
    if rendered.is_empty() {
      continue;
    }
    if writable {
      out.push('\n');
      if !matches!(block, Block::List { .. }) {
        out.push('\n');
      }
    }
    out.push_str(&rendered);
    writable = true;
  }
  out
}

fn org_table(header: &[Vec<Inline>], rows: &[Vec<Vec<Inline>>]) -> String {
  let columns = header.len().max(rows.iter().map(Vec::len).max().unwrap_or(0));
  if columns == 0 {
    return String::new();
  }
  let mut lines: Vec<String> = Vec::with_capacity(rows.len() + 2);
  lines.push(org_row(header, columns));
  lines.push(format!("|{}|", vec!["---"; columns].join("+")));
  for row in rows {
    lines.push(org_row(row, columns));
  }
  lines.join("\n")
}

fn org_row(cells: &[Vec<Inline>], columns: usize) -> String {
  let mut out = String::from("|");
  for index in 0..columns {
    out.push(' ');
    if let Some(cell) = cells.get(index) {
      out.push_str(&org_inline(cell).replace('|', "\\vert{}"));
    }
    out.push_str(" |");
  }
  out
}

/* -------------------------------------------------------------------- rst -- */

pub fn rst(document: &Document) -> String {
  let mut out = String::new();
  for (key, value) in &document.meta {
    out.push(':');
    out.push_str(&key.trim().to_ascii_lowercase().replace(' ', "-"));
    out.push_str(": ");
    out.push_str(value.trim());
    out.push('\n');
  }
  if !out.is_empty() {
    out.push('\n');
  }
  out.push_str(&join_blocks(&document.blocks, rst_block));
  finished(out)
}

fn rst_blocks(blocks: &[Block]) -> String {
  join_blocks(blocks, rst_block)
}

fn rst_block(block: &Block) -> String {
  match block {
    Block::Paragraph(inlines) => rst_inline(inlines),
    Block::Heading { level, content } => {
      let title = rst_inline(content);
      let level = usize::from((*level).clamp(1, 6));
      let marks = ['=', '-', '~', '^', '"', '\''];
      let mark = marks[level - 1];
      let width = title.chars().count().max(3);
      format!("{title}\n{}", mark.to_string().repeat(width))
    }
    Block::CodeBlock { language, text } => {
      let lang = language.as_deref().unwrap_or("").trim();
      let body = indent_lines(text.trim_end_matches('\n'), "   ");
      if lang.is_empty() {
        format!("::\n\n{body}")
      } else {
        format!(".. code-block:: {lang}\n\n{body}")
      }
    }
    Block::Quote(inner) => {
      let body = rst_blocks(inner);
      if body.is_empty() {
        String::new()
      } else {
        // a bare indented block would merge into a preceding literal block
        format!(".. epigraph::\n\n{}", indent_lines(&body, "   "))
      }
    }
    Block::List {
      ordered,
      start,
      items,
    } => rst_list(*ordered, *start, items),
    Block::Table { header, rows, .. } => rst_table(header, rows),
    Block::Rule => "----".to_string(),
    Block::Raw(text) => text.clone(),
  }
}

fn rst_inline(inlines: &[Inline]) -> String {
  let mut out = String::new();
  for inline in inlines {
    let fragment = match inline {
      Inline::Text(text) | Inline::Raw(text) => text.clone(),
      Inline::Strong(inner) => format!("**{}**", rst_inline(inner)),
      Inline::Emphasis(inner) => format!("*{}*", rst_inline(inner)),
      Inline::Strike(inner) => format!(":strike:`{}`", rst_inline(inner)),
      Inline::Underline(inner) => format!(":underline:`{}`", rst_inline(inner)),
      Inline::Code(text) => format!("``{text}``"),
      Inline::Math(tex) => format!(":math:`{}`", tex.trim()),
      Inline::Link { href, content, .. } => {
        let text = rst_inline(content);
        if text.is_empty() {
          format!("`{href}`_")
        } else {
          format!("`{text} <{href}>`_")
        }
      }
      Inline::Image { src, alt, .. } => {
        let text = if alt.is_empty() { src.as_str() } else { alt.as_str() };
        format!("`{text} <{src}>`_")
      }
      Inline::SoftBreak => "\n".to_string(),
      Inline::HardBreak => "\n\n".to_string(),
    };
    rst_append(&mut out, &fragment);
  }
  out
}

/// reStructuredText only recognises inline markup that follows whitespace or an
/// opening bracket, so adjacent spans are separated by an escaped space.
fn rst_append(out: &mut String, fragment: &str) {
  if fragment.is_empty() {
    return;
  }
  let starts_markup = fragment.starts_with(['*', '`', ':']);
  if starts_markup && out.chars().next_back().is_some_and(|ch| !ch.is_whitespace()) {
    out.push_str("\\ ");
  }
  out.push_str(fragment);
}

fn rst_list(ordered: bool, start: u64, items: &[Vec<Block>]) -> String {
  let first = start.max(1);
  let mut out = String::new();
  for (index, item) in items.iter().enumerate() {
    if index > 0 {
      out.push('\n');
    }
    let marker = if ordered {
      format!("{}. ", first.saturating_add(index as u64))
    } else {
      "- ".to_string()
    };
    let indent = " ".repeat(marker.chars().count());
    out.push_str(&prefix_lines(&rst_item(item), &marker, &indent));
  }
  out
}

fn rst_item(blocks: &[Block]) -> String {
  let mut out = String::new();
  let mut writable = false;
  for block in blocks {
    let rendered = rst_block(block);
    if rendered.is_empty() {
      continue;
    }
    if writable {
      out.push('\n');
      if !matches!(block, Block::List { .. }) {
        out.push('\n');
      }
    }
    out.push_str(&rendered);
    writable = true;
  }
  out
}

fn rst_table(header: &[Vec<Inline>], rows: &[Vec<Vec<Inline>>]) -> String {
  let columns = header.len().max(rows.iter().map(Vec::len).max().unwrap_or(0));
  if columns == 0 {
    return String::new();
  }
  let mut grid: Vec<Vec<String>> = Vec::with_capacity(rows.len() + 1);
  grid.push(rst_cells(header, columns));
  for row in rows {
    grid.push(rst_cells(row, columns));
  }
  let mut widths = vec![1usize; columns];
  for row in &grid {
    for (index, cell) in row.iter().enumerate() {
      widths[index] = widths[index].max(cell.chars().count());
    }
  }
  let border = widths
    .iter()
    .map(|width| "=".repeat(*width))
    .collect::<Vec<String>>()
    .join(" ");
  let mut lines: Vec<String> = Vec::with_capacity(grid.len() + 3);
  lines.push(border.clone());
  lines.push(rst_row(&grid[0], &widths));
  lines.push(border.clone());
  for row in &grid[1..] {
    lines.push(rst_row(row, &widths));
  }
  lines.push(border);
  lines.join("\n")
}

fn rst_cells(cells: &[Vec<Inline>], columns: usize) -> Vec<String> {
  let mut out: Vec<String> = cells.iter().map(|cell| rst_inline(cell)).collect();
  out.truncate(columns);
  while out.len() < columns {
    out.push(String::new());
  }
  out
}

fn rst_row(cells: &[String], widths: &[usize]) -> String {
  let padded: Vec<String> = cells
    .iter()
    .zip(widths)
    .map(|(cell, width)| {
      format!(
        "{cell}{}",
        " ".repeat(width.saturating_sub(cell.chars().count()))
      )
    })
    .collect();
  padded.join(" ").trim_end().to_string()
}

/* ---------------------------------------------------------------- textile -- */

pub fn textile(document: &Document) -> String {
  finished(join_blocks(&document.blocks, textile_block))
}

fn textile_blocks(blocks: &[Block]) -> String {
  join_blocks(blocks, textile_block)
}

fn textile_block(block: &Block) -> String {
  match block {
    Block::Paragraph(inlines) => textile_inline(inlines),
    Block::Heading { level, content } => {
      let level = (*level).clamp(1, 6);
      format!("h{level}. {}", textile_inline(content))
    }
    Block::CodeBlock { language, text } => {
      let body = text.trim_end_matches('\n');
      match language.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
        // Textile code blocks carry no language attribute; the extended form
        // keeps the body intact rather than inventing markup.
        Some(_) => format!("bc.. {body}"),
        None => {
          let mut lines = body.split('\n');
          let mut out = String::from("bc. ");
          out.push_str(lines.next().unwrap_or(""));
          for line in lines {
            out.push('\n');
            out.push_str(line);
          }
          out
        }
      }
    }
    Block::Quote(inner) => prefix_lines(&textile_blocks(inner), "bq. ", ""),
    Block::List {
      ordered,
      start,
      items,
    } => textile_list(*ordered, *start, items, 1),
    Block::Table { header, rows, align } => textile_table(header, rows, align),
    Block::Rule => "---".to_string(),
    Block::Raw(text) => text.clone(),
  }
}

fn textile_inline(inlines: &[Inline]) -> String {
  let mut out = String::new();
  for inline in inlines {
    match inline {
      Inline::Text(text) => out.push_str(text),
      Inline::Strong(inner) => out.push_str(&format!("*{}*", textile_inline(inner))),
      Inline::Emphasis(inner) => out.push_str(&format!("_{}_", textile_inline(inner))),
      Inline::Strike(inner) => out.push_str(&format!("-{}-", textile_inline(inner))),
      Inline::Underline(inner) => out.push_str(&format!("+{}+", textile_inline(inner))),
      Inline::Code(text) => out.push_str(&format!("@{text}@")),
      Inline::Math(tex) => out.push_str(&format!("${}$", tex.trim())),
      Inline::Link { href, content, .. } => {
        out.push_str(&format!("\"{}\":{href}", textile_inline(content)));
      }
      Inline::Image { src, alt, .. } => {
        if alt.is_empty() {
          out.push_str(&format!("!{src}!"));
        } else {
          out.push_str(&format!("!{src}({alt})!"));
        }
      }
      Inline::SoftBreak => out.push('\n'),
      Inline::HardBreak => out.push_str("<br />\n"),
      Inline::Raw(text) => out.push_str(text),
    }
  }
  out
}

fn textile_list(ordered: bool, _start: u64, items: &[Vec<Block>], depth: usize) -> String {
  let mut out = String::new();
  for (index, item) in items.iter().enumerate() {
    if index > 0 {
      out.push('\n');
    }
    let mut marker = if ordered {
      "#".repeat(depth)
    } else {
      "*".repeat(depth)
    };
    marker.push(' ');
    let indent = " ".repeat(marker.chars().count());
    out.push_str(&prefix_lines(&textile_item(item, depth), &marker, &indent));
  }
  out
}

fn textile_item(blocks: &[Block], depth: usize) -> String {
  let mut out = String::new();
  let mut writable = false;
  for block in blocks {
    let rendered = match block {
      Block::List {
        ordered,
        start,
        items,
      } => textile_list(*ordered, *start, items, depth + 1),
      other => textile_block(other),
    };
    if rendered.is_empty() {
      continue;
    }
    if writable {
      out.push('\n');
      if !matches!(block, Block::List { .. }) {
        out.push('\n');
      }
    }
    out.push_str(&rendered);
    writable = true;
  }
  out
}

fn textile_table(header: &[Vec<Inline>], rows: &[Vec<Vec<Inline>>], align: &[Align]) -> String {
  let columns = header.len().max(rows.iter().map(Vec::len).max().unwrap_or(0));
  if columns == 0 {
    return String::new();
  }
  let mut lines: Vec<String> = Vec::with_capacity(rows.len() + 1);
  lines.push(textile_row(header, columns, align, true));
  for row in rows {
    lines.push(textile_row(row, columns, align, false));
  }
  lines.join("\n")
}

fn textile_row(cells: &[Vec<Inline>], columns: usize, align: &[Align], head: bool) -> String {
  let mut out = String::new();
  for index in 0..columns {
    let modifier = match align.get(index).copied().unwrap_or_default() {
      Align::None => "",
      Align::Left => "<",
      Align::Center => "=",
      Align::Right => ">",
    };
    out.push('|');
    if head {
      out.push_str("_. ");
    } else if modifier.is_empty() {
      out.push(' ');
    } else {
      out.push_str(modifier);
      out.push_str(". ");
    }
    if let Some(cell) = cells.get(index) {
      out.push_str(&textile_inline(cell).replace('|', "&#124;"));
    }
    out.push(' ');
  }
  out.push('|');
  out
}

/* -------------------------------------------------------------- mediawiki -- */

pub fn mediawiki(document: &Document) -> String {
  finished(join_blocks(&document.blocks, mediawiki_block))
}

fn mediawiki_blocks(blocks: &[Block]) -> String {
  join_blocks(blocks, mediawiki_block)
}

fn mediawiki_block(block: &Block) -> String {
  match block {
    Block::Paragraph(inlines) => mediawiki_inline(inlines),
    Block::Heading { level, content } => {
      let level = usize::from((*level).clamp(1, 6));
      let marks = "=".repeat(level);
      format!("{marks} {} {marks}", mediawiki_inline(content))
    }
    Block::CodeBlock { language, text } => {
      let body = mediawiki_code(text.trim_end_matches('\n'));
      match language.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
        Some(lang) => format!("<syntaxhighlight lang=\"{lang}\">\n{body}\n</syntaxhighlight>"),
        None => format!("<pre>\n{body}\n</pre>"),
      }
    }
    Block::Quote(inner) => {
      let body = mediawiki_blocks(inner);
      if body.is_empty() {
        String::new()
      } else {
        format!("<blockquote>\n{body}\n</blockquote>")
      }
    }
    Block::List {
      ordered,
      start,
      items,
    } => mediawiki_list(*ordered, *start, items, 0),
    Block::Table { header, rows, align } => mediawiki_table(header, rows, align),
    Block::Rule => "----".to_string(),
    Block::Raw(text) => text.clone(),
  }
}

fn mediawiki_inline(inlines: &[Inline]) -> String {
  let mut out = String::new();
  for inline in inlines {
    match inline {
      Inline::Text(text) => out.push_str(&mediawiki_text(text)),
      Inline::Strong(inner) => out.push_str(&format!("'''{}'''", mediawiki_inline(inner))),
      Inline::Emphasis(inner) => out.push_str(&format!("''{}''", mediawiki_inline(inner))),
      Inline::Strike(inner) => {
        out.push_str(&format!("<s>{}</s>", mediawiki_inline(inner)));
      }
      Inline::Underline(inner) => {
        out.push_str(&format!("<u>{}</u>", mediawiki_inline(inner)));
      }
      Inline::Code(text) => {
        out.push_str(&format!("<code>{}</code>", mediawiki_text(text)));
      }
      Inline::Math(tex) => out.push_str(&format!("<math>{tex}</math>")),
      Inline::Link { href, content, .. } => {
        let text = mediawiki_inline(content);
        if text.is_empty() {
          out.push_str(&format!("[{href}]"));
        } else {
          out.push_str(&format!("[{href} {text}]"));
        }
      }
      Inline::Image { src, alt, .. } => {
        if alt.is_empty() {
          out.push_str(&format!("[[File:{src}]]"));
        } else {
          out.push_str(&format!("[[File:{src}|{alt}]]"));
        }
      }
      Inline::SoftBreak => out.push('\n'),
      Inline::HardBreak => out.push_str("<br />\n"),
      Inline::Raw(text) => out.push_str(text),
    }
  }
  out
}

fn mediawiki_text(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  for ch in text.chars() {
    match ch {
      '&' => out.push_str("&amp;"),
      '<' => out.push_str("&lt;"),
      '>' => out.push_str("&gt;"),
      '{' => out.push_str("&#123;"),
      '}' => out.push_str("&#125;"),
      '[' => out.push_str("&#91;"),
      ']' => out.push_str("&#93;"),
      _ => out.push(ch),
    }
  }
  out
}

/// Code blocks keep braces and brackets; only characters that could open a tag
/// are escaped.
fn mediawiki_code(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  for ch in text.chars() {
    match ch {
      '&' => out.push_str("&amp;"),
      '<' => out.push_str("&lt;"),
      '>' => out.push_str("&gt;"),
      _ => out.push(ch),
    }
  }
  out
}

fn mediawiki_list(ordered: bool, start: u64, items: &[Vec<Block>], depth: usize) -> String {
  let first = start.max(1);
  if ordered && first != 1 {
    // the # syntax cannot express a start value, HTML can
    let mut out = format!("<ol start=\"{first}\">\n");
    for item in items {
      out.push_str("<li>");
      out.push_str(&mediawiki_item(item, depth + 1));
      out.push_str("</li>\n");
    }
    out.push_str("</ol>");
    return out;
  }
  let mut out = String::new();
  for (index, item) in items.iter().enumerate() {
    if index > 0 {
      out.push('\n');
    }
    let mark = if ordered { '#' } else { '*' };
    let mut marker = String::new();
    for _ in 0..=depth {
      marker.push(mark);
    }
    marker.push(' ');
    let indent = " ".repeat(marker.chars().count());
    out.push_str(&prefix_lines(&mediawiki_item(item, depth + 1), &marker, &indent));
  }
  out
}

fn mediawiki_item(blocks: &[Block], depth: usize) -> String {
  let mut out = String::new();
  let mut writable = false;
  for block in blocks {
    let rendered = match block {
      Block::List {
        ordered,
        start,
        items,
      } => mediawiki_list(*ordered, *start, items, depth),
      other => mediawiki_block(other),
    };
    if rendered.is_empty() {
      continue;
    }
    if writable {
      out.push('\n');
      if !matches!(block, Block::List { .. }) {
        out.push('\n');
      }
    }
    out.push_str(&rendered);
    writable = true;
  }
  out
}

fn mediawiki_table(header: &[Vec<Inline>], rows: &[Vec<Vec<Inline>>], align: &[Align]) -> String {
  let columns = header.len().max(rows.iter().map(Vec::len).max().unwrap_or(0));
  if columns == 0 {
    return String::new();
  }
  let mut out = String::from("{| class=\"wikitable\"\n|-\n");
  for index in 0..columns {
    let style = mediawiki_style(align.get(index).copied().unwrap_or_default());
    let cell = header
      .get(index)
      .map_or_else(String::new, |cell| mediawiki_inline(cell));
    out.push_str(&format!("! {style}| {cell}\n"));
  }
  for row in rows {
    out.push_str("|-\n");
    for index in 0..columns {
      let style = mediawiki_style(align.get(index).copied().unwrap_or_default());
      let cell = row
        .get(index)
        .map_or_else(String::new, |cell| mediawiki_inline(cell));
      out.push_str(&format!("| {style}| {cell}\n"));
    }
  }
  out.push_str("|}");
  out
}

fn mediawiki_style(align: Align) -> String {
  match align {
    Align::None => String::new(),
    Align::Left => "style=\"text-align: left;\" ".to_string(),
    Align::Center => "style=\"text-align: center;\" ".to_string(),
    Align::Right => "style=\"text-align: right;\" ".to_string(),
  }
}

/* ------------------------------------------------------------------- opml -- */

/// A node of the OPML outline tree; `level` mirrors the heading depth.
struct Outline {
  level: u8,
  text: String,
  notes: Vec<String>,
  children: Vec<Outline>,
}

pub fn opml(document: &Document) -> String {
  let mut roots: Vec<Outline> = Vec::new();
  let mut open: Vec<Outline> = Vec::new();
  let mut preamble: Vec<String> = Vec::new();

  for block in &document.blocks {
    if let Block::Heading { level, content } = block {
      while open.last().is_some_and(|node| node.level >= *level) {
        close_outline(&mut open, &mut roots);
      }
      open.push(Outline {
        level: *level,
        text: Inline::plain_text(content).trim().to_string(),
        notes: Vec::new(),
        children: Vec::new(),
      });
      continue;
    }
    if let Some(note) = outline_note(block) {
      match open.last_mut() {
        Some(node) => node.notes.push(note),
        None => preamble.push(note),
      }
    }
  }
  while !open.is_empty() {
    close_outline(&mut open, &mut roots);
  }

  let title = document
    .meta
    .iter()
    .find(|(key, _)| key.eq_ignore_ascii_case("title"))
    .map(|(_, value)| value.trim().to_string())
    .or_else(|| roots.first().map(|node| node.text.clone()))
    .unwrap_or_else(|| "Untitled".to_string());

  let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<opml version=\"2.0\">\n");
  out.push_str("<head>\n<title>");
  out.push_str(&opml_attr(&title));
  out.push_str("</title>\n</head>\n<body>\n");
  if !preamble.is_empty() {
    let text = preamble
      .first()
      .map(|note| note.lines().next().unwrap_or(note.as_str()).chars().take(80).collect::<String>())
      .unwrap_or_default();
    out.push_str(&opml_outline(
      &Outline {
        level: 0,
        text,
        notes: preamble,
        children: Vec::new(),
      },
      1,
    ));
  }
  for node in &roots {
    out.push_str(&opml_outline(node, 1));
  }
  out.push_str("</body>\n</opml>\n");
  out
}

fn close_outline(open: &mut Vec<Outline>, roots: &mut Vec<Outline>) {
  if let Some(node) = open.pop() {
    match open.last_mut() {
      Some(parent) => parent.children.push(node),
      None => roots.push(node),
    }
  }
}

fn outline_note(block: &Block) -> Option<String> {
  let note = Block::plain_text(std::slice::from_ref(block)).trim().to_string();
  if note.is_empty() {
    None
  } else {
    Some(note)
  }
}

fn opml_outline(node: &Outline, depth: usize) -> String {
  let pad = "  ".repeat(depth);
  let mut out = pad.clone();
  out.push_str("<outline text=\"");
  out.push_str(&opml_attr(&node.text));
  out.push('"');
  if !node.notes.is_empty() {
    out.push_str(" _note=\"");
    out.push_str(&opml_attr(&node.notes.join("\n")));
    out.push('"');
  }
  if node.children.is_empty() {
    out.push_str("/>\n");
    return out;
  }
  out.push_str(">\n");
  for child in &node.children {
    out.push_str(&opml_outline(child, depth + 1));
  }
  out.push_str(&pad);
  out.push_str("</outline>\n");
  out
}

fn opml_attr(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  for ch in text.chars() {
    match ch {
      '&' => out.push_str("&amp;"),
      '<' => out.push_str("&lt;"),
      '>' => out.push_str("&gt;"),
      '"' => out.push_str("&quot;"),
      '\n' => out.push_str("&#10;"),
      '\t' => out.push_str("&#9;"),
      _ => out.push(ch),
    }
  }
  out
}

/* ------------------------------------------------------------------ latex -- */

pub fn latex(document: &Document) -> String {
  let mut out = String::from(
    "\\documentclass{article}\n\
     \\usepackage[utf8]{inputenc}\n\
     \\usepackage[T1]{fontenc}\n\
     \\usepackage{graphicx}\n\
     \\usepackage{hyperref}\n\
     \\usepackage[normalem]{ulem}\n\
     \\usepackage{amsmath}\n\
     \\usepackage{listings}\n\
     \\begin{document}\n\n",
  );
  let mut titled = false;
  for (key, value) in &document.meta {
    if key.eq_ignore_ascii_case("title") {
      out.push_str(&format!("\\title{{{}}}\n", tex_escape(value.trim())));
      titled = true;
    } else if key.eq_ignore_ascii_case("author") {
      out.push_str(&format!("\\author{{{}}}\n", tex_escape(value.trim())));
    } else if key.eq_ignore_ascii_case("date") {
      out.push_str(&format!("\\date{{{}}}\n", tex_escape(value.trim())));
    }
  }
  if titled {
    out.push_str("\\maketitle\n\n");
  }
  out.push_str(&latex_blocks(&document.blocks, 0));
  out.push_str("\n\n\\end{document}\n");
  finished(out)
}

fn latex_blocks(blocks: &[Block], depth: usize) -> String {
  let rendered: Vec<String> = blocks
    .iter()
    .map(|block| latex_block(block, depth))
    .filter(|text| !text.is_empty())
    .collect();
  rendered.join("\n\n")
}

fn latex_block(block: &Block, depth: usize) -> String {
  match block {
    Block::Paragraph(inlines) => match inlines.as_slice() {
      [Inline::Math(tex)] => format!("\\[\n{}\n\\]", tex.trim()),
      _ => latex_inline(inlines),
    },
    Block::Heading { level, content } => {
      let title = latex_inline(content);
      match (*level).clamp(1, 6) {
        1 => format!("\\section{{{title}}}"),
        2 => format!("\\subsection{{{title}}}"),
        3 => format!("\\subsubsection{{{title}}}"),
        4 => format!("\\paragraph{{{title}}}"),
        _ => format!("\\subparagraph{{{title}}}"),
      }
    }
    Block::CodeBlock { language, text } => {
      let body = text.trim_end_matches('\n');
      match language.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
        Some(lang) => {
          format!("\\begin{{lstlisting}}[language={lang}]\n{body}\n\\end{{lstlisting}}")
        }
        None => format!("\\begin{{verbatim}}\n{body}\n\\end{{verbatim}}"),
      }
    }
    Block::Quote(inner) => {
      let body = latex_blocks(inner, depth);
      if body.is_empty() {
        String::new()
      } else {
        format!("\\begin{{quote}}\n{body}\n\\end{{quote}}")
      }
    }
    Block::List {
      ordered,
      start,
      items,
    } => latex_list(*ordered, *start, items, depth),
    Block::Table { header, rows, align } => latex_table(header, rows, align),
    Block::Rule => "\\noindent\\rule{\\linewidth}{0.4pt}".to_string(),
    Block::Raw(text) => text.clone(),
  }
}

fn latex_inline(inlines: &[Inline]) -> String {
  let mut out = String::new();
  for inline in inlines {
    match inline {
      Inline::Text(text) => out.push_str(&tex_escape(text)),
      Inline::Strong(inner) => out.push_str(&format!("\\textbf{{{}}}", latex_inline(inner))),
      Inline::Emphasis(inner) => out.push_str(&format!("\\emph{{{}}}", latex_inline(inner))),
      Inline::Strike(inner) => out.push_str(&format!("\\sout{{{}}}", latex_inline(inner))),
      Inline::Underline(inner) => out.push_str(&format!("\\underline{{{}}}", latex_inline(inner))),
      Inline::Code(text) => out.push_str(&format!("\\texttt{{{}}}", tex_escape(text))),
      Inline::Math(tex) => out.push_str(&format!("${}$", tex.trim())),
      Inline::Link { href, content, .. } => {
        out.push_str(&format!(
          "\\href{{{}}}{{{}}}",
          tex_escape(href),
          latex_inline(content)
        ));
      }
      Inline::Image { src, alt, .. } => {
        out.push_str(&format!("\\includegraphics{{{}}}", tex_escape(src)));
        if !alt.is_empty() {
          out.push_str(&format!("\\emph{{{}}}", tex_escape(alt)));
        }
      }
      Inline::SoftBreak => out.push('\n'),
      Inline::HardBreak => out.push_str("\\\\\n"),
      Inline::Raw(text) => out.push_str(text),
    }
  }
  out
}

fn latex_list(ordered: bool, start: u64, items: &[Vec<Block>], depth: usize) -> String {
  let (open, close) = if ordered {
    ("\\begin{enumerate}", "\\end{enumerate}")
  } else {
    ("\\begin{itemize}", "\\end{itemize}")
  };
  let mut out = String::from(open);
  out.push('\n');
  let first = start.max(1);
  if ordered && first != 1 {
    let counter = ["enumi", "enumii", "enumiii", "enumiv"][depth.min(3)];
    out.push_str(&format!("\\setcounter{{{counter}}}{{{}}}\n", first - 1));
  }
  for item in items {
    out.push_str("\\item ");
    out.push_str(&latex_item(item, depth + 1));
    out.push('\n');
  }
  out.push_str(close);
  out
}

fn latex_item(blocks: &[Block], depth: usize) -> String {
  let rendered: Vec<String> = blocks
    .iter()
    .map(|block| latex_block(block, depth))
    .filter(|text| !text.is_empty())
    .collect();
  rendered.join("\n")
}

fn latex_table(header: &[Vec<Inline>], rows: &[Vec<Vec<Inline>>], align: &[Align]) -> String {
  let columns = header.len().max(rows.iter().map(Vec::len).max().unwrap_or(0));
  if columns == 0 {
    return String::new();
  }
  let spec: String = (0..columns)
    .map(|index| match align.get(index).copied().unwrap_or_default() {
      Align::None | Align::Left => "l|",
      Align::Center => "c|",
      Align::Right => "r|",
    })
    .collect();
  let mut out = format!("\\begin{{tabular}}{{|{spec}}}\n\\hline\n");
  out.push_str(&latex_row(header, columns));
  out.push_str(" \\\\\n\\hline\n");
  for row in rows {
    out.push_str(&latex_row(row, columns));
    out.push_str(" \\\\\n\\hline\n");
  }
  out.push_str("\\end{tabular}");
  out
}

fn latex_row(cells: &[Vec<Inline>], columns: usize) -> String {
  let mut parts: Vec<String> = Vec::with_capacity(columns);
  for index in 0..columns {
    parts.push(cells.get(index).map_or_else(String::new, |cell| latex_inline(cell)));
  }
  parts.join(" & ")
}

fn tex_escape(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  for ch in text.chars() {
    match ch {
      '\\' => out.push_str("\\textbackslash{}"),
      '&' => out.push_str("\\&"),
      '%' => out.push_str("\\%"),
      '$' => out.push_str("\\$"),
      '#' => out.push_str("\\#"),
      '_' => out.push_str("\\_"),
      '{' => out.push_str("\\{"),
      '}' => out.push_str("\\}"),
      '~' => out.push_str("\\textasciitilde{}"),
      '^' => out.push_str("\\textasciicircum{}"),
      '<' => out.push_str("\\textless{}"),
      '>' => out.push_str("\\textgreater{}"),
      '|' => out.push_str("\\textbar{}"),
      _ => out.push(ch),
    }
  }
  out
}
