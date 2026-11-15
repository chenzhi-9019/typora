//! HTML reader: a small, fault tolerant tag scanner. Deliberately avoids
//! html5ever so the crate keeps compiling in a couple of seconds.
//!
//! The parser builds a light tree and then renders it into the shared model.
//! epub reuses the rendering half through the pub(crate) helpers below.

use crate::model::{Align, Block, Document, Inline};
use crate::ConvertError;

pub fn read(input: &[u8]) -> Result<Document, ConvertError> {
  let source = decode_source(input);
  let root = parse(&source);
  let mut meta = Vec::new();
  collect_meta(&root, &mut meta);
  Ok(Document {
    meta,
    blocks: blocks_of(&root.children),
  })
}

/// Renders one HTML/XHTML fragment into blocks; used by the epub reader.
pub(crate) fn blocks_from_html(input: &[u8]) -> Vec<Block> {
  let source = decode_source(input);
  let root = parse(&source);
  blocks_of(&root.children)
}

/// Lossy UTF-8 decode that strips a BOM.
pub(crate) fn decode_source(input: &[u8]) -> String {
  let bytes = input.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(input);
  String::from_utf8_lossy(bytes).into_owned()
}

// ---------------------------------------------------------------------------
// tree
// ---------------------------------------------------------------------------

enum Node {
  Text(String),
  Element(Element),
}

struct Element {
  name: String,
  attrs: Vec<(String, String)>,
  children: Vec<Node>,
}

impl Element {
  fn new(name: &str) -> Self {
    Self {
      name: name.to_string(),
      attrs: Vec::new(),
      children: Vec::new(),
    }
  }

  fn attr(&self, name: &str) -> Option<&str> {
    self
      .attrs
      .iter()
      .find(|(key, _)| key == name)
      .map(|(_, value)| value.as_str())
  }

  /// Concatenated text of every descendant, whitespace untouched.
  fn text_content(&self, out: &mut String) {
    for child in &self.children {
      match child {
        Node::Text(text) => out.push_str(text),
        Node::Element(element) => element.text_content(out),
      }
    }
  }

  fn find_class(&self, prefixes: &str) -> Option<String> {
    if let Some(class) = self.attr("class") {
      if let Some(found) = class_from(class, prefixes) {
        return Some(found);
      }
    }
    for child in &self.children {
      if let Node::Element(element) = child {
        if let Some(found) = element.find_class(prefixes) {
          return Some(found);
        }
      }
    }
    None
  }
}

fn class_from(class: &str, prefixes: &str) -> Option<String> {
  class.split_whitespace().find_map(|token| {
    let token = token.to_ascii_lowercase();
    for prefix in prefixes.split(' ') {
      if let Some(rest) = token.strip_prefix(prefix) {
        if !rest.is_empty() {
          return Some(rest.to_string());
        }
      }
    }
    None
  })
}

fn is_void(name: &str) -> bool {
  matches!(
    name,
    "area"
      | "base"
      | "br"
      | "col"
      | "embed"
      | "hr"
      | "img"
      | "input"
      | "link"
      | "meta"
      | "param"
      | "source"
      | "track"
      | "wbr"
  )
}

fn is_block(name: &str) -> bool {
  matches!(
    name,
    "address"
      | "article"
      | "aside"
      | "blockquote"
      | "div"
      | "dl"
      | "fieldset"
      | "figcaption"
      | "figure"
      | "footer"
      | "form"
      | "h1"
      | "h2"
      | "h3"
      | "h4"
      | "h5"
      | "h6"
      | "header"
      | "hr"
      | "li"
      | "main"
      | "nav"
      | "ol"
      | "p"
      | "pre"
      | "section"
      | "table"
      | "ul"
  )
}

// ---------------------------------------------------------------------------
// scanner
// ---------------------------------------------------------------------------

