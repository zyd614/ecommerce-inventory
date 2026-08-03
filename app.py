import csv
import io
import json
import os
import secrets
import sqlite3
import uuid
from datetime import datetime
from functools import wraps

from flask import Flask, Response, jsonify, render_template, request, send_from_directory, session
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_PATH = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "data", "inventory.db"))
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", os.path.join(BASE_DIR, "data", "uploads"))
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "change-me")
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-change-me")
ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif"}

app = Flask(__name__)
app.secret_key = SECRET_KEY
app.config["MAX_CONTENT_LENGTH"] = int(os.environ.get("MAX_UPLOAD_MB", "8")) * 1024 * 1024


def get_db():
    os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with get_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sku TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                unit TEXT NOT NULL DEFAULT '件',
                low_stock_threshold INTEGER NOT NULL DEFAULT 0,
                note TEXT,
                image_filename TEXT,
                specs_json TEXT NOT NULL DEFAULT '[]',
                main_spec_name TEXT NOT NULL DEFAULT '',
                sub_spec_name TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS movements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                type TEXT NOT NULL CHECK (type IN ('in', 'out')),
                quantity INTEGER NOT NULL CHECK (quantity > 0),
                unit_price REAL,
                reference TEXT,
                note TEXT,
                happened_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                variant_id INTEGER,
                FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
            );

            CREATE TABLE IF NOT EXISTS product_variants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                main_spec TEXT NOT NULL DEFAULT '',
                sub_spec TEXT NOT NULL DEFAULT '',
                variant_key TEXT NOT NULL,
                image_filename TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(product_id, variant_key),
                FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_movements_product_id ON movements(product_id);
            CREATE INDEX IF NOT EXISTS idx_movements_happened_at ON movements(happened_at);
            """
        )
        columns = {row["name"] for row in db.execute("PRAGMA table_info(products)").fetchall()}
        if "image_filename" not in columns:
            db.execute("ALTER TABLE products ADD COLUMN image_filename TEXT")
        if "specs_json" not in columns:
            db.execute("ALTER TABLE products ADD COLUMN specs_json TEXT NOT NULL DEFAULT '[]'")
        if "main_spec_name" not in columns:
            db.execute("ALTER TABLE products ADD COLUMN main_spec_name TEXT NOT NULL DEFAULT ''")
        if "sub_spec_name" not in columns:
            db.execute("ALTER TABLE products ADD COLUMN sub_spec_name TEXT NOT NULL DEFAULT ''")
        movement_columns = {row["name"] for row in db.execute("PRAGMA table_info(movements)").fetchall()}
        if "variant_id" not in movement_columns:
            db.execute("ALTER TABLE movements ADD COLUMN variant_id INTEGER")
        db.execute("CREATE INDEX IF NOT EXISTS idx_movements_variant_id ON movements(variant_id)")
        variant_columns = {row["name"] for row in db.execute("PRAGMA table_info(product_variants)").fetchall()}
        if "image_filename" not in variant_columns:
            db.execute("ALTER TABLE product_variants ADD COLUMN image_filename TEXT")
        migrate_legacy_variants(db)


@app.before_request
def ensure_schema():
    init_db()


@app.errorhandler(RequestEntityTooLarge)
def upload_too_large(_error):
    return jsonify({"error": "图片太大，请上传 8MB 以内的图片"}), 413


def get_password_hash(db):
    row = db.execute("SELECT value FROM app_settings WHERE key = 'admin_password_hash'").fetchone()
    return row["value"] if row else None


def password_matches(db, password):
    stored_hash = get_password_hash(db)
    if stored_hash:
        return check_password_hash(stored_hash, password)
    configured_hash = os.environ.get("ADMIN_PASSWORD_HASH")
    if configured_hash:
        return check_password_hash(configured_hash, password)
    return password == ADMIN_PASSWORD


def save_password_hash(db, password):
    db.execute(
        """
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('admin_password_hash', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
        """,
        (generate_password_hash(password),),
    )


def variant_key(main_spec, sub_spec):
    return json.dumps([clean_text(main_spec), clean_text(sub_spec)], ensure_ascii=False, separators=(",", ":"))


def parse_variant_defs(value):
    if not value:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return []
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        if not isinstance(item, dict):
            continue
        main_spec = clean_text(item.get("main_spec", item.get("main")))
        sub_spec = clean_text(item.get("sub_spec", item.get("sub")))
        if main_spec or sub_spec:
            result.append({"main_spec": main_spec, "sub_spec": sub_spec})
    return result


def parse_variant_config(value):
    if not value:
        return {"main_spec_name": "", "main_values": [], "sub_spec_name": "", "sub_values": []}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return {"main_spec_name": "", "main_values": [], "sub_spec_name": "", "sub_values": []}
    if not isinstance(value, dict):
        return {"main_spec_name": "", "main_values": [], "sub_spec_name": "", "sub_values": []}
    return {
        "main_spec_name": clean_text(value.get("main_spec_name", value.get("main_name"))),
        "main_values": unique_texts(value.get("main_values", value.get("main", []))),
        "sub_spec_name": clean_text(value.get("sub_spec_name", value.get("sub_name"))),
        "sub_values": unique_texts(value.get("sub_values", value.get("sub", []))),
    }


def unique_texts(values):
    if isinstance(values, str):
        values = values.split(",")
    if not isinstance(values, list):
        return []
    result = []
    for value in values:
        value = clean_text(value)
        if value and value not in result:
            result.append(value)
    return result


def build_variant_defs(config):
    main_values = config["main_values"] or [""]
    sub_values = config["sub_values"] or ["default"]
    return [{"main_spec": main_value, "sub_spec": sub_value} for main_value in main_values for sub_value in sub_values]


def migrate_legacy_variants(db):
    products = db.execute("SELECT id FROM products").fetchall()
    for product in products:
        variants = db.execute("SELECT id FROM product_variants WHERE product_id = ?", (product["id"],)).fetchall()
        if variants:
            continue
        cur = db.execute(
            "INSERT INTO product_variants (product_id, main_spec, sub_spec, variant_key) VALUES (?, '', 'default', ?)",
            (product["id"], variant_key("", "default")),
        )
        db.execute(
            "UPDATE movements SET variant_id = ? WHERE product_id = ? AND variant_id IS NULL",
            (cur.lastrowid, product["id"]),
        )


def row_to_dict(row):
    return dict(row) if row is not None else None


def product_to_dict(row):
    product = row_to_dict(row)
    if product is None:
        return None
    product["image_url"] = f"/uploads/{product['image_filename']}" if product.get("image_filename") else None
    product["spec_config"] = parse_variant_config(product.get("specs_json"))
    product["specs"] = parse_specs(product.get("specs_json"))
    return product


def variant_rows(db, product_id):
    rows = db.execute(
        """
        SELECT
            v.id,
            v.product_id,
            v.main_spec,
            v.sub_spec,
            v.variant_key,
            v.image_filename,
            COALESCE(SUM(CASE WHEN m.type = 'in' THEN m.quantity ELSE 0 END), 0) AS total_in,
            COALESCE(SUM(CASE WHEN m.type = 'out' THEN m.quantity ELSE 0 END), 0) AS total_out,
            COALESCE(SUM(CASE WHEN m.type = 'in' THEN m.quantity ELSE -m.quantity END), 0) AS stock
        FROM product_variants v
        LEFT JOIN movements m ON m.variant_id = v.id
        WHERE v.product_id = ?
        GROUP BY v.id
        ORDER BY v.id
        """,
        (product_id,),
    ).fetchall()
    variants = []
    for row in rows:
        variant = row_to_dict(row)
        variant["image_url"] = f"/uploads/{variant['image_filename']}" if variant.get("image_filename") else None
        variants.append(variant)
    return variants


def attach_variants(db, product):
    product["variants"] = variant_rows(db, product["id"])
    product["total_in"] = sum(item["total_in"] for item in product["variants"])
    product["total_out"] = sum(item["total_out"] for item in product["variants"])
    product["stock"] = sum(item["stock"] for item in product["variants"])
    return product


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("authenticated"):
            return jsonify({"error": "请先登录"}), 401
        return fn(*args, **kwargs)

    return wrapper


def parse_int(value, field_name, min_value=None):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field_name} 必须是整数")
    if min_value is not None and parsed < min_value:
        raise ValueError(f"{field_name} 不能小于 {min_value}")
    return parsed


def clean_text(value):
    if value is None:
        return ""
    return str(value).strip()


def parse_specs(value):
    if not value:
        return []
    if isinstance(value, str):
        try:
            raw_specs = json.loads(value)
        except ValueError:
            return []
    else:
        raw_specs = value

    specs = []
    if not isinstance(raw_specs, list):
        return specs

    for item in raw_specs:
        if not isinstance(item, dict):
            continue
        name = clean_text(item.get("name"))
        value = clean_text(item.get("value"))
        if name or value:
            specs.append({"name": name, "value": value})
    return specs


def specs_to_json(value):
    return json.dumps(parse_specs(value), ensure_ascii=False)


def format_specs(specs):
    return "；".join(
        f"{spec['name']}：{spec['value']}" if spec.get("name") and spec.get("value") else spec.get("name") or spec.get("value")
        for spec in specs
    )


def next_sku(db):
    for _ in range(100):
        sku = f"{secrets.randbelow(1_000_000):06d}"
        exists = db.execute("SELECT 1 FROM products WHERE sku = ?", (sku,)).fetchone()
        if exists is None:
            return sku
    raise RuntimeError("暂时无法生成唯一 SKU，请重试")



def parse_variant_initial_stocks(value, variant_defs, default_value=0):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            value = {}
    if not isinstance(value, dict):
        value = {}
    result = {}
    for definition in variant_defs:
        key = variant_key(definition["main_spec"], definition["sub_spec"])
        raw = value.get(key, default_value)
        try:
            quantity = int(raw)
        except (TypeError, ValueError):
            quantity = default_value
        result[key] = max(quantity, 0)
    return result

def request_payload():
    if request.form:
        return request.form
    return request.get_json(force=True, silent=True) or {}


def image_extension(image):
    if image is None or not image.filename:
        return None
    safe_name = secure_filename(image.filename)
    extension = safe_name.rsplit(".", 1)[-1].lower() if "." in safe_name else ""
    if extension not in ALLOWED_IMAGE_EXTENSIONS:
        raise ValueError("图片只能上传 JPG、PNG、WebP 或 GIF")
    return extension


def save_uploaded_image(field_name):
    image = request.files.get(field_name)
    extension = image_extension(image)
    if extension is None:
        return None
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.{extension}"
    image.save(os.path.join(UPLOAD_DIR, filename))
    return filename


def parse_variant_image_fields(value, variant_defs):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            value = {}
    if not isinstance(value, dict):
        return {}

    valid_keys = {variant_key(item["main_spec"], item["sub_spec"]) for item in variant_defs}
    return {
        clean_text(field_name): clean_text(key)
        for field_name, key in value.items()
        if clean_text(field_name).startswith("variant_image_") and clean_text(key) in valid_keys
    }


def validate_image_fields(field_names):
    for field_name in field_names:
        image_extension(request.files.get(field_name))


def save_variant_images(image_fields):
    return {
        key: filename
        for field_name, key in image_fields.items()
        if (filename := save_uploaded_image(field_name))
    }


def delete_product_image(filename):
    if not filename:
        return
    image_path = os.path.abspath(os.path.join(UPLOAD_DIR, filename))
    upload_root = os.path.abspath(UPLOAD_DIR)
    if image_path.startswith(upload_root) and os.path.exists(image_path):
        os.remove(image_path)


def current_stock(db, product_id, variant_id=None):
    variant_clause = "AND variant_id = ?" if variant_id is not None else ""
    params = [product_id]
    if variant_id is not None:
        params.append(variant_id)
    row = db.execute(
        f"""
        SELECT COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END), 0) AS stock
        FROM movements
        WHERE product_id = ? {variant_clause}
        """,
        params,
    ).fetchone()
    return int(row["stock"])


def product_listing(db, where="", params=()):
    rows = db.execute(
        f"""
        SELECT
            p.id, p.sku, p.name, p.unit, p.low_stock_threshold, p.note,
            p.image_filename, p.specs_json, p.main_spec_name, p.sub_spec_name,
            p.created_at, p.updated_at
        FROM products p
        {where}
        ORDER BY p.updated_at DESC, p.id DESC
        """,
        params,
    ).fetchall()
    products = []
    for row in rows:
        product = product_to_dict(row)
        attach_variants(db, product)
        products.append(product)
    return products


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/uploads/<path:filename>")
@require_auth
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


@app.post("/api/login")
def login():
    payload = request.get_json(force=True, silent=True) or {}
    password = payload.get("password", "")
    with get_db() as db:
        ok = password_matches(db, password)
    if not ok:
        return jsonify({"error": "密码不正确"}), 401

    session["authenticated"] = True
    return jsonify({"ok": True})


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
def me():
    return jsonify({"authenticated": bool(session.get("authenticated"))})


@app.post("/api/change-password")
@require_auth
def change_password():
    payload = request.get_json(force=True, silent=True) or {}
    current_password = clean_text(payload.get("current_password"))
    new_password = clean_text(payload.get("new_password"))
    confirm_password = clean_text(payload.get("confirm_password"))

    if len(new_password) < 6:
        return jsonify({"error": "新密码至少需要 6 位"}), 400
    if new_password != confirm_password:
        return jsonify({"error": "两次输入的新密码不一致"}), 400

    with get_db() as db:
        if not password_matches(db, current_password):
            return jsonify({"error": "当前密码不正确"}), 401
        save_password_hash(db, new_password)
    return jsonify({"ok": True})


@app.get("/api/password-hash")
def password_hash_hint():
    password = request.args.get("password", "")
    if not password:
        return jsonify({"error": "请提供 password 参数"}), 400
    return jsonify({"hash": generate_password_hash(password)})


@app.get("/api/summary")
@require_auth
def summary():
    with get_db() as db:
        row = db.execute(
            """
            SELECT
                (SELECT COUNT(*) FROM products) AS product_count,
                (SELECT COALESCE(SUM(quantity), 0) FROM movements WHERE type = 'in') AS total_in,
                (SELECT COALESCE(SUM(quantity), 0) FROM movements WHERE type = 'out') AS total_out,
                (SELECT COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END), 0) FROM movements) AS total_stock,
                (SELECT COUNT(*) FROM (
                    SELECT v.id, p.low_stock_threshold,
                           COALESCE(SUM(CASE WHEN m.type = 'in' THEN m.quantity ELSE -m.quantity END), 0) AS qty
                    FROM product_variants v
                    JOIN products p ON p.id = v.product_id
                    LEFT JOIN movements m ON m.variant_id = v.id
                    GROUP BY v.id
                ) WHERE qty <= low_stock_threshold) AS low_stock_count
            """
        ).fetchone()
    return jsonify(row_to_dict(row))


@app.get("/api/products")
@require_auth
def list_products():
    query = clean_text(request.args.get("q"))
    with get_db() as db:
        if query:
            like = f"%{query}%"
            products = product_listing(
                db,
                "WHERE p.sku LIKE ? OR p.name LIKE ? OR p.specs_json LIKE ? OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND (v.main_spec LIKE ? OR v.sub_spec LIKE ?))",
                (like, like, like, like, like),
            )
        else:
            products = product_listing(db)
    return jsonify(products)


@app.post("/api/products")
@require_auth
def create_product():
    payload = request_payload()
    sku = clean_text(payload.get("sku"))
    name = clean_text(payload.get("name"))
    unit = clean_text(payload.get("unit")) or "件"
    note = clean_text(payload.get("note"))
    happened_at = clean_text(payload.get("happened_at")) or datetime.now().strftime("%Y-%m-%d")
    config = parse_variant_config(payload.get("variant_config"))
    variant_defs = build_variant_defs(config)
    image_fields = parse_variant_image_fields(payload.get("variant_image_keys"), variant_defs)

    try:
        low_stock_threshold = parse_int(payload.get("low_stock_threshold", 5), "低库存阈值", 0)
        initial_stock_default = parse_int(payload.get("initial_stock", 0), "新品入库数量", 0)
        initial_stocks = parse_variant_initial_stocks(
            payload.get("variant_stocks"),
            variant_defs,
            default_value=initial_stock_default if not config["main_values"] and not config["sub_values"] else 0,
        )
        validate_image_fields(["image", *image_fields])
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    image_filename = save_uploaded_image("image")
    variant_images = save_variant_images(image_fields)
    saved_images = [filename for filename in [image_filename, *variant_images.values()] if filename]

    try:
        with get_db() as db:
            sku = sku or next_sku(db)
            name = name or sku
            cur = db.execute(
                """
                INSERT INTO products (sku, name, unit, low_stock_threshold, note, image_filename, specs_json, main_spec_name, sub_spec_name, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, '', '', CURRENT_TIMESTAMP)
                """,
                (sku, name, unit, low_stock_threshold, note, image_filename, json.dumps(config, ensure_ascii=False)),
            )
            product_id = cur.lastrowid
            for definition in variant_defs:
                key = variant_key(definition["main_spec"], definition["sub_spec"])
                variant_cur = db.execute(
                    "INSERT INTO product_variants (product_id, main_spec, sub_spec, variant_key, image_filename) VALUES (?, ?, ?, ?, ?)",
                    (product_id, definition["main_spec"], definition["sub_spec"], key, variant_images.get(key)),
                )
                quantity = initial_stocks.get(key, 0)
                if quantity > 0:
                    db.execute(
                        "INSERT INTO movements (product_id, variant_id, type, quantity, reference, note, happened_at) VALUES (?, ?, 'in', ?, ?, ?, ?)",
                        (product_id, variant_cur.lastrowid, quantity, "新品入库", "创建商品时自动入库", happened_at),
                    )
            product = product_listing(db, "WHERE p.id = ?", (product_id,))[0]
    except sqlite3.IntegrityError:
        for filename in saved_images:
            delete_product_image(filename)
        return jsonify({"error": "这个 SKU 已经存在"}), 409

    return jsonify(product), 201


@app.put("/api/products/<int:product_id>")
@require_auth
def update_product(product_id):
    payload = request_payload()
    name = clean_text(payload.get("name"))
    unit = clean_text(payload.get("unit")) or "件"
    note = clean_text(payload.get("note"))
    config = parse_variant_config(payload.get("variant_config"))
    variant_defs = build_variant_defs(config)
    image_fields = parse_variant_image_fields(payload.get("variant_image_keys"), variant_defs)

    try:
        low_stock_threshold = parse_int(payload.get("low_stock_threshold", 0), "低库存阈值", 0)
        validate_image_fields(["image", *image_fields])
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    new_image_filename = save_uploaded_image("image")
    variant_images = save_variant_images(image_fields)
    saved_images = [filename for filename in [new_image_filename, *variant_images.values()] if filename]
    old_variant_images_to_delete = []

    try:
        with get_db() as db:
            existing = db.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
            if existing is None:
                for filename in saved_images:
                    delete_product_image(filename)
                return jsonify({"error": "商品不存在"}), 404

            sku = existing["sku"]
            name = name or sku
            image_filename = new_image_filename or existing["image_filename"]
            db.execute(
                "UPDATE products SET name = ?, unit = ?, low_stock_threshold = ?, note = ?, image_filename = ?, specs_json = ?, main_spec_name = '', sub_spec_name = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (name, unit, low_stock_threshold, note, image_filename, json.dumps(config, ensure_ascii=False), product_id),
            )
            existing_variants = {
                row["variant_key"]: row
                for row in db.execute("SELECT * FROM product_variants WHERE product_id = ?", (product_id,)).fetchall()
            }
            for definition in variant_defs:
                key = variant_key(definition["main_spec"], definition["sub_spec"])
                if key not in existing_variants:
                    db.execute(
                        "INSERT INTO product_variants (product_id, main_spec, sub_spec, variant_key, image_filename) VALUES (?, ?, ?, ?, ?)",
                        (product_id, definition["main_spec"], definition["sub_spec"], key, variant_images.get(key)),
                    )
                elif key in variant_images:
                    db.execute(
                        "UPDATE product_variants SET image_filename = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                        (variant_images[key], existing_variants[key]["id"]),
                    )
                    old_variant_images_to_delete.append(existing_variants[key]["image_filename"])
            product = product_listing(db, "WHERE p.id = ?", (product_id,))[0]
    except sqlite3.IntegrityError:
        for filename in saved_images:
            delete_product_image(filename)
        return jsonify({"error": "保存失败，请检查商品数据或 SKU"}), 409

    if new_image_filename:
        delete_product_image(existing["image_filename"])
    for filename in old_variant_images_to_delete:
        delete_product_image(filename)
    return jsonify(product)


@app.delete("/api/products/<int:product_id>")
@require_auth
def delete_product(product_id):
    with get_db() as db:
        product = db.execute("SELECT image_filename FROM products WHERE id = ?", (product_id,)).fetchone()
        if product is None:
            return jsonify({"error": "商品不存在"}), 404
        variant_images = [
            row["image_filename"]
            for row in db.execute("SELECT image_filename FROM product_variants WHERE product_id = ?", (product_id,)).fetchall()
        ]

        movement_count = db.execute(
            "SELECT COUNT(*) AS count FROM movements WHERE product_id = ?", (product_id,)
        ).fetchone()["count"]
        if movement_count:
            return jsonify({"error": "这个商品已有库存流水，不能直接删除"}), 409

        db.execute("DELETE FROM products WHERE id = ?", (product_id,))

    delete_product_image(product["image_filename"])
    for filename in variant_images:
        delete_product_image(filename)
    return jsonify({"ok": True})

@app.get("/api/movements")
@require_auth
def list_movements():
    product_id = request.args.get("product_id")
    limit = min(parse_int(request.args.get("limit", 100), "limit", 1), 500)

    where = ""
    params = []
    if product_id:
        where = "WHERE m.product_id = ?"
        params.append(parse_int(product_id, "product_id", 1))
    params.append(limit)

    with get_db() as db:
        rows = db.execute(
            f"""
            SELECT
                m.id,
                m.product_id,
                p.sku,
                p.name AS product_name,
                p.unit,
                p.image_filename,
                m.variant_id,
                v.main_spec,
                v.sub_spec,
                m.type,
                m.quantity,
                m.unit_price,
                m.reference,
                m.note,
                m.happened_at,
                m.created_at
            FROM movements m
            JOIN products p ON p.id = m.product_id
            LEFT JOIN product_variants v ON v.id = m.variant_id
            {where}
            ORDER BY m.happened_at DESC, m.id DESC
            LIMIT ?
            """,
            params,
        ).fetchall()

    movements = []
    for row in rows:
        item = row_to_dict(row)
        item["image_url"] = f"/uploads/{item['image_filename']}" if item.get("image_filename") else None
        movements.append(item)
    return jsonify(movements)


@app.post("/api/movements")
@require_auth
def create_movement():
    payload = request.get_json(force=True, silent=True) or {}
    movement_type = clean_text(payload.get("type"))
    product_id = payload.get("product_id")
    variant_id = payload.get("variant_id")
    quantity = payload.get("quantity")
    reference = clean_text(payload.get("reference"))
    note = clean_text(payload.get("note"))
    happened_at = clean_text(payload.get("happened_at")) or datetime.now().strftime("%Y-%m-%d")

    try:
        product_id = parse_int(product_id, "商品", 1)
        variant_id = parse_int(variant_id, "规格组合", 1)
        quantity = parse_int(quantity, "数量", 1)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if movement_type not in {"in", "out"}:
        return jsonify({"error": "流水类型只能是入库或出库"}), 400

    unit_price = payload.get("unit_price")
    if unit_price in ("", None):
        unit_price = None
    else:
        try:
            unit_price = float(unit_price)
        except (TypeError, ValueError):
            return jsonify({"error": "单价必须是数字"}), 400
        if unit_price < 0:
            return jsonify({"error": "单价不能小于 0"}), 400

    with get_db() as db:
        product = db.execute("SELECT id FROM products WHERE id = ?", (product_id,)).fetchone()
        if not product:
            return jsonify({"error": "商品不存在"}), 404

        variant = db.execute(
            "SELECT id, product_id, main_spec, sub_spec FROM product_variants WHERE id = ? AND product_id = ?",
            (variant_id, product_id),
        ).fetchone()
        if not variant:
            return jsonify({"error": "规格组合不存在，请重新选择"}), 404

        if movement_type == "out":
            stock = current_stock(db, product_id, variant_id)
            if quantity > stock:
                label = " / ".join(filter(None, [variant["main_spec"], variant["sub_spec"]])) or "默认规格"
                return jsonify({"error": f"{label} 当前库存只有 {stock}，不能出库 {quantity}"}), 409

        cur = db.execute(
            """
            INSERT INTO movements (product_id, variant_id, type, quantity, unit_price, reference, note, happened_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (product_id, variant_id, movement_type, quantity, unit_price, reference, note, happened_at),
        )
        db.execute("UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", (product_id,))
        movement = db.execute(
            """
            SELECT
                m.id,
                m.product_id,
                p.sku,
                p.name AS product_name,
                p.unit,
                p.image_filename,
                m.variant_id,
                v.main_spec,
                v.sub_spec,
                m.type,
                m.quantity,
                m.unit_price,
                m.reference,
                m.note,
                m.happened_at,
                m.created_at
            FROM movements m
            JOIN products p ON p.id = m.product_id
            LEFT JOIN product_variants v ON v.id = m.variant_id
            WHERE m.id = ?
            """,
            (cur.lastrowid,),
        ).fetchone()

    item = row_to_dict(movement)
    item["image_url"] = f"/uploads/{item['image_filename']}" if item.get("image_filename") else None
    return jsonify(item), 201


