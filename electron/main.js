const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let mainWindow;
let serverProcess;

function startServer() {
  const serverPath = path.join(__dirname, '..', 'server', 'src', 'index.js');
  serverProcess = fork(serverPath, [], {
    cwd: path.join(__dirname, '..', 'server'),
    env: { ...process.env, PORT: '3001' },
    silent: true,
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`[server] ${data}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`[server] ${data}`);
  });

  return new Promise((resolve) => {
    // 等待服务器启动
    setTimeout(resolve, 2000);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'BookFlow 小说阅读器',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 开发模式：加载 Vite dev server
  // 生产模式：加载构建后的静态文件
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});
