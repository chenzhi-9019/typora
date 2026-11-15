//! Reader integration tests. Samples that live in a zip container are built in
//! memory so the fixtures stay readable text instead of opaque binaries.

use std::io::{Cursor, Write};

use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use doc_rs::model::{Align, Block, Document, Inline};

use doc_rs::readers::{docx, epub, html, rtf};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

fn zip_of(entries: &[(&str, &str)]) -> Vec<u8> {
  let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
  for (name, body) in entries {
    writer
      .start_file(*name, SimpleFileOptions::default())
      .expect("zip entry");
    writer.write_all(body.as_bytes()).expect("zip body");
  }
  writer.finish().expect("zip finish").into_inner()
}

fn text(value: &str) -> Inline {
  Inline::Text(value.to_string())
}

fn plain(block: &Block) -> String {
  match block {
    Block::Paragraph(inlines) | Block::Heading { content: inlines, .. } => {
      Inline::plain_text(inlines)
    }
    other => Block::plain_text(std::slice::from_ref(other)),
  }
}

fn headings(document: &Document) -> Vec<(u8, String)> {
  document
    .blocks
    .iter()
    .filter_map(|block| match block {
      Block::Heading { level, content } => Some((*level, Inline::plain_text(content))),
      _ => None,
    })
    .collect()
}

fn meta_value(document: &Document, key: &str) -> Option<String> {
  document
    .meta
    .iter()
    .find(|(name, _)| name == key)
    .map(|(_, value)| value.clone())
}

fn paragraph_text(block: &Block) -> Vec<Inline> {
  match block {
    Block::Paragraph(inlines) => inlines.clone(),
    other => panic!("expected a paragraph, got {other:?}"),
  }
}

// ---------------------------------------------------------------------------
// docx
// ---------------------------------------------------------------------------

const DOCX_NAMESPACES: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture""#;

const DOCX_BODY: &str = r#"<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Chapter One</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Plain </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r><w:r><w:t xml:space="preserve"> text.</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>First item</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Second item</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>alpha</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:jc w:val="center"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:hyperlink r:id="rId5"><w:r><w:t>Example site</w:t></w:r></w:hyperlink></w:p>
<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture 1" descr="A cat"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#;

fn docx_document(body: &str) -> String {
  format!(
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document {DOCX_NAMESPACES}><w:body>{body}<w:sectPr/></w:body></w:document>"#
  )
}

const DOCX_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/docs" TargetMode="External"/>
<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>"#;

const DOCX_NUMBERING: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="7"/></w:num>
</w:numbering>"#;

const DOCX_CORE: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>Sample document</dc:title><dc:creator>Ada Lovelace</dc:creator><dc:subject>Readers</dc:subject>
</cp:coreProperties>"#;

fn docx_sample(with_numbering: bool) -> Vec<u8> {
  let document = docx_document(DOCX_BODY);
  let mut entries: Vec<(&str, &str)> = vec![
    ("[Content_Types].xml", "<Types/>"),
    ("word/document.xml", document.as_str()),
    ("word/_rels/document.xml.rels", DOCX_RELS),
    ("docProps/core.xml", DOCX_CORE),
  ];
  if with_numbering {
    entries.push(("word/numbering.xml", DOCX_NUMBERING));
  }
  zip_of(&entries)
}

#[test]
fn docx_reads_headings_paragraphs_and_runs() {
  let document = docx::read(&docx_sample(true)).expect("docx parses");

  assert_eq!(
    headings(&document),
    vec![(1u8, "Chapter One".to_string())],
    "Heading1 style becomes a level one heading"
  );
  assert_eq!(
    document.blocks[1],
    Block::Paragraph(vec![
      text("Plain "),
      Inline::Strong(vec![text("bold")]),
      Inline::Emphasis(vec![text("italic")]),
      text(" text."),
    ]),
    "bold and italic runs wrap their text"
  );
  assert_eq!(plain(&document.blocks[0]), "Chapter One");
}