@app.delete("/api/movements/<int:movement_id>")
@require_auth
def delete_movement(movement_id):
    with get_db() as db:
        movement = db.execute("SELECT * FROM movements WHERE id = ?", (movement_id,)).fetchone()
        if not movement:
            return jsonify({"error": "流水不存在"}), 404

        if movement["type"] == "in":
            stock_after_delete = current_stock(db, movement["product_id"], movement["variant_id"]) - movement["quantity"]
            if stock_after_delete < 0:
                return jsonify({"error": "删除这条入库后库存会变成负数，请先调整相关出库记录"}), 409

        db.execute("DELETE FROM movements WHERE id = ?", (movement_id,))
        db.execute(
            "UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (movement["product_id"],),
        )
    return jsonify({"ok": True})


@app.get("/api/export/products.csv")
@require_auth
def export_products_csv():
    with get_db() as db:
        products = product_listing(db)

    output = io.StringIO()
    output.write("\ufeff")
    writer = csv.writer(output)
    writer.writerow(["SKU", "商品名称", "主规格", "子规格", "单位", "当前库存", "总入库", "总出库", "低库存阈值", "图片文件", "备注"])
    for product in products:
        for variant in product["variants"]:
            writer.writerow(
                [
                    product["sku"],
                    product["name"],
                    variant["main_spec"],
                    variant["sub_spec"],
                    product["unit"],
                    variant["stock"],
                    variant["total_in"],
                    variant["total_out"],
                    product["low_stock_threshold"],
                    product["image_filename"] or "",
                    product["note"] or "",
                ]
            )
    return Response(
        output.getvalue(),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=products.csv"},
    )


