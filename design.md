# neoPdfReader — 架构设计文档

## 1. 技术选型

### 1.1 决策总览

| 层 | 选型 | 理由 |
|----|------|------|
| **GUI 框架** | **Tauri 2.x** (Rust + WebView) | 跨平台(macOS/Linux)、原生性能、安装包小(~10MB vs Electron ~150MB)、Rust 后端天然高性能 |
| **前端** | **React + TypeScript + Vite** | 生态成熟、虚拟化组件丰富、类型安全 |
| **PDF 解析/渲染** | **mupdf (via mupdf-rs)** | C 库性能极高、支持 PDF 全特性、比 poppler 更适合嵌入、MIT 许可(商用需注意 AGPL，备选 pdfium) |
| **全文搜索引擎** | **tantivy** (Rust) | Rust 原生全文检索库、类 Lucene 架构、内存索引+磁盘索引、支持中文分词(jieba-rs) |
| **文本提取** | mupdf stext API | 提取带位置信息的文本块，用于搜索高亮定位 |
| **异步运行时** | **tokio** | Rust 标准异步运行时，后台任务调度 |
| **状态管理(前端)** | **Zustand** | 轻量、TypeScript 友好 |
| **虚拟滚动** | **react-virtuoso** | 支持变高度项、16000 项无压力 |

### 1.2 备选方案对比

**GUI 框架**:
- ~~Electron~~: 内存占用大(基线 ~200MB)，不适合大文件场景
- ~~Qt (C++)~~: 开发效率低，UI 现代感不足
- ~~Flutter~~: PDF 渲染生态不成熟

**PDF 库**:
- ~~pdfium (Google)~~: 性能好但 API 复杂、构建困难
- ~~poppler~~: GPL 许可、API 设计较老
- **mupdf**: 性能最优、API 清晰、渲染质量高

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (WebView)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │ Toolbar  │ │ PageView │ │ Sidebar  │ │ SearchBar  │  │
│  │          │ │(Virtuoso)│ │Thumbnail │ │            │  │
│  │          │ │          │ │Bookmark  │ │            │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────┘  │
│                       │ Tauri IPC (invoke / event)       │
├───────────────────────┼─────────────────────────────────┤
│                    Rust Backend                          │
│  ┌──────────────┐ ┌──────────────┐ ┌─────────────────┐  │
│  │ PDF Manager  │ │Search Engine │ │  Cache Manager  │  │
│  │  (mupdf-rs)  │ │  (tantivy)   │ │  (LRU + Disk)  │  │
│  │              │ │              │ │                 │  │
│  │ - open()     │ │ - index()    │ │ - page bitmap   │  │
│  │ - render()   │ │ - search()   │ │ - text blocks   │  │
│  │ - text()     │ │ - highlight()│ │ - thumbnails    │  │
│  │ - outline()  │ │              │ │                 │  │
│  └──────┬───────┘ └──────┬───────┘ └────────┬────────┘  │
│         │                │                   │           │
│  ┌──────┴────────────────┴───────────────────┴────────┐  │
│  │              Task Scheduler (tokio)                 │  │
│  │  - 后台文本提取 & 索引构建                            │  │
│  │  - 缩略图预生成                                      │  │
│  │  - 页面预渲染                                        │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 核心模块设计

### 3.1 PDF Manager（PDF 管理器）

**职责**: 文件加载、页面渲染、元数据解析、文本提取

```rust
// 核心接口设计
pub struct PdfDocument {
    doc: mupdf::Document,
    page_count: usize,
    metadata: DocumentMetadata,
    page_sizes: Vec<(f32, f32)>,   // 预计算所有页面尺寸，用于虚拟滚动
}

impl PdfDocument {
    /// 打开 PDF — 仅读取 xref 表和元数据，不渲染任何页面
    /// 16000 页 PDF 打开时间目标: < 200ms
    pub fn open(path: &Path) -> Result<Self>;

    /// 渲染指定页面为位图
    /// 返回 RGBA 像素数据，前端通过 <canvas> 或 <img> 展示
    pub fn render_page(&self, page_num: usize, scale: f32, rotation: i32) -> Result<PageBitmap>;

    /// 提取指定页面的文本块（含位置信息）
    pub fn extract_text(&self, page_num: usize) -> Result<Vec<TextBlock>>;

    /// 获取 PDF 书签/大纲树
    pub fn get_outline(&self) -> Result<Vec<OutlineItem>>;

    /// 批量提取文本（后台索引用），流式返回
    pub fn extract_all_text(&self) -> impl Iterator<Item = (usize, Vec<TextBlock>)>;
}
```

