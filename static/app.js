const state = {
  products: [],
  movementType: "in",
  authenticated: false,
  productImageFile: null,
  productImagePreviewUrl: null,
  productExistingImageUrl: null,
  productImageRemoved: false,
  variantImageFiles: new Map(),
  variantImagePreviewUrls: new Map(),
  variantExistingImages: new Map(),
  variantRemovedImages: new Set(),
  imageProcessingCount: 0,
};

const $ = (selector) => document.querySelector(selector);
const els = {
  loginView: $("#loginView"), appView: $("#appView"), loginForm: $("#loginForm"), password: $("#password"),
  logoutBtn: $("#logoutBtn"), changePasswordBtn: $("#changePasswordBtn"), newProductBtn: $("#newProductBtn"), alertBox: $("#alertBox"),
  metricProducts: $("#metricProducts"), metricStock: $("#metricStock"), metricIn: $("#metricIn"), metricOut: $("#metricOut"), metricLow: $("#metricLow"),
  productSearch: $("#productSearch"), productsTable: $("#productsTable"), productModal: $("#productModal"), productModalTitle: $("#productModalTitle"),
  productForm: $("#productForm"), productId: $("#productId"), sku: $("#sku"), initialStockLabel: $("#initialStockLabel"), initialStock: $("#initialStock"), passwordModal: $("#passwordModal"), passwordForm: $("#passwordForm"), currentPassword: $("#currentPassword"), newPassword: $("#newPassword"), confirmPassword: $("#confirmPassword"),
  productImage: $("#productImage"), imagePasteZone: $("#imagePasteZone"), imagePasteText: $("#imagePasteText"), imagePreview: $("#imagePreview"), removeProductImageBtn: $("#removeProductImageBtn"),
  name: $("#name"), unit: $("#unit"), mainSpecRows: $("#mainSpecRows"), subSpecRows: $("#subSpecRows"),
  addMainSpecValueBtn: $("#addMainSpecValueBtn"), addSubSpecValueBtn: $("#addSubSpecValueBtn"), enableSubSpecBtn: $("#enableSubSpecBtn"), disableSubSpecBtn: $("#disableSubSpecBtn"), subSpecSection: $("#subSpecSection"), addSubSpecPrompt: $("#addSubSpecPrompt"),
  variantStockRows: $("#variantStockRows"), lowStock: $("#lowStock"), productHappenedAt: $("#productHappenedAt"), productNote: $("#productNote"),
  cancelProductEdit: $("#cancelProductEdit"), productSaveBtn: $("#productSaveBtn"), movementModal: $("#movementModal"), movementModalTitle: $("#movementModalTitle"),
  typeIn: $("#typeIn"), typeOut: $("#typeOut"), movementForm: $("#movementForm"), movementProduct: $("#movementProduct"), movementVariant: $("#movementVariant"),
  quantity: $("#quantity"), happenedAt: $("#happenedAt"), unitPrice: $("#unitPrice"), reference: $("#reference"), movementNote: $("#movementNote"), movementSubmit: $("#movementSubmit"),
};

function showAlert(message) {
  els.alertBox.textContent = message || "";
  els.alertBox.classList.toggle("hidden", !message);
}

