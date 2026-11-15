//! Integration tests for the five writers.
//!
//! The zip containers are inspected through the central directory directly, so
//! the package layout is checked without a zip dev-dependency.

use doc_rs::model::{Align, Block, Document, Inline};
use doc_rs::writers::{docx, epub, markup, plain, rtf};

/* ------------------------------------------------------------------ fixture -- */

fn text(value: &str) -> Vec<Inline> {
  vec![Inline::Text(value.to_string())]
}

fn paragraph(value: &str) -> Block {
  Block::Paragraph(text(value))
}

fn heading(level: u8, value: &str) -> Block {
  Block::Heading {
    level,
    content: text(value),
  }
}

fn sample() -> Document {
  Document {
    meta: vec![
      ("title".to_string(), "Writer Guide".to_string()),
      ("author".to_string(), "Ada Lovelace".to_string()),
      ("weird".to_string(), "a: b".to_string()),
    ],
    blocks: vec![
      heading(1, "Title"),
      Block::Paragraph(vec![
        Inline::Text("plain ".to_string()),
        Inline::Strong(text("bold")),
        Inline::Emphasis(text("italic")),
        Inline::Strike(text("struck")),
        Inline::Underline(text("under")),
        Inline::Code("let x = 1;".to_string()),
        Inline::Math("a^2".to_string()),
      ]),
      Block::Paragraph(vec![Inline::Math("\\int_0^1 x dx".to_string())]),
      heading(2, "Sub"),
      heading(3, "Sub sub"),
      paragraph("sub sub body"),
      Block::CodeBlock {
        language: Some("rust".to_string()),
        text: "fn main() {\n  println!(\"hi\");\n}".to_string(),
      },
      Block::Quote(vec![paragraph("quoted")]),
      Block::List {
        ordered: false,
        start: 1,
        items: vec![
          vec![paragraph("first")],
          vec![
            paragraph("second"),
            Block::List {
              ordered: true,
              start: 3,
              items: vec![vec![paragraph("nested three")]],
            },
          ],
          vec![paragraph("[x] done")],
          vec![paragraph("[ ] todo")],
        ],
      },
      Block::List {
        ordered: true,
        start: 3,
        items: vec![vec![paragraph("three")], vec![paragraph("four")]],
      },
      Block::Table {
        header: vec![text("Left"), text("Center"), text("Right")],
        align: vec![Align::Left, Align::Center, Align::Right],
        rows: vec![vec![text("a"), text("b"), text("c")]],
      },
      Block::Rule,
      Block::Paragraph(vec![Inline::Image {
        src: "pic.png".to_string(),
        alt: "alt text".to_string(),
        title: None,
      }]),
      Block::Paragraph(vec![Inline::Link {
        href: "https://example.com".to_string(),
        title: Some("Example".to_string()),
        content: text("link"),
      }]),
      paragraph("tail paragraph"),
      heading(1, "Second Chapter"),
      paragraph("chapter two body"),
    ],
  }
}

/* ----------------------------------------------------------------- markdown -- */

#[test]
fn markdown_round_trip_structure() {
  let out = plain::markdown(&sample());

  // YAML front matter, with a quoted scalar where the value needs it.
  assert!(
    out.starts_with("---\ntitle: Writer Guide\nauthor: Ada Lovelace\nweird: \"a: b\"\n---\n\n"),
    "front matter wrong:\n{out}"
  );

  // headings
  assert!(out.contains("\n# Title\n"), "{out}");
  assert!(out.contains("\n## Sub\n"), "{out}");
  assert!(out.contains("\n### Sub sub\n"), "{out}");

  // inline formatting
  assert!(out.contains("**bold**"), "{out}");
  assert!(out.contains("*italic*"), "{out}");
  assert!(out.contains("~~struck~~"), "{out}");
  assert!(out.contains("<u>under</u>"), "{out}");
  assert!(out.contains("`let x = 1;`"), "{out}");
  assert!(out.contains("$a^2$"), "{out}");

  // block math
  assert!(out.contains("$\n\\int_0^1 x dx\n$"), "{out}");

  // fenced code with language
  assert!(out.contains("```rust\nfn main() {\n  println!(\"hi\");\n}\n```"), "{out}");

  // quote, nested lists, task items and ordered list start
  assert!(out.contains("> quoted"), "{out}");
  assert!(out.contains("- first"), "{out}");
  assert!(out.contains("- second\n  3. nested three"), "{out}");
  assert!(out.contains("- [x] done"), "{out}");
  assert!(out.contains("- [ ] todo"), "{out}");
  assert!(out.contains("\n3. three\n4. four"), "{out}");

  // table with alignment markers
  assert!(out.contains("| :--- | :----: | ----: |"), "{out}");

  // link, image, rule
  assert!(out.contains("[link](https://example.com \"Example\")"), "{out}");
  assert!(out.contains("![alt text](pic.png)"), "{out}");
  assert!(out.contains("\n---\n"), "{out}");
  assert!(out.ends_with('\n'), "{out}");
}

