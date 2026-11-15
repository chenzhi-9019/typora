//! docx reader: zip container plus the WordprocessingML parts we care about.
//!
//! Everything is driven by a tiny XML tree built with quick-xml; missing parts
//! are tolerated so a hand-authored container still converts.

use std::collections::HashMap;
use std::io::{Cursor, Read};

use quick_xml::events::Event;
use quick_xml::Reader;
use zip::ZipArchive;

use crate::model::{Align, Block, Document, Inline};
use crate::ConvertError;

use super::html::decode_entities;
use super::SourceFormat;

pub fn read(input: &[u8]) -> Result<Document, ConvertError> {
  let mut archive = ZipArchive::new(Cursor::new(input))
    .map_err(|error| read_err(format!("not a zip container: {error}")))?;

  let document_bytes = read_part(&mut archive, &["word/document.xml"])?
    .or_else(|| read_part_ending_with(&mut archive, "document.xml").ok().flatten())
    .ok_or_else(|| read_err("word/document.xml is missing"))?;

  let mut context = Context::default();
  if let Some(bytes) = read_part(&mut archive, &["word/_rels/document.xml.rels"])? {
    context.relationships = parse_relationships(&bytes);
  }
  if let Some(bytes) = read_part(&mut archive, &["word/numbering.xml"])? {
    context.numbering = parse_numbering(&bytes);
  }
  if let Some(bytes) = read_part(&mut archive, &["word/styles.xml"])? {
    context.styles = parse_styles(&bytes);
  }
  let meta = match read_part(&mut archive, &["docProps/core.xml"])? {
    Some(bytes) => parse_core_properties(&bytes),
    None => Vec::new(),
  };

  let root = parse_xml(&document_bytes)
    .map_err(|message| read_err(format!("word/document.xml is not readable: {message}")))?;
  let body = find(&root, "body").unwrap_or(&root);
  let blocks = body_blocks(body, &context);

  Ok(Document { meta, blocks })
}

fn read_err(message: impl Into<String>) -> ConvertError {
  ConvertError::Read {
    format: SourceFormat::Docx,
    message: message.into(),
  }
}

// ---------------------------------------------------------------------------
// zip access
// ---------------------------------------------------------------------------

/// Entry names inside the container, in archive order. Shared with the epub
/// reader, which needs the same tolerant lookup.
pub(crate) fn zip_names<F: Read + std::io::Seek>(archive: &ZipArchive<F>) -> Vec<String> {
  archive.file_names().map(|name| name.to_string()).collect()
}

/// Zip entry names are compared with forward slashes and case-insensitively,
/// because producers disagree about both.
pub(crate) fn zip_bytes<F: Read + std::io::Seek>(
  archive: &mut ZipArchive<F>,
  name: &str,
) -> Result<Option<Vec<u8>>, String> {
  let wanted = normalize_path(name);
  let available = zip_names(archive);
  let chosen = available
    .iter()
    .find(|entry| normalize_path(entry) == wanted)
    .or_else(|| {
      available
        .iter()
        .find(|entry| normalize_path(entry).eq_ignore_ascii_case(&wanted))
    })
    .cloned();
  let Some(chosen) = chosen else {
    return Ok(None);
  };
  let mut file = archive.by_name(&chosen).map_err(|error| error.to_string())?;
  let mut buffer = Vec::new();
  file
    .read_to_end(&mut buffer)
    .map_err(|error| error.to_string())?;
  Ok(Some(buffer))
}

pub(crate) fn normalize_path(path: &str) -> String {
  path.replace('\\', "/").trim_start_matches('/').to_string()
}

fn read_part<F: Read + std::io::Seek>(
  archive: &mut ZipArchive<F>,
  names: &[&str],
) -> Result<Option<Vec<u8>>, ConvertError> {
  for name in names {
    if let Some(bytes) = zip_bytes(archive, name).map_err(read_err)? {
      return Ok(Some(bytes));
    }
  }
  Ok(None)
}