async function api(path, options = {}) {
  const { showLoginOnUnauthorized = true, ...fetchOptions } = options;
  const headers = { ...(fetchOptions.headers || {}) };
  if (!(fetchOptions.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { headers, credentials: "same-origin", ...fetchOptions });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : {};
  if (!response.ok) {
    if (response.status === 401 && showLoginOnUnauthorized) showLogin();
    throw new Error(body.error || "请求失败");
  }
  return body;
}

function showLogin() { closeAllModals(); els.loginView.classList.remove("hidden"); els.appView.classList.add("hidden"); els.password.focus(); }
function showApp() { els.loginView.classList.add("hidden"); els.appView.classList.remove("hidden"); }
function openModal(modal) { modal.classList.remove("hidden"); }
function closeModal(modal) { modal.classList.add("hidden"); }
function closeAllModals() { closeModal(els.productModal); closeModal(els.passwordModal); closeModal(els.movementModal); }
function formatNumber(value) { return Number(value || 0).toLocaleString("zh-CN"); }
function today() { return new Date().toISOString().slice(0, 10); }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function variantLabel(variant) {
  const parts = [variant.main_spec, variant.sub_spec].filter((value) => value && value !== "default");
  return parts.join(" / ") || "默认规格";
}
function collectManualSpecValues(container) {
  return [...container.querySelectorAll(".manual-spec-value")].map((input) => input.value.trim()).filter(Boolean);
}
function addManualSpecRow(container, value = "") {
  const row = document.createElement("div");
  row.className = "manual-spec-row";
  row.innerHTML = `<input class="manual-spec-value" value="${escapeHtml(value)}" placeholder="输入规格值" /><button class="ghost small-btn" type="button" data-action="remove-manual-spec">删除</button>`;
  container.appendChild(row);
  row.querySelector(".manual-spec-value").focus();
}
function setSubSpecEnabled(enabled) {
  const stocks = collectVariantStocks();
  els.subSpecSection.classList.toggle("hidden", !enabled);
  els.addSubSpecPrompt.classList.toggle("hidden", enabled);
  if (enabled && !els.subSpecRows.querySelector(".manual-spec-row")) addManualSpecRow(els.subSpecRows);
  if (!enabled) els.subSpecRows.innerHTML = "";
  renderVariantStockRows(stocks);
}
function variantConfigFromInputs() {
  return {
    main_spec_name: "",
    main_values: collectManualSpecValues(els.mainSpecRows),
    sub_spec_name: "",
    sub_values: els.subSpecSection.classList.contains("hidden") ? [] : collectManualSpecValues(els.subSpecRows),
  };
}
function previewVariantDefs(config) {
  const mains = config.main_values.length ? config.main_values : [""];
  const subs = config.sub_values.length ? config.sub_values : ["default"];
  return mains.flatMap((main) => subs.map((sub) => ({ main_spec: main, sub_spec: sub })));
}
function variantKey(variant) { return JSON.stringify([variant.main_spec, variant.sub_spec]); }

function setMovementType(type) {
  state.movementType = type;
  els.typeIn.classList.toggle("active", type === "in");
  els.typeOut.classList.toggle("active", type === "out");
  els.movementModalTitle.textContent = type === "in" ? "进货加库存" : "发货减库存";
  els.movementSubmit.textContent = type === "in" ? "加库存" : "减库存";
  els.reference.placeholder = type === "in" ? "采购单号" : "订单号";
  els.unitPrice.parentElement.style.display = type === "in" ? "grid" : "none";
}

const IMAGE_TARGET_BYTES = 600 * 1024;
const IMAGE_MAX_SIDE = 1600;

function updateImagePreview(file, fallbackUrl = state.productExistingImageUrl) {
  if (state.productImagePreviewUrl) URL.revokeObjectURL(state.productImagePreviewUrl);
  state.productImagePreviewUrl = file ? URL.createObjectURL(file) : null;
  const previewUrl = state.productImagePreviewUrl || fallbackUrl;
  if (!previewUrl) {
    els.imagePreview.removeAttribute("src");
    els.imagePreview.classList.add("hidden");
    els.removeProductImageBtn.classList.add("hidden");
    els.imagePasteText.textContent = "选择文件或直接粘贴图片";
    return;
  }
  els.imagePreview.src = previewUrl;
  els.imagePreview.classList.remove("hidden");
  els.removeProductImageBtn.classList.remove("hidden");
  els.imagePasteText.textContent = file?.name || "已有商品图片";
}
function removeProductImage() {
  state.productImageFile = null;
  state.productExistingImageUrl = null;
  state.productImageRemoved = true;
  els.productImage.value = "";
  updateImagePreview(null, null);
  els.imagePasteZone.focus();
  showAlert("商品图片已移除，保存后生效；现在仍可重新粘贴图片");
}
function setImageProcessing(active) {
  state.imageProcessingCount = Math.max(0, state.imageProcessingCount + (active ? 1 : -1));
  els.productSaveBtn.disabled = state.imageProcessingCount > 0;
}
function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图片压缩失败")), type, quality));
}
async function decodeImage(file) {
  if ("createImageBitmap" in window) return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("无法读取这张图片")); image.src = url; });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function prepareImageForUpload(file) {
  if (!file?.type.startsWith("image/")) throw new Error("请选择图片文件");
  const source = await decodeImage(file);
  try {
    const sourceWidth = source.naturalWidth || source.width;
    const sourceHeight = source.naturalHeight || source.height;
    if (!sourceWidth || !sourceHeight) throw new Error("无法读取图片尺寸");
    if (file.size <= IMAGE_TARGET_BYTES && Math.max(sourceWidth, sourceHeight) <= IMAGE_MAX_SIDE) return file;

    let scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(sourceWidth, sourceHeight));
    let width = Math.max(1, Math.round(sourceWidth * scale));
    let height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("当前浏览器无法压缩图片");
    let smallestBlob = null;

    for (let pass = 0; pass < 4; pass += 1) {
      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);
      context.drawImage(source, 0, 0, width, height);
      for (const quality of [0.82, 0.7, 0.58, 0.46]) {
        const blob = await canvasToBlob(canvas, "image/webp", quality);
        if (!smallestBlob || blob.size < smallestBlob.size) smallestBlob = blob;
        if (blob.size <= IMAGE_TARGET_BYTES) return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "image"}.webp`, { type: "image/webp", lastModified: Date.now() });
      }
      width = Math.max(1, Math.round(width * 0.78));
      height = Math.max(1, Math.round(height * 0.78));
    }
    return new File([smallestBlob], `${file.name.replace(/\.[^.]+$/, "") || "image"}.webp`, { type: "image/webp", lastModified: Date.now() });
  } finally {
    if (typeof source.close === "function") source.close();
  }
}
async function setProductImageFile(file) {
  if (!file) return;
  setImageProcessing(true);
  showAlert("正在自动压缩商品图片，请稍候...");
  try {
    const uploadFile = await prepareImageForUpload(file);
    state.productImageFile = uploadFile;
    state.productImageRemoved = false;
    try { const transfer = new DataTransfer(); transfer.items.add(uploadFile); els.productImage.files = transfer.files; } catch { els.productImage.value = ""; }
    updateImagePreview(uploadFile);
    showAlert(file.size > uploadFile.size ? "商品图片已自动压缩" : "");
  } catch (error) {
    showAlert(error.message);
  } finally {
    setImageProcessing(false);
  }
}
function imageFromClipboard(event) { for (const item of event.clipboardData?.items || []) if (item.type.startsWith("image/")) return item.getAsFile(); return null; }

async function refreshAll() {
  showAlert("");
  const query = els.productSearch.value.trim();
  const [summary, products] = await Promise.all([api("/api/summary"), api(`/api/products${query ? `?q=${encodeURIComponent(query)}` : ""}`)]);
  state.products = products; renderSummary(summary); renderProducts(); renderProductOptions();
}
function renderSummary(summary) {
  els.metricProducts.textContent = formatNumber(summary.product_count); els.metricStock.textContent = formatNumber(summary.total_stock); els.metricIn.textContent = formatNumber(summary.total_in); els.metricOut.textContent = formatNumber(summary.total_out); els.metricLow.textContent = formatNumber(summary.low_stock_count);
}
function productById(id) { return state.products.find((product) => String(product.id) === String(id)); }
function renderProductOptions(selectedProductId = els.movementProduct.value) {
  els.movementProduct.innerHTML = "";
  for (const product of state.products) {
    const option = document.createElement("option"); option.value = product.id; option.textContent = `${product.sku} - ${product.name}（总库存 ${product.stock}${product.unit}）`; els.movementProduct.appendChild(option);
  }
  if (selectedProductId && productById(selectedProductId)) els.movementProduct.value = selectedProductId;
  renderVariantOptions();
}
function renderVariantOptions(selectedVariantId = els.movementVariant.value) {
  const product = productById(els.movementProduct.value);
  els.movementVariant.innerHTML = "";
  for (const variant of product?.variants || []) {
    const option = document.createElement("option"); option.value = variant.id; option.textContent = `${variantLabel(variant)}（库存 ${variant.stock}${product.unit}）`; els.movementVariant.appendChild(option);
  }
  if (selectedVariantId && [...els.movementVariant.options].some((option) => option.value === String(selectedVariantId))) els.movementVariant.value = selectedVariantId;
}

function clearVariantImageState() {
  for (const url of state.variantImagePreviewUrls.values()) URL.revokeObjectURL(url);
  state.variantImageFiles.clear();
  state.variantImagePreviewUrls.clear();
  state.variantExistingImages.clear();
  state.variantRemovedImages.clear();
}
function variantEditorImageMarkup(key) {
  const previewUrl = state.variantImagePreviewUrls.get(key) || state.variantExistingImages.get(key);
  return previewUrl
    ? `<img class="variant-upload-preview" src="${escapeHtml(previewUrl)}" alt="规格图片预览" />`
    : `<div class="variant-upload-preview variant-upload-empty">暂无图片</div>`;
}
function focusVariantImageZone(key) {
  const zone = [...els.variantStockRows.querySelectorAll(".variant-image-zone")].find((item) => item.dataset.variantImageKey === key);
  zone?.focus();
}
function removeVariantImage(key) {
  const previewUrl = state.variantImagePreviewUrls.get(key);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  state.variantImageFiles.delete(key);
  state.variantImagePreviewUrls.delete(key);
  state.variantExistingImages.delete(key);
  state.variantRemovedImages.add(key);
  const stocks = collectVariantStocks();
  renderVariantStockRows(stocks);
  requestAnimationFrame(() => focusVariantImageZone(key));
  showAlert("规格图片已移除，保存后生效；现在仍可重新粘贴图片");
}
function renderVariantStockRows(stocks = collectVariantStocks()) {
  const defs = previewVariantDefs(variantConfigFromInputs());
  els.variantStockRows.innerHTML = "";
  defs.forEach((variant) => {
    const row = document.createElement("div");
    row.className = "variant-stock-row";
    const key = variantKey(variant);
    row.dataset.variantKey = key;
    row.innerHTML = `
      <div class="variant-stock-identity"><span>${escapeHtml(variantLabel(variant))}</span></div>
      <label class="variant-quantity-field"><span>初始库存</span><input type="number" min="0" data-variant-key="${escapeHtml(key)}" value="${Number(stocks[key] || 0)}" /></label>
      <div class="variant-image-field">
        <span>规格图片</span>
        <div class="variant-image-zone" tabindex="0" data-variant-image-key="${escapeHtml(key)}">
          <div class="variant-image-zone-copy">
            <strong>选择文件或直接粘贴图片</strong>
            <span>按 Ctrl+V 粘贴；再次粘贴会替换</span>
          </div>
          <div class="variant-preview-actions">${variantEditorImageMarkup(key)}<button class="danger small-btn ${state.variantImageFiles.has(key) || state.variantExistingImages.has(key) ? "" : "hidden"}" type="button" data-action="remove-variant-image" data-variant-image-key="${escapeHtml(key)}">删除图片</button></div>
        </div>
        <input type="file" accept="image/*" data-variant-image-key="${escapeHtml(key)}" />
      </div>`;
    els.variantStockRows.appendChild(row);
  });
}
function collectVariantStocks() {
  return Object.fromEntries([...els.variantStockRows.querySelectorAll("input[data-variant-key]")].map((input) => [input.dataset.variantKey, input.value]));
}
async function setVariantImageFile(key, file) {
  if (!file) return;
  setImageProcessing(true);
  showAlert("正在自动压缩规格图片，请稍候...");
  try {
    const uploadFile = await prepareImageForUpload(file);
    const oldUrl = state.variantImagePreviewUrls.get(key);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    state.variantImageFiles.set(key, uploadFile);
    state.variantRemovedImages.delete(key);
    state.variantImagePreviewUrls.set(key, URL.createObjectURL(uploadFile));
    const stocks = collectVariantStocks();
    renderVariantStockRows(stocks);
    requestAnimationFrame(() => focusVariantImageZone(key));
    showAlert(file.size > uploadFile.size ? "规格图片已自动压缩，可继续粘贴替换" : "规格图片已选择，可继续粘贴替换");
  } catch (error) {
    showAlert(error.message);
  } finally {
    setImageProcessing(false);
  }
}
function renderProducts() {
  els.productsTable.innerHTML = "";
  if (!state.products.length) {
    els.productsTable.innerHTML = `<tr><td class="empty" colspan="6">还没有商品，点击“新品入库”添加第一个 SKU。</td></tr>`;
    return;
  }

  let productIndex = 0;
  for (const product of state.products) {
    if (productIndex > 0) {
      const separator = document.createElement("tr");
      separator.className = "product-separator-row";
      separator.innerHTML = `<td colspan="6" aria-hidden="true"></td>`;
      els.productsTable.appendChild(separator);
    }
    const variants = product.variants?.length
      ? product.variants
      : [{ id: "", main_spec: "", sub_spec: "default", stock: product.stock, total_in: product.total_in, total_out: product.total_out }];
    const mainGroups = [];
    const groupByMainSpec = new Map();

    for (const variant of variants) {
      const mainKey = variant.main_spec || "";
      if (!groupByMainSpec.has(mainKey)) {
        const group = { mainSpec: mainKey, variants: [] };
        groupByMainSpec.set(mainKey, group);
        mainGroups.push(group);
      }
      groupByMainSpec.get(mainKey).variants.push(variant);
    }

    let productRowIndex = 0;
    mainGroups.forEach((group, groupIndex) => {
      group.variants.forEach((variant, groupRowIndex) => {
        const isLow = Number(variant.stock) <= Number(product.low_stock_threshold);
        const tr = document.createElement("tr");
        tr.className = [isLow ? "low-row" : "", groupRowIndex === 0 && groupIndex > 0 ? "main-spec-group-split" : "", productRowIndex === 0 ? "product-group-first" : "", productRowIndex === variants.length - 1 ? "product-group-last" : "", productIndex % 2 ? "product-group-alt" : ""].filter(Boolean).join(" ");
        const productCell = productRowIndex === 0 ? `
          <td class="product-group-cell" rowspan="${variants.length}">
            <div class="product-main">${productImageMarkup(product)}<div><div class="product-name">${escapeHtml(product.name)}</div><div class="sku">${escapeHtml(product.sku)}</div><div class="subtle">${escapeHtml(product.note || "")}</div></div></div>
            <div class="product-total">商品总库存 <strong>${formatNumber(product.stock)}${escapeHtml(product.unit)}</strong></div>
            <div class="row-actions product-actions"><button class="ghost sort-button" type="button" data-action="move-product" data-direction="up" data-id="${product.id}" title="商品上移" aria-label="商品上移">↑</button><button class="ghost sort-button" type="button" data-action="move-product" data-direction="down" data-id="${product.id}" title="商品下移" aria-label="商品下移">↓</button><button class="ghost" type="button" data-action="edit-product" data-id="${product.id}">编辑商品</button><button class="danger" type="button" data-action="delete-product" data-id="${product.id}">删除商品</button></div>
          </td>` : "";
        const mainSpecCell = groupRowIndex === 0 ? `
          <td class="main-spec-group-cell" rowspan="${group.variants.length}">
            <span class="main-spec-value">${escapeHtml(group.mainSpec || "默认规格")}</span>
            ${group.variants.length > 1 ? `<span class="main-spec-count">${group.variants.length} 个子规格</span>` : ""}
          </td>` : "";
        const hasSubSpec = variant.sub_spec && variant.sub_spec !== "default";
        const variantImage = (variant.main_spec || hasSubSpec) ? (variant.image_url || product.image_url) : null;
        const variantImageMarkup = variantImage
          ? `<img class="variant-thumb" src="${escapeHtml(variantImage)}" alt="${escapeHtml(variantLabel(variant))}" loading="lazy" />`
          : ((variant.main_spec || hasSubSpec) ? `<div class="variant-thumb variant-thumb-empty">无图</div>` : "");
        const subSpecMarkup = hasSubSpec
          ? `<span class="sub-spec-value">${escapeHtml(variant.sub_spec)}</span>`
          : `<span class="sub-spec-empty">单规格</span>`;

        tr.innerHTML = `${productCell}${mainSpecCell}
          <td class="sub-spec-cell"><div class="variant-branch-cell">${variantImageMarkup}<div class="variant-branch">${subSpecMarkup}</div></div></td>
          <td class="stock-cell"><div class="stock-count ${isLow ? "low" : ""}">${formatNumber(variant.stock)}${escapeHtml(product.unit)}</div><div class="subtle">阈值 ${formatNumber(product.low_stock_threshold)}</div></td>
          <td class="flow-cell">${formatNumber(variant.total_in)} / ${formatNumber(variant.total_out)}</td>
          <td class="function-cell"><div class="row-actions"><button class="ghost" type="button" data-action="stock-in" data-id="${product.id}" data-variant-id="${variant.id}">进货 +</button><button class="ghost" type="button" data-action="stock-out" data-id="${product.id}" data-variant-id="${variant.id}">发货 -</button></div></td>`;
        els.productsTable.appendChild(tr);
        productRowIndex += 1;
      });
    });
    productIndex += 1;
  }
}
function productImageMarkup(product) { return product.image_url ? `<img class="product-thumb" src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.sku)}" loading="lazy" />` : `<div class="product-thumb product-thumb-empty">${escapeHtml(product.sku.slice(0, 2).toUpperCase())}</div>`; }