#[test]
fn docx_reads_numbered_lists() {
  let document = docx::read(&docx_sample(true)).expect("docx parses");
  let list = document
    .blocks
    .iter()
    .find(|block| matches!(block, Block::List { .. }))
    .expect("list block");

  match list {
    Block::List {
      ordered,
      start,
      items,
    } => {
      assert!(*ordered, "decimal numFmt is an ordered list");
      assert_eq!(*start, 1);
      assert_eq!(items.len(), 2);
      assert_eq!(plain(&items[0][0]), "First item");
      assert_eq!(plain(&items[1][0]), "Second item");
    }
    other => panic!("unexpected block {other:?}"),
  }
}

#[test]
fn docx_without_numbering_falls_back_to_bullets() {
  let document = docx::read(&docx_sample(false)).expect("docx parses without numbering.xml");
  let list = document
    .blocks
    .iter()
    .find(|block| matches!(block, Block::List { .. }))
    .expect("list block still present");
  assert!(
    matches!(list, Block::List { ordered: false, .. }),
    "a missing numbering part degrades to an unordered list"
  );
}

#[test]
fn docx_reads_tables() {
  let document = docx::read(&docx_sample(true)).expect("docx parses");
  let table = document
    .blocks
    .iter()
    .find(|block| matches!(block, Block::Table { .. }))
    .expect("table block");

  match table {
    Block::Table { header, align, rows } => {
      assert_eq!(header.len(), 2);
      assert_eq!(Inline::plain_text(&header[0]), "Name");
      assert_eq!(Inline::plain_text(&header[1]), "Value");
      assert_eq!(align, &vec![Align::None, Align::None]);
      assert_eq!(rows.len(), 1);
      assert_eq!(Inline::plain_text(&rows[0][0]), "alpha");
      assert_eq!(Inline::plain_text(&rows[0][1]), "1");
    }
    other => panic!("unexpected block {other:?}"),
  }
}

#[test]
fn docx_reads_underline_and_strike() {
  let body = r#"<w:p><w:r><w:rPr><w:u w:val="single"/><w:strike/></w:rPr><w:t>decorated</w:t></w:r><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t xml:space="preserve"> plain</w:t></w:r></w:p>"#;
  let document = docx_document(body);
  let sample = zip_of(&[("word/document.xml", document.as_str())]);
  let parsed = docx::read(&sample).expect("docx parses");

  assert_eq!(
    parsed.blocks[0],
    Block::Paragraph(vec![
      Inline::Underline(vec![Inline::Strike(vec![text("decorated")])]),
      text(" plain"),
    ]),
    "underline and strike wrap the run, and b w:val=0 turns bold off"
  );
}

#[test]
fn docx_nests_lists_by_ilvl() {
  let body = r#"<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Top</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Child</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Second top</w:t></w:r></w:p>"#;
  let document = docx_document(body);
  let sample = zip_of(&[
    ("word/document.xml", document.as_str()),
    ("word/numbering.xml", DOCX_NUMBERING),
  ]);
  let parsed = docx::read(&sample).expect("docx parses");

  match &parsed.blocks[0] {
    Block::List { ordered, items, .. } => {
      assert!(*ordered);
      assert_eq!(items.len(), 2, "two top level items");
      assert_eq!(plain(&items[0][0]), "Top");
      match &items[0][1] {
        Block::List { items: nested, .. } => {
          assert_eq!(nested.len(), 1);
          assert_eq!(plain(&nested[0][0]), "Child");
        }
        other => panic!("expected a nested list, got {other:?}"),
      }
      assert_eq!(plain(&items[1][0]), "Second top");
    }
    other => panic!("unexpected block {other:?}"),
  }
}

#[test]
fn docx_reads_hyperlinks_and_images() {
  let document = docx::read(&docx_sample(true)).expect("docx parses");

  let link = document
    .blocks
    .iter()
    .flat_map(|block| match block {
      Block::Paragraph(inlines) => inlines.clone(),
      _ => Vec::new(),
    })
    .find_map(|inline| match inline {
      Inline::Link { href, content, .. } => Some((href, Inline::plain_text(&content))),
      _ => None,
    })
    .expect("hyperlink");
  assert_eq!(link.0, "https://example.com/docs");
  assert_eq!(link.1, "Example site");

  let image = document
    .blocks
    .iter()
    .flat_map(|block| match block {
      Block::Paragraph(inlines) => inlines.clone(),
      _ => Vec::new(),
    })
    .find_map(|inline| match inline {
      Inline::Image { src, alt, .. } => Some((src, alt)),
      _ => None,
    })
    .expect("inline image");
  assert_eq!(image.0, "media/image1.png");
  assert_eq!(image.1, "A cat");
}