fn read_part_ending_with<F: Read + std::io::Seek>(
  archive: &mut ZipArchive<F>,
  suffix: &str,
) -> Result<Option<Vec<u8>>, ConvertError> {
  let suffix = suffix.to_ascii_lowercase();
  let chosen = zip_names(archive).into_iter().find(|name| {
    let normalized = normalize_path(name).to_ascii_lowercase();
    normalized.ends_with(&suffix) && !normalized.contains("_rels")
  });
  match chosen {
    Some(name) => zip_bytes(archive, &name).map_err(read_err),
    None => Ok(None),
  }
}

// ---------------------------------------------------------------------------
// xml tree
// ---------------------------------------------------------------------------

/// Minimal XML tree over the parts; the epub reader reuses it for its package
/// document instead of carrying a second parser.
pub(crate) enum Item {
  El(El),
  Text(String),
}

pub(crate) struct El {
  pub(crate) name: String,
  pub(crate) attrs: Vec<(String, String)>,
  pub(crate) items: Vec<Item>,
}

impl El {
  fn new(name: &str) -> Self {
    Self {
      name: name.to_string(),
      attrs: Vec::new(),
      items: Vec::new(),
    }
  }
}

fn local_name(qualified: &[u8]) -> String {
  let bytes = match qualified.iter().rposition(|byte| *byte == b':') {
    Some(index) => &qualified[index + 1..],
    None => qualified,
  };
  String::from_utf8_lossy(bytes).to_string()
}

pub(crate) fn parse_xml(bytes: &[u8]) -> Result<El, String> {
  let mut reader = Reader::from_reader(bytes);
  let mut stack: Vec<El> = vec![El::new("#root")];
  let mut buffer = Vec::new();

  loop {
    let event = reader
      .read_event_into(&mut buffer)
      .map_err(|error| error.to_string())?;
    match event {
      Event::Start(start) => {
        let mut element = El::new(&local_name(start.name().as_ref()));
        for attribute in start.attributes() {
          let attribute = attribute.map_err(|error| error.to_string())?;
          element.attrs.push((
            local_name(attribute.key.as_ref()),
            decode_entities(&String::from_utf8_lossy(&attribute.value)),
          ));
        }
        stack.push(element);
      }
      Event::Empty(start) => {
        let mut element = El::new(&local_name(start.name().as_ref()));
        for attribute in start.attributes() {
          let attribute = attribute.map_err(|error| error.to_string())?;
          element.attrs.push((
            local_name(attribute.key.as_ref()),
            decode_entities(&String::from_utf8_lossy(&attribute.value)),
          ));
        }
        attach(&mut stack, element);
      }
      Event::End(_) => {
        if stack.len() > 1 {
          let element = stack.pop().unwrap_or_else(|| El::new("#empty"));
          attach(&mut stack, element);
        }
      }
      Event::Text(text) => {
        let raw = text.into_inner();
        let decoded = decode_entities(&String::from_utf8_lossy(&raw));
        if let Some(parent) = stack.last_mut() {
          parent.items.push(Item::Text(decoded));
        }
      }
      Event::CData(data) => {
        let raw = data.into_inner();
        if let Some(parent) = stack.last_mut() {
          parent
            .items
            .push(Item::Text(String::from_utf8_lossy(&raw).to_string()));
        }
      }
      Event::Eof => break,
      _ => {}
    }
    buffer.clear();
  }

  while stack.len() > 1 {
    let element = stack.pop().unwrap_or_else(|| El::new("#empty"));
    attach(&mut stack, element);
  }
  // The synthetic root only holds the real document element; unwrap it so
  // callers can look at the document's own children.
  let mut holder = stack.pop().unwrap_or_else(|| El::new("#root"));
  if let Some(position) = holder
    .items
    .iter()
    .position(|item| matches!(item, Item::El(_)))
  {
    if let Item::El(document) = holder.items.remove(position) {
      return Ok(document);
    }
  }
  Ok(holder)
}

