# Release Notes Template

## Neo PDF Reader

### Downloads

- macOS: `.dmg`
- Ubuntu: `.AppImage` / `.deb`
- Windows: installer

### Notes

- Optimized for large PDF files
- Built with Tauri + React + Rust

### macOS First Run

This app is currently not code-signed.

If macOS blocks the app on first launch, run:

```bash
xattr -rd com.apple.quarantine "/Applications/Neo PDF Reader.app"
```

If you open the app from somewhere other than `/Applications`, replace the path with the actual app location.

### Changes

- Add your release highlights here
- Add bug fixes here
- Add UI or performance updates here