fn parse(source: &str) -> Element {
  let bytes = source.as_bytes();
  let mut stack: Vec<Element> = vec![Element::new("#root")];
  let mut index = 0usize;

  while index < source.len() {
    if bytes[index] != b'<' {
      let end = source[index..]
        .find('<')
        .map(|offset| index + offset)
        .unwrap_or(source.len());
      let text = decode_entities(&source[index..end]);
      if let Some(parent) = stack.last_mut() {
        parent.children.push(Node::Text(text));
      }
      index = end;
      continue;
    }

    let rest = &source[index..];
    if rest.starts_with("<!--") {
      index = skip_to(rest, "-->", index);
      continue;
    }
    if rest.starts_with("<![CDATA[") {
      let body_start = index + 9;
      let close = source[body_start..]
        .find("]]>")
        .map(|offset| body_start + offset)
        .unwrap_or(source.len());
      if let Some(parent) = stack.last_mut() {
        parent
          .children
          .push(Node::Text(source[body_start..close].to_string()));
      }
      index = skip_to(&source[close..], "]]>", close);
      continue;
    }
    if rest.starts_with("<!") || rest.starts_with("<?") {
      index = skip_to(rest, ">", index);
      continue;
    }
    if rest.starts_with("</") {
      let name_start = index + 2;
      let mut cursor = name_start;
      while cursor < bytes.len() && !is_name_end(bytes[cursor]) {
        cursor += 1;
      }
      let name = source[name_start..cursor].to_ascii_lowercase();
      index = skip_to(rest, ">", index);
      while let Some(top) = stack.last() {
        if top.name == "#root" {
          break;
        }
        let matched = top.name == name;
        close_top(&mut stack);
        if matched {
          break;
        }
      }
      continue;
    }

    let Some(tag) = scan_tag(source, index) else {
      if let Some(parent) = stack.last_mut() {
        parent
          .children
          .push(Node::Text(source[index..].to_string()));
      }
      break;
    };
    index = tag.next;

    if let Some(top) = stack.last() {
      if auto_close(&top.name, &tag.name) {
        close_top(&mut stack);
      }
    }

    let element = Element {
      name: tag.name,
      attrs: tag.attrs,
      children: Vec::new(),
    };
    if tag.self_closing || is_void(&element.name) {
      if let Some(parent) = stack.last_mut() {
        parent.children.push(Node::Element(element));
      }
    } else {
      stack.push(element);
    }
  }

  while stack.len() > 1 {
    close_top(&mut stack);
  }
  stack.pop().unwrap_or_else(|| Element::new("#root"))
}

fn is_name_end(byte: u8) -> bool {
  byte.is_ascii_whitespace() || matches!(byte, b'>' | b'/')
}

fn auto_close(open: &str, next: &str) -> bool {
  match open {
    "li" => next == "li",
    "p" => next == "p" || is_block(next),
    "tr" => matches!(next, "tr" | "thead" | "tbody" | "tfoot"),
    "td" | "th" => matches!(next, "td" | "th" | "tr"),
    "thead" | "tbody" => matches!(next, "thead" | "tbody" | "tfoot"),
    "option" => next == "option",
    _ => false,
  }
}

fn close_top(stack: &mut Vec<Element>) {
  if stack.len() < 2 {
    return;
  }
  if let Some(done) = stack.pop() {
    if let Some(parent) = stack.last_mut() {
      parent.children.push(Node::Element(done));
    }
  }
}

fn skip_to(haystack: &str, needle: &str, base: usize) -> usize {
  match haystack.find(needle) {
    Some(offset) => base + offset + needle.len(),
    None => base + haystack.len(),
  }
}

struct Tag {
  name: String,
  attrs: Vec<(String, String)>,
  self_closing: bool,
  /// index just past the closing angle bracket
  next: usize,
}