fn attach(stack: &mut [El], element: El) {
  if let Some(parent) = stack.last_mut() {
    parent.items.push(Item::El(element));
  }
}

pub(crate) fn attr<'a>(element: &'a El, name: &str) -> Option<&'a str> {
  element
    .attrs
    .iter()
    .find(|(key, _)| key.eq_ignore_ascii_case(name))
    .map(|(_, value)| value.as_str())
}

pub(crate) fn child<'a>(element: &'a El, name: &str) -> Option<&'a El> {
  element.items.iter().find_map(|item| match item {
    Item::El(candidate) if candidate.name.eq_ignore_ascii_case(name) => Some(candidate),
    _ => None,
  })
}

fn find<'a>(element: &'a El, name: &str) -> Option<&'a El> {
  if element.name.eq_ignore_ascii_case(name) {
    return Some(element);
  }
  element.items.iter().find_map(|item| match item {
    Item::El(candidate) => find(candidate, name),
    Item::Text(_) => None,
  })
}

fn collect_all<'a>(element: &'a El, name: &str, out: &mut Vec<&'a El>) {
  for item in &element.items {
    if let Item::El(candidate) = item {
      if candidate.name.eq_ignore_ascii_case(name) {
        out.push(candidate);
      }
      collect_all(candidate, name, out);
    }
  }
}

pub(crate) fn all<'a>(element: &'a El, name: &str) -> Vec<&'a El> {
  let mut out = Vec::new();
  collect_all(element, name, &mut out);
  out
}

/// Direct children with this local name.
fn kids<'a>(element: &'a El, name: &str) -> Vec<&'a El> {
  element
    .items
    .iter()
    .filter_map(|item| match item {
      Item::El(candidate) if candidate.name.eq_ignore_ascii_case(name) => Some(candidate),
      _ => None,
    })
    .collect()
}

pub(crate) fn text_of(element: &El) -> String {
  let mut out = String::new();
  collect_text(element, &mut out);
  out
}

fn collect_text(element: &El, out: &mut String) {
  for item in &element.items {
    match item {
      Item::Text(text) => out.push_str(text),
      Item::El(candidate) => collect_text(candidate, out),
    }
  }
}

// ---------------------------------------------------------------------------
// package parts
// ---------------------------------------------------------------------------

struct Level {
  ordered: bool,
  start: u64,
}

#[derive(Default)]
struct Numbering {
  levels: HashMap<(String, u32), Level>,
  num_to_abstract: HashMap<String, String>,
}

#[derive(Default)]
struct Context {
  relationships: HashMap<String, String>,
  numbering: Numbering,
  styles: HashMap<String, String>,
}

impl Context {
  fn numbering(&self, num_id: &str, ilvl: u32) -> (bool, u64) {
    let Some(abstract_id) = self.numbering.num_to_abstract.get(num_id) else {
      return (false, 1);
    };
    let level = self
      .numbering
      .levels
      .get(&(abstract_id.clone(), ilvl))
      .or_else(|| self.numbering.levels.get(&(abstract_id.clone(), 0)));
    match level {
      Some(level) => (level.ordered, if level.ordered { level.start } else { 1 }),
      None => (false, 1),
    }
  }

  fn heading_level(&self, style_id: &str) -> Option<u8> {
    if let Some(name) = self.styles.get(style_id) {
      if let Some(level) = level_from_name(name) {
        return Some(level);
      }
    }
    level_from_name(style_id)
  }
}