#[test]
fn docx_reads_core_properties() {
  let document = docx::read(&docx_sample(true)).expect("docx parses");
  assert_eq!(
    meta_value(&document, "title").as_deref(),
    Some("Sample document")
  );
  assert_eq!(
    meta_value(&document, "creator").as_deref(),
    Some("Ada Lovelace")
  );
  assert_eq!(meta_value(&document, "subject").as_deref(), Some("Readers"));
}

#[test]
fn docx_rejects_non_zip_input() {
  let error = docx::read(b"not a zip file").expect_err("must fail");
  let message = error.to_string();
  assert!(
    message.to_lowercase().contains("docx"),
    "error mentions the format: {message}"
  );
}

// ---------------------------------------------------------------------------
// epub
// ---------------------------------------------------------------------------

const EPUB_CONTAINER: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#;

const EPUB_OPF: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>Two Chapters</dc:title><dc:creator>Grace Hopper</dc:creator><dc:language>en</dc:language>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml"/>
<item id="ch1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
<item id="ch2" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
</manifest>
<spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>"#;

const EPUB_CHAPTER1: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head>
<body><h1>Chapter One</h1><p>First chapter body.</p></body></html>"#;

const EPUB_CHAPTER2: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Two</title></head>
<body><h1>Chapter Two</h1><p>Second chapter body with <em>emphasis</em>.</p></body></html>"#;

fn epub_sample() -> Vec<u8> {
  zip_of(&[
    ("mimetype", "application/epub+zip"),
    ("META-INF/container.xml", EPUB_CONTAINER),
    ("OEBPS/content.opf", EPUB_OPF),
    ("OEBPS/nav.xhtml", EPUB_CHAPTER1),
    ("OEBPS/text/chapter1.xhtml", EPUB_CHAPTER1),
    ("OEBPS/text/chapter2.xhtml", EPUB_CHAPTER2),
  ])
}

#[test]
fn epub_joins_spine_chapters_in_order() {
  let document = epub::read(&epub_sample()).expect("epub parses");

  assert_eq!(
    headings(&document),
    vec![
      (1u8, "Chapter One".to_string()),
      (1u8, "Chapter Two".to_string()),
    ],
    "both chapter headings survive, in spine order"
  );
  assert_eq!(
    document.blocks[1],
    Block::Paragraph(vec![text("First chapter body.")])
  );
  assert_eq!(
    document.blocks[3],
    Block::Paragraph(vec![
      text("Second chapter body with "),
      Inline::Emphasis(vec![text("emphasis")]),
      text("."),
    ])
  );
  assert_eq!(
    meta_value(&document, "title").as_deref(),
    Some("Two Chapters")
  );
  assert_eq!(
    meta_value(&document, "creator").as_deref(),
    Some("Grace Hopper")
  );
}

#[test]
fn epub_tolerates_missing_chapters() {
  let sample = zip_of(&[
    ("META-INF/container.xml", EPUB_CONTAINER),
    ("OEBPS/content.opf", EPUB_OPF),
    ("OEBPS/text/chapter2.xhtml", EPUB_CHAPTER2),
  ]);
  let document = epub::read(&sample).expect("epub parses with a missing chapter");
  assert_eq!(
    headings(&document).len(),
    1,
    "only the existing chapter is read"
  );
}

// ---------------------------------------------------------------------------
// rtf
// ---------------------------------------------------------------------------

#[test]
fn rtf_reads_paragraphs_bold_and_escapes() {
  let source = r#"{\rtf1\ansi\ansicpg1252\deff0
{\fonttbl{\f0\fnil Arial;}}
{\colortbl ;\red0\green0\blue0;}
{\*\generator Riched20 10.0;}
\pard Hello \b bold\b0  world.\par
Caf\'e9 and \u8594? arrow.\par
\i Italic\i0  tail\line soft break\par}"#;

  let document = rtf::read(source.as_bytes()).expect("rtf parses");

  assert_eq!(document.blocks.len(), 3, "one block per paragraph");
  assert_eq!(
    document.blocks[0],
    Block::Paragraph(vec![
      text("Hello "),
      Inline::Strong(vec![text("bold")]),
      text(" world."),
    ])
  );
  assert_eq!(
    paragraph_text(&document.blocks[1]),
    vec![text("Café and → arrow.")],
    "code page escapes and unicode escapes decode"
  );
  assert_eq!(
    document.blocks[2],
    Block::Paragraph(vec![
      Inline::Emphasis(vec![text("Italic")]),
      text(" tail"),
      Inline::HardBreak,
      text("soft break"),
    ])
  );
}