/// Reads one start tag.
fn scan_tag(source: &str, start: usize) -> Option<Tag> {
  let bytes = source.as_bytes();
  let mut index = start + 1;
  if index >= bytes.len() {
    return None;
  }
  let name_start = index;
  while index < bytes.len() && !is_name_end(bytes[index]) {
    index += 1;
  }
  let name = source[name_start..index].to_ascii_lowercase();
  if name.is_empty() {
    return None;
  }
  let mut attrs: Vec<(String, String)> = Vec::new();
  let mut self_closing = false;

  loop {
    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
      index += 1;
    }
    if index >= bytes.len() {
      return None;
    }
    match bytes[index] {
      b'>' => {
        index += 1;
        break;
      }
      b'/' => {
        index += 1;
        continue;
      }
      _ => {}
    }
    let key_start = index;
    while index < bytes.len()
      && !bytes[index].is_ascii_whitespace()
      && !matches!(bytes[index], b'=' | b'/' | b'>')
    {
      index += 1;
    }
    let key = source[key_start..index].to_ascii_lowercase();
    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
      index += 1;
    }
    let mut value = String::new();
    if index < bytes.len() && bytes[index] == b'=' {
      index += 1;
      while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
      }
      if index < bytes.len() && (bytes[index] == b'"' || bytes[index] == b'\'') {
        let quote = bytes[index];
        index += 1;
        let value_start = index;
        while index < bytes.len() && bytes[index] != quote {
          index += 1;
        }
        value = decode_entities(&source[value_start..index]);
        if index < bytes.len() {
          index += 1;
        }
      } else {
        let value_start = index;
        while index < bytes.len()
          && !bytes[index].is_ascii_whitespace()
          && !matches!(bytes[index], b'>' | b'/')
        {
          index += 1;
        }
        value = decode_entities(&source[value_start..index]);
      }
    }
    if !key.is_empty() && !attrs.iter().any(|(existing, _)| *existing == key) {
      attrs.push((key, value));
    }
  }

  if index > start && bytes[index - 1] == b'>' {
    let mut probe = index - 1;
    while probe > start && bytes[probe - 1].is_ascii_whitespace() {
      probe -= 1;
    }
    if probe > start && bytes[probe - 1] == b'/' {
      self_closing = true;
    }
  }

  Some(Tag {
    name,
    attrs,
    self_closing,
    next: index,
  })
}

// ---------------------------------------------------------------------------
// blocks
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Sink {
  blocks: Vec<Block>,
  pending: Vec<Inline>,
}

impl Sink {
  fn flush(&mut self) {
    if self.pending.is_empty() {
      return;
    }
    let content = normalize(std::mem::take(&mut self.pending));
    if !content.is_empty() {
      self.blocks.push(Block::Paragraph(content));
    }
  }

  fn push_block(&mut self, block: Block) {
    self.flush();
    self.blocks.push(block);
  }

  fn push_inlines(&mut self, inlines: Vec<Inline>) {
    self.pending.extend(inlines);
  }
}

fn blocks_of(nodes: &[Node]) -> Vec<Block> {
  let mut sink = Sink::default();
  walk(nodes, &mut sink);
  sink.flush();
  sink.blocks
}

fn walk(nodes: &[Node], sink: &mut Sink) {
  for node in nodes {
    match node {
      Node::Text(text) => sink.push_inlines(vec![Inline::Text(collapse(text))]),
      Node::Element(element) => walk_element(element, sink),
    }
  }
}

fn walk_element(element: &Element, sink: &mut Sink) {
  match element.name.as_str() {
    "script" | "style" | "head" | "title" | "meta" | "link" | "base" | "noscript" | "template" => {}
    "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
      let level = element.name[1..].parse::<u8>().unwrap_or(1);
      sink.push_block(Block::Heading {
        level,
        content: inlines_of(&element.children),
      });
    }
    "p" => sink.push_block(Block::Paragraph(inlines_of(&element.children))),
    "hr" => sink.push_block(Block::Rule),
    "ul" | "ol" | "menu" | "dir" => sink.push_block(build_list(element)),
    "blockquote" => {
      let inner = blocks_of(&element.children);
      if !inner.is_empty() {
        sink.push_block(Block::Quote(inner));
      }
    }
    "pre" => sink.push_block(build_pre(element)),
    "table" => {
      if let Some(table) = build_table(element) {
        sink.push_block(table);
      }
    }
    "div" | "section" | "article" | "aside" | "header" | "footer" | "main" | "nav" | "figure"
    | "figcaption" | "form" | "fieldset" | "address" | "center" | "details" | "summary" | "html"
    | "body" | "dl" | "dt" | "dd" | "li" | "tr" | "td" | "th" | "thead" | "tbody" | "tfoot"
    | "caption" => walk(&element.children, sink),
    _ => sink.push_inlines(inline_element(element)),
  }
}

