//! Input formats. Each reader turns raw bytes into a Document.

pub mod docx;
pub mod epub;
pub mod html;
pub mod rtf;

use crate::model::Document;
use crate::ConvertError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceFormat {
  Docx,
  Epub,
  Rtf,
  Html,
}

impl SourceFormat {
  pub const ALL: [SourceFormat; 4] = [
    SourceFormat::Docx,
    SourceFormat::Epub,
    SourceFormat::Rtf,
    SourceFormat::Html,
  ];

  /// Accepts both the canonical name and common extensions.
  pub fn parse(name: &str) -> Option<Self> {
    match name.trim().to_ascii_lowercase().as_str() {
      "docx" | "doc" | "word" => Some(SourceFormat::Docx),
      "epub" => Some(SourceFormat::Epub),
      "rtf" => Some(SourceFormat::Rtf),
      "html" | "htm" | "xhtml" => Some(SourceFormat::Html),
      _ => None,
    }
  }

  pub fn name(&self) -> &'static str {
    match self {
      SourceFormat::Docx => "docx",
      SourceFormat::Epub => "epub",
      SourceFormat::Rtf => "rtf",
      SourceFormat::Html => "html",
    }
  }
}

pub fn read(input: &[u8], from: SourceFormat) -> Result<Document, ConvertError> {
  match from {
    SourceFormat::Docx => docx::read(input),
    SourceFormat::Epub => epub::read(input),
    SourceFormat::Rtf => rtf::read(input),
    SourceFormat::Html => html::read(input),
  }
}
