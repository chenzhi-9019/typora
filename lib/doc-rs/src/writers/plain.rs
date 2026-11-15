//! Markdown and HTML writers.
//!
//! Both target the Typora DOM contract used by the renderer
//! (`src/renderer/src/editor/markdown-renderer.ts`): block classes such as
//! `md-fences`, `md-task-list-item`, `md-table`, `md-math-block` and
//! `md-inline-math` mirror the editor's own markup.

use crate::model::{Align, Block, Document, Inline};

/* --------------------------------------------------------------- markdown -- */

pub fn markdown(document: &Document) -> String {
  let mut out = String::new();
  if !document.meta.is_empty() {
    out.push_str("---\n");
    for (key, value) in &document.meta {
      out.push_str(key.trim());
      out.push_str(": ");
      out.push_str(&yaml_scalar(value));
      out.push('\n');
    }
    out.push_str("---\n\n");
  }
  out.push_str(&md_blocks(&document.blocks));
  if !out.is_empty() && !out.ends_with('\n') {
    out.push('\n');
  }
  out
}

/// Renders a block sequence, dropping blocks that render to nothing.
fn md_blocks(blocks: &[Block]) -> String {
  let rendered: Vec<String> = blocks
    .iter()
    .map(md_block)
    .filter(|text| !text.is_empty())
    .collect();
  rendered.join("\n\n")
}

fn md_block(block: &Block) -> String {
  match block {
    Block::Paragraph(inlines) => match inlines.as_slice() {
      [Inline::Math(tex)] => md_math_block(tex),
      _ => md_escape_line_starts(&md_inline(inlines)),
    },
    Block::Heading { level, content } => {
      let level = usize::from((*level).clamp(1, 6));
      let mut out = "#".repeat(level);
      let title = md_inline(content);
      if !title.is_empty() {
        out.push(' ');
        out.push_str(&title);
      }
      out
    }
    Block::CodeBlock { language, text } => match language.as_deref() {
      Some(lang) if md_is_math_language(lang) => md_math_block(text),
      _ => md_fence(language.as_deref(), text),
    },
    Block::Quote(inner) => md_quote(&md_blocks(inner)),
    Block::List {
      ordered,
      start,
      items,
    } => md_list(*ordered, *start, items),
    Block::Table {
      header,
      align,
      rows,
    } => md_table(header, align, rows),
    Block::Rule => "---".to_string(),
    Block::Raw(text) => text.clone(),
  }
}

fn md_math_block(tex: &str) -> String {
  format!("$$\n{}\n$$", tex.trim())
}

fn md_is_math_language(language: &str) -> bool {
  matches!(
    language.trim().to_ascii_lowercase().as_str(),
    "math" | "latex" | "katex" | "tex"
  )
}

fn md_fence(language: Option<&str>, text: &str) -> String {
  let fence = "`".repeat(longest_run(text, '`').max(2) + 1);
  let mut out = String::new();
  out.push_str(&fence);
  if let Some(lang) = language {
    let lang = lang.trim();
    if !lang.is_empty() {
      out.push_str(lang);
    }
  }
  out.push('\n');
  out.push_str(text);
  if !text.ends_with('\n') {
    out.push('\n');
  }
  out.push_str(&fence);
  out
}

fn md_quote(text: &str) -> String {
  let mut out = String::new();
  for (index, line) in text.split('\n').enumerate() {
    if index > 0 {
      out.push('\n');
    }
    if line.is_empty() {
      out.push('>');
    } else {
      out.push_str("> ");
      out.push_str(line);
    }
  }
  out
}

fn md_list(ordered: bool, start: u64, items: &[Vec<Block>]) -> String {
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
    out.push_str(&prefix_lines(&md_list_item(item), &marker, &indent));
  }
  out
}