#[test]
fn rtf_skips_optional_groups() {
  let source = r#"{\rtf1\ansi{\*\unknown \b SHOULD NOT APPEAR}\pard Visible\par}"#;
  let document = rtf::read(source.as_bytes()).expect("rtf parses");
  assert_eq!(
    Block::plain_text(&document.blocks),
    "Visible",
    "starred groups are dropped"
  );
  assert!(!Block::plain_text(&document.blocks).contains("SHOULD"));
}

#[test]
fn rtf_plain_resets_formatting() {
  let source = r#"{\rtf1\ansi\pard \b reg\plain ulr\par}"#;
  let document = rtf::read(source.as_bytes()).expect("rtf parses");
  assert_eq!(
    document.blocks[0],
    Block::Paragraph(vec![Inline::Strong(vec![text("reg")]), text("ulr")]),
    "plain resets character formatting"
  );
}

#[test]
fn rtf_reads_underline_and_strike() {
  let source = r#"{\rtf1\ansi\pard normal \ul under\ulnone  \strike gone\strike0  end\par}"#;
  let document = rtf::read(source.as_bytes()).expect("rtf parses");
  assert_eq!(
    paragraph_text(&document.blocks[0]),
    vec![
      text("normal "),
      Inline::Underline(vec![text("under")]),
      text(" "),
      Inline::Strike(vec![text("gone")]),
      text(" end"),
    ]
  );
}

#[test]
fn rtf_reads_tabs() {
  let source = r#"{\rtf1\ansi\pard left\tab right\par}"#;
  let document = rtf::read(source.as_bytes()).expect("rtf parses");
  assert_eq!(
    paragraph_text(&document.blocks[0]),
    vec![text("left"), text("\t"), text("right")]
  );
}

// ---------------------------------------------------------------------------
// html
// ---------------------------------------------------------------------------

const HTML_SAMPLE: &str = r#"<!DOCTYPE html>
<html><head><title>Reader sample</title><meta name="author" content="Kim"><style>p{}</style></head>
<body>
<h1>Top &amp; tail</h1>
<p>Hello <strong>bold</strong>, <em>italic</em> and <a href="https://example.com" title="docs">a link</a>.</p>
<ul><li>one</li><li>two</li></ul>
<ol start="3"><li>three</li></ol>
<blockquote><p>quoted</p></blockquote>
<pre><code class="language-rust">fn main() {
  println!("hi");
}
</code></pre>
<table>
<thead><tr><th>Head</th><th style="text-align: center">Centered</th></tr></thead>
<tbody><tr><td>a</td><td>b</td></tr></tbody>
</table>
<img src="images/cat.png" alt="a cat" title="Cat">
<hr>
<p>Numeric &#33; and hex &#x48; and mdash &mdash; done.</p>
</body></html>"#;

#[test]
fn html_reads_headings_and_inlines() {
  let document = html::read(HTML_SAMPLE.as_bytes()).expect("html parses");

  assert_eq!(headings(&document), vec![(1u8, "Top & tail".to_string())]);
  assert_eq!(
    document.blocks[1],
    Block::Paragraph(vec![
      text("Hello "),
      Inline::Strong(vec![text("bold")]),
      text(", "),
      Inline::Emphasis(vec![text("italic")]),
      text(" and "),
      Inline::Link {
        href: "https://example.com".to_string(),
        title: Some("docs".to_string()),
        content: vec![text("a link")],
      },
      text("."),
    ])
  );
  assert_eq!(
    meta_value(&document, "title").as_deref(),
    Some("Reader sample")
  );
  assert_eq!(meta_value(&document, "author").as_deref(), Some("Kim"));
}

