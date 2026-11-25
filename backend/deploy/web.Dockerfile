# ppCoffe · H5 前端镜像
#
# 构建上下文是 web/ 目录，其中应包含：
#   dist/   —— Taro 打包出的 H5 产物（由 deploy-fnos-docker.sh 构建后拷入）
#   nginx.conf —— 反向代理配置
#
# 构建：
#   docker build -t ppcoffe/web:latest web/
#
# 为什么不在镜像里跑 npm build：
#   1) 产物是静态文件，浏览器拿到就能跑，不需要 Node 运行时；
#   2) 构建机（本地 Mac）的依赖更完整，node_modules 已在，
#      避免容器内再拉一遍 npm 依赖（Taro 依赖量大，构建慢且易因网络失败）；
#   3) 镜像更小（alpine + nginx 只有几十 MB）。

FROM nginx:1.27-alpine

# 静态产物
COPY dist/ /usr/share/nginx/html/

# 反向代理配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
