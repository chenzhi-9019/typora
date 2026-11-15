//! A small, dependency-light stand-in for the parts of pandoc this editor needs.
//!
//! Everything funnels through model::Document: every reader produces one, every
//! writer consumes one.

pub mod model;
pub mod readers;
pub mod writers;

pub use model::{Align, Block, Document, Inline};
pub use readers::SourceFormat;
pub use writers::TargetFormat;

#[derive(Debug, thiserror::Error)]
pub enum ConvertError {
  #[error("unsupported conversion: {from:?} -> {to:?}")]
  UnsupportedPair { from: SourceFormat, to: TargetFormat },
  #[error("failed to read {format:?}: {message}")]
  Read { format: SourceFormat, message: String },
  #[error("failed to write {format:?}: {message}")]
  Write { format: TargetFormat, message: String },
  #[error("io error: {0}")]
  Io(#[from] std::io::Error),
}

/// Reads input in one format and writes it back out in another.
pub fn convert(
  input: &[u8],
  from: SourceFormat,
  to: TargetFormat,
) -> Result<Vec<u8>, ConvertError> {
  let document = readers::read(input, from)?;
  writers::write(&document, to)
}