function resetProductForm() {
  els.productId.value = ""; els.productForm.reset(); els.sku.value = ""; els.sku.placeholder = "系统自动生成";
  state.productImageFile = null; state.productExistingImageUrl = null; state.productImageRemoved = false; updateImagePreview(null, null); clearVariantImageState();
  els.initialStock.value = "0"; els.unit.value = "件"; els.lowStock.value = "5"; els.productHappenedAt.value = today(); els.productNote.value = "";
  els.mainSpecRows.innerHTML = ""; addManualSpecRow(els.mainSpecRows); els.subSpecRows.innerHTML = ""; setSubSpecEnabled(false); els.variantStockRows.innerHTML = `<p class="subtle">添加规格值后，会自动生成库存分支。</p>`; els.productModalTitle.textContent = "新品入库"; els.initialStockLabel.classList.remove("hidden"); els.cancelProductEdit.classList.add("hidden"); els.productSaveBtn.textContent = "保存并入库";
}
function openNewProduct() { resetProductForm(); openModal(els.productModal); els.name.focus(); }
function editProduct(product) {
  const config = product.spec_config || { main_spec_name: product.main_spec_name || "", main_values: [], sub_spec_name: product.sub_spec_name || "", sub_values: [] };
  els.productId.value = product.id; els.productModalTitle.textContent = "编辑商品"; els.sku.value = product.sku; els.name.value = product.name; els.unit.value = product.unit; els.lowStock.value = product.low_stock_threshold; els.productHappenedAt.value = today(); els.productNote.value = product.note || ""; els.productImage.value = ""; state.productImageFile = null; state.productExistingImageUrl = product.image_url || null; state.productImageRemoved = false; updateImagePreview(null, state.productExistingImageUrl);
  clearVariantImageState(); (product.variants || []).forEach((variant) => { if (variant.image_url) state.variantExistingImages.set(variantKey(variant), variant.image_url); });
  els.mainSpecRows.innerHTML = ""; (config.main_values || []).forEach((value) => addManualSpecRow(els.mainSpecRows, value)); if (!els.mainSpecRows.children.length) addManualSpecRow(els.mainSpecRows);
  els.subSpecRows.innerHTML = ""; (config.sub_values || []).forEach((value) => addManualSpecRow(els.subSpecRows, value)); els.subSpecSection.classList.toggle("hidden", !(config.sub_values || []).length); els.addSubSpecPrompt.classList.toggle("hidden", Boolean((config.sub_values || []).length)); renderVariantStockRows(Object.fromEntries((product.variants || []).map((variant) => [variantKey(variant), variant.stock])));
  els.initialStockLabel.classList.add("hidden"); els.cancelProductEdit.classList.remove("hidden"); els.productSaveBtn.textContent = "保存商品"; openModal(els.productModal); els.name.focus();
}
function prepareMovement(product, type, variantId) { setMovementType(type); renderProductOptions(product.id); els.movementProduct.value = product.id; renderVariantOptions(variantId); els.movementVariant.value = variantId; els.quantity.value = "1"; els.happenedAt.value = today(); els.unitPrice.value = ""; els.reference.value = ""; els.movementNote.value = ""; openModal(els.movementModal); els.quantity.focus(); }
function buildProductFormData() {
  const formData = new FormData();
  if (els.productId.value) formData.append("sku", els.sku.value);
  formData.append("name", els.name.value);
  formData.append("unit", els.unit.value);
  formData.append("low_stock_threshold", els.lowStock.value);
  formData.append("note", els.productNote.value);
  formData.append("variant_config", JSON.stringify(variantConfigFromInputs()));
  formData.append("variant_stocks", JSON.stringify(collectVariantStocks()));
  formData.append("happened_at", els.productHappenedAt.value);
  if (!els.productId.value) formData.append("initial_stock", els.initialStock.value);
  const imageFile = state.productImageFile || els.productImage.files[0];
  if (imageFile) formData.append("image", imageFile);
  if (state.productImageRemoved) formData.append("remove_product_image", "1");
  const variantImageKeys = {};
  let index = 0;
  for (const [key, file] of state.variantImageFiles) {
    const fieldName = `variant_image_${index++}`;
    variantImageKeys[fieldName] = key;
    formData.append(fieldName, file);
  }
  formData.append("variant_image_keys", JSON.stringify(variantImageKeys));
  formData.append("remove_variant_images", JSON.stringify([...state.variantRemovedImages]));
  return formData;
}
els.loginForm.addEventListener("submit", async (event) => { event.preventDefault(); try { await api("/api/login", { method: "POST", body: JSON.stringify({ password: els.password.value }) }); state.authenticated = true; els.password.value = ""; showApp(); await refreshAll(); } catch (error) { showAlert(error.message); } });
els.logoutBtn.addEventListener("click", async () => { await api("/api/logout", { method: "POST" }); state.authenticated = false; showLogin(); });
els.changePasswordBtn.addEventListener("click", () => { els.passwordForm.reset(); openModal(els.passwordModal); els.currentPassword.focus(); });
els.passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/change-password", { method: "POST", body: JSON.stringify({ current_password: els.currentPassword.value, new_password: els.newPassword.value, confirm_password: els.confirmPassword.value }) });
    closeModal(els.passwordModal);
    showAlert("密码修改成功，下次登录请使用新密码");
    els.passwordForm.reset();
  } catch (error) { showAlert(error.message); }
});
els.newProductBtn.addEventListener("click", openNewProduct);
els.productImage.addEventListener("change", () => { const file = els.productImage.files[0]; if (file) setProductImageFile(file); });
els.imagePasteZone.addEventListener("click", (event) => { if (!event.target.closest("button")) els.imagePasteZone.focus(); });
els.removeProductImageBtn.addEventListener("click", removeProductImage);
els.imagePasteZone.addEventListener("paste", (event) => { const file = imageFromClipboard(event); if (file) { event.preventDefault(); event.stopPropagation(); setProductImageFile(file); } });
els.addMainSpecValueBtn.addEventListener("click", () => addManualSpecRow(els.mainSpecRows));
els.enableSubSpecBtn.addEventListener("click", () => setSubSpecEnabled(true));
els.disableSubSpecBtn.addEventListener("click", () => setSubSpecEnabled(false));
els.addSubSpecValueBtn.addEventListener("click", () => addManualSpecRow(els.subSpecRows));
els.mainSpecRows.addEventListener("input", () => renderVariantStockRows());
els.subSpecRows.addEventListener("input", () => renderVariantStockRows());
els.mainSpecRows.addEventListener("click", (event) => {
  if (event.target.closest("[data-action='remove-manual-spec']")) {
    event.target.closest(".manual-spec-row")?.remove();
    if (!els.mainSpecRows.querySelector(".manual-spec-row")) addManualSpecRow(els.mainSpecRows);
    renderVariantStockRows();
  }
});
els.subSpecRows.addEventListener("click", (event) => {
  if (event.target.closest("[data-action='remove-manual-spec']")) {
    event.target.closest(".manual-spec-row")?.remove();
    if (!els.subSpecRows.querySelector(".manual-spec-row")) addManualSpecRow(els.subSpecRows);
    renderVariantStockRows();
  }
});
els.variantStockRows.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-variant-image-key]");
  if (input?.files[0]) setVariantImageFile(input.dataset.variantImageKey, input.files[0]);
});
els.variantStockRows.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-action='remove-variant-image']");
  if (removeButton) {
    removeVariantImage(removeButton.dataset.variantImageKey);
    return;
  }
  const zone = event.target.closest(".variant-image-zone");
  if (zone && !event.target.closest("input, button")) zone.focus();
});
els.variantStockRows.addEventListener("paste", (event) => {
  const zone = event.target.closest(".variant-image-zone");
  const file = imageFromClipboard(event);
  if (zone && file) {
    event.preventDefault();
    event.stopPropagation();
    setVariantImageFile(zone.dataset.variantImageKey, file);
  }
});
els.productForm.addEventListener("submit", async (event) => { event.preventDefault(); if (state.imageProcessingCount > 0) { showAlert("图片正在自动压缩，请稍候再保存"); return; } try { await api(els.productId.value ? `/api/products/${els.productId.value}` : "/api/products", { method: els.productId.value ? "PUT" : "POST", body: buildProductFormData() }); closeModal(els.productModal); resetProductForm(); await refreshAll(); } catch (error) { showAlert(error.message); } });
els.cancelProductEdit.addEventListener("click", () => { closeModal(els.productModal); resetProductForm(); });
els.productSearch.addEventListener("input", async () => { try { await refreshAll(); } catch (error) { showAlert(error.message); } });
els.movementProduct.addEventListener("change", () => renderVariantOptions());
els.productsTable.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]"); if (!button) return; const product = productById(button.dataset.id); if (!product) return;
  if (button.dataset.action === "move-product") {
    try {
      await api(`/api/products/${product.id}/position`, { method: "PATCH", body: JSON.stringify({ direction: button.dataset.direction }) });
      await refreshAll();
    } catch (error) { showAlert(error.message); }
    return;
  }
  if (button.dataset.action === "edit-product") editProduct(product);
  if (button.dataset.action === "stock-in") prepareMovement(product, "in", button.dataset.variantId);
  if (button.dataset.action === "stock-out") prepareMovement(product, "out", button.dataset.variantId);
  if (button.dataset.action === "delete-product") { if (!confirm(`确定删除 ${product.name} 吗？已有流水的商品不能删除。`)) return; try { await api(`/api/products/${product.id}`, { method: "DELETE" }); await refreshAll(); } catch (error) { showAlert(error.message); } }
});
els.typeIn.addEventListener("click", () => setMovementType("in")); els.typeOut.addEventListener("click", () => setMovementType("out"));
els.movementForm.addEventListener("submit", async (event) => { event.preventDefault(); try { await api("/api/movements", { method: "POST", body: JSON.stringify({ type: state.movementType, product_id: els.movementProduct.value, variant_id: els.movementVariant.value, quantity: els.quantity.value, happened_at: els.happenedAt.value, unit_price: els.unitPrice.value, reference: els.reference.value, note: els.movementNote.value }) }); closeModal(els.movementModal); await refreshAll(); } catch (error) { showAlert(error.message); } });
document.addEventListener("click", (event) => { if (event.target.closest("[data-close-modal]")) closeAllModals(); });
document.addEventListener("paste", (event) => {
  if (els.productModal.classList.contains("hidden")) return;
  const file = imageFromClipboard(event);
  if (!file) return;
  const zone = event.target.closest?.(".variant-image-zone");
  event.preventDefault();
  if (zone) {
    setVariantImageFile(zone.dataset.variantImageKey, file);
    return;
  }
  setProductImageFile(file);
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeAllModals(); });

async function boot() {
  els.happenedAt.value = today(); els.productHappenedAt.value = today(); setMovementType("in");
  try { const me = await api("/api/me", { showLoginOnUnauthorized: false }); state.authenticated = Boolean(me.authenticated); } catch { state.authenticated = false; }
  if (state.authenticated) { showApp(); await refreshAll(); } else showLogin();
}
boot();
