# LocFuzz · JS 引擎漏洞感知模糊测试平台

**LLM 引导变异位置选择** → 定向变异 → Node.js（V8）执行 → 行为相似度评估
的完整链路，对 JS 引擎做漏洞感知的定向模糊测试。提供命令行与 Web 服务两种使用方式。

## 环境要求

- Python 3.10+（`pip install -r requirements.txt`）
- Node.js（执行与特征采集依赖 `inspector` API）

## 目录结构

```
code/
├── locfuzz/                 # 核心包
│   ├── experiment.py        # 实验驱动（入口）
│   ├── mutator.py           # LLM 定向变异（DeepSeek）
│   ├── prompts.py           # 提示词加载
│   ├── runner.py            # 执行 harness
│   ├── features.py          # EditSim + Jaccard
│   └── assets/              # 非 Python 资源
│       ├── coverage_agent.js    # 执行 + 特征采集 agent
│       ├── promote_system.txt   # system 提示词
│       └── promote_user.txt     # user 提示词
├── seeds/                   # 内置种子用例（.js）
├── seeds_user/              # 用户通过 Web 上传的自定义种子（运行时自动生成，与内置隔离）
├── results/                 # 运行产物（用例 + results.json，运行时自动生成）
├── web/                     # 前后端分离实现（见下文「Web 服务化部署」）
├── .secret/                 # API 密钥目录（仅 DeepSeek_key.txt 空占位入库，密钥自行填入）
├── .gitignore               # 排除密钥与产物（.secret/ 仅放行空占位文件、results/ 等）
├── .gitattributes           # 统一 LF 行尾
├── .dockerignore            # 排除产物与缓存，不进入镜像
├── docker-compose.yml       # 全栈一键编排
├── requirements.txt
└── README.md
```

> 注：`seeds_user/` 与 `results/` 不进版本库，由后端在首次运行/上传时自动创建；
> `.secret/` 中只有空的 `DeepSeek_key.txt` 占位文件入库，真实密钥由部署者自行写入，切勿提交。

## 运行

```bash
cd code
pip install -r requirements.txt

python -m locfuzz.experiment --per-seed 10
```

API 密钥直接读取 `code/.secret/DeepSeek_key.txt`，无需任何环境变量
（部署时密钥文件随 `code/` 一起上传即可）；如需覆盖端点/模型/密钥，
可用环境变量 `LOC_FUZZ_BASE_URL` / `LOC_FUZZ_MODEL` / `LOC_FUZZ_API_KEY`。

## 运行效果

终端逐用例打印状态，结束时输出汇总：

```
[seed] seed1_typeconf.js: 基线 status=ok seq=3 funcs=2
  [m00] ok            valid=True J=100.0 E=66.7
  ...

===== 汇总 =====
用例总数        : 80
用例有效性    : 100.00%  {'ok': 80}
Jaccard 相似度: 100.00%
EditSim 相似度: 79.80%
崩溃/超时用例   : N 个（详见 results.json）
结果已保存      : .../results/results.json
```

- **有效性**：变异用例非语法错误且未超时/崩溃即计为有效
- **Jaccard**：变异前后函数覆盖集合的交并比
- **EditSim**：变异前后函数调用序列的编辑距离相似度
- 崩溃/超时用例单独列出，便于人工排查是否为疑似漏洞触发

结果写入 `results/results.json`，每条记录含种子名、状态、有效性、
两项相似度；全部变异用例源码保存在 `results/cases/` 下。

## 模块

| 文件 | 作用 |
| ------ | ------ |
| `locfuzz/prompts.py` + `locfuzz/assets/promote_*.txt` | 提示词加载与占位符填充 |
| `locfuzz/mutator.py` | 调 DeepSeek（OpenAI 兼容协议）生成定向变异，重试 3 次 |
| `locfuzz/runner.py` + `locfuzz/assets/coverage_agent.js` | 执行用例，采集调用序列与函数覆盖集合 |
| `locfuzz/features.py` | EditSim + Jaccard 计算 |
| `locfuzz/experiment.py` | 实验驱动：基线 → 变异 → 执行 → 汇总 |
| `seeds/` | 8 个内置种子用例，覆盖典型历史漏洞模式（见下表） |

## 参数

| 参数 | 默认 | 说明 |
| ------ | ------ | ------ |
| `--seeds` | `seeds/` | 种子目录，放入自定义 `.js` 即可 |
| `--per-seed` | 10 | 每个种子生成的变异用例数 |
| `--timeout` | 5000 | 单用例超时（毫秒） |
| `--out` | `results/` | 结果输出目录 |

## 种子

`seeds/` 内置 8 个模仿历史漏洞模式的自包含种子，覆盖 JS 引擎几类
典型缺陷面；接入更多种子时，把 `.js` 文件放入该目录即可。

| 种子 | 漏洞模式 |
| ------ | --------- |
| `seed1_typeconf.js` | JIT 类型混淆（valueOf 副作用改变类型） |
| `seed2_oob.js` | 数组长度边界（边界检查消除绕过） |
| `seed3_proto.js` | 原型链 / 动态属性访问（Proxy 陷阱语义不一致） |
| `seed4_typer.js` | TurboFan typer 数值范围失配（Math 函数越界值） |
| `seed5_sort.js` | 排序比较器副作用（sort 中收缩数组） |
| `seed6_regexp.js` | RegExp 状态边界（exec 热循环中 lastIndex 突变） |
| `seed7_redos.js` | 正则回溯（ReDoS） |
| `seed8_oom.js` | 堆内存耗尽（资源耗尽型 DoS） |