#[test]
fn markdown_escapes_only_what_matters() {
  let document = Document {
    meta: Vec::new(),
    blocks: vec![
      paragraph("*not emphasis* [not a link] snake_case_word"),
      paragraph("# not a heading"),
      paragraph("1. not a list"),
      paragraph("- not a bullet"),
      paragraph("costs 5 dollars, 50% off"),
    ],
  };
  let out = plain::markdown(&document);
  assert!(out.contains("\\*not emphasis\\* \\[not a link\\] snake_case_word"), "{out}");
  assert!(out.contains("\\# not a heading"), "{out}");
  assert!(out.contains("1\\. not a list"), "{out}");
  assert!(out.contains("\\- not a bullet"), "{out}");
  // no over-escaping of plain prose
  assert!(out.contains("costs 5 dollars, 50% off"), "{out}");
}

/* --------------------------------------------------------------------- html -- */

#[test]
fn html_typora_dom_contract() {
  let out = plain::html(&sample());

  assert!(out.contains("<h1 class=\"md-end-block\">Title</h1>"), "{out}");
  assert!(out.contains("<h2 class=\"md-end-block\">Sub</h2>"), "{out}");
  assert!(out.contains("<p class=\"md-end-block md-p\">"), "{out}");
  assert!(out.contains("<strong>bold</strong>"), "{out}");
  assert!(out.contains("<em>italic</em>"), "{out}");
  assert!(out.contains("<del>struck</del>"), "{out}");
  assert!(out.contains("<u>under</u>"), "{out}");
  assert!(out.contains("<code>let x = 1;</code>"), "{out}");
  assert!(out.contains("<span class=\"md-inline-math\" data-math=\"a^2\">a^2</span>"), "{out}");
  assert!(out.contains("<div class=\"md-math-block md-end-block\" contenteditable=\"false\" data-math=\"\\int_0^1 x dx\">"), "{out}");
  assert!(
    out.contains(
      "<pre class=\"md-fences md-end-block\" lang=\"rust\"><code class=\"language-rust hljs\">fn main() {\n  println!(&quot;hi&quot;);\n}</code></pre>"
    ),
    "{out}"
  );
  assert!(out.contains("<blockquote class=\"md-end-block\">"), "{out}");
  assert!(out.contains("<ul class=\"ul-list\" data-mark=\"-\">"), "{out}");
  assert!(out.contains("<ol class=\"ol-list\" start=\"3\">"), "{out}");
  assert!(out.contains("<li class=\"md-list-item\">"), "{out}");
  assert!(
    out.contains("<li class=\"md-list-item task-list-item md-task-list-item task-list-done\"><input type=\"checkbox\" class=\"task-list-item-checkbox\" checked>done</li>"),
    "{out}"
  );
  assert!(out.contains("task-list-not-done"), "{out}");
  assert!(out.contains("<div class=\"md-table md-table-fig md-end-block\">\n<table class=\"md-table\">"), "{out}");
  assert!(out.contains("<th align=\"left\" style=\"text-align: left\">Left</th>"), "{out}");
  assert!(out.contains("<th align=\"center\" style=\"text-align: center\">Center</th>"), "{out}");
  assert!(out.contains("<th align=\"right\" style=\"text-align: right\">Right</th>"), "{out}");
  assert!(out.contains("<hr class=\"md-hr md-end-block\">"), "{out}");
  assert!(out.contains("<img src=\"pic.png\" alt=\"alt text\">"), "{out}");
  assert!(out.contains("<a href=\"https://example.com\" title=\"Example\">link</a>"), "{out}");
}