fn level_from_name(raw: &str) -> Option<u8> {
  let normalized: String = raw
    .chars()
    .filter(|ch| ch.is_alphanumeric())
    .flat_map(|ch| ch.to_lowercase())
    .collect();
  if matches!(normalized.as_str(), "title" | "titel" | "documenttitle") {
    return Some(1);
  }
  for prefix in ["heading", "uberschrift", "titre", "titolo", "kapitel", "head"] {
    if let Some(rest) = normalized.strip_prefix(prefix) {
      if let Ok(level) = rest.parse::<u8>() {
        if (1..=6).contains(&level) {
          return Some(level);
        }
      }
    }
  }
  if normalized.len() == 1 {
    if let Ok(level) = normalized.parse::<u8>() {
      if (1..=6).contains(&level) {
        return Some(level);
      }
    }
  }
  None
}

fn parse_relationships(bytes: &[u8]) -> HashMap<String, String> {
  let mut map = HashMap::new();
  let Ok(root) = parse_xml(bytes) else {
    return map;
  };
  for relationship in all(&root, "Relationship") {
    if let (Some(id), Some(target)) = (attr(relationship, "Id"), attr(relationship, "Target")) {
      map.insert(id.to_string(), target.to_string());
    }
  }
  map
}

fn parse_numbering(bytes: &[u8]) -> Numbering {
  let mut numbering = Numbering::default();
  let Ok(root) = parse_xml(bytes) else {
    return numbering;
  };
  for abstract_element in all(&root, "abstractNum") {
    let Some(abstract_id) = attr(abstract_element, "abstractNumId").map(|value| value.to_string())
    else {
      continue;
    };
    for level_element in all(abstract_element, "lvl") {
      let ilvl = attr(level_element, "ilvl")
        .and_then(|value| value.trim().parse::<u32>().ok())
        .unwrap_or(0);
      let format = child(level_element, "numFmt")
        .and_then(|element| attr(element, "val"))
        .unwrap_or("bullet")
        .to_ascii_lowercase();
      let start = child(level_element, "start")
        .and_then(|element| attr(element, "val"))
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(1);
      let ordered = !matches!(format.as_str(), "bullet" | "none" | "");
      numbering
        .levels
        .insert((abstract_id.clone(), ilvl), Level { ordered, start });
    }
  }
  for num_element in all(&root, "num") {
    let num_id = attr(num_element, "numId");
    let abstract_id = child(num_element, "abstractNumId").and_then(|element| attr(element, "val"));
    if let (Some(num_id), Some(abstract_id)) = (num_id, abstract_id) {
      numbering
        .num_to_abstract
        .insert(num_id.to_string(), abstract_id.to_string());
    }
  }
  numbering
}

fn parse_styles(bytes: &[u8]) -> HashMap<String, String> {
  let mut map = HashMap::new();
  let Ok(root) = parse_xml(bytes) else {
    return map;
  };
  for style in all(&root, "style") {
    let Some(id) = attr(style, "styleId") else {
      continue;
    };
    if let Some(name) = child(style, "name").and_then(|element| attr(element, "val")) {
      map.insert(id.to_string(), name.to_string());
    }
  }
  map
}

fn parse_core_properties(bytes: &[u8]) -> Vec<(String, String)> {
  let mut meta = Vec::new();
  let Ok(root) = parse_xml(bytes) else {
    return meta;
  };
  for item in &root.items {
    let Item::El(element) = item else {
      continue;
    };
    let key = match element.name.to_ascii_lowercase().as_str() {
      "title" => "title",
      "creator" => "creator",
      "subject" => "subject",
      "description" => "description",
      "keywords" => "keywords",
      "lastmodifiedby" => "last-modified-by",
      "created" => "created",
      "modified" => "modified",
      "category" => "category",
      "language" => "language",
      "revision" => "revision",
      _ => continue,
    };
    let value = text_of(element).trim().to_string();
    if value.is_empty() || meta.iter().any(|(existing, _)| *existing == key) {
      continue;
    }
    meta.push((key.to_string(), value));
  }
  meta
}

// ---------------------------------------------------------------------------
// body
// ---------------------------------------------------------------------------

#[derive(Default)]
struct ParagraphProps {
  style: Option<String>,
  num_id: Option<String>,
  ilvl: u32,
}

