// extension.js - 简化版本：仅通过 HTTP 检测端口的可用性（包含失败阈值回退）
const vscode = require("vscode");
const http = require("http");

let statusBar = null;
let currentStatus = "idle";
let checkInterval = null;
let devServerPort = undefined;
let outputChannel = null;
let updateIntervalMs = 3000;
let isTerminalVisible = false; // 新增：跟踪终端显示状态

// 新增：连续失败计数与阈值（超过阈值则认为服务已停止，回到 IDLE）
let consecutiveFailures = 0;
let failureThreshold = 3;

const STATUS = {
  IDLE: "idle",
  BUILDING: "building",
  READY: "ready",
};

function activate(context) {
  const config = vscode.workspace.getConfiguration("vueStatus");
  updateIntervalMs = config.get("updateInterval", updateIntervalMs);
  failureThreshold = config.get("failureThreshold", 3); // 读取配置值

  outputChannel = vscode.window.createOutputChannel("Vue Dev Server Monitor");
  outputChannel.appendLine("扩展激活：简化版（仅端口 HTTP 检测）");

  // 初始化端口：优先 workspace 配置，其次 user（global）配置
  const inspected = config.inspect("defaultPort") || {};
  if (inspected.workspaceValue) {
    devServerPort = inspected.workspaceValue;
    outputChannel.appendLine(`使用工作区配置端口: ${devServerPort}`);
  } else if (inspected.globalValue) {
    devServerPort = inspected.globalValue;
    outputChannel.appendLine(`使用用户配置端口: ${devServerPort}`);
  } else {
    devServerPort = undefined;
    outputChannel.appendLine("未配置默认端口（需手动设置或在设置中添加）");
  }

  // 创建状态栏
  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  updateStatusDisplay(STATUS.IDLE);
  statusBar.show();

  // 开始监控
  startMonitoring();

  // 监听文件保存：若是源码文件，触发热重载检测
  vscode.workspace.onDidSaveTextDocument((document) => {
    const ext = document.fileName.split(".").pop();
    if (["vue", "js", "ts", "jsx", "tsx"].includes(ext)) {
      outputChannel.appendLine(`文件已保存: ${document.fileName}`);
      onFileSaved();
    }
  });

  // 注册命令：打开浏览器、手动检查、设置端口、显示日志
  const commands = [
    vscode.commands.registerCommand("vueStatus.toggleTerminal", () => {
      const terminal = vscode.window.activeTerminal;
      if (terminal) {
        if (isTerminalVisible) {
          terminal.hide();
          isTerminalVisible = false;
        } else {
          terminal.show();
          isTerminalVisible = true;
        }
      } else {
        vscode.window.showWarningMessage("没有活动的终端");
      }
    }),
    vscode.commands.registerCommand("vueStatus.checkNow", () => {
      checkDevServerStatus();
      outputChannel.appendLine("手动触发状态检查");
    }),
    vscode.commands.registerCommand("vueStatus.openBrowser", () => {
      if (!devServerPort) {
        vscode.window.showWarningMessage("未设置端口，无法打开浏览器");
        return;
      }
      openBrowser(devServerPort);
      outputChannel.appendLine(`打开浏览器: http://localhost:${devServerPort}`);
    }),
    vscode.commands.registerCommand("vueStatus.checkNow", () => {
      checkDevServerStatus();
      outputChannel.appendLine("手动触发状态检查");
    }),
    vscode.commands.registerCommand("vueStatus.setPort", async () => {
      const portInput = await vscode.window.showInputBox({
        prompt: "输入开发服务器端口（1-65535），留空取消",
        value: devServerPort ? devServerPort.toString() : "",
        validateInput: (value) => {
          if (!value) return null;
          const portNum = parseInt(value, 10);
          return portNum > 0 && portNum < 65536
            ? null
            : "请输入有效的端口号 (1-65535)";
        },
      });
      if (portInput) {
        devServerPort = parseInt(portInput, 10);
        outputChannel.appendLine(`端口手动设置为: ${devServerPort}`);
        vscode.window.showInformationMessage(`端口已设置为: ${devServerPort}`);
        // 重置失败计数并立即检查一次
        consecutiveFailures = 0;
        checkDevServerStatus();
      }
    }),
    vscode.commands.registerCommand("vueStatus.showLogs", () => {
      if (outputChannel) outputChannel.show(true);
    }),
  ];

  commands.forEach((cmd) => context.subscriptions.push(cmd));
  context.subscriptions.push(statusBar);
  context.subscriptions.push(outputChannel);

  // 监听配置变化：当用户更改 defaultPort 或 updateInterval 时，更新行为
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("vueStatus")) {
        const newConf = vscode.workspace.getConfiguration("vueStatus");
        const inspectedNew = newConf.inspect("defaultPort") || {};
        if (inspectedNew.workspaceValue) {
          devServerPort = inspectedNew.workspaceValue;
          outputChannel.appendLine(`工作区配置端口更新: ${devServerPort}`);
        } else if (inspectedNew.globalValue) {
          devServerPort = inspectedNew.globalValue;
          outputChannel.appendLine(`用户配置端口更新: ${devServerPort}`);
        } else {
          devServerPort = undefined;
          outputChannel.appendLine("配置中未设置 defaultPort，已清除端口设置");
        }

        const newInterval = newConf.get("updateInterval", updateIntervalMs);
        updateIntervalMs = newInterval;
        outputChannel.appendLine(
          `配置更新：updateInterval=${updateIntervalMs} defaultPort=${
            devServerPort || "未设置"
          }`
        );

        if (checkInterval) {
          clearInterval(checkInterval);
        }
        // 重置失败计数并重新启动监控
        consecutiveFailures = 0;
        startMonitoring();
      }
    })
  );
}

