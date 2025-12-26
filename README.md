
# Vue Dev Server Monitor

## 概述
Vue Dev Server Monitor 是一个 Visual Studio Code 扩展，用于在状态栏实时监控 Vue.js 开发服务器的运行状态。它能够自动检测开发服务器进程、端口状态，并在文件保存时提供热重载反馈，帮助开发者高效管理开发环境。

## 关键特性
- 🚀 **实时状态监控**：在状态栏显示开发服务器状态（空闲/构建中/运行中/错误）
- 📁 **工作区归属检测**：智能判断开发服务器进程是否属于当前工作区
- 🔍 **自动端口检测**：支持自动识别常用端口（3000, 8080, 5173 等）
- 🌐 **一键打开浏览器**：快速访问运行中的开发服务器
- 📝 **详细日志输出**：通过专用输出通道提供运行日志
- ⚙️ **灵活配置**：支持自定义端口、检查间隔等参数

## 前置条件
- Visual Studio Code 1.60.0 或更高版本
- Node.js 开发环境
- Vue.js 项目（使用 Vite 或 Vue CLI）

## 安装方法
1. 在 VS Code 扩展市场搜索 `Vue Dev Server Monitor`
2. 点击 **安装** 按钮
3. 重启 VS Code 完成安装

## 使用方法
1. 打开 Vue 项目工作区
2. 启动开发服务器（`npm run dev` 或 `yarn dev`）
3. 观察状态栏右侧显示的服务器状态：
   - `$(circle-outline) 空闲`：服务器未运行
   - `$(sync~spin) 构建中`：正在构建或热重载
   - `$(rocket) 运行中`：服务器就绪
   - `$(error) 错误`：服务器异常
4. 点击状态栏可快速打开浏览器或执行其他操作

## 配置选项
在 VS Code 设置中搜索 `vueStatus` 可配置以下选项：
- `vueStatus.enable`：启用/禁用监控
- `vueStatus.updateInterval`：状态检查间隔（默认 3000ms）
- `vueStatus.defaultPort`：默认端口（默认 5173）
- `vueStatus.autoDetectPort`：自动检测端口（默认启用）
- `vueStatus.commonPorts`：常用端口列表

## 可用命令
打开命令面板（Ctrl+Shift+P）可执行以下操作：
- `Vue Status: 打开浏览器`：访问开发服务器
- `Vue Status: 检查服务器状态`：手动刷新状态
- `Vue Status: 设置服务器端口`：自定义端口
- `Vue Status: 自动检测端口`：扫描常用端口
- `Vue Status: 显示运行日志`：查看详细日志

## 开发说明
### 构建方法
```bash
# 克隆项目
git clone https://github.com/your-username/vue-dev-server-monitor.git

# 安装依赖
npm install

# 编译扩展
npm run compile

# 打包扩展
vsce package
```

### 调试方法
1. 在 VS Code 中打开项目
2. 按 F5 启动调试会话
3. 在新窗口中测试扩展功能

## 许可证
MIT License

## 贡献指南
欢迎提交 Issue 和 Pull Request！请确保：
1. 代码符合项目风格
2. 添加必要的测试用例
3. 更新相关文档

## 更新日志
### v1.0.0
- 初始版本发布
- 支持基本状态监控
- 添加自动端口检测
- 实现工作区归属判断

## 联系方式
- 作者：dengxuyang
- 邮箱：your-email@example.com
- GitHub：https://github.com/your-username/vue-dev-server-monitor

---

> 💡 **提示**：如果遇到服务器状态检测不准确的情况，可以尝试手动设置端口或使用"自动检测端口"功能。