@app.get("/api/export/movements.csv")
@require_auth
def export_movements_csv():
    with get_db() as db:
        rows = db.execute(
            """
            SELECT
                m.happened_at,
                p.sku,
                p.name,
                v.main_spec,
                v.sub_spec,
                m.type,
                m.quantity,
                p.unit,
                m.unit_price,
                m.reference,
                m.note
            FROM movements m
            JOIN products p ON p.id = m.product_id
            LEFT JOIN product_variants v ON v.id = m.variant_id
            ORDER BY m.happened_at DESC, m.id DESC
            """
        ).fetchall()

    output = io.StringIO()
    output.write("\ufeff")
    writer = csv.writer(output)
    writer.writerow(["日期", "SKU", "商品名称", "主规格", "子规格", "类型", "数量", "单位", "单价", "单号/备注号", "备注"])
    for row in rows:
        writer.writerow(
            [
                row["happened_at"],
                row["sku"],
                row["name"],
                row["main_spec"] or "",
                row["sub_spec"] or "",
                "入库" if row["type"] == "in" else "出库",
                row["quantity"],
                row["unit"],
                "" if row["unit_price"] is None else row["unit_price"],
                row["reference"] or "",
                row["note"] or "",
            ]
        )
    return Response(
        output.getvalue(),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=movements.csv"},
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), debug=True)