fn md_list_item(blocks: &[Block]) -> String {
  let mut out = String::new();
  let mut writable = false;
  for (index, block) in blocks.iter().enumerate() {
    let rendered = match block {
      Block::Paragraph(inlines) if index == 0 => match task_marker(inlines) {
        Some((checked, rest)) => {
          let mut text = String::from(if checked { "[x] " } else { "[ ] " });
          text.push_str(&md_escape_line_starts(&md_inline(&rest)));
          text
        }
        None => md_block(block),
      },
      other => md_block(other),
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

fn md_table(header: &[Vec<Inline>], align: &[Align], rows: &[Vec<Vec<Inline>>]) -> String {
  let columns = header.len().max(rows.iter().map(Vec::len).max().unwrap_or(0));
  if columns == 0 {
    return String::new();
  }
  let mut grid: Vec<Vec<String>> = Vec::with_capacity(rows.len() + 1);
  grid.push(md_cells(header, columns));
  for row in rows {
    grid.push(md_cells(row, columns));
  }
  let mut widths = vec![3usize; columns];
  for row in &grid {
    for (index, cell) in row.iter().enumerate() {
      widths[index] = widths[index].max(cell.chars().count());
    }
  }
  let mut lines: Vec<String> = Vec::with_capacity(grid.len() + 1);
  lines.push(md_table_row(&grid[0], &widths));
  lines.push(md_table_divider(align, &widths));
  for row in &grid[1..] {
    lines.push(md_table_row(row, &widths));
  }
  lines.join("\n")
}

fn md_cells(cells: &[Vec<Inline>], columns: usize) -> Vec<String> {
  let mut out: Vec<String> = cells.iter().map(|cell| md_inline(cell)).collect();
  out.truncate(columns);
  while out.len() < columns {
    out.push(String::new());
  }
  out
}

fn md_table_row(cells: &[String], widths: &[usize]) -> String {
  let mut out = String::new();
  for (cell, width) in cells.iter().zip(widths) {
    out.push_str("| ");
    out.push_str(cell);
    out.push_str(&" ".repeat(width.saturating_sub(cell.chars().count())));
    out.push(' ');
  }
  out.push('|');
  out
}

fn md_table_divider(align: &[Align], widths: &[usize]) -> String {
  let mut out = String::new();
  for (index, width) in widths.iter().copied().enumerate() {
    out.push_str("| ");
    match align.get(index).copied().unwrap_or_default() {
      Align::None => out.push_str(&"-".repeat(width)),
      Align::Left => {
        out.push(':');
        out.push_str(&"-".repeat(width - 1));
      }
      Align::Center => {
        out.push(':');
        out.push_str(&"-".repeat(width - 2));
        out.push(':');
      }
      Align::Right => {
        out.push_str(&"-".repeat(width - 1));
        out.push(':');
      }
    }
    out.push(' ');
  }
  out.push('|');
  out
}

fn md_inline(inlines: &[Inline]) -> String {
  let mut out = String::new();
  for inline in inlines {
    match inline {
      Inline::Text(text) => out.push_str(&md_escape_text(text)),
      Inline::Strong(inner) => md_wrap(&mut out, inner, "**", "**"),
      Inline::Emphasis(inner) => md_wrap(&mut out, inner, "*", "*"),
      Inline::Strike(inner) => md_wrap(&mut out, inner, "~~", "~~"),
      Inline::Underline(inner) => md_wrap(&mut out, inner, "<u>", "</u>"),
      Inline::Code(text) => {
        let fence = "`".repeat(longest_run(text, '`') + 1);
        let padded = text.starts_with('`')
          || text.ends_with('`')
          || (text.starts_with(' ') && text.ends_with(' '));
        out.push_str(&fence);
        if padded {
          out.push(' ');
        }
        out.push_str(text);
        if padded {
          out.push(' ');
        }
        out.push_str(&fence);
      }
      Inline::Math(tex) => {
        out.push('$');
        out.push_str(tex.trim());
        out.push('$');
      }
      Inline::Link {
        href,
        title,
        content,
      } => {
        out.push('[');
        out.push_str(&md_inline(content));
        out.push_str("](");
        out.push_str(&md_link_target(href));
        if let Some(title) = title {
          out.push_str(" \"");
          out.push_str(&title.replace('"', "\\\""));
          out.push('"');
        }
        out.push(')');
      }
      Inline::Image { src, alt, title } => {
        out.push_str("![");
        out.push_str(&md_escape_text(alt));
        out.push_str("](");
        out.push_str(&md_link_target(src));
        if let Some(title) = title {
          out.push_str(" \"");
          out.push_str(&title.replace('"', "\\\""));
          out.push('"');
        }
        out.push(')');
      }
      Inline::SoftBreak => out.push('\n'),
      Inline::HardBreak => out.push_str("\\\n"),
      Inline::Raw(text) => out.push_str(text),
    }
  }
  out
}

fn md_wrap(out: &mut String, inner: &[Inline], open: &str, close: &str) {
  if inner.is_empty() {
    return;
  }
  out.push_str(open);
  out.push_str(&md_inline(inner));
  out.push_str(close);
}

fn md_link_target(target: &str) -> String {
  let needs_brackets = target.is_empty()
    || target
      .chars()
      .any(|ch| ch.is_whitespace() || matches!(ch, '(' | ')' | '<' | '>'));
  if needs_brackets {
    format!("<{target}>")
  } else {
    target.to_string()
  }
}

/// Escapes the characters that would otherwise start inline markup. Deliberately
/// narrow: punctuation with no meaning in Markdown stays untouched.
fn md_escape_text(text: &str) -> String {
  let chars: Vec<char> = text.chars().collect();
  let mut out = String::with_capacity(text.len());
  for (index, ch) in chars.iter().enumerate() {
    match ch {
      '\\' | '`' | '*' | '[' | ']' | '|' | '<' => {
        out.push('\\');
        out.push(*ch);
      }
      '_' => {
        let prev = index.checked_sub(1).map(|i| chars[i]);
        let next = chars.get(index + 1).copied();
        let opens =
          prev.is_none_or(|ch| !ch.is_alphanumeric()) && next.is_some_and(|ch| !ch.is_whitespace());
        let closes = prev.is_some_and(|ch| !ch.is_whitespace())
          && next.is_none_or(|ch| !ch.is_alphanumeric());
        if opens || closes {
          out.push('\\');
        }
        out.push('_');
      }
      '~' => {
        let prev = index.checked_sub(1).map(|i| chars[i]);
        let next = chars.get(index + 1).copied();
        if prev == Some('~') || next == Some('~') {
          out.push('\\');
        }
        out.push('~');
      }
      _ => out.push(*ch),
    }
  }
  out
}

/// Neutralises Markdown block markers that only matter at the start of a line.
fn md_escape_line_starts(text: &str) -> String {
  let lines: Vec<String> = text.split('\n').map(md_escape_line_start).collect();
  lines.join("\n")
}

fn md_escape_line_start(line: &str) -> String {
  if matches!(line.chars().next(), Some('#' | '>' | '=')) {
    return format!("\\{line}");
  }
  if line == "-" || line.starts_with("- ") || line.starts_with("+ ") {
    return format!("\\{line}");
  }
  let digits = line.bytes().take_while(u8::is_ascii_digit).count();
  if digits > 0 && digits < line.len() {
    let marker = line.as_bytes()[digits];
    let after_marker = digits + 1;
    let terminated = after_marker == line.len() || line.as_bytes()[after_marker] == b' ';
    if matches!(marker, b'.' | b')') && terminated {
      return format!("{}\\{}", &line[..digits], &line[digits..]);
    }
  }
  line.to_string()
}

fn yaml_scalar(value: &str) -> String {
  let has_special = value.chars().any(|ch| {
    matches!(
      ch,
      ':' | '#'
        | '"'
        | '\''
        | '['
        | ']'
        | '{'
        | '}'
        | '&'
        | '*'
        | '!'
        | '|'
        | '>'
        | '@'
        | '`'
        | '%'
        | ','
        | '\n'
        | '\t'
    )
  });
  let plain = !value.is_empty()
    && value.trim() == value
    && !has_special
    && !matches!(value, "true" | "false" | "null" | "~")
    && value.parse::<f64>().is_err();
  if plain {
    return value.to_string();
  }
  let escaped = value
    .replace('\\', "\\\\")
    .replace('"', "\\\"")
    .replace('\n', "\\n");
  format!("\"{escaped}\"")
}

/* ------------------------------------------------------------------- html -- */

pub fn html(document: &Document) -> String {
  let body = html_blocks(&document.blocks);
  if body.is_empty() {
    String::new()
  } else {
    format!("{body}\n")
  }
}

fn html_blocks(blocks: &[Block]) -> String {
  let rendered: Vec<String> = blocks
    .iter()
    .map(html_block)
    .filter(|text| !text.is_empty())
    .collect();
  rendered.join("\n")
}

fn html_block(block: &Block) -> String {
  match block {
    Block::Paragraph(inlines) => match inlines.as_slice() {
      [Inline::Math(tex)] => html_math_block(tex),
      _ => format!("<p class=\"md-end-block md-p\">{}</p>", html_inline(inlines)),
    },
    Block::Heading { level, content } => {
      let level = (*level).clamp(1, 6);
      format!(
        "<h{level} class=\"md-end-block\">{}</h{level}>",
        html_inline(content)
      )
    }
    Block::CodeBlock { language, text } => match language.as_deref() {
      Some(lang) if md_is_math_language(lang) => html_math_block(text),
      _ => html_fence(language.as_deref(), text),
    },
    Block::Quote(inner) => {
      let body = html_blocks(inner);
      if body.is_empty() {
        String::new()
      } else {
        format!("<blockquote class=\"md-end-block\">\n{body}\n</blockquote>")
      }
    }
    Block::List {
      ordered,
      start,
      items,
    } => html_list(*ordered, *start, items),
    Block::Table {
      header,
      align,
      rows,
    } => html_table(header, align, rows),
    Block::Rule => "<hr class=\"md-hr md-end-block\">".to_string(),
    Block::Raw(text) => text.clone(),
  }
}

fn html_math_block(tex: &str) -> String {
  let tex = tex.trim();
  format!(
    "<div class=\"md-math-block md-end-block\" contenteditable=\"false\" data-math=\"{}\">{}</div>",
    html_attr(tex),
    html_escape(tex)
  )
}

fn html_fence(language: Option<&str>, text: &str) -> String {
  let lang = language.map(str::trim).unwrap_or("").to_ascii_lowercase();
  let body = html_escape(text);
  if lang.is_empty() {
    format!("<pre class=\"md-fences md-end-block\"><code class=\"hljs\">{body}</code></pre>")
  } else {
    format!(
      "<pre class=\"md-fences md-end-block\" lang=\"{}\"><code class=\"language-{} hljs\">{body}</code></pre>",
      html_attr(&lang),
      html_attr(&lang)
    )
  }
}

fn html_list(ordered: bool, start: u64, items: &[Vec<Block>]) -> String {
  let first = start.max(1);
  let mut out = String::new();
  if ordered {
    if first == 1 {
      out.push_str("<ol class=\"ol-list\">\n");
    } else {
      out.push_str(&format!("<ol class=\"ol-list\" start=\"{first}\">\n"));
    }
  } else {
    out.push_str("<ul class=\"ul-list\" data-mark=\"-\">\n");
  }
  for item in items {
    out.push_str(&html_list_item(item));
    out.push('\n');
  }
  out.push_str(if ordered { "</ol>" } else { "</ul>" });
  out
}

fn html_list_item(blocks: &[Block]) -> String {
  let mut class = String::from("md-list-item");
  let mut parts: Vec<String> = Vec::new();
  let mut used = 0;
  if let Some(Block::Paragraph(inlines)) = blocks.first() {
    if let Some((checked, rest)) = task_marker(inlines) {
      class.push_str(" task-list-item md-task-list-item ");
      class.push_str(if checked {
        "task-list-done"
      } else {
        "task-list-not-done"
      });
      let mut head = String::from("<input type=\"checkbox\" class=\"task-list-item-checkbox\"");
      if checked {
        head.push_str(" checked");
      }
      head.push('>');
      head.push_str(&html_inline(&rest));
      parts.push(head);
      used = 1;
    }
  }
  for block in &blocks[used..] {
    // a leading paragraph stays bare so the item matches Typora's tight list DOM
    let rendered = match block {
      Block::Paragraph(inlines) if parts.is_empty() => html_inline(inlines),
      other => html_block(other),
    };
    if !rendered.is_empty() {
      parts.push(rendered);
    }
  }
  format!("<li class=\"{class}\">{}</li>", parts.join("\n"))
}

fn html_table(header: &[Vec<Inline>], align: &[Align], rows: &[Vec<Vec<Inline>>]) -> String {
  let columns = header.len().max(rows.iter().map(Vec::len).max().unwrap_or(0));
  if columns == 0 {
    return String::new();
  }
  let mut out = String::from("<div class=\"md-table md-table-fig md-end-block\">\n");
  out.push_str("<table class=\"md-table\">\n");
  out.push_str("<thead>\n<tr>");
  for index in 0..columns {
    let cell = header.get(index).map_or_else(String::new, |cell| html_inline(cell));
    out.push_str(&format!(
      "<th{}>{cell}</th>",
      html_align(align.get(index).copied().unwrap_or_default())
    ));
  }
  out.push_str("</tr>\n</thead>\n");
  if !rows.is_empty() {
    out.push_str("<tbody>\n");
    for row in rows {
      out.push_str("<tr>");
      for index in 0..columns {
        let cell = row.get(index).map_or_else(String::new, |cell| html_inline(cell));
        out.push_str(&format!(
          "<td{}>{cell}</td>",
          html_align(align.get(index).copied().unwrap_or_default())
        ));
      }
      out.push_str("</tr>\n");
    }
    out.push_str("</tbody>\n");
  }
  out.push_str("</table>\n</div>");
  out
}

fn html_align(align: Align) -> String {
  let name = match align {
    Align::None => return String::new(),
    Align::Left => "left",
    Align::Center => "center",
    Align::Right => "right",
  };
  format!(" align=\"{name}\" style=\"text-align: {name}\"")
}

fn html_inline(inlines: &[Inline]) -> String {
  let mut out = String::new();
  for inline in inlines {
    match inline {
      Inline::Text(text) => out.push_str(&html_escape(text)),
      Inline::Strong(inner) => html_wrap(&mut out, inner, "<strong>", "</strong>"),
      Inline::Emphasis(inner) => html_wrap(&mut out, inner, "<em>", "</em>"),
      Inline::Strike(inner) => html_wrap(&mut out, inner, "<del>", "</del>"),
      Inline::Underline(inner) => html_wrap(&mut out, inner, "<u>", "</u>"),
      Inline::Code(text) => {
        out.push_str("<code>");
        out.push_str(&html_escape(text));
        out.push_str("</code>");
      }
      Inline::Math(tex) => {
        let tex = tex.trim();
        out.push_str("<span class=\"md-inline-math\" data-math=\"");
        out.push_str(&html_attr(tex));
        out.push_str("\">");
        out.push_str(&html_escape(tex));
        out.push_str("</span>");
      }
      Inline::Link {
        href,
        title,
        content,
      } => {
        out.push_str("<a href=\"");
        out.push_str(&html_attr(href));
        out.push('"');
        if let Some(title) = title {
          out.push_str(" title=\"");
          out.push_str(&html_attr(title));
          out.push('"');
        }
        out.push('>');
        out.push_str(&html_inline(content));
        out.push_str("</a>");
      }
      Inline::Image { src, alt, title } => {
        out.push_str("<img src=\"");
        out.push_str(&html_attr(src));
        out.push_str("\" alt=\"");
        out.push_str(&html_attr(alt));
        out.push('"');
        if let Some(title) = title {
          out.push_str(" title=\"");
          out.push_str(&html_attr(title));
          out.push('"');
        }
        out.push('>');
      }
      Inline::SoftBreak => out.push_str("<br class=\"md-softbreak\">"),
      Inline::HardBreak => out.push_str("<br>"),
      Inline::Raw(text) => out.push_str(text),
    }
  }
  out
}

fn html_wrap(out: &mut String, inner: &[Inline], open: &str, close: &str) {
  if inner.is_empty() {
    return;
  }
  out.push_str(open);
  out.push_str(&html_inline(inner));
  out.push_str(close);
}

fn html_escape(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  for ch in text.chars() {
    match ch {
      '&' => out.push_str("&amp;"),
      '<' => out.push_str("&lt;"),
      '>' => out.push_str("&gt;"),
      '"' => out.push_str("&quot;"),
      _ => out.push(ch),
    }
  }
  out
}

fn html_attr(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  for ch in text.chars() {
    match ch {
      '&' => out.push_str("&amp;"),
      '<' => out.push_str("&lt;"),
      '>' => out.push_str("&gt;"),
      '"' => out.push_str("&quot;"),
      '\'' => out.push_str("&#39;"),
      '\n' => out.push_str("&#10;"),
      _ => out.push(ch),
    }
  }
  out
}

/* ---------------------------------------------------------------- helpers -- */

/// Detects a GFM task marker (`[ ]` / `[x]`) at the head of a list item.
fn task_marker(inlines: &[Inline]) -> Option<(bool, Vec<Inline>)> {
  let Inline::Text(text) = inlines.first()? else {
    return None;
  };
  let mut chars = text.chars();
  if chars.next() != Some('[') {
    return None;
  }
  let checked = match chars.next()? {
    ' ' => false,
    'x' | 'X' => true,
    _ => return None,
  };
  if chars.next() != Some(']') {
    return None;
  }
  let after = chars.as_str();
  if after.chars().next().is_some_and(|ch| !ch.is_whitespace()) {
    return None;
  }
  let rest = after.trim_start();
  let mut out: Vec<Inline> = Vec::new();
  if !rest.is_empty() {
    out.push(Inline::Text(rest.to_string()));
  }
  out.extend(inlines.iter().skip(1).cloned());
  Some((checked, out))
}

fn longest_run(text: &str, needle: char) -> usize {
  let mut longest = 0;
  let mut current = 0;
  for ch in text.chars() {
    if ch == needle {
      current += 1;
      longest = longest.max(current);
    } else {
      current = 0;
    }
  }
  longest
}

/// Prefixes the first line with `first` and every following line with `rest`.
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
