// extension.js - 使用 HTTP 检测服务器状态（已增强：按进程 cwd 归属到当前工作区）
const vscode = require("vscode");
const { exec } = require("child_process");
const http = require("http");
const https = require("https");
const path = require("path");

let statusBar = null;
let currentStatus = "idle";
let checkInterval = null;
let devServerPort = 8901; // 默认端口，可以自动检测
let serverReadyChecked = false;
let outputChannel = null;
let updateIntervalMs = 3000;

const STATUS = {
  IDLE: "idle",
  BUILDING: "building",
  READY: "ready",
  ERROR: "error",
};

function activate(context) {
  console.log("Vue Dev Server Monitor 已激活");
  const config = vscode.workspace.getConfiguration("vueStatus");
  devServerPort = config.get("defaultPort", devServerPort);
  updateIntervalMs = config.get("updateInterval", updateIntervalMs);
  outputChannel = vscode.window.createOutputChannel("Vue Dev Server Monitor");
  outputChannel.appendLine("扩展激活，读取配置完成。");

  // 创建状态栏
  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  updateStatusDisplay(STATUS.IDLE);
  statusBar.show();

  // 开始监控
  startMonitoring();

  // 监听文件保存
  vscode.workspace.onDidSaveTextDocument((document) => {
    const ext = document.fileName.split(".").pop();
    if (["vue", "js", "ts", "jsx", "tsx"].includes(ext)) {
      outputChannel &&
        outputChannel.appendLine(`文件保存: ${document.fileName}`);
      onFileSaved();
    }
  });

  // 注册命令
  const commands = [
    vscode.commands.registerCommand("vueStatus.openBrowser", () => {
      openBrowser(devServerPort);
      if (outputChannel)
        outputChannel.appendLine(
          `打开浏览器: http://localhost:${devServerPort}`
        );
    }),
    vscode.commands.registerCommand("vueStatus.checkNow", () => {
      checkDevServerStatus();
      if (outputChannel) outputChannel.appendLine("手动触发状态检查");
    }),
    vscode.commands.registerCommand("vueStatus.setPort", async () => {
      const port = await vscode.window.showInputBox({
        prompt: "输入开发服务器端口",
        value: devServerPort.toString(),
        validateInput: (value) => {
          const portNum = parseInt(value);
          return portNum > 0 && portNum < 65536
            ? null
            : "请输入有效的端口号 (1-65535)";
        },
      });
      if (port) {
        devServerPort = parseInt(port);
        if (outputChannel)
          outputChannel.appendLine(`端口手动设置为: ${devServerPort}`);
        vscode.window.showInformationMessage(`端口已设置为: ${devServerPort}`);
      }
    }),
  ];
  // 注册额外命令：自动检测端口、显示日志
  commands.push(
    vscode.commands.registerCommand("vueStatus.autoDetectPort", async () => {
      const detected = await tryDetectPort();
      if (detected) {
        vscode.window.showInformationMessage(
          `检测到服务器运行在端口: ${detected}`
        );
        if (outputChannel)
          outputChannel.appendLine(`检测到服务器运行在端口: ${detected}`);
      } else {
        vscode.window.showWarningMessage("未检测到已运行的开发服务器");
        if (outputChannel)
          outputChannel.appendLine("自动检测端口：未检测到服务器。");
      }
    })
  );
  commands.push(
    vscode.commands.registerCommand("vueStatus.showLogs", () => {
      if (outputChannel) outputChannel.show(true);
    })
  );

  commands.forEach((cmd) => context.subscriptions.push(cmd));
  context.subscriptions.push(statusBar);
  context.subscriptions.push(outputChannel);

  // 监听配置变化
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("vueStatus")) {
        const newConf = vscode.workspace.getConfiguration("vueStatus");
        const newPort = newConf.get("defaultPort", devServerPort);
        const newInterval = newConf.get("updateInterval", updateIntervalMs);
        devServerPort = newPort;
        updateIntervalMs = newInterval;
        if (outputChannel)
          outputChannel.appendLine(
            `配置已更新：defaultPort=${devServerPort} updateInterval=${updateIntervalMs}`
          );
        // 重新启动监控间隔
        if (checkInterval) {
          clearInterval(checkInterval);
        }
        startMonitoring();
      }
    })
  );
}

function startMonitoring() {
  // 使用配置间隔检查
  if (checkInterval) clearInterval(checkInterval);
  checkInterval = setInterval(checkDevServerStatus, updateIntervalMs);
  // 立即检查一次
  checkDevServerStatus();
}

