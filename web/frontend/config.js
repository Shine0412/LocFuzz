// 后端地址：
//  - 容器部署：entrypoint.sh 启动时用 BACKEND_URL 环境变量替换下面的占位符；
//  - 本地开发：占位符未被替换时自动回退为「当前访问主机 + 6024」（本机访问即 localhost:6024）。
window.API_BASE = "__BACKEND_URL__";
if (window.API_BASE.indexOf("__") === 0) {
  window.API_BASE = "http://" + location.hostname + ":6024";
}
