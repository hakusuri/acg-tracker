# ACG 记录（ACG Tracker）

个人 ACG 作品记录桌面应用，用于记录看过的**番剧、漫画、轻小说与 Galgame**。
单机本地运行，数据保存在本机 SQLite，无需账号、不涉及云端。

## 功能

- **首页作品库**：卡片网格展示全部作品；按类别（番剧/漫画/轻小说/Galgame）、年份筛选；番剧额外支持按日本动画季度（冬/春/夏/秋）筛选；标题模糊搜索；按添加时间/年份/评分/标题排序
- **作品详情**：年份、季度、简介、评分、我的评分、状态、进度（番剧=集数，漫画/轻小说=卷数，Galgame=路线）、标签、笔记、外部链接，支持编辑与删除
- **添加 / 编辑**：手动录入；封面支持本地图片（自动复制到应用数据目录）或 URL
- **数据导入**：
  - 文件导入：MAL 导出 XML（自动解析番剧/漫画两部分）、Bangumi CSV，导入前预览、按标题+年份去重
  - API 搜索：Bangumi API 与 VNDB API 按名称搜索，一键带入简介/封面/链接后加入记录
- **统计信息**：各类别数量、状态分布、按年份分布、番剧季度分布（条形图 / 环形图）
- **设置**：主题（跟随系统/浅色/深色）、卡片密度、自定义背景图片、默认类别/状态/排序、API 搜索数量、封面下载开关、代理模式与 API 地址、数据导出/导入/清空、封面修复、检查更新（GitHub Release）、自动备份
- **界面**：液态玻璃（Glassmorphism）风格，跟随系统深浅色主题，中文界面

## 技术栈

- Tauri 2（Rust 后端）+ React 18 + TypeScript + Vite
- SQLite（tauri-plugin-sql），数据重启不丢失
- tauri-plugin-dialog / fs（文件选择与读取）、tauri-plugin-opener（打开外部链接）

## 开发与构建

```bash
npm install          # 安装依赖
npm run tauri dev    # 开发运行
npm run tauri build  # 打包 Windows 安装程序（NSIS）
```

打包产物：

- 安装程序：`src-tauri/target/release/bundle/nsis/ACG Tracker_0.1.1_x64-setup.exe`
- 便携版：`src-tauri/target/release/acg-tracker.exe`（需系统已安装 WebView2 运行时，Win10/11 一般自带）

以上发布产物同时整理在项目根目录的 outputs/ 文件夹中。

## 数据存储位置

- 默认数据目录：**程序所在目录下的 `data\`**（安装版与便携版一致，数据跟随程序目录）
- 旧版本（%APPDATA% 目录）的数据会在首次启动时自动迁移到新默认目录
- 可在「设置 → 数据管理 → 数据目录」中选择自定义目录（数据库/封面/备份会整体迁移过去）
- 自定义目录记录在 `%APPDATA%\com.acg.tracker\data_dir.json`

删除数据目录即可彻底清空数据。

## 说明

- 首次启动作品库为空，可在首页点击「载入示例数据」快速体验，或在导入页导入 MAL / Bangumi 数据
- API 搜索（Bangumi / VNDB）需要能访问对应站点；应用优先走系统代理，失败时自动回退直连
- Bangumi CSV 导入默认按「番剧」处理，可在导入预览中逐行调整类别
- 评分为 0–10；外部导入的数据带来源标记（MAL / Bangumi / VNDB）