**性能关键设计**:
- `open()` 只解析 xref 表 + trailer，**不加载页面内容**
- 预计算所有页面尺寸 `page_sizes`，供前端虚拟滚动计算总高度
- `render_page()` 在线程池中执行，不阻塞 UI

### 3.2 Search Engine（搜索引擎）

**职责**: 全文索引构建、搜索查询、结果定位

```
┌─────────────────────────────────────────────┐
│              Search Engine                   │
│                                             │
│  ┌─────────────┐     ┌──────────────────┐   │
│  │ Text Index  │     │  Position Map    │   │
│  │  (tantivy)  │     │ page_num → Vec<  │   │
│  │             │     │  TextBlock {     │   │
│  │ Schema:     │     │    text,         │   │
│  │  - page_num │     │    bbox (x,y,w,h)│   │
│  │  - content  │     │  }>             │   │
│  └──────┬──────┘     └────────┬─────────┘   │
│         │  search()           │  locate()   │
│         ▼                     ▼             │
│  ┌─────────────────────────────────────┐    │
│  │  SearchResult {                     │    │
│  │    page_num,                        │    │
│  │    snippet,       // 上下文片段      │    │
│  │    bboxes,        // 高亮矩形列表    │    │
│  │    match_count,                     │    │
│  │  }                                  │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

**索引策略**:

1. **打开文件后立即在后台线程启动索引构建**
2. 采用**分批增量**方式：每 100 页提交一次索引，搜索可在索引构建完成前执行（搜已索引部分）
3. 索引存储在内存中（tantivy RAM Directory），16000 页纯文本索引约 50-100MB
4. 可选：将索引持久化到磁盘（`~/.cache/neopdfreader/<file_hash>/`），再次打开同一文件时直接加载

```rust
pub struct SearchEngine {
    index: tantivy::Index,
    position_map: HashMap<usize, Vec<TextBlock>>,
}

impl SearchEngine {
    /// 后台增量构建索引
    pub async fn build_index(&self, doc: &PdfDocument, progress_tx: Sender<IndexProgress>);

    /// 全文搜索 — 返回匹配页及高亮位置
    pub fn search(&self, query: &str, options: SearchOptions) -> Result<Vec<SearchResult>>;

    /// 获取索引构建进度 (0.0 ~ 1.0)
    pub fn index_progress(&self) -> f64;
}
```

**搜索性能优化**:
- tantivy 倒排索引，16000 页搜索 < 100ms（索引建好后）
- 支持中文分词（jieba-rs tokenizer）
- 搜索结果按页码排序，支持分页加载

### 3.3 Cache Manager（缓存管理器）

```
┌────────────────────────────────────────────┐
│             Cache Manager                   │
│                                            │
│  ┌─────────────────────────────────────┐   │
│  │     L1: Page Bitmap LRU Cache       │   │
│  │     容量: ~50 页 (按内存预算动态调整)   │   │
│  │     Key: (page_num, scale, rotation) │   │
│  │     淘汰: LRU                        │   │
│  └─────────────────────────────────────┘   │
│                                            │
│  ┌─────────────────────────────────────┐   │
│  │     L2: Thumbnail Cache             │   │
│  │     容量: 全部页面缩略图              │   │
│  │     大小: ~64KB/页 × 16000 ≈ 1GB    │   │
│  │     策略: 按需生成 + 磁盘持久化       │   │
│  └─────────────────────────────────────┘   │
│                                            │
│  ┌─────────────────────────────────────┐   │
│  │     预渲染策略                        │   │
│  │     当前页 ±3 页预渲染               │   │
│  │     滚动方向预测: 向下多预取2页       │   │
│  └─────────────────────────────────────┘   │
└────────────────────────────────────────────┘
```

**内存预算控制**:
- 设总内存预算 400MB
- 页面位图: 单页 A4@150dpi ≈ 2MB，缓存 50 页 ≈ 100MB
- 缩略图: 按需生成，不全量缓存在内存
- 文本索引: ~100MB
- PDF 文件映射: ~50MB（mmap）
- 余量: ~150MB 给运行时和前端

### 3.4 Task Scheduler（任务调度器）

后台任务优先级队列：

```
优先级从高到低：
  1. 当前页渲染请求        ──▶ 立即执行
  2. 预渲染（当前页 ±3）    ──▶ 高优先级
  3. 搜索查询              ──▶ 高优先级
  4. 缩略图生成            ──▶ 中优先级
  5. 文本索引构建           ──▶ 低优先级（可被中断/暂停）
