# AI 状态哨兵 (AI Status Canary) - 桌面客户端 🚀

这是一个基于 **Rust + Tauri** 架构开发的**极致轻量、超低资源占用、无杀毒软件误报**的 AI 编程助手状态监控桌面客户端。

它可以在 Windows 和 macOS 系统后台静默运行，自动监控本地 AI 助手的执行状态，并在需要手动确认（等待审批）或任务完成时，通过**手机推送**、**本地合成音效**或**TTS语音播报**通知您。

---

## 🏗️ 项目结构

- `src-tauri/`：Rust 后端逻辑。
  - `src/lib.rs`：主程序逻辑，包含 Rust 后台高频日志监听线程和 Tauri 事件广播接口。
  - `Cargo.toml`：Rust 项目依赖配置。
  - `tauri.conf.json`：Tauri 窗口、打包及权限配置文件。
- `src/`：Tauri 前端网页界面。
  - `index.html`：毛玻璃暗黑风仪表盘。
  - `styles.css`：UI 样式表。
  - `main.js`：前端核心交互逻辑（包含 Web Audio 音效合成、语音播报以及 Bark/飞书/钉钉等推送网关发送）。
- `.github/workflows/release.yml`：GitHub Actions 自动化云端编译流水线。

---

## ☁️ 如何利用 GitHub Actions 云端自动打包

因为在本地编译 Rust 程序需要安装数 GB 的 C++ 编译环境（如 Visual Studio Build Tools），我们已经为您配置好了**云端自动打包流水线**。您无需在自己电脑上安装任何编译工具，即可一键生成 Windows (`.exe`) 和 macOS (`.dmg`) 安装包。

### 步骤 1：新建 GitHub 仓库
1. 登录您的 GitHub 账号。
2. 点击右上角的 **New repository**，新建一个仓库，名字可以叫 `ai-status-canary`。
3. 保持仓库为公开（Public）或私有（Private）均可。

### 步骤 2：初始化本地 Git 并推送代码
在当前项目根目录下打开终端，依次运行以下命令：

```bash
# 初始化 git 仓库
git init

# 添加所有文件
git add .

# 提交本地修改
git commit -m "feat: init tauri canary client with github actions"

# 关联远程仓库（请将下方地址替换为您自己刚刚新建的 GitHub 仓库地址！）
git remote add origin https://github.com/您的用户名/ai-status-canary.git

# 推送代码至主分支
git branch -M main
git push -u origin main
```

### 步骤 3：触发云端自动打包（打 Tag 发布）
一旦您的代码推送到 GitHub，您只需要通过**推送一个版本标签 (Git Tag)**，即可触发云端自动化构建：

```bash
# 创建版本标签（例如 v1.0.0）
git tag v1.0.0

# 将标签推送到 GitHub
git push origin v1.0.0
```

### 步骤 4：下载您的客户端
1. 推送 Tag 后，打开您的 GitHub 仓库网页。
2. 点击右侧的 **Releases** 栏目。
3. 您会看到 GitHub Actions 正在为您编译 Windows 和 macOS 版本（通常需要 5~8 分钟）。
4. 编译完成后，页面会自动生成一个 **Draft Release**，在下方附件中，您可以直接下载编译好的：
   - **Windows**：`AI-Status-Canary_1.0.0_x64-setup.exe` (安装包) 或绿色版单文件 `.exe`。
   - **macOS**：`AI-Status-Canary_1.0.0_x64.dmg` (安装包)。
5. 双击下载好的安装包，即可开始使用！

---

## 📱 手机推送配置说明

一旦在电脑上安装并启动了编译好的 `AI Status Canary` 客户端，您可以在软件主界面右侧的**“手机推送通道配置”**中完成配置：

- **Bark (苹果 iOS 用户推荐)**：在 iPhone 上下载 Bark App，复制生成的 Key 填入即可，免费且无任何延迟。
- **群机器人 Webhook (支持安卓与 iOS)**：在飞书、钉钉、企业微信建立一个仅有自己的群，添加“自定义群机器人”，将获取的 Webhook 链接粘贴至对应输入框即可。