#[test]
fn html_escapes_attributes() {
  let document = Document {
    meta: Vec::new(),
    blocks: vec![Block::Paragraph(vec![Inline::Link {
      href: "https://example.com/?a=1&b=\"2\"".to_string(),
      title: Some("<t>".to_string()),
      content: text("x < y & z"),
    }])],
  };
  let out = plain::html(&document);
  assert!(out.contains("href=\"https://example.com/?a=1&amp;b=&quot;2&quot;\""), "{out}");
  assert!(out.contains("title=\"&lt;t&gt;\""), "{out}");
  assert!(out.contains("x &lt; y &amp; z"), "{out}");
}

/* ------------------------------------------------------------------- markup -- */

#[test]
fn org_syntax() {
  let out = markup::org(&sample());
  assert!(out.starts_with("#+TITLE: Writer Guide\n#+AUTHOR: Ada Lovelace\n"), "{out}");
  assert!(out.contains("\n* Title\n"), "{out}");
  assert!(out.contains("\n** Sub\n"), "{out}");
  assert!(out.contains("*** Sub sub"), "{out}");
  assert!(out.contains("*bold*"), "{out}");
  assert!(out.contains("/italic/"), "{out}");
  assert!(out.contains("+struck+"), "{out}");
  assert!(out.contains("_under_"), "{out}");
  assert!(out.contains("=let x = 1;="), "{out}");
  assert!(out.contains("#+BEGIN_SRC rust\nfn main()"), "{out}");
  assert!(out.contains("#+END_SRC"), "{out}");
  assert!(out.contains("- first"), "{out}");
  assert!(out.contains("[[https://example.com][link]]"), "{out}");
  assert!(out.contains("| Left | Center | Right |"), "{out}");
  assert!(out.contains("|---+---+---|"), "{out}");
  assert!(out.contains("-----"), "{out}");
  assert!(out.contains("#+BEGIN_QUOTE\nquoted\n#+END_QUOTE"), "{out}");
}

#[test]
fn rst_syntax() {
  let out = markup::rst(&sample());
  assert!(out.starts_with(":title: Writer Guide\n:author: Ada Lovelace\n"), "{out}");
  assert!(out.contains("Title\n====="), "{out}");
  assert!(out.contains("Sub\n---"), "{out}");
  assert!(out.contains("plain **bold**\\ *italic*"), "{out}");
  assert!(out.contains(":strike:`struck`"), "{out}");
  assert!(out.contains("``let x = 1;``"), "{out}");
  assert!(out.contains(":math:`a^2`"), "{out}");
  assert!(out.contains(".. code-block:: rust"), "{out}");
  assert!(out.contains("   fn main() {"), "{out}");
  assert!(out.contains("- first"), "{out}");
  assert!(out.contains("`link <https://example.com>`_"), "{out}");
  assert!(out.contains("====="), "{out}");
  assert!(out.contains(".. epigraph::\n\n   quoted"), "{out}");
  assert!(out.contains("----"), "{out}");
}

#[test]
fn textile_syntax() {
  let out = markup::textile(&sample());
  assert!(out.contains("h1. Title"), "{out}");
  assert!(out.contains("h2. Sub"), "{out}");
  assert!(out.contains("h3. Sub sub"), "{out}");
  assert!(out.contains("*bold*"), "{out}");
  assert!(out.contains("_italic_"), "{out}");
  assert!(out.contains("-struck-"), "{out}");
  assert!(out.contains("+under+"), "{out}");
  assert!(out.contains("@let x = 1;@"), "{out}");
  assert!(out.contains("bc.. fn main() {"), "{out}");
  assert!(out.contains("* first"), "{out}");
  assert!(out.contains("# three"), "{out}");
  assert!(out.contains("\"link\":https://example.com"), "{out}");
  assert!(out.contains("|_. Left |_. Center |_. Right |"), "{out}");
  assert!(out.contains("bq. quoted"), "{out}");
}

#[test]
fn mediawiki_syntax() {
  let out = markup::mediawiki(&sample());
  assert!(out.contains("= Title ="), "{out}");
  assert!(out.contains("== Sub =="), "{out}");
  assert!(out.contains("=== Sub sub ==="), "{out}");
  assert!(out.contains("'''bold'''"), "{out}");
  assert!(out.contains("''italic''"), "{out}");
  assert!(out.contains("<s>struck</s>"), "{out}");
  assert!(out.contains("<code>let x = 1;</code>"), "{out}");
  assert!(out.contains("<math>a^2</math>"), "{out}");
  assert!(out.contains("<syntaxhighlight lang=\"rust\">"), "{out}");
  // code inside a block keeps its braces and quotes
  assert!(out.contains("fn main() {\n  println!(\"hi\");\n}"), "{out}");
  assert!(out.contains("* first"), "{out}");
  assert!(out.contains("[https://example.com link]"), "{out}");
  assert!(out.contains("{| class=\"wikitable\""), "{out}");
  assert!(out.contains("----"), "{out}");
  assert!(out.contains("<blockquote>\nquoted\n</blockquote>"), "{out}");
}

