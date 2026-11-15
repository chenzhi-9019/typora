//! The intermediate document model every reader and writer shares.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Align {
  #[default]
  None,
  Left,
  Center,
  Right,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Inline {
  Text(String),
  Strong(Vec<Inline>),
  Emphasis(Vec<Inline>),
  Strike(Vec<Inline>),
  Underline(Vec<Inline>),
  Code(String),
  Math(String),
  Link { href: String, title: Option<String>, content: Vec<Inline> },
  Image { src: String, alt: String, title: Option<String> },
  SoftBreak,
  HardBreak,
  /// markup a reader could not classify; writers pass it through when they can
  Raw(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Block {
  Paragraph(Vec<Inline>),
  Heading { level: u8, content: Vec<Inline> },
  CodeBlock { language: Option<String>, text: String },
  Quote(Vec<Block>),
  List { ordered: bool, start: u64, items: Vec<Vec<Block>> },
  Table { header: Vec<Vec<Inline>>, align: Vec<Align>, rows: Vec<Vec<Vec<Inline>>> },
  Rule,
  Raw(String),
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Document {
  /// front matter style key/value pairs, in document order
  pub meta: Vec<(String, String)>,
  pub blocks: Vec<Block>,
}

impl Inline {
  /// Flattens an inline tree into plain text, used by writers that cannot carry
  /// formatting (OPML titles, alt text, RTF fallbacks).
  pub fn plain_text(inlines: &[Inline]) -> String {
    let mut out = String::new();
    for inline in inlines {
      match inline {
        Inline::Text(text)
        | Inline::Code(text)
        | Inline::Math(text)
        | Inline::Raw(text) => out.push_str(text),
        Inline::Strong(inner)
        | Inline::Emphasis(inner)
        | Inline::Strike(inner)
        | Inline::Underline(inner)
        | Inline::Link { content: inner, .. } => out.push_str(&Inline::plain_text(inner)),
        Inline::Image { alt, .. } => out.push_str(alt),
        Inline::SoftBreak | Inline::HardBreak => out.push(0x20 as char),
      }
    }
    out
  }
}

impl Block {
  pub fn plain_text(blocks: &[Block]) -> String {
    let mut out = String::new();
    for block in blocks {
      match block {
        Block::Paragraph(inlines) | Block::Heading { content: inlines, .. } => {
          out.push_str(&Inline::plain_text(inlines))
        }
        Block::CodeBlock { text, .. } | Block::Raw(text) => out.push_str(text),
        Block::Quote(inner) => out.push_str(&Block::plain_text(inner)),
        Block::List { items, .. } => {
          for item in items {
            out.push_str(&Block::plain_text(item));
            out.push(0x0A as char);
          }
        }
        Block::Table { header, rows, .. } => {
          for cell in header {
            out.push_str(&Inline::plain_text(cell));
            out.push(0x09 as char);
          }
          out.push(0x0A as char);
          for row in rows {
            for cell in row {
              out.push_str(&Inline::plain_text(cell));
              out.push(0x09 as char);
            }
            out.push(0x0A as char);
          }
        }
        Block::Rule => {}
      }
    }
    out
  }
}