#[test]
fn html_reads_lists_and_quotes() {
  let document = html::read(HTML_SAMPLE.as_bytes()).expect("html parses");

  let lists: Vec<&Block> = document
    .blocks
    .iter()
    .filter(|block| matches!(block, Block::List { .. }))
    .collect();
  assert_eq!(lists.len(), 2);
  match lists[0] {
    Block::List {
      ordered,
      start,
      items,
    } => {
      assert!(!*ordered);
      assert_eq!(*start, 1);
      assert_eq!(items.len(), 2);
      assert_eq!(plain(&items[0][0]), "one");
      assert_eq!(plain(&items[1][0]), "two");
    }
    other => panic!("unexpected block {other:?}"),
  }
  match lists[1] {
    Block::List { ordered, start, .. } => {
      assert!(*ordered);
      assert_eq!(*start, 3, "an ol start attribute is honoured");
    }
    other => panic!("unexpected block {other:?}"),
  }

  let quote = document
    .blocks
    .iter()
    .find(|block| matches!(block, Block::Quote(_)))
    .expect("quote block");
  match quote {
    Block::Quote(inner) => assert_eq!(plain(&inner[0]), "quoted"),
    other => panic!("unexpected block {other:?}"),
  }
}

#[test]
fn html_reads_code_blocks_with_language() {
  let document = html::read(HTML_SAMPLE.as_bytes()).expect("html parses");
  let code = document
    .blocks
    .iter()
    .find(|block| matches!(block, Block::CodeBlock { .. }))
    .expect("code block");

  match code {
    Block::CodeBlock {
      language,
      text: body,
    } => {
      assert_eq!(language.as_deref(), Some("rust"));
      assert_eq!(
        body, "fn main() {\n  println!(\"hi\");\n}",
        "pre content is verbatim"
      );
    }
    other => panic!("unexpected block {other:?}"),
  }
}

#[test]
fn html_reads_tables_images_and_entities() {
  let document = html::read(HTML_SAMPLE.as_bytes()).expect("html parses");

  let table = document
    .blocks
    .iter()
    .find(|block| matches!(block, Block::Table { .. }))
    .expect("table block");
  match table {
    Block::Table { header, align, rows } => {
      assert_eq!(Inline::plain_text(&header[0]), "Head");
      assert_eq!(Inline::plain_text(&header[1]), "Centered");
      assert_eq!(align, &vec![Align::None, Align::Center]);
      assert_eq!(rows.len(), 1);
      assert_eq!(Inline::plain_text(&rows[0][1]), "b");
    }
    other => panic!("unexpected block {other:?}"),
  }

  let image = document
    .blocks
    .iter()
    .flat_map(|block| match block {
      Block::Paragraph(inlines) => inlines.clone(),
      _ => Vec::new(),
    })
    .find_map(|inline| match inline {
      Inline::Image { src, alt, title } => Some((src, alt, title)),
      _ => None,
    })
    .expect("image");
  assert_eq!(image.0, "images/cat.png");
  assert_eq!(image.1, "a cat");
  assert_eq!(image.2.as_deref(), Some("Cat"));

  let last = document.blocks.last().expect("trailing paragraph");
  assert_eq!(
    plain(last),
    "Numeric ! and hex H and mdash — done.",
    "named and numeric entities decode"
  );
}

#[test]
fn html_survives_sloppy_markup() {
  let source =
    "<div><p>unclosed one<p>unclosed two<ul><li>alpha<li>beta</ul><table><tr><td>x<td>y</table>";
  let document = html::read(source.as_bytes()).expect("html parses");
  let texts: Vec<String> = document.blocks.iter().map(plain).collect();
  assert_eq!(texts[0], "unclosed one");
  assert_eq!(texts[1], "unclosed two");
  match &document.blocks[2] {
    Block::List { items, .. } => assert_eq!(items.len(), 2, "implicit li close"),
    other => panic!("expected a list, got {other:?}"),
  }
}

// ---------------------------------------------------------------------------
// real-sample evidence: a tiny Markdown dump used by the delivery report
// ---------------------------------------------------------------------------

const RTF_SAMPLE: &str = r#"{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}}{\*\generator test;}\pard {\b Bold title}\par
A paragraph with \i emphasis\i0  and more.\par
\'c9\'a0 une id\'e9e\par}"#;