fn body_blocks(container: &El, context: &Context) -> Vec<Block> {
  let mut blocks: Vec<Block> = Vec::new();
  let mut list: Option<ListAcc> = None;

  for item in &container.items {
    let Item::El(element) = item else {
      continue;
    };
    match element.name.to_ascii_lowercase().as_str() {
      "p" => {
        let props = paragraph_props(element);
        let content = inlines_of(&element.items, context);
        let heading = props
          .style
          .as_deref()
          .and_then(|style| context.heading_level(style));
        match (&props.num_id, heading) {
          (Some(num_id), _) => {
            let (ordered, start) = context.numbering(num_id, props.ilvl);
            let continues = list
              .as_ref()
              .map(|accumulator| accumulator.num_id == *num_id)
              .unwrap_or(false);
            if !continues {
              if let Some(previous) = list.take() {
                blocks.push(previous.finish());
              }
              list = Some(ListAcc::new(num_id.clone(), ordered, start));
            }
            if let Some(accumulator) = list.as_mut() {
              accumulator
                .entries
                .push((props.ilvl, vec![Block::Paragraph(content)]));
            }
          }
          (None, Some(level)) => {
            if let Some(previous) = list.take() {
              blocks.push(previous.finish());
            }
            blocks.push(Block::Heading { level, content });
          }
          (None, None) => {
            if let Some(previous) = list.take() {
              blocks.push(previous.finish());
            }
            if !content.is_empty() {
              blocks.push(Block::Paragraph(content));
            }
          }
        }
      }
      "tbl" => {
        if let Some(previous) = list.take() {
          blocks.push(previous.finish());
        }
        if let Some(table) = table_of(element, context) {
          blocks.push(table);
        }
      }
      "sdt" => {
        let content = child(element, "sdtContent");
        if let Some(content) = content {
          if let Some(previous) = list.take() {
            blocks.push(previous.finish());
          }
          blocks.extend(body_blocks(content, context));
        }
      }
      _ => {}
    }
  }

  if let Some(previous) = list {
    blocks.push(previous.finish());
  }
  blocks
}

struct ListAcc {
  num_id: String,
  ordered: bool,
  start: u64,
  entries: Vec<(u32, Vec<Block>)>,
}

impl ListAcc {
  fn new(num_id: String, ordered: bool, start: u64) -> Self {
    Self {
      num_id,
      ordered,
      start,
      entries: Vec::new(),
    }
  }

  fn finish(self) -> Block {
    // Start from the shallowest level so a list that begins nested still keeps
    // every entry.
    let level = self
      .entries
      .iter()
      .map(|(level, _)| *level)
      .min()
      .unwrap_or(0);
    nest_list(&self.entries, self.ordered, self.start, level)
  }
}

fn nest_list(entries: &[(u32, Vec<Block>)], ordered: bool, start: u64, level: u32) -> Block {
  let mut items: Vec<Vec<Block>> = Vec::new();
  let mut index = 0usize;
  while index < entries.len() {
    let current = entries[index].0;
    if current < level {
      break;
    }
    if current > level {
      let mut end = index;
      while end < entries.len() && entries[end].0 > level {
        end += 1;
      }
      let nested = nest_list(&entries[index..end], ordered, 1, entries[index].0);
      match items.last_mut() {
        Some(last) => last.push(nested),
        None => items.push(vec![nested]),
      }
      index = end;
      continue;
    }
    items.push(entries[index].1.clone());
    index += 1;
  }
  Block::List {
    ordered,
    start,
    items,
  }
}

