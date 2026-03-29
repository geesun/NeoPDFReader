# Neo PDF Reader

Neo PDF Reader is a high-performance desktop PDF reader built with Tauri 2, React, TypeScript, and Rust.

It is designed for fast page rendering, smooth navigation, and responsive reading even with large PDF files.

## Stack

- Tauri 2
- React + TypeScript + Vite
- Rust
- MuPDF
- Tantivy

## Features

- Fast PDF rendering
- Smooth page scrolling and page jump
- Search with precise text highlight
- Text selection and copy
- Internal and external link support
- Recent files home screen
- Tab-based document management
- Light and dark theme support
- Optimized for large files

## Requirements

- Node.js 20+
- pnpm 10+
- Rust stable

Platform-specific notes:

- macOS: Xcode Command Line Tools required
- Ubuntu: WebKitGTK and GTK development packages required
- Windows: Visual Studio C++ build tools required

## Install Dependencies

```bash
pnpm install
```

## Run In Development

```bash
pnpm tauri dev
```

This starts:

- the Vite dev server
- the Rust backend
- the Tauri desktop app

## Type Check

Frontend:

```bash
pnpm tsc --noEmit
```

Rust:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

On macOS, if MuPDF hits the `ar` response-file issue, use the bundled wrapper:

```bash
PATH="$(pwd)/src-tauri/.build-tools:$PATH" cargo check --manifest-path src-tauri/Cargo.toml
```

## Build Desktop App

```bash
pnpm tauri build
```

Build artifacts are written under:

```bash
src-tauri/target/release/bundle/
```

## Build Specific Bundle Types

Examples:

```bash
pnpm tauri build --bundles app,dmg
pnpm tauri build --bundles appimage,deb
pnpm tauri build --bundles nsis
```

## GitHub Actions

This repository includes a cross-platform workflow at:

```bash
.github/workflows/build.yml
```

It builds on:

- macOS
- Ubuntu 22.04
- Windows

The workflow:

- installs Node, pnpm, and Rust
- installs Linux build dependencies
- installs LLVM on macOS for the MuPDF build workaround
- runs TypeScript and Rust checks
- builds Tauri bundles
- uploads bundle artifacts

## macOS Build Note

The project includes a wrapper at:

```bash
src-tauri/.build-tools/xcrun
```

This is used to route `xcrun ar` to `llvm-ar` when needed, which avoids macOS `ar` limitations during MuPDF-related builds.

In CI, the workflow sets `LLVM_AR` automatically.

## Project Structure

```text
.
├── src/                # React frontend
├── src-tauri/          # Rust backend and Tauri config
├── .github/workflows/  # CI workflows
├── req.md              # Requirements
└── design.md           # Architecture notes
```

## Useful Commands

```bash
pnpm install
pnpm tsc --noEmit
pnpm tauri dev
pnpm tauri build
cargo check --manifest-path src-tauri/Cargo.toml
```

## License

Private project for now.