fn build_list(element: &Element) -> Block {
  let ordered = element.name == "ol";
  let start = element
    .attr("start")
    .and_then(|value| value.trim().parse::<u64>().ok())
    .unwrap_or(1);
  let mut items: Vec<Vec<Block>> = Vec::new();
  for child in &element.children {
    match child {
      Node::Element(entry) if matches!(entry.name.as_str(), "li" | "dd" | "dt") => {
        let mut blocks = blocks_of(&entry.children);
        if blocks.is_empty() {
          blocks.push(Block::Paragraph(Vec::new()));
        }
        items.push(blocks);
      }
      Node::Text(text) => {
        let text = collapse(text);
        let trimmed = text.trim().to_string();
        if !trimmed.is_empty() {
          items.push(vec![Block::Paragraph(vec![Inline::Text(trimmed)])]);
        }
      }
      _ => {}
    }
  }
  if items.is_empty() {
    items.push(vec![Block::Paragraph(Vec::new())]);
  }
  Block::List {
    ordered,
    start,
    items,
  }
}

fn build_pre(element: &Element) -> Block {
  let language = element
    .attr("class")
    .and_then(|class| class_from(class, "language- lang-"))
    .or_else(|| element.find_class("language- lang-"));
  let mut text = String::new();
  element.text_content(&mut text);
  while text.ends_with('\n') {
    text.pop();
    if text.ends_with('\r') {
      text.pop();
    }
  }
  Block::CodeBlock { language, text }
}

fn build_table(element: &Element) -> Option<Block> {
  let mut rows: Vec<(Vec<Vec<Inline>>, Vec<Align>)> = Vec::new();
  collect_rows(element, &mut rows);
  if rows.is_empty() {
    return None;
  }
  let (header, aligns) = rows.remove(0);
  let mut align = aligns;
  align.resize(header.len(), Align::None);
  let body: Vec<Vec<Vec<Inline>>> = rows.into_iter().map(|(cells, _)| cells).collect();
  Some(Block::Table {
    header,
    align,
    rows: body,
  })
}

fn collect_rows(element: &Element, rows: &mut Vec<(Vec<Vec<Inline>>, Vec<Align>)>) {
  for child in &element.children {
    let Node::Element(entry) = child else {
      continue;
    };
    match entry.name.as_str() {
      "tr" => {
        let mut cells: Vec<Vec<Inline>> = Vec::new();
        let mut aligns: Vec<Align> = Vec::new();
        for cell in &entry.children {
          let Node::Element(cell) = cell else { continue };
          if matches!(cell.name.as_str(), "td" | "th") {
            cells.push(inlines_of(&cell.children));
            aligns.push(align_of(cell));
          }
        }
        if !cells.is_empty() {
          rows.push((cells, aligns));
        }
      }
      "thead" | "tbody" | "tfoot" => collect_rows(entry, rows),
      _ => {}
    }
  }
}

fn align_of(element: &Element) -> Align {
  if let Some(value) = element.attr("align") {
    return match value.trim().to_ascii_lowercase().as_str() {
      "left" | "start" => Align::Left,
      "center" => Align::Center,
      "right" | "end" => Align::Right,
      _ => Align::None,
    };
  }
  element
    .attr("style")
    .and_then(align_from_style)
    .unwrap_or(Align::None)
}

fn align_from_style(style: &str) -> Option<Align> {
  let lower = style.to_ascii_lowercase();
  let start = lower.find("text-align")?;
  let rest = &lower[start + "text-align".len()..];
  let value = rest.split([':', ';']).nth(1)?.trim().to_string();
  match value.as_str() {
    "left" | "start" => Some(Align::Left),
    "center" => Some(Align::Center),
    "right" | "end" => Some(Align::Right),
    _ => None,
  }
}