fn paragraph_props(paragraph: &El) -> ParagraphProps {
  let mut props = ParagraphProps::default();
  let Some(properties) = child(paragraph, "pPr") else {
    return props;
  };
  for item in &properties.items {
    let Item::El(element) = item else {
      continue;
    };
    match element.name.to_ascii_lowercase().as_str() {
      "pstyle" => props.style = attr(element, "val").map(|value| value.to_string()),
      "numpr" => {
        if let Some(value) = child(element, "numId").and_then(|node| attr(node, "val")) {
          if value.trim() != "0" {
            props.num_id = Some(value.to_string());
          }
        }
        if let Some(value) = child(element, "ilvl")
          .and_then(|node| attr(node, "val"))
          .and_then(|value| value.trim().parse::<u32>().ok())
        {
          props.ilvl = value;
        }
      }
      _ => {}
    }
  }
  props
}

// ---------------------------------------------------------------------------
// inlines
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Default)]
struct Format {
  bold: bool,
  italic: bool,
  underline: bool,
  strike: bool,
}

fn inlines_of(items: &[Item], context: &Context) -> Vec<Inline> {
  let mut out = Vec::new();
  for item in items {
    let Item::El(element) = item else {
      continue;
    };
    match element.name.to_ascii_lowercase().as_str() {
      "r" => out.extend(run_inlines(element, context)),
      "hyperlink" => {
        let content = inlines_of(&element.items, context);
        if content.is_empty() {
          continue;
        }
        let target = attr(element, "id")
          .and_then(|id| context.relationships.get(id).cloned())
          .or_else(|| attr(element, "anchor").map(|anchor| format!("#{anchor}")));
        match target {
          Some(href) => out.push(Inline::Link {
            href,
            title: None,
            content,
          }),
          None => out.extend(content),
        }
      }
      "fldsimple" | "smarttag" | "ins" | "sdt" | "sdtcontent" | "customxml" => {
        out.extend(inlines_of(&element.items, context));
      }
      "del" | "movefrom" | "bookmarkstart" | "bookmarkend" | "prooferr" => {}
      "p" => {
        if !out.is_empty() {
          out.push(Inline::HardBreak);
        }
        out.extend(inlines_of(&element.items, context));
      }
      _ => {}
    }
  }
  out
}

fn run_inlines(run: &El, context: &Context) -> Vec<Inline> {
  let mut format = Format::default();
  let mut out = Vec::new();
  for item in &run.items {
    let Item::El(element) = item else {
      continue;
    };
    match element.name.to_ascii_lowercase().as_str() {
      "rpr" => format = format_of(element),
      "t" => {
        let text = text_of(element);
        if !text.is_empty() {
          out.push(Inline::Text(text));
        }
      }
      "tab" => out.push(Inline::Text("\t".to_string())),
      "ptab" => out.push(Inline::Text("\t".to_string())),
      "br" | "cr" => out.push(Inline::HardBreak),
      "nobreakhyphen" => out.push(Inline::Text("\u{2011}".to_string())),
      "softhyphen" => {}
      "drawing" => {
        if let Some(image) = image_of(element, context) {
          out.push(image);
        }
      }
      "pict" => {
        if let Some(image) = image_of(element, context) {
          out.push(image);
        }
      }
      "sym" => {
        if let Some(character) = attr(element, "char").and_then(symbol_char) {
          out.push(Inline::Text(character.to_string()));
        }
      }
      _ => {}
    }
  }
  wrap(format, out)
}

fn format_of(properties: &El) -> Format {
  let mut format = Format::default();
  for item in &properties.items {
    let Item::El(element) = item else {
      continue;
    };
    match element.name.to_ascii_lowercase().as_str() {
      "b" => format.bold = toggle(element),
      "i" => format.italic = toggle(element),
      "strike" | "dstrike" => format.strike = toggle(element),
      "u" => {
        format.underline = attr(element, "val")
          .map(|value| !value.eq_ignore_ascii_case("none"))
          .unwrap_or(true);
      }
      _ => {}
    }
  }
  format
}

fn toggle(element: &El) -> bool {
  match attr(element, "val") {
    None => true,
    Some(value) => !matches!(
      value.to_ascii_lowercase().as_str(),
      "0" | "false" | "off" | "none"
    ),
  }
}