```

使用 tokio 线程池管理，CPU 密集任务用 `spawn_blocking`，I/O 任务用 `spawn`。

---

## 4. 前端架构

### 4.1 组件树

```
<App>
  ├── <TitleBar />                    // 窗口标题栏（Tauri 自定义）
  ├── <Toolbar />                     // 工具栏：打开、缩放、页码、视图模式
  ├── <MainLayout>
  │   ├── <Sidebar>                   // 可折叠侧边栏
  │   │   ├── <ThumbnailPanel />      // 缩略图列表（虚拟滚动）
  │   │   ├── <BookmarkPanel />       // 书签/大纲树
  │   │   └── <SearchResultPanel />   // 搜索结果列表
  │   │
  │   └── <PageViewport>             // 主视图区域
  │       └── <VirtualizedPageList /> // react-virtuoso 虚拟滚动
  │           └── <PageCanvas />      // 单页渲染 canvas
  │               ├── <TextLayer />   // 文本选择层（透明 div 覆盖）
  │               └── <AnnotLayer />  // 批注层
  │
  ├── <SearchBar />                   // Ctrl+F 搜索条
  ├── <StatusBar />                   // 底部状态栏：页码、缩放比、索引进度
  └── <TabBar />                      // 多文件标签页
```

### 4.2 页面渲染流程

```
用户滚动/翻页
    │
    ▼
VirtualizedPageList 计算可见页码范围 [visibleStart, visibleEnd]
    │
    ▼
检查 L1 缓存是否命中
    │
    ├── 命中 ──▶ 直接展示缓存位图
    │
    └── 未命中 ──▶ 显示低分辨率占位 ──▶ 通过 IPC invoke("render_page") 请求后端
                                              │
                                              ▼
                                     Rust 后端渲染 + 放入缓存
                                              │
                                              ▼
                                     通过 IPC 返回 base64/ArrayBuffer
                                              │
                                              ▼
                                     前端更新 canvas，移除占位
```

**IPC 数据传输优化**:
- 使用 Tauri 的 `invoke` 返回 `Vec<u8>` (二进制)，避免 base64 编码开销
- 单页传输大小: A4@150dpi RGBA ≈ 2MB，压缩后 (WebP) ≈ 200KB
- 考虑使用共享内存 (mmap) 传递大位图，避免拷贝

### 4.3 虚拟滚动设计

```typescript
// 核心虚拟滚动配置
interface VirtualScrollConfig {
  totalPages: number;          // 16000
  pageSizes: Array<{w: number, h: number}>;  // 从后端获取的所有页面尺寸
  overscan: number;            // 可视区域外额外渲染的页数 = 3
  currentScale: number;        // 当前缩放比例
}

// react-virtuoso 的 itemSize 回调使用预计算的页面尺寸
// 而非渲染后测量，确保 16000 页滚动条精确
```

关键点：
- 后端在 `open()` 时预计算所有页面尺寸，一次性传给前端
- 前端根据尺寸数组精确计算总滚动高度，滚动条位置精确
- 仅渲染 `可见页 ± overscan` 范围内的 `<PageCanvas>`

---

## 5. IPC 接口设计

### 5.1 Tauri Commands

```rust
#[tauri::command]
async fn open_pdf(path: String) -> Result<DocumentInfo, String>;

