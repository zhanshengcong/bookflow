# BookFlow — 本地小说阅读器

跨平台（Web / 桌面 / 移动端）小说阅读器，支持 EPUB / PDF / TXT / MOBI / AZW3 格式，适配电脑和手机。

---

## 项目结构

```
bookflow/
├── README.md                    # 本文件
├── server/                      # 后端服务 (Fastify + sql.js)
│   ├── package.json
│   └── src/
│       ├── index.js             # 入口，启动 HTTP 服务 (端口 3001)
│       ├── db.js                # SQLite 数据库初始化 & 工具函数
│       ├── parser.js            # EPUB/PDF/MOBI 元数据解析 + 封面提取
│       └── routes/
│           ├── library.js       # 书库管理：扫描/导入/删除
│           ├── books.js         # 书籍 CRUD + 文件流 + 元数据提取
│           ├── progress.js      # 阅读进度读写
│           └── bookmarks.js     # 书签增删查
├── frontend/                    # 前端 (Vite + React + Tailwind CSS)
│   ├── package.json
│   ├── vite.config.js           # Vite 配置 (开发代理到 :3001)
│   ├── tailwind.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx             # React 入口
│       ├── App.jsx              # 路由定义
│       ├── index.css            # 全局样式 + Tailwind 指令
│       ├── store/index.js       # Zustand 全局状态 (主题/设置)
│       ├── hooks/useApi.js      # API 请求封装 (axios)
│       ├── pages/
│       │   ├── LibraryPage.jsx  # 书架主页：封面网格、搜索、过滤
│       │   ├── ReaderPage.jsx   # 阅读器容器：主题/设置/进度/书签/翻页按钮
│       │   └── SettingsPage.jsx # 全局设置页
│       └── components/
│           ├── EpubViewer.jsx   # EPUB 渲染器 (epub.js)
│           ├── PdfViewer.jsx    # PDF 渲染器 (pdf.js)
│           └── TxtViewer.jsx    # 纯文本渲染器
├── cache/covers/                # 提取的封面图片缓存
└── data/bookflow.db             # SQLite 数据库文件
```

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js 22 + Fastify + sql.js (纯 JS SQLite) |
| 前端 | React 18 + Vite 5 + Tailwind CSS 3 + Zustand |
| EPUB | epub.js v0.3 |
| PDF | pdfjs-dist v4 |
| 图标 | lucide-react |

## 快速启动

### 前提条件
- Node.js >= 18（项目使用 `D:/program/nvm/v22.22.0/node.exe`）
- npm >= 9

### 安装依赖

```bash
cd bookflow/server && npm install
cd bookflow/frontend && npm install
```

### 启动服务（需要两个终端）

**终端 1 — 启动后端 (端口 3001)**

```bash
cd server
npm start
```

**终端 2 — 启动前端 (端口 3000)**

```bash
cd frontend
npm run dev
```

> 前端 Vite 自动将 `/api` 和 `/covers` 代理到后端 `http://localhost:3001`。

浏览器打开 `http://localhost:3000` 即可使用。

### 使用步骤

1. 打开书架页面
2. 点击「导入」按钮，可选择本地文件/文件夹，或粘贴书库路径
3. 等待扫描完成
4. 点击书籍封面进入阅读

## 翻页操作

| 方式 | 操作 |
|------|------|
| 底部按钮 | 点击 `← 上一页` / `下一页 →` |
| 键盘 | `←` `→` / `PageUp` `PageDown` |
| 手机触摸 | 左右滑动（滑过 60px 触发） |

## 打包教程

### 方式一：PWA（推荐，最简单）

将 Web 应用安装为"桌面快捷方式"，无需打包，支持离线阅读。

**步骤：**

1. 在 `frontend/` 下安装 `vite-plugin-pwa`：

```bash
cd bookflow/frontend
npm install -D vite-plugin-pwa
```

2. 修改 `vite.config.js`，添加 PWA 插件：

```js
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'BookFlow 小说阅读器',
        short_name: 'BookFlow',
        theme_color: '#4f46e5',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ]
      }
    })
  ]
})
```

3. 构建并部署：

```bash
cd bookflow/frontend
npm run build        # 产出 dist/ 目录
```

4. 将 `dist/` 部署到任意静态服务器（nginx / Vercel / Netlify），后端保持运行。

5. 手机浏览器打开网址 → 地址栏会出现"添加到主屏幕"按钮。

---

### 方式二：Electron 桌面应用（Windows / Mac / Linux）

**步骤：**

1. 创建 `bookflow/electron/` 目录：

