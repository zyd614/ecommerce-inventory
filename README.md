# 电商库存台账

一个可以部署在 Debian 服务器上的轻量库存系统，用来记录商品 SKU、商品图片、进货加库存、发货减库存、当前库存、低库存提醒和库存流水。

## 功能

- 新品入库：系统自动生成 SKU，选择文件或粘贴商品图片，填进货数量即可建档
- 商品管理：SKU、主图、规格图片、名称、多个规格值、单位、低库存阈值、备注
- 规格组合：只填写规格值，不需要填写规格名称；主规格和可选子规格会自动生成蓝色-M、蓝色-L、红色-M、红色-L 等组合
- 独立库存：每个规格组合单独统计当前库存、累计进货和累计发货，并可上传自己的规格图片
- 图片自动压缩：支持选择或粘贴大于 8MB 的商品图和规格图，浏览器会自动压缩为适合上传的 WebP
- 图片管理：商品主图和规格图都可删除，也可以再次选择或粘贴新图进行替换
- 进货加库存：选择商品和具体规格组合，填数量，库存自动增加
- 发货减库存：选择商品和具体规格组合，填数量，库存自动减少
- 自动计算：当前库存、累计入库、累计出库、低库存商品数
- 库存保护：出库数量不能超过当前库存
- 流水撤销：误登记后可以撤销
- CSV 导出：商品库存和库存流水
- 密码登录：首次部署默认密码为 `change-me`，登录网页后可在右上角“修改密码”中改成自己的密码

输入密码登录后，主页就是单独的库存展示页，可以直接看到每个 SKU 下每个规格组合当前还剩多少。搜索框支持按 SKU、商品名称或规格搜索；新品入库、进货加库存、发货减库存都是弹窗功能，不占用库存展示页。

## 日常使用

1. 新品到货：点“新品入库”，系统会自动生成 SKU；选择文件或直接粘贴商品主图，然后直接填写主规格值。
2. 初始库存：需要时点“添加子规格”，系统会生成所有组合；分别填写蓝色-M、蓝色-L 等组合的初始数量，也可以给每个组合上传正常大小的图片。页面会自动把规格图显示得比商品主图小，不需要提前缩小图片。
3. 老品补货：在库存展示页对应组合的商品行点“进货 +”，选择或确认规格组合，填数量，点“加库存”。
4. 发货出库：在库存展示页对应组合的商品行点“发货 -”，选择或确认规格组合，填数量，点“减库存”。
5. 看库存：库存展示页每一行就是一个规格组合的当前库存，不同组合互不影响。

## Debian 部署

服务器需要先安装 Docker 和 Docker Compose 插件。

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

上传项目后进入目录：

```bash
cd ecommerce-inventory
```

首次部署时直接使用默认密码 `change-me` 登录网页。登录后点击右上角“修改密码”，输入当前密码和新密码即可。新密码保存在 `data/inventory.db` 中，容器重启或更新代码不会丢失。

修改 `docker-compose.yml` 里的会话密钥：

```yaml
environment:
  ADMIN_PASSWORD: "change-me"
  SECRET_KEY: "一串足够长的随机字符"
  DATABASE_PATH: "/app/data/inventory.db"
  UPLOAD_DIR: "/app/data/uploads"
  MAX_UPLOAD_MB: "128"
```

启动：

```bash
docker compose up -d --build
```

访问：

```text
http://你的服务器IP:8000
```

查看日志：

```bash
docker compose logs -f
```

停止：

```bash
docker compose down
```

## 数据和备份

库存数据保存在项目目录的 `data/inventory.db`，商品图片保存在 `data/uploads`。选择或粘贴大图后，浏览器会自动压缩再上传；服务端单次请求总上限默认为 128MB。备份时复制整个 `data` 目录即可。

```bash
mkdir -p backups
cp -r data "backups/data-$(date +%F-%H%M%S)"
```

## 本地运行

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
ADMIN_PASSWORD=change-me SECRET_KEY=dev-secret python app.py
```

然后打开：

```text
http://127.0.0.1:8000
```
