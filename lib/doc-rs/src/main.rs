use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;

use doc_rs::readers::SourceFormat;
use doc_rs::writers::TargetFormat;

/// Converts documents without pandoc. Used by the editor for import and export.
#[derive(Parser, Debug)]
#[command(name = "doc-rs", version, about, disable_help_subcommand = true)]
struct Cli {
  /// input file; omit when reading stdin
  input: Option<PathBuf>,

  /// output file; omit when writing stdout
  #[arg(short, long)]
  output: Option<PathBuf>,

  /// input format (docx, epub, rtf, html)
  #[arg(short, long)]
  from: Option<String>,

  /// output format (markdown, html, docx, epub, rtf, org, rst, textile, mediawiki, opml, latex)
  #[arg(short, long)]
  to: Option<String>,

  /// prints a JSON capability report and exits
  #[arg(long)]
  probe: bool,
}

fn probe() -> String {
  let from: Vec<&str> = SourceFormat::ALL.iter().map(|f| f.name()).collect();
  let to: Vec<&str> = TargetFormat::ALL.iter().map(|f| f.name()).collect();
  format!(
    "{{\"name\":\"doc-rs\",\"version\":\"{}\",\"from\":{},\"to\":{}}}",
    env!("CARGO_PKG_VERSION"),
    serde_like(&from),
    serde_like(&to)
  )
}

fn serde_like(items: &[&str]) -> String {
  let quoted: Vec<String> = items.iter().map(|i| format!("\"{}\"", i)).collect();
  format!("[{}]", quoted.join(","))
}

fn main() -> ExitCode {
  let cli = Cli::parse();

  if cli.probe {
    println!("{}", probe());
    return ExitCode::SUCCESS;
  }

  let from_name = match &cli.from {
    Some(name) => name.clone(),
    None => match cli.input.as_ref().and_then(|p| p.extension()) {
      Some(ext) => ext.to_string_lossy().to_string(),
      None => {
        eprintln!("doc-rs: cannot infer the input format, pass --from");
        return ExitCode::from(2);
      }
    },
  };
  let to_name = match &cli.to {
    Some(name) => name.clone(),
    None => {
      eprintln!("doc-rs: missing --to");
      return ExitCode::from(2);
    }
  };

  let Some(from) = SourceFormat::parse(&from_name) else {
    eprintln!("doc-rs: unsupported input format {}", from_name);
    return ExitCode::from(2);
  };
  let Some(to) = TargetFormat::parse(&to_name) else {
    eprintln!("doc-rs: unsupported output format {}", to_name);
    return ExitCode::from(2);
  };

  let input = match &cli.input {
    Some(path) => match fs::read(path) {
      Ok(bytes) => bytes,
      Err(error) => {
        eprintln!("doc-rs: cannot read {}: {}", path.display(), error);
        return ExitCode::from(1);
      }
    },
    None => {
      let mut buffer = Vec::new();
      if let Err(error) = std::io::Read::read_to_end(&mut std::io::stdin(), &mut buffer) {
        eprintln!("doc-rs: cannot read stdin: {}", error);
        return ExitCode::from(1);
      }
      buffer
    }
  };

  let output = match doc_rs::convert(&input, from, to) {
    Ok(bytes) => bytes,
    Err(error) => {
      eprintln!("doc-rs: {}", error);
      return ExitCode::from(1);
    }
  };

  match &cli.output {
    Some(path) => {
      if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
          let _ = fs::create_dir_all(parent);
        }
      }
      if let Err(error) = fs::write(path, &output) {
        eprintln!("doc-rs: cannot write {}: {}", path.display(), error);
        return ExitCode::from(1);
      }
    }
    None => {
      use std::io::Write;
      if let Err(error) = std::io::stdout().write_all(&output) {
        eprintln!("doc-rs: cannot write stdout: {}", error);
        return ExitCode::from(1);
      }
    }
  }

  ExitCode::SUCCESS
}
