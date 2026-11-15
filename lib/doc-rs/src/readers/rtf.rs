//! rtf reader: a hand written tokenizer. Groups scope character formatting,
//! optional groups are dropped wholesale, and every paragraph is flushed on
//! \par or on the closing brace that ends the body.

use crate::model::{Block, Document, Inline};
use crate::ConvertError;

pub fn read(input: &[u8]) -> Result<Document, ConvertError> {
  Ok(Document {
    meta: Vec::new(),
    blocks: parse(input),
  })
}

fn parse(input: &[u8]) -> Vec<Block> {
  let mut parser = Parser::default();
  parser.run(input);
  parser.blocks
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
struct Format {
  bold: bool,
  italic: bool,
  underline: bool,
  strike: bool,
}

#[derive(Clone)]
enum Piece {
  Text(String),
  Break,
  Tab,
}

#[derive(Default)]
struct Parser {
  stack: Vec<Format>,
  format: Format,
  depth: usize,
  /// while set, everything until this group closes is dropped
  skip_until: Option<usize>,
  /// raw bytes of the current text run, decoded when the run ends
  pending: Vec<u8>,
  current: Vec<(Format, Piece)>,
  blocks: Vec<Block>,
  /// how many fallback characters follow a Unicode escape; one unless \uc
  /// says otherwise
  fallback: Option<usize>,
}

/// Group destinations that never carry body text.
const SKIPPED_DESTINATIONS: [&str; 20] = [
  "fonttbl",
  "colortbl",
  "stylesheet",
  "info",
  "pict",
  "object",
  "header",
  "footer",
  "headerl",
  "headerr",
  "footerl",
  "footerr",
  "listtable",
  "listoverridetable",
  "listtext",
  "themedata",
  "colorschememapping",
  "latentstyles",
  "datastore",
  "xmlnstbl",
];

impl Parser {
  fn run(&mut self, input: &[u8]) {
    let bytes = input;
    let mut index = 0usize;
    while index < bytes.len() {
      let byte = bytes[index];

      if let Some(level) = self.skip_until {
        match byte {
          b'{' => {
            self.depth += 1;
            index += 1;
          }
          b'}' => {
            self.depth = self.depth.saturating_sub(1);
            if self.depth < level {
              self.skip_until = None;
            }
            index += 1;
          }
          b'\\' if index + 1 < bytes.len() => index += 2,
          _ => index += 1,
        }
        continue;
      }

      match byte {
        b'{' => {
          self.depth += 1;
          self.stack.push(self.format);
          index += 1;
        }
        b'}' => {
          self.depth = self.depth.saturating_sub(1);
          if let Some(previous) = self.stack.pop() {
            self.format = previous;
          }
          index += 1;
        }
        b'\\' => {
          index = self.control(bytes, index);
        }
        b'\r' | b'\n' => index += 1,
        _ => {
          self.push_byte(byte);
          index += 1;
        }
      }
    }
    self.flush_paragraph();
  }

  /// Handles one control word or control symbol starting at index.
  fn control(&mut self, bytes: &[u8], index: usize) -> usize {
    let mut cursor = index + 1;
    if cursor >= bytes.len() {
      return cursor;
    }

    if bytes[cursor].is_ascii_alphabetic() {
      let start = cursor;
      while cursor < bytes.len() && bytes[cursor].is_ascii_alphabetic() {
        cursor += 1;
      }
      let word = String::from_utf8_lossy(&bytes[start..cursor]).to_ascii_lowercase();
      let mut negative = false;
      if cursor < bytes.len() && bytes[cursor] == b'-' {
        negative = true;
        cursor += 1;
      }
      let digits_start = cursor;
      while cursor < bytes.len() && bytes[cursor].is_ascii_digit() {
        cursor += 1;
      }
      let param = if cursor > digits_start {
        std::str::from_utf8(&bytes[digits_start..cursor])
          .ok()
          .and_then(|digits| digits.parse::<i32>().ok())
          .map(|value| if negative { -value } else { value })
      } else {
        None
      };
      if cursor < bytes.len() && bytes[cursor] == b' ' {
        cursor += 1;
      }
      return self.word(&word, param, bytes, cursor);
    }

    let symbol = bytes[cursor];
    cursor += 1;
    match symbol {
      b'*' => self.skip_until = Some(self.depth.max(1)),
      b'\'' => {
        let mut end = cursor;
        let mut value = String::new();
        while end < bytes.len() && value.len() < 2 && bytes[end].is_ascii_hexdigit() {
          value.push(bytes[end] as char);
          end += 1;
        }
        if let Ok(byte) = u8::from_str_radix(&value, 16) {
          self.push_byte(byte);
        }
        return end;
      }
      b'\\' | b'{' | b'}' => {
        let character = symbol as char;
        self.push_text(&character.to_string());
      }
      b'~' => self.push_text("\u{00A0}"),
      b'_' => self.push_text("\u{2011}"),
      b'\r' | b'\n' => {}
      _ => {}
    }
    cursor
  }

  fn word(&mut self, word: &str, param: Option<i32>, bytes: &[u8], cursor: usize) -> usize {
    let toggle = param != Some(0);
    match word {
      "par" | "sect" | "page" | "row" | "nestcell" => self.flush_paragraph(),
      "line" => {
        self.flush_pending();
        self.current.push((self.format, Piece::Break));
      }
      "tab" => {
        self.flush_pending();
        self.current.push((self.format, Piece::Tab));
      }
      "b" => {
        self.flush_pending();
        self.format.bold = toggle;
      }
      "i" => {
        self.flush_pending();
        self.format.italic = toggle;
      }
      "ul" | "uld" | "uldb" | "ulw" => {
        self.flush_pending();
        self.format.underline = toggle;
      }
      "ulnone" => {
        self.flush_pending();
        self.format.underline = false;
      }
      "strike" | "striked" => {
        self.flush_pending();
        self.format.strike = toggle;
      }
      "plain" | "pard" => {
        self.flush_pending();
        self.format = Format::default();
      }
      "u" => {
        self.flush_pending();
        if let Some(value) = param {
          let code = if value < 0 {
            (value + 65536) as u32
          } else {
            value as u32
          };
          if let Some(character) = char::from_u32(code) {
            self.push_text(&character.to_string());
          }
        }
        return self.skip_fallback(bytes, cursor);
      }
      "uc" => {
        if let Some(value) = param {
          if value >= 0 {
            self.fallback = Some(value as usize);
          }
        }
      }
      "ansicpg" | "deff" | "deflang" | "rtlch" | "ltrch" | "fcs" => {}
      _ => {
        if SKIPPED_DESTINATIONS.contains(&word) {
          self.skip_until = Some(self.depth.max(1));
        }
      }
    }
    cursor
  }

  /// Skips the fallback characters that follow a Unicode escape.
  fn skip_fallback(&self, bytes: &[u8], cursor: usize) -> usize {
    let mut index = cursor;
    let mut remaining = self.fallback.unwrap_or(1);
    while remaining > 0 && index < bytes.len() {
      if bytes[index] == b'\\' && index + 1 < bytes.len() {
        if bytes[index + 1] == b'\'' {
          index = (index + 4).min(bytes.len());
        } else {
          index += 2;
        }
      } else {
        index += 1;
      }
      remaining -= 1;
    }
    index
  }

  fn push_byte(&mut self, byte: u8) {
    self.pending.push(byte);
  }

  fn push_text(&mut self, text: &str) {
    if text.is_empty() {
      return;
    }
    match self.current.last_mut() {
      Some((format, Piece::Text(existing))) if *format == self.format => {
        existing.push_str(text);
      }
      _ => self.current.push((self.format, Piece::Text(text.to_string()))),
    }
  }

  fn flush_pending(&mut self) {
    if self.pending.is_empty() {
      return;
    }
    let text = decode_bytes(&self.pending);
    self.pending.clear();
    self.push_text(&text);
  }

  fn flush_paragraph(&mut self) {
    self.flush_pending();
    if self.current.is_empty() {
      return;
    }
    let mut pieces = std::mem::take(&mut self.current);
    trim_pieces(&mut pieces);
    let inlines = render(&pieces);
    if !inlines.is_empty() && !Inline::plain_text(&inlines).trim().is_empty() {
      self.blocks.push(Block::Paragraph(inlines));
    }
  }
}

fn trim_pieces(pieces: &mut Vec<(Format, Piece)>) {
  loop {
    match pieces.first_mut() {
      Some((_, Piece::Text(text))) => {
        let trimmed = text.trim_start_matches(is_space).to_string();
        if trimmed.is_empty() {
          pieces.remove(0);
          continue;
        }
        *text = trimmed;
        break;
      }
      Some(_) => break,
      None => return,
    }
  }
  loop {
    match pieces.last_mut() {
      Some((_, Piece::Text(text))) => {
        let trimmed = text.trim_end_matches(is_space).to_string();
        if trimmed.is_empty() {
          pieces.pop();
          continue;
        }
        *text = trimmed;
        break;
      }
      Some(_) => break,
      None => return,
    }
  }
}

fn is_space(ch: char) -> bool {
  matches!(ch, ' ' | '\t' | '\r' | '\n')
}

fn render(pieces: &[(Format, Piece)]) -> Vec<Inline> {
  let mut out: Vec<Inline> = Vec::new();
  for (format, piece) in pieces {
    match piece {
      Piece::Text(text) => {
        if text.is_empty() {
          continue;
        }
        out.extend(wrap(*format, vec![Inline::Text(text.clone())]));
      }
      Piece::Break => out.push(Inline::HardBreak),
      Piece::Tab => out.push(Inline::Text("\t".to_string())),
    }
  }
  out
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

/// RTF escapes carry raw bytes: prefer UTF-8 when the run happens to be valid
/// and fall back to Windows-1252 otherwise.
fn decode_bytes(bytes: &[u8]) -> String {
  if bytes.is_ascii() {
    return String::from_utf8_lossy(bytes).into_owned();
  }
  if let Ok(text) = std::str::from_utf8(bytes) {
    return text.to_string();
  }
  let mut out = String::with_capacity(bytes.len());
  for byte in bytes {
    out.push(cp1252(*byte));
  }
  out
}

fn cp1252(byte: u8) -> char {
  const HIGH: [char; 32] = [
    '\u{20AC}', '\u{FFFD}', '\u{201A}', '\u{0192}', '\u{201E}', '\u{2026}', '\u{2020}', '\u{2021}',
    '\u{02C6}', '\u{2030}', '\u{0160}', '\u{2039}', '\u{0152}', '\u{FFFD}', '\u{017D}', '\u{FFFD}',
    '\u{FFFD}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}', '\u{2022}', '\u{2013}', '\u{2014}',
    '\u{02DC}', '\u{2122}', '\u{0161}', '\u{203A}', '\u{0153}', '\u{FFFD}', '\u{017E}', '\u{0178}',
  ];
  if byte < 0x80 {
    return byte as char;
  }
  if byte < 0xA0 {
    return HIGH[(byte - 0x80) as usize];
  }
  char::from(byte)
}