async function checkDevServerStatus() {
  try {
    // 先查找可能的 dev-server 进程，并判断这些进程是否属于当前工作区
    const procs = await findDevServerProcesses();
    if (!procs || procs.length === 0) {
      if (currentStatus !== STATUS.IDLE) {
        setStatus(STATUS.IDLE, "开发服务器未运行");
        serverReadyChecked = false;
      }
      return;
    }

    const workspaceRoots = getWorkspaceRoots();
    const owned = procs.some((p) => {
      if (!p.cwd) return false;
      return workspaceRoots.some((root) => {
        // 兼容路径比较（确保末尾分隔符）
        const normalizedRoot = path.normalize(root);
        const normalizedCwd = path.normalize(p.cwd);
        return (
          normalizedCwd === normalizedRoot ||
          normalizedCwd.startsWith(normalizedRoot + path.sep)
        );
      });
    });

    if (!owned) {
      // 进程存在但不属于当前工作区 —— 把本窗口视为“空闲”
      if (currentStatus !== STATUS.IDLE) {
        setStatus(STATUS.IDLE, "开发服务器在其他窗口运行");
      }
      serverReadyChecked = false;
      return;
    }

    // 如果到这里说明进程存在且属于当前工作区，继续原有就绪检测逻辑
    const isRunning = true;
    if (!isRunning) {
      if (currentStatus !== STATUS.IDLE) {
        setStatus(STATUS.IDLE, "开发服务器未运行");
        serverReadyChecked = false;
      }
      return;
    }

    if (!serverReadyChecked && currentStatus === STATUS.BUILDING) {
      const isReady = await checkServerReady();
      if (isReady) {
        setStatus(STATUS.READY, `服务器运行在端口 ${devServerPort}`);
        serverReadyChecked = true;
      } else {
        if (currentStatus !== STATUS.BUILDING) {
          setStatus(STATUS.BUILDING, "服务器启动中...");
        }
      }
    } else if (serverReadyChecked && currentStatus === STATUS.READY) {
      const isReady = await checkServerReady();
      if (!isReady) {
        setStatus(STATUS.ERROR, "服务器可能已崩溃");
        serverReadyChecked = false;
      }
    } else if (
      isRunning &&
      !serverReadyChecked &&
      currentStatus !== STATUS.BUILDING
    ) {
      setStatus(STATUS.BUILDING, "检测到开发服务器进程");
      setTimeout(() => checkDevServerStatus(), 1000);
    }
  } catch (error) {
    outputChannel &&
      outputChannel.appendLine(
        "检查开发服务器状态失败: " +
          (error && error.message ? error.message : String(error))
      );
    console.error("检查开发服务器状态失败:", error);
  }
}

function getWorkspaceRoots() {
  const folders = vscode.workspace.workspaceFolders || [];
  return folders.map((f) => f.uri.fsPath);
}

function findDevServerProcesses() {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      // Windows 情况下保持原有粗略检测（不做 cwd 映射），以避免复杂的实现
      const command = 'tasklist /FI "IMAGENAME eq node.exe" /FO CSV';
      exec(command, (error, stdout) => {
        if (error) {
          return resolve([]);
        }
        // 这里只返回空，表示没有可靠的 cwd 信息（Windows 下可以扩展实现）
        resolve([]);
      });
      return;
    }

    // 在类 unix 系统上查找可能的 vite/npm run dev/node vite 进程
    const psCommand =
      "ps -eo pid,command | grep -E '[n]pm run dev|[v]ite.*dev|[n]ode.*vite' | grep -v grep";
    exec(psCommand, (err, stdout) => {
      if (err || !stdout) {
        return resolve([]);
      }
      const lines = stdout.trim().split("\n").filter(Boolean);
      const proms = lines.map((line) => {
        const m = line.match(/^(\d+)\s+(.*)$/);
        if (!m) return Promise.resolve(null);
        const pid = m[1];
        const cmd = m[2];
        // 使用 lsof 获取 cwd（macOS / Linux 通常有 lsof）
        return new Promise((res) => {
          const lsofCmd = `lsof -p ${pid} -a -d cwd -Fn 2>/dev/null | tr '\\n' '\\n'`;
          exec(lsofCmd, (lerr, lout) => {
            if (lerr || !lout) {
              // 如果没有 cwd 信息，仍然返回 pid/cmd
              return res({ pid, cmd, cwd: null });
            }
            // lsof -Fn 输出中，含 n<path> 行，取第一个 n 开头行
            const lines = lout.split("\n");
            const nline = lines.find((ln) => ln && ln.startsWith("n"));
            const cwd = nline ? nline.slice(1) : null;
            res({ pid, cmd, cwd });
          });
        });
      });

      Promise.all(proms)
        .then((results) => {
          const filtered = results.filter(Boolean);
          resolve(filtered);
        })
        .catch(() => resolve([]));
    });
  });
}

