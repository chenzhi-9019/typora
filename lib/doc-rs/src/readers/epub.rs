//! epub reader: zip container, the OPF package document, then each spine item
//! rendered by the html reader.
//!
//! The XML tree and zip helpers come from the docx reader so this crate keeps a
//! single small parser for both container formats.

use std::collections::HashMap;
use std::io::Cursor;

use zip::ZipArchive;

use crate::model::{Block, Document};
use crate::ConvertError;

use super::docx::{all, attr, child, normalize_path, parse_xml, text_of, zip_bytes, zip_names, Item};
use super::html::blocks_from_html;
use super::SourceFormat;

pub fn read(input: &[u8]) -> Result<Document, ConvertError> {
  let mut archive = ZipArchive::new(Cursor::new(input))
    .map_err(|error| epub_err(format!("not a zip container: {error}")))?;

  let opf_path = locate_package(&mut archive)?;
  let opf = zip_bytes(&mut archive, &opf_path)
    .map_err(epub_err)?
    .ok_or_else(|| epub_err(format!("cannot read {opf_path}")))?;
  let package = parse_package(&opf);
  let base = directory_of(&opf_path);

  let mut blocks: Vec<Block> = Vec::new();
  let mut chapters = 0usize;
  for idref in &package.spine {
    let Some((href, media_type)) = package.manifest.get(idref) else {
      continue;
    };
    let path = resolve(&base, href);
    if !is_markup(&path, media_type) {
      continue;
    }
    let Some(bytes) = zip_bytes(&mut archive, &path).map_err(epub_err)? else {
      continue;
    };
    let chapter = blocks_from_html(&bytes);
    if chapter.is_empty() {
      continue;
    }
    blocks.extend(chapter);
    chapters += 1;
  }

  if chapters == 0 {
    // No usable spine: fall back to every markup document in manifest order.
    for (href, media_type) in &package.order {
      let path = resolve(&base, href);
      if !is_markup(&path, media_type) {
        continue;
      }
      let Some(bytes) = zip_bytes(&mut archive, &path).map_err(epub_err)? else {
        continue;
      };
      blocks.extend(blocks_from_html(&bytes));
    }
  }

  Ok(Document {
    meta: package.meta,
    blocks,
  })
}

fn epub_err(message: impl Into<String>) -> ConvertError {
  ConvertError::Read {
    format: SourceFormat::Epub,
    message: message.into(),
  }
}

// ---------------------------------------------------------------------------
// package
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Package {
  meta: Vec<(String, String)>,
  /// manifest id -> (href, media type)
  manifest: HashMap<String, (String, String)>,
  /// manifest entries in document order
  order: Vec<(String, String)>,
  spine: Vec<String>,
}

fn locate_package<F: std::io::Read + std::io::Seek>(
  archive: &mut ZipArchive<F>,
) -> Result<String, ConvertError> {
  if let Some(bytes) = zip_bytes(archive, "META-INF/container.xml").map_err(epub_err)? {
    if let Ok(root) = parse_xml(&bytes) {
      for rootfile in all(&root, "rootfile") {
        if let Some(path) = attr(rootfile, "full-path") {
          let path = normalize_path(path);
          if !path.is_empty() {
            return Ok(path);
          }
        }
      }
    }
  }
  let candidate = zip_names(archive)
    .into_iter()
    .find(|name| normalize_path(name).to_ascii_lowercase().ends_with(".opf"));
  match candidate {
    Some(name) => Ok(normalize_path(&name)),
    None => Err(epub_err("no OPF package document found")),
  }
}

fn parse_package(bytes: &[u8]) -> Package {
  let mut package = Package::default();
  let Ok(root) = parse_xml(bytes) else {
    return package;
  };

  if let Some(metadata) = child(&root, "metadata") {
    for item in &metadata.items {
      let Item::El(element) = item else {
        continue;
      };
      let name = element.name.to_ascii_lowercase();
      match name.as_str() {
        "title" | "creator" | "subject" | "description" | "publisher" | "language" | "identifier"
        | "date" | "rights" => {
          let value = text_of(element);
          push_meta(&mut package.meta, &name, &value);
        }
        "meta" => {
          let property = attr(element, "property").unwrap_or("").to_ascii_lowercase();
          let content = attr(element, "content").unwrap_or("");
          let key = property.rsplit(':').next().unwrap_or(&property).to_string();
          push_meta(&mut package.meta, &key, content);
        }
        _ => {}
      }
    }
  }

  for item in all(&root, "item") {
    let (Some(id), Some(href)) = (attr(item, "id"), attr(item, "href")) else {
      continue;
    };
    let media_type = attr(item, "media-type").unwrap_or("").to_string();
    package
      .manifest
      .insert(id.to_string(), (href.to_string(), media_type.clone()));
    package.order.push((href.to_string(), media_type));
  }

  for itemref in all(&root, "itemref") {
    if let Some(idref) = attr(itemref, "idref") {
      package.spine.push(idref.to_string());
    }
  }

  package
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

fn is_markup(path: &str, media_type: &str) -> bool {
  let path = path.to_ascii_lowercase();
  let media_type = media_type.to_ascii_lowercase();
  media_type.contains("html")
    || path.ends_with(".xhtml")
    || path.ends_with(".html")
    || path.ends_with(".htm")
}

// ---------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------

fn directory_of(path: &str) -> String {
  match path.rfind('/') {
    Some(index) => path[..index].to_string(),
    None => String::new(),
  }
}

fn resolve(base: &str, href: &str) -> String {
  let href = href.split('#').next().unwrap_or(href);
  let decoded = percent_decode(href);
  let decoded = decoded.trim();
  let joined = if decoded.starts_with('/') || base.is_empty() {
    decoded.to_string()
  } else {
    format!("{base}/{decoded}")
  };
  let normalized = normalize_path(&joined);
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

fn percent_decode(input: &str) -> String {
  let bytes = input.as_bytes();
  let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
  let mut index = 0usize;
  while index < bytes.len() {
    if bytes[index] == b'%' && index + 2 < bytes.len() {
      if let (Some(high), Some(low)) = (hex_value(bytes[index + 1]), hex_value(bytes[index + 2])) {
        out.push(high * 16 + low);
        index += 3;
        continue;
      }
    }
    out.push(bytes[index]);
    index += 1;
  }
  String::from_utf8_lossy(&out).into_owned()
}

fn hex_value(byte: u8) -> Option<u8> {
  match byte {
    b'0'..=b'9' => Some(byte - b'0'),
    b'a'..=b'f' => Some(byte - b'a' + 10),
    b'A'..=b'F' => Some(byte - b'A' + 10),
    _ => None,
  }
}