#[tauri::command]
async fn render_page(page_num: usize, scale: f32, rotation: i32) -> Result<Vec<u8>, String>;

#[tauri::command]
async fn get_page_text(page_num: usize) -> Result<Vec<TextBlock>, String>;

#[tauri::command]
async fn get_outline() -> Result<Vec<OutlineItem>, String>;

#[tauri::command]
async fn search(query: String, options: SearchOptions) -> Result<Vec<SearchResult>, String>;

#[tauri::command]
async fn get_thumbnail(page_num: usize) -> Result<Vec<u8>, String>;

#[tauri::command]
async fn get_document_properties() -> Result<DocumentMetadata, String>;
```

### 5.2 Tauri Events（后端 → 前端推送）

```rust
// 索引构建进度
app.emit("index-progress", IndexProgress { current: 5000, total: 16000 });

// 索引完成
app.emit("index-complete", ());

// 预渲染完成通知
app.emit("page-prerendered", PrerenderedPage { page_num: 42, scale: 1.5 });
```

---

## 6. 大文件性能优化策略

### 6.1 打开速度优化

```
传统方式（慢）:
  打开文件 → 解析全部页面 → 渲染第一页 → 显示

优化方式（快）:
  打开文件 → 仅读 xref + trailer (< 50ms)
           → 预计算页面尺寸列表 (< 100ms)
           → 渲染第一页 (< 200ms)
           → 显示 ✓
           → 后台: 索引构建、缩略图生成
```

- **mmap 文件映射**: 不将整个 PDF 读入内存，由 OS 管理页面换入换出
- **延迟解析**: 只在需要时解析具体页面的内容流
- **页面尺寸快速获取**: 解析 `/MediaBox` 不需要解码页面内容

### 6.2 搜索速度优化

```
场景: 用户打开 16000 页 PDF 后 5 秒内按 Ctrl+F 搜索

Timeline:
  0s    ─ 文件打开，开始后台索引
  0-5s  ─ 已索引约 3000 页（每页文本提取 ~1ms，索引 ~0.5ms）
  5s    ─ 用户搜索 "keyword"
         ├─ 先搜已索引的 3000 页（tantivy 查询 < 10ms）
         ├─ 对未索引页做实时 grep 扫描（并行，约 2s）
         └─ 合并结果展示
  ~10s  ─ 全部 16000 页索引完成
  此后  ─ 所有搜索 < 100ms