function isDevServerRunning() {
  // 兼容保留：快速判断是否存在相关进程（不考虑 cwd）
  return new Promise((resolve) => {
    const command =
      process.platform === "win32"
        ? 'tasklist /FI "IMAGENAME eq node.exe" /FO CSV'
        : "ps aux | grep -E '[n]pm run dev|[v]ite.*dev|[n]ode.*vite' | grep -v grep";

    exec(command, (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }

      const isRunning =
        stdout.includes("npm run dev") ||
        stdout.includes("vite") ||
        (stdout.includes("node") && stdout.includes("vite"));
      resolve(isRunning);
    });
  });
}

function checkServerReady() {
  return new Promise((resolve) => {
    const options = {
      hostname: "localhost",
      port: devServerPort,
      path: "/",
      method: "HEAD",
      timeout: 2000, // 2秒超时
    };

    const req = http.request(options, (res) => {
      outputChannel &&
        outputChannel.appendLine(`服务器响应状态码: ${res.statusCode}`);
      resolve(res.statusCode < 500);
    });

    req.on("error", (err) => {
      outputChannel &&
        outputChannel.appendLine(`服务器检测失败: ${err.message}`);
      resolve(false);
    });

    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

async function tryDetectPort() {
  const config = vscode.workspace.getConfiguration("vueStatus");
  const commonPorts = config.get(
    "commonPorts",
    [3000, 8080, 5173, 8901, 3001, 8081, 4173]
  );

  for (const port of commonPorts) {
    const isReady = await checkPort(port);
    if (isReady) {
      devServerPort = port;
      outputChannel &&
        outputChannel.appendLine(`检测到服务器运行在端口: ${port}`);
      return port;
    }
  }
  return null;
}

function checkPort(port) {
  return new Promise((resolve) => {
    const options = {
      hostname: "localhost",
      port: port,
      path: "/",
      method: "HEAD",
      timeout: 1000,
    };

    const req = http.request(options, (res) => {
      resolve(true);
    });

    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

function onFileSaved() {
  if (currentStatus === STATUS.READY || currentStatus === STATUS.ERROR) {
    setStatus(STATUS.BUILDING, "文件已保存，热重载中...");
    setTimeout(() => {
      checkServerReady().then((isReady) => {
        if (isReady) {
          setStatus(STATUS.READY, "热重载完成");
        } else {
          setStatus(STATUS.ERROR, "热重载可能失败");
        }
      });
    }, 2000);
  }
}

function setStatus(status, message = "") {
  if (currentStatus === status) return;
  outputChannel &&
    outputChannel.appendLine(
      `状态变化: ${currentStatus} -> ${status} ${message ? `(${message})` : ""}`
    );
  currentStatus = status;
  updateStatusDisplay(status, message);
  if (message) {
    showStatusNotification(status, message);
  }
}

function updateStatusDisplay(status, message = "") {
  const config = getStatusConfig(status);
  statusBar.text = config.text;
  statusBar.color = config.color;

  let tooltip = config.tooltip;
  if (message) {
    tooltip += `\n${message}`;
  }
  if (status === STATUS.READY) {
    tooltip += `\n端口: ${devServerPort}`;
  }
  statusBar.tooltip = tooltip;

  if (
    status === STATUS.READY ||
    status === STATUS.IDLE ||
    status === STATUS.BUILDING
  ) {
    statusBar.command = "workbench.action.terminal.toggleTerminal";
  } else if (status === STATUS.ERROR) {
    statusBar.command = "vueStatus.checkNow";
  } else {
    statusBar.command = undefined;
  }
}

function getStatusConfig(status) {
  const configs = {
    [STATUS.IDLE]: {
      text: "$(circle-outline) 空闲",
      color: undefined,
      tooltip: "Vue开发服务器未运行",
    },
    [STATUS.BUILDING]: {
      text: "$(sync~spin)  构建中",
      color: new vscode.ThemeColor("statusBarItem.warningForeground"),
      tooltip: "代码正在构建...",
    },
    [STATUS.READY]: {
      text: "$(rocket)  运行中",
      color: new vscode.ThemeColor("statusBarItem.successForeground"),
      tooltip: "开发服务器已就绪",
    },
    [STATUS.ERROR]: {
      text: "$(error)  错误",
      color: new vscode.ThemeColor("errorForeground"),
      tooltip: "服务器可能存在问题",
    },
  };

  return configs[status] || configs[STATUS.IDLE];
}

function showStatusNotification(status, message) {
  const config = vscode.workspace.getConfiguration("vueStatus");
  if (config.get("showNotifications", true)) {
    // 这里保持静默：如果需要可启用 showInformationMessage / showErrorMessage
  }
}

function openBrowser(port) {
  vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}`));
}

function deactivate() {
  if (checkInterval) {
    clearInterval(checkInterval);
  }
  console.log("扩展已停用");
}

module.exports = {
  activate,
  deactivate,
};