function startMonitoring() {
  if (checkInterval) clearInterval(checkInterval);
  checkInterval = setInterval(checkDevServerStatus, updateIntervalMs);
  checkDevServerStatus();
}

function checkDevServerStatus() {
  // 如果没有端口配置，则显示空闲（不报错）
  if (!devServerPort) {
    consecutiveFailures = 0;
    setStatus(STATUS.IDLE, "未配置端口");
    return;
  }

  checkPort(devServerPort)
    .then((isReady) => {
      if (isReady) {
        // 成功响应：重置失败计数，设为 READY
        consecutiveFailures = 0;
        setStatus(STATUS.READY, `服务器在端口 ${devServerPort}`);
      } else {
        // 检测失败：计数并根据阈值决定是否回到 IDLE
        consecutiveFailures++;
        outputChannel &&
          outputChannel.appendLine(
            `端口 ${devServerPort} 无响应（连续失败 ${consecutiveFailures}/${FAILURE_THRESHOLD}）`
          );

        if (currentStatus === STATUS.READY) {
          // 从 READY 到 BUILDING（第一次检测失败）
          setStatus(STATUS.BUILDING, "可能正在热重载或构建");
        } else if (currentStatus === STATUS.BUILDING) {
          // 在 BUILDING 中，如果连续失败次数超过阈值则认定为停止，回到 IDLE；否则继续保持 BUILDING
          if (consecutiveFailures >= FAILURE_THRESHOLD) {
            outputChannel &&
              outputChannel.appendLine(
                `达到失败阈值，认为服务已停止，切回空闲`
              );
            setStatus(STATUS.IDLE, "服务停止或端口未监听");
            // 重置计数，等待下一次成功检测再恢复
            consecutiveFailures = 0;
          } else {
            setStatus(STATUS.BUILDING, "构建中，等待服务响应...");
          }
        } else {
          // 其他情况（如原本是 IDLE），保持或回到 IDLE
          setStatus(STATUS.IDLE, "未检测到服务");
        }
      }
    })
    .catch((err) => {
      outputChannel && outputChannel.appendLine("检查端口失败: " + err.message);
      // 异常时也增加失败计数并按阈值回退
      consecutiveFailures++;
      if (currentStatus === STATUS.BUILDING) {
        if (consecutiveFailures >= FAILURE_THRESHOLD) {
          setStatus(STATUS.IDLE, "检测异常，已回到空闲");
          consecutiveFailures = 0;
        } else {
          setStatus(STATUS.BUILDING, "构建中（检测异常，继续等待）");
        }
      } else {
        setStatus(STATUS.IDLE, "检测异常");
      }
    });
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
      resolve(res.statusCode < 500);
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
  // 如果当前为运行中或已处于构建中，保存后进入并保持构建中直到检测到就绪或达到失败阈值
  if (currentStatus === STATUS.READY || currentStatus === STATUS.BUILDING) {
    consecutiveFailures = 0; // 保存触发时认为是新的构建周期，重置失败计数
    setStatus(STATUS.BUILDING, "文件已保存，热重载中...");
    setTimeout(() => {
      checkPort(devServerPort)
        .then((isReady) => {
          if (isReady) {
            consecutiveFailures = 0;
            setStatus(STATUS.READY, "热重载完成");
          } else {
            // 保持构建中（具体是否回到 IDLE 由连续失败计数决定）
            consecutiveFailures++;
            if (consecutiveFailures >= FAILURE_THRESHOLD) {
              setStatus(STATUS.IDLE, "热重载后未响应，已回到空闲");
              consecutiveFailures = 0;
            } else {
              setStatus(STATUS.BUILDING, "热重载中，等待响应...");
            }
          }
        })
        .catch(() => {
          consecutiveFailures++;
          if (consecutiveFailures >= FAILURE_THRESHOLD) {
            setStatus(STATUS.IDLE, "热重载检测异常，已回到空闲");
            consecutiveFailures = 0;
          } else {
            setStatus(STATUS.BUILDING, "热重载中（检测异常，继续等待）");
          }
        });
    }, 1500);
  }
}

function setStatus(status, message = "") {
  if (currentStatus === status && !message) return;
  outputChannel &&
    outputChannel.appendLine(
      `状态变化: ${currentStatus} -> ${status} ${message ? `(${message})` : ""}`
    );
  currentStatus = status;
  updateStatusDisplay(status, message);
}

function updateStatusDisplay(status, message = "") {
  const config = getStatusConfig(status);
  statusBar.text = config.text;
  statusBar.color = config.color;

  let tooltip = config.tooltip;
  if (message) {
    tooltip += `\n${message}`;
  }
  if (status === STATUS.READY && devServerPort) {
    tooltip += `\n端口: ${devServerPort}`;
  }
  statusBar.tooltip = tooltip;

  // 修改点击行为：切换终端显示
  statusBar.command = "vueStatus.toggleTerminal";
}

function getStatusConfig(status) {
  const configs = {
    [STATUS.IDLE]: {
      text: "$(circle-outline) 空闲",
      color: undefined,
      tooltip: "开发服务器未运行",
    },
    [STATUS.BUILDING]: {
      text: "$(sync~spin)  构建中",
      color: "#FFA500",
      tooltip: "代码可能正在构建或热重载中...",
    },
    [STATUS.READY]: {
      text: "$(rocket)  运行中",
      color: "#00FF00",
      tooltip: "开发服务器已就绪",
    },
  };

  return configs[status] || configs[STATUS.IDLE];
}

function openBrowser(port) {
  vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}`));
}

function deactivate() {
  if (checkInterval) clearInterval(checkInterval);
  if (outputChannel) outputChannel.dispose();
}

module.exports = {
  activate,
  deactivate,
};