// ---------------------------------------------------------------------------
// inlines
// ---------------------------------------------------------------------------

fn inlines_of(nodes: &[Node]) -> Vec<Inline> {
  let mut out = Vec::new();
  for node in nodes {
    match node {
      Node::Text(text) => out.push(Inline::Text(collapse(text))),
      Node::Element(element) => out.extend(inline_element(element)),
    }
  }
  normalize(out)
}

fn inline_element(element: &Element) -> Vec<Inline> {
  match element.name.as_str() {
    "br" => vec![Inline::HardBreak],
    "img" => vec![Inline::Image {
      src: element
        .attr("src")
        .or_else(|| element.attr("data-src"))
        .unwrap_or("")
        .to_string(),
      alt: element.attr("alt").unwrap_or("").to_string(),
      title: element.attr("title").map(|value| value.to_string()),
    }],
    "a" => {
      let href = element
        .attr("href")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| element.attr("name").map(|value| format!("#{}", value)));
      let content = inlines_of(&element.children);
      match href {
        Some(href) => vec![Inline::Link {
          href,
          title: element.attr("title").map(|value| value.to_string()),
          content,
        }],
        None => content,
      }
    }
    "strong" | "b" => vec![Inline::Strong(inlines_of(&element.children))],
    "em" | "i" | "cite" | "dfn" => vec![Inline::Emphasis(inlines_of(&element.children))],
    "u" | "ins" => vec![Inline::Underline(inlines_of(&element.children))],
    "s" | "del" | "strike" => vec![Inline::Strike(inlines_of(&element.children))],
    "code" | "tt" | "kbd" | "samp" => {
      let mut text = String::new();
      element.text_content(&mut text);
      if text.is_empty() {
        Vec::new()
      } else {
        vec![Inline::Code(text)]
      }
    }
    "math" => {
      let mut text = String::new();
      element.text_content(&mut text);
      if text.is_empty() {
        Vec::new()
      } else {
        vec![Inline::Math(text)]
      }
    }
    "script" | "style" | "meta" | "link" | "title" | "base" => Vec::new(),
    _ => inlines_of(&element.children),
  }
}

fn normalize(inlines: Vec<Inline>) -> Vec<Inline> {
  let mut out: Vec<Inline> = Vec::with_capacity(inlines.len());
  for inline in inlines {
    match inline {
      Inline::Text(text) => {
        if text.is_empty() {
          continue;
        }
        match out.last_mut() {
          Some(Inline::Text(previous)) => previous.push_str(&text),
          _ => out.push(Inline::Text(text)),
        }
      }
      Inline::Strong(inner) => {
        let inner = normalize(inner);
        if !inner.is_empty() {
          out.push(Inline::Strong(inner));
        }
      }
      Inline::Emphasis(inner) => {
        let inner = normalize(inner);
        if !inner.is_empty() {
          out.push(Inline::Emphasis(inner));
        }
      }
      Inline::Strike(inner) => {
        let inner = normalize(inner);
        if !inner.is_empty() {
          out.push(Inline::Strike(inner));
        }
      }
      Inline::Underline(inner) => {
        let inner = normalize(inner);
        if !inner.is_empty() {
          out.push(Inline::Underline(inner));
        }
      }
      Inline::Link {
        href,
        title,
        content,
      } => {
        let content = normalize(content);
        if !content.is_empty() {
          out.push(Inline::Link {
            href,
            title,
            content,
          });
        }
      }
      other => out.push(other),
    }
  }
  trim_start(&mut out);
  trim_end(&mut out);
  out
}

enum Action {
  Stop,
  Remove,
}

