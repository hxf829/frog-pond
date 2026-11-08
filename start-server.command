#!/bin/bash
# 双击本文件，在 Mac 上启动 Frog Pond 本地服务器
cd "$(dirname "$0")" || exit 1
PORT=8777
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)
echo "===================================="
echo "  Frog Pond 服务器已启动"
echo "  本机访问: http://localhost:$PORT"
echo "  iPad 访问: http://$IP:$PORT"
echo "  （iPad 需与电脑连同一个 Wi-Fi）"
echo "===================================="
echo "关闭此窗口即停止服务器。"
python3 server.py "$PORT"