#[test]
fn latex_syntax() {
  let out = markup::latex(&sample());
  assert!(out.starts_with("\\documentclass{article}"), "{out}");
  assert!(out.contains("\\title{Writer Guide}"), "{out}");
  assert!(out.contains("\\author{Ada Lovelace}"), "{out}");
  assert!(out.contains("\\maketitle"), "{out}");
  assert!(out.contains("\\section{Title}"), "{out}");
  assert!(out.contains("\\subsection{Sub}"), "{out}");
  assert!(out.contains("\\subsubsection{Sub sub}"), "{out}");
  assert!(out.contains("\\textbf{bold}"), "{out}");
  assert!(out.contains("\\emph{italic}"), "{out}");
  assert!(out.contains("\\sout{struck}"), "{out}");
  assert!(out.contains("\\texttt{let x = 1;}"), "{out}");
  assert!(out.contains("\\[\n\\int_0^1 x dx\n\\]"), "{out}");
  assert!(out.contains("\\begin{lstlisting}[language=rust]"), "{out}");
  assert!(out.contains("\\begin{itemize}"), "{out}");
  assert!(out.contains("\\begin{enumerate}"), "{out}");
  assert!(out.contains("\\setcounter{enumi}{2}"), "{out}");
  assert!(out.contains("\\begin{tabular}{|l|c|r|}"), "{out}");
  assert!(out.contains("\\href{https://example.com}{link}"), "{out}");
  assert!(out.ends_with("\\end{document}\n"), "{out}");
}

/* --------------------------------------------------------------------- opml -- */

#[test]
fn opml_outline_hierarchy() {
  let out = markup::opml(&sample());
  assert!(out.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<opml version=\"2.0\">\n"), "{out}");
  assert!(out.contains("<head>\n<title>Writer Guide</title>\n</head>\n<body>"), "{out}");

  let find = |needle: &str| match out.find(needle) {
    Some(index) => index,
    None => panic!("missing {needle} in:
{out}"),
  };
  let level_one = find("<outline text=\"Title\"");
  let level_two = find("<outline text=\"Sub\"");
  let level_three = find("<outline text=\"Sub sub\"");
  assert!(level_one < level_two && level_two < level_three, "{out}");

  // nesting is expressed by indentation and by containment
  let line_of = |index: usize| {
    let start = out[..index].rfind('\n').map_or(0, |offset| offset + 1);
    let end = out[index..].find('\n').map_or(out.len(), |offset| index + offset);
    &out[start..end]
  };
  assert!(line_of(level_one).starts_with("  <outline "), "{out}");
  assert!(line_of(level_two).starts_with("    <outline "), "{out}");
  assert!(line_of(level_three).starts_with("      <outline "), "{out}");

  let close = out.find("</outline>").expect("closing outline");
  assert!(level_three < close, "{out}");

  // paragraphs become _note of the enclosing heading, newlines escaped as &#10;
  assert!(
    out.contains("<outline text=\"Sub sub\" _note=\"sub sub body&#10;"),
    "{out}"
  );
  assert!(out.contains("&#10;quoted&#10;"), "{out}");
  assert!(
    out.contains("<outline text=\"Title\" _note=\"plain bold"),
    "{out}"
  );
  assert!(
    out.contains("<outline text=\"Second Chapter\" _note=\"chapter two body\"/>"),
    "{out}"
  );
  assert!(out.ends_with("</body>\n</opml>\n"), "{out}");
}

/* ---------------------------------------------------------------------- rtf -- */