fn trim_start(inlines: &mut Vec<Inline>) {
  loop {
    if inlines.is_empty() {
      return;
    }
    let action = {
      let first = &mut inlines[0];
      match first {
        Inline::Text(text) => {
          let trimmed = text.trim_start_matches(is_blank).to_string();
          *text = trimmed;
          if text.is_empty() {
            Action::Remove
          } else {
            Action::Stop
          }
        }
        Inline::Strong(inner) => desc_trim_start(inner),
        Inline::Emphasis(inner) => desc_trim_start(inner),
        Inline::Strike(inner) => desc_trim_start(inner),
        Inline::Underline(inner) => desc_trim_start(inner),
        Inline::Link { content, .. } => desc_trim_start(content),
        _ => Action::Stop,
      }
    };
    match action {
      Action::Remove => {
        inlines.remove(0);
      }
      Action::Stop => return,
    }
  }
}

fn desc_trim_start(inner: &mut Vec<Inline>) -> Action {
  trim_start(inner);
  if inner.is_empty() {
    Action::Remove
  } else {
    Action::Stop
  }
}

fn trim_end(inlines: &mut Vec<Inline>) {
  loop {
    if inlines.is_empty() {
      return;
    }
    let last_index = inlines.len() - 1;
    let action = {
      let last = &mut inlines[last_index];
      match last {
        Inline::Text(text) => {
          let trimmed = text.trim_end_matches(is_blank).to_string();
          *text = trimmed;
          if text.is_empty() {
            Action::Remove
          } else {
            Action::Stop
          }
        }
        Inline::Strong(inner) => desc_trim_end(inner),
        Inline::Emphasis(inner) => desc_trim_end(inner),
        Inline::Strike(inner) => desc_trim_end(inner),
        Inline::Underline(inner) => desc_trim_end(inner),
        Inline::Link { content, .. } => desc_trim_end(content),
        _ => Action::Stop,
      }
    };
    match action {
      Action::Remove => {
        inlines.pop();
      }
      Action::Stop => return,
    }
  }
}

fn desc_trim_end(inner: &mut Vec<Inline>) -> Action {
  trim_end(inner);
  if inner.is_empty() {
    Action::Remove
  } else {
    Action::Stop
  }
}

fn is_blank(ch: char) -> bool {
  matches!(ch, ' ' | '\t' | '\r' | '\n')
}

/// Collapses ASCII whitespace runs into single spaces.
fn collapse(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  let mut spaced = false;
  for ch in text.chars() {
    if is_blank(ch) {
      if !spaced {
        out.push(' ');
        spaced = true;
      }
    } else {
      out.push(ch);
      spaced = false;
    }
  }
  out
}

// ---------------------------------------------------------------------------
// metadata + entities
// ---------------------------------------------------------------------------

fn collect_meta(element: &Element, meta: &mut Vec<(String, String)>) {
  if element.name == "title" {
    let mut text = String::new();
    element.text_content(&mut text);
    push_meta(meta, "title", &text);
    return;
  }
  if element.name == "meta" {
    let key = element.attr("name").or_else(|| element.attr("property"));
    if let (Some(key), Some(content)) = (key, element.attr("content")) {
      let lowered = key.trim().to_ascii_lowercase();
      let key = lowered.strip_prefix("og:").unwrap_or(&lowered).to_string();
      push_meta(meta, &key, content);
    }
  }
  for child in &element.children {
    if let Node::Element(child) = child {
      collect_meta(child, meta);
    }
  }
}

fn push_meta(meta: &mut Vec<(String, String)>, key: &str, value: &str) {
  let value = value.trim();
  if key.is_empty() || value.is_empty() {
    return;
  }
  if meta.iter().any(|(existing, _)| existing == key) {
    return;
  }
  meta.push((key.to_string(), value.to_string()));
}

/// Decodes the common HTML entities plus numeric references.
pub(crate) fn decode_entities(input: &str) -> String {
  if !input.contains('&') {
    return input.to_string();
  }
  let mut out = String::with_capacity(input.len());
  let mut index = 0usize;
  while index < input.len() {
    let rest = &input[index..];
    if let Some(semi) = rest.find(';') {
      if (2..=12).contains(&semi) && rest.starts_with('&') {
        if let Some(ch) = entity_char(&rest[1..semi]) {
          out.push(ch);
          index += semi + 1;
          continue;
        }
      }
    }
    match rest.chars().next() {
      Some(ch) => {
        out.push(ch);
        index += ch.len_utf8();
      }
      None => break,
    }
  }
  out
}