## Web 服务化部署（前端 6023 / 后端 6024）

`web/` 下提供完整的前后端分离实现。**Web 界面特性**：
全局统计仪表盘（任务/变异用例/有效性/Jaccard/EditSim/崩溃捕获 6 格，
窄屏 3+3、宽屏单行自适应）、LLM 流水线动态示意、任务实时事件控制台、
三项指标环形仪表 + 执行状态环形图、逐用例 LLM 延迟统计、
全部界面注释统一为 ⓘ 悬停提示、点击用例弹出语法高亮详情抽屉
（含 LLM 自述的变异位置/策略/漏洞模式）、用例记录**按种子分组合集**
（组头折叠，含异常的组默认展开）、任务重跑/删除/结果导出、
种子源码在线查看、变异体语法非法时自动请求 LLM 重试一次。
种子提供**两种使用方式**：「默认配置」一键使用全部 8 个内置种子；
「自定义选择」在页面中勾选内置种子（每个种子附漏洞模式说明），
或上传自己的 `.js` 种子（存入独立的 `seeds_user/` 目录，与内置种子
隔离，可随时删除）。

**后端 REST 接口**：

| 方法 | 路径 | 说明 |
| ------ | ------ | ------ |
| GET | `/api/health` / `/api/config` / `/api/stats` | 存活 / 引擎与模型配置 / 全局统计 |
| GET | `/api/seeds` | 种子库列表（内置 `seeds/` 与 用户 `seeds_user/` 分开返回） |
| POST | `/api/seeds` | 上传自定义种子（保存至 `seeds_user/`） |
| DELETE | `/api/seeds/{name}` | 删除用户种子（内置种子不可删除） |
| POST | `/api/jobs` | 勾选种子（`selected` 逗号分隔名单）+ 参数，启动任务 |
| GET | `/api/jobs` / `/api/jobs/{id}` | 任务列表（含实时进度/耗时）/ 详情 |
| POST | `/api/jobs/{id}/stop` / `/rerun` | 停止 / 按相同配置重跑 |
| DELETE | `/api/jobs/{id}` | 删除任务（运行中需先停止） |
| GET | `/api/jobs/{id}/events` | 任务实时事件流（控制台轮询） |
| GET | `/api/jobs/{id}/result` / `/export` | 汇总 JSON / 下载汇总文件 |
| GET | `/api/jobs/{id}/cases` / `/cases/{name}` | 用例列表 / 下载用例源码 |
| GET | `/api/jobs/{id}/seeds/{name}` | 查看上传的种子源码 |

**预期效果**（默认配置一次完整运行，可直接用于部署验收）：
正常种子（seed1~6）的变异用例有效性 ≈ 100%，Jaccard ≈ 100%，
EditSim ≈ 80%；seed7 全部超时、seed8 基线与变异体触发崩溃——
任务结果页应同时看到高指标、崩溃/超时表条目与按种子分组的用例合集。

```
web/
├── backend/            # FastAPI 后端（后台线程跑 fuzz 任务）
│   ├── main.py         #   上述 REST 接口 + CORS
│   ├── job.py          #   FuzzJob：流水线线程封装（进度/事件流/停止/汇总落盘）
│   ├── store.py        #   任务内存存储（并发上限保护、重跑、删除）
│   ├── requirements.txt
│   └── Dockerfile      #   node:20-slim + Python（单容器双运行时）
└── frontend/           # 静态单页（nginx 托管）
    ├── index.html      #   发起任务 / 任务监控 / 结果展示 三区
    ├── app.js
    ├── style.css
    ├── config.js       #   后端地址占位符，启动时按 BACKEND_URL 注入
    ├── favicon.svg
    ├── nginx.conf
    ├── entrypoint.sh
    └── Dockerfile
```

**Docker 部署**（在有 Docker 的机器上，于 `code/` 目录执行）：

```bash
# 方式一：compose 一键起全栈
docker compose up -d --build

# 方式二：分别构建运行
docker build -f web/backend/Dockerfile  -t locfuzz-backend  .
docker build -f web/frontend/Dockerfile -t locfuzz-frontend .
docker run -d --name locfuzz-backend  -p 6024:6024 \
  -v fuzzdata:/data locfuzz-backend
docker run -d --name locfuzz-frontend -p 6023:80 \
  -e BACKEND_URL=http://<本机IP>:6024 locfuzz-frontend
```

访问 `http://<IP>:6023`。设备上部署时把 `BACKEND_URL` 换成设备 IP。

**本地开发调试**（无 Docker）：

```bash
pip install -r web/backend/requirements.txt
python -m uvicorn web.backend.main:app --port 6024          # 后端
cd web/frontend && python -m http.server 6023               # 前端
```

> 本地开发无需改配置：`config.js` 中的占位符未被替换时会自动回退为
> 「当前访问主机 + 6024」，本机访问即 `localhost:6024`。

> 密钥说明：仓库自带 `code/.secret/DeepSeek_key.txt` **空占位文件**——克隆/部署后
> 把自己的 DeepSeek API 密钥写入该文件（单行、无多余空白）即可，后端启动时直接
> 读取，无需环境变量；也可用 `LOC_FUZZ_API_KEY` 环境变量覆盖。`.gitignore` 只放行
> 这一个占位文件，**请勿把真实密钥提交进版本库**。容器需能访问外网 DeepSeek API。