#[test]
fn rtf_structure() {
  let bytes = rtf::write(&sample()).expect("rtf");
  let out = String::from_utf8(bytes).expect("rtf output is ascii");
  assert!(out.starts_with("{\\rtf1\\ansi\\ansicpg1252\\deff0"), "{out}");
  assert!(out.contains("{\\fonttbl{\\f0 Calibri;}"), "{out}");
  assert!(out.contains("{\\colortbl;"), "{out}");

  let opens = out.matches('{').count();
  let closes = out.matches('}').count();
  assert_eq!(opens, closes, "braces must balance");
  assert!(out.ends_with("}\n"), "{out}");

  assert!(out.contains("{\\b bold}"), "{out}");
  assert!(out.contains("{\\i italic}"), "{out}");
  assert!(out.contains("{\\ul under}"), "{out}");
  assert!(out.contains("{\\strike struck}"), "{out}");
  assert!(out.contains("\\par"), "{out}");

  // headings approximated with a bold, larger font size
  assert!(out.contains("\\b\\fs40 Title\\b0"), "{out}");
  assert!(out.contains("\\b\\fs30 Sub sub\\b0"), "{out}");

  // lists are hand written with \\u8226 for bullets
  assert!(out.contains("\\u8226?"), "{out}");
  assert!(out.contains("\\li360\\fi-360 \\u8226? \\tab first"), "{out}");
  assert!(out.contains("\\li360\\fi-360 3. \\tab three"), "{out}");

  // table row definitions
  assert!(out.contains("\\trowd"), "{out}");
  assert!(out.contains("\\cellx"), "{out}");
  assert!(out.contains("\\cell "), "{out}");
  assert!(out.contains("\\row"), "{out}");

  // hyperlink field
  assert!(out.contains("HYPERLINK \"https://example.com\""), "{out}");

  // non-ascii becomes \uNNNN?
  let unicode = rtf::write(&Document {
    meta: Vec::new(),
    blocks: vec![paragraph("汉字 — é")],
  })
  .expect("rtf");
  let text = String::from_utf8(unicode).expect("ascii");
  assert!(text.contains("\\u27721?"), "{text}"); // 汉
  assert!(text.contains("\\u8212?"), "{text}"); // em dash, decimal U+2014
  assert!(text.contains("\\u233?"), "{text}"); // é
  assert!(!text.contains('汉'), "{text}");
}

/* --------------------------------------------------------------------- docx -- */

struct ZipEntry {
  name: String,
  method: u16,
  compressed: u32,
  uncompressed: u32,
  local_header: u32,
}

fn u16_at(bytes: &[u8], offset: usize) -> u16 {
  u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

fn u32_at(bytes: &[u8], offset: usize) -> u32 {
  u32::from_le_bytes([
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  ])
}

fn zip_entries(bytes: &[u8]) -> Vec<ZipEntry> {
  let mut eocd = None;
  let floor = bytes.len().saturating_sub(66_000);
  for offset in (floor..bytes.len().saturating_sub(3)).rev() {
    if bytes[offset..offset + 4] == [0x50, 0x4b, 0x05, 0x06] {
      eocd = Some(offset);
      break;
    }
  }
  let eocd = eocd.expect("end of central directory record");
  let count = u16_at(bytes, eocd + 10) as usize;
  let mut cursor = u32_at(bytes, eocd + 16) as usize;
  let mut entries = Vec::with_capacity(count);
  for _ in 0..count {
    assert_eq!(
      bytes[cursor..cursor + 4],
      [0x50, 0x4b, 0x01, 0x02],
      "central directory entry signature"
    );
    let name_len = u16_at(bytes, cursor + 28) as usize;
    let extra_len = u16_at(bytes, cursor + 30) as usize;
    let comment_len = u16_at(bytes, cursor + 32) as usize;
    let name = String::from_utf8_lossy(&bytes[cursor + 46..cursor + 46 + name_len]).to_string();
    entries.push(ZipEntry {
      name,
      method: u16_at(bytes, cursor + 10),
      compressed: u32_at(bytes, cursor + 20),
      uncompressed: u32_at(bytes, cursor + 24),
      local_header: u32_at(bytes, cursor + 42),
    });
    cursor += 46 + name_len + extra_len + comment_len;
  }
  entries
}

fn stored_bytes<'a>(bytes: &'a [u8], entry: &ZipEntry) -> &'a [u8] {
  assert_eq!(entry.method, 0, "{} must be stored", entry.name);
  let header = entry.local_header as usize;
  assert_eq!(
    bytes[header..header + 4],
    [0x50, 0x4b, 0x03, 0x04],
    "local file header signature"
  );
  let name_len = u16_at(bytes, header + 26) as usize;
  let extra_len = u16_at(bytes, header + 28) as usize;
  let start = header + 30 + name_len + extra_len;
  &bytes[start..start + entry.compressed as usize]
}