fn entity_char(body: &str) -> Option<char> {
  if let Some(number) = body.strip_prefix('#') {
    let code = if let Some(hex) = number.strip_prefix(['x', 'X']) {
      u32::from_str_radix(hex, 16).ok()?
    } else {
      number.parse::<u32>().ok()?
    };
    return char::from_u32(code);
  }
  let ch = match body {
    "amp" => '&',
    "lt" => '<',
    "gt" => '>',
    "quot" => '"',
    "apos" => '\'',
    "nbsp" => '\u{00A0}',
    "ensp" => '\u{2002}',
    "emsp" => '\u{2003}',
    "thinsp" => '\u{2009}',
    "shy" => '\u{00AD}',
    "mdash" => '\u{2014}',
    "ndash" => '\u{2013}',
    "hellip" => '\u{2026}',
    "lsquo" => '\u{2018}',
    "rsquo" => '\u{2019}',
    "ldquo" => '\u{201C}',
    "rdquo" => '\u{201D}',
    "laquo" => '\u{00AB}',
    "raquo" => '\u{00BB}',
    "bull" => '\u{2022}',
    "middot" => '\u{00B7}',
    "copy" => '\u{00A9}',
    "reg" => '\u{00AE}',
    "trade" => '\u{2122}',
    "deg" => '\u{00B0}',
    "plusmn" => '\u{00B1}',
    "times" => '\u{00D7}',
    "divide" => '\u{00F7}',
    "minus" => '\u{2212}',
    "frac12" => '\u{00BD}',
    "frac14" => '\u{00BC}',
    "frac34" => '\u{00BE}',
    "sup2" => '\u{00B2}',
    "sup3" => '\u{00B3}',
    "sect" => '\u{00A7}',
    "para" => '\u{00B6}',
    "dagger" => '\u{2020}',
    "Dagger" => '\u{2021}',
    "euro" => '\u{20AC}',
    "pound" => '\u{00A3}',
    "yen" => '\u{00A5}',
    "cent" => '\u{00A2}',
    "larr" => '\u{2190}',
    "rarr" => '\u{2192}',
    "uarr" => '\u{2191}',
    "darr" => '\u{2193}',
    "harr" => '\u{2194}',
    "szlig" => '\u{00DF}',
    "agrave" => '\u{00E0}',
    "aacute" => '\u{00E1}',
    "acirc" => '\u{00E2}',
    "atilde" => '\u{00E3}',
    "auml" => '\u{00E4}',
    "aring" => '\u{00E5}',
    "aelig" => '\u{00E6}',
    "ccedil" => '\u{00E7}',
    "egrave" => '\u{00E8}',
    "eacute" => '\u{00E9}',
    "ecirc" => '\u{00EA}',
    "euml" => '\u{00EB}',
    "iacute" => '\u{00ED}',
    "igrave" => '\u{00EC}',
    "icirc" => '\u{00EE}',
    "iuml" => '\u{00EF}',
    "ntilde" => '\u{00F1}',
    "oacute" => '\u{00F3}',
    "ograve" => '\u{00F2}',
    "ocirc" => '\u{00F4}',
    "otilde" => '\u{00F5}',
    "ouml" => '\u{00F6}',
    "oslash" => '\u{00F8}',
    "uacute" => '\u{00FA}',
    "ugrave" => '\u{00F9}',
    "ucirc" => '\u{00FB}',
    "uuml" => '\u{00FC}',
    "yacute" => '\u{00FD}',
    "yuml" => '\u{00FF}',
    "Aacute" => '\u{00C1}',
    "Auml" => '\u{00C4}',
    "Ouml" => '\u{00D6}',
    "Uuml" => '\u{00DC}',
    "Eacute" => '\u{00C9}',
    _ => return None,
  };
  Some(ch)
}