```bash
mkdir -p bookflow/electron
cd bookflow/electron
npm init -y
```

2. 安装 Electron：

```bash
npm install electron electron-builder --save-dev
```

3. 创建 `bookflow/electron/main.js`：

```js
const { app, BrowserWindow } = require('electron')
const { spawn } = require('child_process')
const path = require('path')

let backend
let mainWindow

function startBackend() {
  backend = spawn('node', [path.join(__dirname, '../server/src/index.js')])
}

app.whenReady().then(() => {
  startBackend()

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: { nodeIntegration: false }
  })

  // 开发模式连接 Vite dev server，生产模式加载打包后的文件
  const isDev = process.argv.includes('--dev')
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000')
  } else {
    mainWindow.loadURL('http://localhost:3001')
    // 或托管静态文件
  }
})

app.on('window-all-closed', () => {
  if (backend) backend.kill()
  app.quit()
})
```

4. 修改 `package.json` 添加打包脚本：

```json
{
  "main": "main.js",
  "scripts": {
    "dev": "electron . --dev",
    "build": "electron-builder"
  },
  "build": {
    "appId": "com.bookflow.app",
    "productName": "BookFlow",
    "directories": { "output": "release" },
    "win": { "target": "nsis" },
    "mac": { "target": "dmg" },
    "linux": { "target": "AppImage" }
  }
}
```

5. 构建安装包：

```bash
cd bookflow/electron
npm run build      # 产出在 release/ 目录
```

---

### 方式三：Capacitor 打包 Android/iOS App

**步骤：**

1. 在前端项目中安装 Capacitor：

```bash
cd bookflow/frontend
npm install @capacitor/core @capacitor/cli
npm install @capacitor/android @capacitor/ios
npx cap init BookFlow com.bookflow.app --web-dir=dist
```

2. 构建前端：

```bash
npm run build
npx cap sync
```

3. 打包 Android：

```bash
npx cap add android
npx cap open android     # 用 Android Studio 打开，Build → Generate APK
```

4. 打包 iOS（需要 Mac + Xcode）：

```bash
npx cap add ios
npx cap open ios         # 用 Xcode 打开，Product → Archive
```

> 注意：移动端需要配置 `@capacitor/filesystem` 插件来访问本地文件，因为浏览器无法直接读取手机文件系统。

---

### 方式四：Docker 部署（服务器）

适合部署到 NAS 或云服务器，多设备通过浏览器访问。

**Dockerfile：**

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm install --production
COPY server/ ./server/
COPY frontend/dist/ ./public/
EXPOSE 3001
CMD ["node", "server/src/index.js"]
```

构建运行：

```bash
cd bookflow/frontend && npm run build
cd bookflow
docker build -t bookflow .
docker run -d -p 3001:3001 -v /your/books:/books -v $(pwd)/data:/app/data bookflow
```

---

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/library` | 导入书库（`{ dirPath, name }`） |
| GET | `/api/library` | 列出所有书库 |
| DELETE | `/api/library/:id` | 删除书库 |
| GET | `/api/books` | 书籍列表（`?q=&format=&library=&limit=&offset=`） |
| GET | `/api/books/:id` | 书籍详情 |
| GET | `/api/books/:id/file` | 书籍文件下载流 |
| GET | `/api/books/:id/cover` | 封面图片 |
| POST | `/api/books/meta/extract` | 批量提取元数据 |
| GET | `/api/books/meta/stats` | 统计信息 |
| GET | `/api/books/meta/authors` | 作者列表 |
| GET | `/api/progress/:bookId` | 获取阅读进度 |
| PUT | `/api/progress/:bookId` | 保存阅读进度 |
| GET | `/api/bookmarks/:bookId` | 获取书签列表 |
| POST | `/api/bookmarks/:bookId` | 添加书签 |
| DELETE | `/api/bookmarks/:id` | 删除书签 |

## 依赖版本

| 包 | 版本 | 用途 |
|----|------|------|
| fastify | ^4.28 | HTTP 服务 |
| sql.js | ^1.12 | 纯 JS SQLite（免编译） |
| epubjs | ^0.3.93 | EPUB 渲染 |
| pdfjs-dist | ^4.4 | PDF 渲染 |
| react | ^18.3 | UI 框架 |
| zustand | ^4.5 | 状态管理 |
| tailwindcss | ^3.4 | 样式框架 |
| vite | ^5.4 | 构建工具 |
| adm-zip | ^0.5 | 解析 epub/zip |
| xml2js | ^0.6 | 解析 OPF 元数据 |
