//! Output formats. Each writer renders a Document into bytes.

pub mod docx;
pub mod epub;
pub mod markup;
pub mod plain;
pub mod rtf;

use crate::model::Document;
use crate::ConvertError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetFormat {
  Markdown,
  Html,
  Docx,
  Epub,
  Rtf,
  Org,
  Rst,
  Textile,
  Mediawiki,
  Opml,
  Latex,
}

impl TargetFormat {
  pub const ALL: [TargetFormat; 11] = [
    TargetFormat::Markdown,
    TargetFormat::Html,
    TargetFormat::Docx,
    TargetFormat::Epub,
    TargetFormat::Rtf,
    TargetFormat::Org,
    TargetFormat::Rst,
    TargetFormat::Textile,
    TargetFormat::Mediawiki,
    TargetFormat::Opml,
    TargetFormat::Latex,
  ];

  pub fn parse(name: &str) -> Option<Self> {
    match name.trim().to_ascii_lowercase().as_str() {
      "markdown" | "md" => Some(TargetFormat::Markdown),
      "html" | "htm" => Some(TargetFormat::Html),
      "docx" | "doc" | "word" => Some(TargetFormat::Docx),
      "epub" => Some(TargetFormat::Epub),
      "rtf" => Some(TargetFormat::Rtf),
      "org" => Some(TargetFormat::Org),
      "rst" => Some(TargetFormat::Rst),
      "textile" => Some(TargetFormat::Textile),
      "mediawiki" | "wiki" => Some(TargetFormat::Mediawiki),
      "opml" => Some(TargetFormat::Opml),
      "latex" | "tex" => Some(TargetFormat::Latex),
      _ => None,
    }
  }

  pub fn name(&self) -> &'static str {
    match self {
      TargetFormat::Markdown => "markdown",
      TargetFormat::Html => "html",
      TargetFormat::Docx => "docx",
      TargetFormat::Epub => "epub",
      TargetFormat::Rtf => "rtf",
      TargetFormat::Org => "org",
      TargetFormat::Rst => "rst",
      TargetFormat::Textile => "textile",
      TargetFormat::Mediawiki => "mediawiki",
      TargetFormat::Opml => "opml",
      TargetFormat::Latex => "latex",
    }
  }

  /// Everything except the two zip containers is plain text.
  pub fn is_text(&self) -> bool {
    !matches!(self, TargetFormat::Docx | TargetFormat::Epub)
  }
}

pub fn write(document: &Document, to: TargetFormat) -> Result<Vec<u8>, ConvertError> {
  match to {
    TargetFormat::Markdown => Ok(plain::markdown(document).into_bytes()),
    TargetFormat::Html => Ok(plain::html(document).into_bytes()),
    TargetFormat::Org => Ok(markup::org(document).into_bytes()),
    TargetFormat::Rst => Ok(markup::rst(document).into_bytes()),
    TargetFormat::Textile => Ok(markup::textile(document).into_bytes()),
    TargetFormat::Mediawiki => Ok(markup::mediawiki(document).into_bytes()),
    TargetFormat::Opml => Ok(markup::opml(document).into_bytes()),
    TargetFormat::Latex => Ok(markup::latex(document).into_bytes()),
    TargetFormat::Rtf => rtf::write(document),
    TargetFormat::Docx => docx::write(document),
    TargetFormat::Epub => epub::write(document),
  }
}