#[test]
fn docx_package_parts() {
  let bytes = docx::write(&sample()).expect("docx");
  assert!(bytes.starts_with(&[0x50, 0x4b, 0x03, 0x04]), "zip local header");

  let entries = zip_entries(&bytes);
  let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
  assert_eq!(
    names,
    [
      "[Content_Types].xml",
      "_rels/.rels",
      "word/document.xml",
      "word/styles.xml",
      "word/numbering.xml",
      "word/_rels/document.xml.rels",
      "docProps/core.xml",
      "docProps/app.xml",
    ],
    "eight package parts in OOXML order"
  );
  for entry in &entries {
    assert!(entry.uncompressed > 0, "{} is empty", entry.name);
  }
  let document = entries
    .iter()
    .find(|entry| entry.name == "word/document.xml")
    .expect("document.xml");
  assert!(
    document.uncompressed > 1000,
    "document.xml looks empty: {} bytes",
    document.uncompressed
  );
}

#[test]
fn docx_rejects_nothing_for_empty_document() {
  let empty = Document::default();
  let bytes = docx::write(&empty).expect("docx");
  assert_eq!(zip_entries(&bytes).len(), 8);
}

/* --------------------------------------------------------------------- epub -- */

#[test]
fn epub_container_layout() {
  let bytes = epub::write(&sample()).expect("epub");
  let entries = zip_entries(&bytes);

  let first = entries.first().expect("at least one entry");
  assert_eq!(first.name, "mimetype", "mimetype must be the first entry");
  assert_eq!(first.method, 0, "mimetype must be stored, not deflated");
  assert_eq!(
    stored_bytes(&bytes, first),
    b"application/epub+zip",
    "mimetype payload"
  );

  let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
  for expected in [
    "META-INF/container.xml",
    "OEBPS/content.opf",
    "OEBPS/nav.xhtml",
    "OEBPS/style.css",
    "OEBPS/chapter1.xhtml",
    "OEBPS/chapter2.xhtml",
  ] {
    assert!(names.contains(&expected), "missing {expected} in {names:?}");
  }
  assert!(
    !names.iter().any(|name| name.contains("chapter3")),
    "level two headings must not split chapters: {names:?}"
  );
}

#[test]
fn writes_artifacts_for_external_validation() {
  let directory = std::env::temp_dir().join("doc-rs-writers-artifacts");
  std::fs::create_dir_all(&directory).expect("artifact directory");
  let document = sample();
  let docx_bytes = docx::write(&document).expect("docx");
  let epub_bytes = epub::write(&document).expect("epub");
  let rtf_bytes = rtf::write(&document).expect("rtf");
  std::fs::write(directory.join("sample.docx"), &docx_bytes).expect("write docx");
  std::fs::write(directory.join("sample.epub"), &epub_bytes).expect("write epub");
  std::fs::write(directory.join("sample.rtf"), &rtf_bytes).expect("write rtf");
  std::fs::write(directory.join("sample.md"), plain::markdown(&document)).expect("write md");
  std::fs::write(directory.join("sample.html"), plain::html(&document)).expect("write html");
  std::fs::write(directory.join("sample.org"), markup::org(&document)).expect("write org");
  std::fs::write(directory.join("sample.rst"), markup::rst(&document)).expect("write rst");
  std::fs::write(directory.join("sample.textile"), markup::textile(&document)).expect("write textile");
  std::fs::write(directory.join("sample.mediawiki"), markup::mediawiki(&document)).expect("write mediawiki");
  std::fs::write(directory.join("sample.opml"), markup::opml(&document)).expect("write opml");
  std::fs::write(directory.join("sample.tex"), markup::latex(&document)).expect("write latex");
  for name in [
    "sample.docx",
    "sample.epub",
    "sample.rtf",
    "sample.md",
    "sample.opml",
    "sample.tex",
  ] {
    let metadata = std::fs::metadata(directory.join(name)).expect("artifact metadata");
    assert!(metadata.len() > 0, "{name} is empty");
  }
}

#[test]
fn epub_without_headings_has_one_chapter() {
  let document = Document {
    meta: vec![("title".to_string(), "Lonely".to_string())],
    blocks: vec![paragraph("body only")],
  };
  let bytes = epub::write(&document).expect("epub");
  let entries = zip_entries(&bytes);
  let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
  assert!(names.contains(&"OEBPS/chapter1.xhtml"), "{names:?}");
  assert!(!names.contains(&"OEBPS/chapter2.xhtml"), "{names:?}");
}