```

**双模搜索策略**:
1. 索引完成前: tantivy 查已索引部分 + 并行 grep 未索引部分
2. 索引完成后: 纯 tantivy 查询，毫秒级响应

### 6.3 内存优化

- **mmap** 代替全文件读入
- **LRU 缓存** 控制内存上限
- **位图压缩**: 缓存压缩后的 WebP 而非原始 RGBA
- **缩略图懒生成**: 只生成可见范围内的缩略图
- **索引分段**: tantivy 支持 segment merge，控制内存峰值

---

## 7. 目录结构

```
neoPdfReader/
├── src-tauri/                     # Rust 后端
│   ├── Cargo.toml
│   ├── src/
│   │   ├── main.rs                # 入口，Tauri 初始化
│   │   ├── commands/              # Tauri IPC 命令
│   │   │   ├── mod.rs
│   │   │   ├── document.rs        # open, properties, outline
│   │   │   ├── render.rs          # render_page, thumbnail
│   │   │   └── search.rs          # search, index status
│   │   ├── pdf/                   # PDF 核心模块
│   │   │   ├── mod.rs
│   │   │   ├── document.rs        # PdfDocument 封装
│   │   │   ├── renderer.rs        # 页面渲染
│   │   │   └── text.rs            # 文本提取
│   │   ├── search/                # 搜索引擎模块
│   │   │   ├── mod.rs
│   │   │   ├── indexer.rs         # 索引构建
│   │   │   ├── query.rs           # 查询执行
│   │   │   └── tokenizer.rs       # 分词器（中英文）
│   │   ├── cache/                 # 缓存模块
│   │   │   ├── mod.rs
│   │   │   ├── bitmap_cache.rs    # 页面位图 LRU
│   │   │   ├── thumbnail_cache.rs # 缩略图缓存
│   │   │   └── text_cache.rs      # 文本块缓存
│   │   ├── scheduler/             # 任务调度
│   │   │   ├── mod.rs
│   │   │   └── priority_queue.rs
│   │   └── state.rs               # 全局应用状态
│   └── tauri.conf.json
│
├── src/                           # React 前端
│   ├── main.tsx                   # 入口
│   ├── App.tsx
│   ├── components/
│   │   ├── Toolbar/
│   │   ├── PageViewport/
│   │   │   ├── VirtualizedPageList.tsx
│   │   │   ├── PageCanvas.tsx
│   │   │   └── TextLayer.tsx
│   │   ├── Sidebar/
│   │   │   ├── ThumbnailPanel.tsx
│   │   │   ├── BookmarkPanel.tsx
│   │   │   └── SearchResultPanel.tsx
│   │   ├── SearchBar/
│   │   ├── StatusBar/
│   │   └── TabBar/
│   ├── hooks/
│   │   ├── usePdfDocument.ts      # PDF 文档操作 hook
│   │   ├── usePageRenderer.ts     # 页面渲染调度 hook
│   │   ├── useSearch.ts           # 搜索 hook
│   │   └── useVirtualScroll.ts    # 虚拟滚动 hook
│   ├── store/
│   │   ├── documentStore.ts       # 文档状态
│   │   ├── viewStore.ts           # 视图状态（缩放、视图模式）
│   │   └── searchStore.ts         # 搜索状态
│   ├── services/
│   │   └── tauriApi.ts            # Tauri IPC 调用封装
│   ├── types/
│   │   └── index.ts               # TypeScript 类型定义
│   └── styles/
│       ├── themes/
│       └── global.css
│
├── package.json
├── tsconfig.json
├── vite.config.ts
├── req.md                         # 需求文档
├── design.md                      # 本文档
└── README.md
```

---

## 8. 构建与分发

### 8.1 构建流程

```bash
# 开发
pnpm tauri dev

# 构建
pnpm tauri build
# macOS → .dmg / .app
# Ubuntu → .deb / .AppImage
```

### 8.2 CI/CD

```
GitHub Actions:
  ├── macOS runner  → 构建 .dmg + .app
  ├── Ubuntu runner → 构建 .deb + .AppImage
  └── 两平台运行测试
```

---

## 9. 关键技术风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| mupdf AGPL 许可证 | 如果闭源商用需购买商业许可 | 开源发布可用 AGPL；若需闭源，切换到 pdfium |
| WebView IPC 传输大位图性能 | 高分辨率页面传输延迟 | 使用二进制传输 + WebP 压缩；考虑 SharedArrayBuffer |
| 16000 页文本索引内存峰值 | 可能超出内存预算 | tantivy 分段提交 + 磁盘索引 fallback |
| 中文 PDF 文本提取质量 | CID 字体可能提取乱码 | mupdf 的 CMap 支持较好；降级为 OCR (tesseract) |
| Linux WebView (WebKitGTK) 兼容性 | 某些 CSS/API 不一致 | 测试矩阵覆盖 Ubuntu 22.04/24.04；feature detection |

---

## 10. 性能基准目标

| 场景 | 目标 | 测量方式 |
|------|------|---------|
| 打开 16000 页 PDF 到首页可见 | < 2s | `console.time` 从 `open()` 到首页 canvas 绘制完成 |
| 翻到任意页 | < 300ms (缓存未命中) / < 50ms (缓存命中) | IPC 调用到 canvas 更新 |
| Ctrl+F 搜索（索引完成后） | < 100ms | 从按下 Enter 到结果展示 |
| Ctrl+F 搜索（索引未完成） | < 5s | 混合搜索策略 |
| 连续滚动帧率 | ≥ 30fps | Chrome DevTools Performance |
| 冷启动到空窗口 | < 1s | 进程启动到窗口可见 |
| 内存占用（16000 页 PDF 打开） | < 500MB | 系统监视器观察 RSS |