fn wrap(format: Format, mut inlines: Vec<Inline>) -> Vec<Inline> {
  if inlines.is_empty() {
    return inlines;
  }
  if format.strike {
    inlines = vec![Inline::Strike(inlines)];
  }
  if format.underline {
    inlines = vec![Inline::Underline(inlines)];
  }
  if format.italic {
    inlines = vec![Inline::Emphasis(inlines)];
  }
  if format.bold {
    inlines = vec![Inline::Strong(inlines)];
  }
  inlines
}

fn symbol_char(code: &str) -> Option<char> {
  let trimmed = code.trim();
  let value = if let Some(hex) = trimmed.strip_prefix("0x").or_else(|| trimmed.strip_prefix("0X"))
  {
    u32::from_str_radix(hex, 16).ok()?
  } else {
    u32::from_str_radix(trimmed, 16).ok()?
  };
  char::from_u32(value)
}

fn image_of(element: &El, context: &Context) -> Option<Inline> {
  let blip = find(element, "blip")?;
  let id = attr(blip, "embed").or_else(|| attr(blip, "link"))?;
  let target = context.relationships.get(id)?;
  let source = media_source(target);
  if source.is_empty() {
    return None;
  }
  let properties = find(element, "docPr");
  let alt = properties
    .and_then(|element| attr(element, "descr"))
    .unwrap_or("")
    .to_string();
  let title = properties
    .and_then(|element| attr(element, "title"))
    .map(|value| value.to_string());
  Some(Inline::Image {
    src: source,
    alt,
    title,
  })
}

fn media_source(target: &str) -> String {
  let normalized = target.replace('\\', "/");
  let mut parts: Vec<&str> = Vec::new();
  for segment in normalized.split('/') {
    match segment {
      "" | "." => {}
      ".." => {
        parts.pop();
      }
      other => parts.push(other),
    }
  }
  parts.join("/")
}

// ---------------------------------------------------------------------------
// tables
// ---------------------------------------------------------------------------

fn table_of(element: &El, context: &Context) -> Option<Block> {
  let rows_elements = kids(element, "tr");
  if rows_elements.is_empty() {
    return None;
  }
  let mut rows: Vec<(Vec<Vec<Inline>>, Vec<Align>)> = Vec::new();
  for row in rows_elements {
    let mut cells: Vec<Vec<Inline>> = Vec::new();
    let mut align: Vec<Align> = Vec::new();
    for cell in kids(row, "tc") {
      cells.push(cell_inlines(cell, context));
      align.push(cell_align(cell));
    }
    if !cells.is_empty() {
      rows.push((cells, align));
    }
  }
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

fn cell_inlines(cell: &El, context: &Context) -> Vec<Inline> {
  let mut out: Vec<Inline> = Vec::new();
  for paragraph in kids(cell, "p") {
    let content = inlines_of(&paragraph.items, context);
    if content.is_empty() {
      continue;
    }
    if !out.is_empty() {
      out.push(Inline::HardBreak);
    }
    out.extend(content);
  }
  if out.is_empty() {
    for table in kids(cell, "tbl") {
      if let Some(block) = table_of(table, context) {
        let text = Block::plain_text(std::slice::from_ref(&block));
        let trimmed = text.trim();
        if !trimmed.is_empty() {
          out.push(Inline::Text(trimmed.to_string()));
        }
      }
    }
  }
  out
}

fn cell_align(cell: &El) -> Align {
  let Some(properties) = child(cell, "tcPr") else {
    return Align::None;
  };
  let Some(value) = child(properties, "jc").and_then(|node| attr(node, "val")) else {
    return Align::None;
  };
  match value.to_ascii_lowercase().as_str() {
    "left" | "start" => Align::Left,
    "center" => Align::Center,
    "right" | "end" => Align::Right,
    _ => Align::None,
  }
}