#[test]
fn evidence_markdown_from_samples() {
  let docx_document = docx::read(&docx_sample(true)).expect("docx parses");
  let epub_document = epub::read(&epub_sample()).expect("epub parses");

  println!("--- sample.docx -> markdown ---");
  println!("{}", to_markdown(&docx_document));
  println!("--- sample.epub -> markdown ---");
  println!("{}", to_markdown(&epub_document));
  println!("--- sample.rtf -> markdown ---");
  println!(
    "{}",
    to_markdown(&rtf::read(RTF_SAMPLE.as_bytes()).expect("rtf parses"))
  );
  println!("--- sample.html -> markdown ---");
  println!(
    "{}",
    to_markdown(&html::read(HTML_SAMPLE.as_bytes()).expect("html parses"))
  );

  assert!(!docx_document.blocks.is_empty());
  assert!(!epub_document.blocks.is_empty());
}

fn to_markdown(document: &Document) -> String {
  let mut out = String::new();
  for block in &document.blocks {
    write_block(block, &mut out);
  }
  out
}

fn write_block(block: &Block, out: &mut String) {
  match block {
    Block::Paragraph(inlines) => {
      out.push_str(&write_inlines(inlines));
      out.push_str("\n\n");
    }
    Block::Heading { level, content } => {
      out.push_str(&"#".repeat(*level as usize));
      out.push(' ');
      out.push_str(&write_inlines(content));
      out.push_str("\n\n");
    }
    Block::CodeBlock { language, text } => {
      out.push_str("```");
      out.push_str(language.as_deref().unwrap_or(""));
      out.push('\n');
      out.push_str(text);
      out.push_str("\n```\n\n");
    }
    Block::Quote(inner) => {
      let mut body = String::new();
      for block in inner {
        write_block(block, &mut body);
      }
      for line in body.trim_end().lines() {
        out.push_str("> ");
        out.push_str(line);
        out.push('\n');
      }
      out.push('\n');
    }
    Block::List {
      ordered,
      start,
      items,
    } => {
      for (index, item) in items.iter().enumerate() {
        for (position, block) in item.iter().enumerate() {
          let marker = if position > 0 {
            " ".to_string()
          } else if *ordered {
            format!("{}.", start + index as u64)
          } else {
            "-".to_string()
          };
          let mut body = String::new();
          write_block(block, &mut body);
          for line in body.trim_end().lines() {
            out.push_str(&marker);
            out.push(' ');
            out.push_str(line.trim_start_matches(' '));
            out.push('\n');
          }
        }
      }
      out.push('\n');
    }
    Block::Table { header, rows, .. } => {
      let heads: Vec<String> = header.iter().map(|cell| write_inlines(cell)).collect();
      out.push_str("| ");
      out.push_str(&heads.join(" | "));
      out.push_str(" |\n|");
      for _ in header {
        out.push_str(" --- |");
      }
      out.push('\n');
      for row in rows {
        let cells: Vec<String> = row.iter().map(|cell| write_inlines(cell)).collect();
        out.push_str("| ");
        out.push_str(&cells.join(" | "));
        out.push_str(" |\n");
      }
      out.push('\n');
    }
    Block::Rule => out.push_str("---\n\n"),
    Block::Raw(text) => {
      out.push_str(text);
      out.push('\n');
    }
  }
}

fn write_inlines(inlines: &[Inline]) -> String {
  let mut out = String::new();
  for inline in inlines {
    match inline {
      Inline::Text(value) => out.push_str(value),
      Inline::Strong(inner) => out.push_str(&format!("**{}**", write_inlines(inner))),
      Inline::Emphasis(inner) => out.push_str(&format!("*{}*", write_inlines(inner))),
      Inline::Strike(inner) => out.push_str(&format!("~~{}~~", write_inlines(inner))),
      Inline::Underline(inner) => out.push_str(&write_inlines(inner)),
      Inline::Code(value) => {
        out.push('`');
        out.push_str(value);
        out.push('`');
      }
      Inline::Math(value) => {
        out.push('$');
        out.push_str(value);
        out.push('$');
      }
      Inline::Link {
        href, content, ..
      } => out.push_str(&format!("[{}]({})", write_inlines(content), href)),
      Inline::Image { src, alt, .. } => out.push_str(&format!("![{alt}]({src})")),
      Inline::SoftBreak => out.push(' '),
      Inline::HardBreak => out.push('\n'),
      Inline::Raw(value) => out.push_str(value),
    }
  }
  out
}
